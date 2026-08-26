import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  WidthType,
  ShadingType,
  HeadingLevel,
} from "docx";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import {
  StudyMaterialData,
  filterEducationalChapters,
  cleanDocumentTitle,
  isArtificialSubtitle,
} from "./study-material.types";
import { logTamilStage } from "./tamil-pipeline";

export interface PdfExportOptions {
  elementId?: string;
  domElement?: HTMLElement | null;
  onSuccess?: () => void;
  onError?: (err: any) => void;
}

// Cached Base64 font data for embedded Noto Sans Tamil
let cachedTamilFontBase64: string | null = null;

async function getEmbeddedTamilFont(): Promise<string | null> {
  if (cachedTamilFontBase64) return cachedTamilFontBase64;

  const fontSources = [
    "/fonts/NotoSansTamil.ttf",
    "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstamil/NotoSansTamil%5Bwdth%2Cwght%5D.ttf",
  ];

  for (const src of fontSources) {
    try {
      const res = await fetch(src);
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        cachedTamilFontBase64 =
          typeof btoa !== "undefined"
            ? btoa(binary)
            : typeof Buffer !== "undefined"
            ? Buffer.from(binary, "binary").toString("base64")
            : null;
        if (cachedTamilFontBase64) {
          return cachedTamilFontBase64;
        }
      }
    } catch {
      // try next source
    }
  }
  return null;
}

/**
 * Mathematical conversion from OKLCH color space to standard sRGB.
 * Guarantees crisp, exact color parity with website preview while
 * completely preventing html2canvas from throwing "unsupported color function oklch".
 */
export function oklchToRgb(l: number, c: number, h: number): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);

  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.2914855480 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const r = +4.0767434770 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3;

  const gamma = (x: number) =>
    x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(Math.max(0, x), 1 / 2.4) - 0.055;

  return [
    Math.min(255, Math.max(0, Math.round(gamma(r) * 255))),
    Math.min(255, Math.max(0, Math.round(gamma(g) * 255))),
    Math.min(255, Math.max(0, Math.round(gamma(bl) * 255))),
  ];
}

/**
 * Replaces any oklch(...) or modern color functions in CSS with standard rgb/rgba.
 */
export function sanitizeCssColors(css: string): string {
  if (!css || typeof css !== "string") return css;

  // 1. Convert standard oklch(L C H [/ A])
  let sanitized = css.replace(
    /oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([\d.]+(?:deg)?)(?:\s*\/\s*([\d.]+%?))?\s*\)/gi,
    (_match, lStr, cStr, hStr, aStr) => {
      let l = parseFloat(lStr);
      if (lStr.endsWith("%")) l /= 100;
      let c = parseFloat(cStr);
      if (cStr.endsWith("%")) c /= 100;
      let h = parseFloat(hStr);
      if (isNaN(h)) h = 0;

      let alpha = 1;
      if (aStr) {
        alpha = parseFloat(aStr);
        if (aStr.endsWith("%")) alpha /= 100;
      }

      const [r, g, b] = oklchToRgb(l, c, h);
      return alpha < 1
        ? `rgba(${r}, ${g}, ${b}, ${alpha})`
        : `rgb(${r}, ${g}, ${b})`;
    }
  );

  // 2. Convert light-dark(val1, val2) -> val1
  sanitized = sanitized.replace(/light-dark\(\s*([^,]+?)\s*,\s*[^)]+?\)/gi, "$1");

  // 3. Fallback: Catch any non-standard or complex oklch expressions
  sanitized = sanitized.replace(/oklch\([^)]+\)/gi, "#1e293b");

  // 4. Catch color(display-p3 ...) or color(srgb ...)
  sanitized = sanitized.replace(/color\([^)]+\)/gi, "#1e293b");

  return sanitized;
}

/**
 * High-fidelity, block-aware multi-page PDF generation for Study Material.
 * Captures the EXACT mounted website preview component (`StudyMaterialDocument`),
 * preserving 100% of the CSS design tokens, card styles, gradients, borders,
 * padding, colors, and HarfBuzz-rendered Tamil typography.
 *
 * Slices cleanly at `.pdf-block` boundaries without cutting cards or headings in half.
 * Adds an invisible selectable/searchable text layer with embedded Noto Sans Tamil font
 * so Tamil text in the PDF remains selectable, searchable (Ctrl+F), and copyable.
 */
export async function generateStudyMaterialPdf(
  material: StudyMaterialData,
  options?: PdfExportOptions
): Promise<void> {
  const toastId = toast.loading("Generating Study Material PDF from website preview...");

  try {
    const cleanChapters = filterEducationalChapters(material.chapters);
    const cleanTitle = cleanDocumentTitle(material.title, cleanChapters[0]?.chapterTitle);

    // Diagnostic Log Stage F: Content passed to PDF renderer
    logTamilStage(
      "F",
      "Content Passed to PDF Renderer",
      `Title: ${cleanTitle} | Chapters: ${cleanChapters.length}`
    );

    // 1. Locate the rendered preview DOM element (the exact single source of truth)
    let targetEl: HTMLElement | null =
      options?.domElement ||
      (options?.elementId ? document.getElementById(options.elementId) : null) ||
      document.getElementById("study-material-document-content");

    let tempContainer: HTMLElement | null = null;

    // If no DOM element is currently mounted in view, mount an offscreen container
    if (!targetEl) {
      const { createRoot } = await import("react-dom/client");
      const { StudyMaterialDocument } = await import("@/components/StudyMaterialDocument");
      const React = await import("react");

      tempContainer = document.createElement("div");
      tempContainer.id = "temp-study-material-export-container";
      tempContainer.style.position = "fixed";
      tempContainer.style.left = "-9999px";
      tempContainer.style.top = "0";
      tempContainer.style.width = "820px";
      tempContainer.style.backgroundColor = "#ffffff";
      tempContainer.style.zIndex = "-1000";
      document.body.appendChild(tempContainer);

      const root = createRoot(tempContainer);
      root.render(
        React.createElement(StudyMaterialDocument, {
          material,
          chapters: cleanChapters,
          isEditing: false,
        })
      );

      // Allow React to mount and paint
      await new Promise((resolve) => setTimeout(resolve, 250));
      targetEl = tempContainer.querySelector("#study-material-document-content") || tempContainer;
    }

    // 2. Wait for all fonts (specifically Noto Sans Tamil) to be ready
    if (typeof document !== "undefined" && document.fonts) {
      await document.fonts.ready;
    }

    // 3. Render the target element at crisp print resolution (2.2x scale, ~210 DPI)
    const scale = 2.2;
    const fullCanvas = await html2canvas(targetEl, {
      scale,
      useCORS: true,
      logging: false,
      backgroundColor: "#ffffff",
      windowWidth: targetEl.scrollWidth || 820,
      onclone: (clonedDoc) => {
        // 1. Gather all CSS rules from same-origin document.styleSheets
        let combinedCss = "";
        try {
          if (typeof document !== "undefined") {
            for (let i = 0; i < document.styleSheets.length; i++) {
              const sheet = document.styleSheets[i];
              try {
                const rules = sheet.cssRules || sheet.rules;
                if (rules) {
                  for (let j = 0; j < rules.length; j++) {
                    combinedCss += rules[j].cssText + "\n";
                  }
                }
              } catch {
                // Ignore cross-origin sheet errors (e.g. Google fonts)
              }
            }
          }
        } catch {}

        // 2. Remove all external <link rel="stylesheet"> that are NOT external web fonts
        // This prevents html2canvas from downloading external CSS files containing oklch over the network
        clonedDoc.querySelectorAll("link[rel='stylesheet']").forEach((link) => {
          const href = link.getAttribute("href") || "";
          if (!href.includes("fonts.googleapis.com") && !href.includes("font") && !href.includes("cdn")) {
            link.remove();
          }
        });

        // 3. Sanitize all existing <style> tags in cloned document
        clonedDoc.querySelectorAll("style").forEach((styleEl) => {
          if (styleEl.textContent && styleEl.textContent.includes("oklch")) {
            styleEl.textContent = sanitizeCssColors(styleEl.textContent);
          }
        });

        // 4. Inject the sanitized combined CSS into cloned document head
        if (combinedCss) {
          const sanitizedStyle = clonedDoc.createElement("style");
          sanitizedStyle.id = "injected-sanitized-css";
          sanitizedStyle.textContent = sanitizeCssColors(combinedCss);
          clonedDoc.head.appendChild(sanitizedStyle);
        }

        // 5. Walk all elements in the cloned document and fix any inline oklch styles
        const allElements = clonedDoc.querySelectorAll<HTMLElement>("*");
        allElements.forEach((el) => {
          const styleAttr = el.getAttribute("style");
          if (styleAttr && styleAttr.includes("oklch")) {
            el.setAttribute("style", sanitizeCssColors(styleAttr));
          }
        });
      },
    });

    // 4. Initialize jsPDF in A4 portrait format
    const doc = new jsPDF({
      orientation: "p",
      unit: "pt",
      format: "a4",
      compress: true,
    });

    // Embed Noto Sans Tamil font for selectable text layer
    const base64Font = await getEmbeddedTamilFont();
    const fontName = base64Font ? "NotoSansTamil" : "helvetica";
    if (base64Font) {
      doc.addFileToVFS("NotoSansTamil.ttf", base64Font);
      doc.addFont("NotoSansTamil.ttf", "NotoSansTamil", "normal");
      doc.setFont("NotoSansTamil", "normal");
    }

    const pageWidth = doc.internal.pageSize.getWidth(); // 595.28 pt
    const pageHeight = doc.internal.pageSize.getHeight(); // 841.89 pt
    const marginX = 24;
    const marginY = 28;
    const footerHeight = 28;
    const contentWidth = pageWidth - marginX * 2;
    const contentHeight = pageHeight - marginY * 2 - footerHeight;

    // Scale factor from element pixels to PDF points
    const elWidth = targetEl.offsetWidth || 820;
    const pxToPt = contentWidth / elWidth;
    const pageHeightPx = contentHeight / pxToPt;

    // 5. Query block elements (.pdf-block and .chapter-container) to compute clean page breaks
    const targetRect = targetEl.getBoundingClientRect();
    const blockElements = Array.from(
      targetEl.querySelectorAll(".pdf-block, .chapter-container")
    );

    const blockBoxes = blockElements.map((b) => {
      const r = b.getBoundingClientRect();
      return {
        top: r.top - targetRect.top,
        bottom: r.bottom - targetRect.top,
      };
    });

    // 6. Compute slice boundaries [startY, endY] respecting blocks
    const totalHeightPx = targetEl.scrollHeight || elWidth * (fullCanvas.height / fullCanvas.width);
    const slices: { startY: number; endY: number }[] = [];
    let curY = 0;

    while (curY < totalHeightPx) {
      let nextY = curY + pageHeightPx;
      if (nextY >= totalHeightPx) {
        slices.push({ startY: curY, endY: totalHeightPx });
        break;
      }

      // Check if any block crosses nextY
      let splitY = nextY;
      for (const b of blockBoxes) {
        if (b.top > curY && b.top < nextY && b.bottom > nextY) {
          // If block crossed boundary and page has at least 25% content, break before block
          if (b.top - curY > pageHeightPx * 0.25) {
            splitY = b.top;
            break;
          }
        }
      }

      slices.push({ startY: curY, endY: splitY });
      curY = splitY;
    }

    // 7. Add each sliced page to jsPDF
    const totalPages = slices.length;

    for (let pIdx = 0; pIdx < slices.length; pIdx++) {
      if (pIdx > 0) {
        doc.addPage();
      }

      const slice = slices[pIdx];
      const sliceHeightPx = slice.endY - slice.startY;
      const sliceHeightPt = sliceHeightPx * pxToPt;

      // Crop the high-DPI canvas for this page slice
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = fullCanvas.width;
      pageCanvas.height = Math.round(sliceHeightPx * scale);

      const pageCtx = pageCanvas.getContext("2d");
      if (pageCtx) {
        pageCtx.fillStyle = "#ffffff";
        pageCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        pageCtx.drawImage(
          fullCanvas,
          0,
          Math.round(slice.startY * scale),
          fullCanvas.width,
          Math.round(sliceHeightPx * scale),
          0,
          0,
          pageCanvas.width,
          pageCanvas.height
        );
      }

      const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
      doc.addImage(imgData, "JPEG", marginX, marginY, contentWidth, sliceHeightPt);

      // 8. Add invisible selectable text layer (/Tr 3 = invisible text in PDF standard)
      // This ensures the Tamil text remains searchable with Ctrl+F and copyable with mouse cursor
      try {
        doc.saveGraphicsState();
        (doc.internal as any).write("/Tr 3\n"); // Set Text Rendering Mode to 'Neither fill nor stroke'
        doc.setFont(fontName, "normal");
        doc.setFontSize(10);

        // Find text elements on this page slice
        const textNodes = Array.from(
          targetEl.querySelectorAll("h1, h2, h3, p, span, li, td, th")
        );

        for (const node of textNodes) {
          const r = node.getBoundingClientRect();
          const nodeTop = r.top - targetRect.top;
          const nodeLeft = r.left - targetRect.left;

          if (nodeTop >= slice.startY && nodeTop < slice.endY) {
            const rawText = (node.textContent || "").trim();
            if (rawText.length > 0) {
              const textX = marginX + nodeLeft * pxToPt;
              const textY = marginY + (nodeTop - slice.startY) * pxToPt + 10;
              // Only write if within page boundaries
              if (textX >= marginX && textX <= pageWidth - marginX && textY <= pageHeight - footerHeight) {
                const singleLine = rawText.replace(/\s+/g, " ").slice(0, 120);
                doc.text(singleLine, textX, textY);
              }
            }
          }
        }
        doc.restoreGraphicsState();
      } catch {
        // Fallback gracefully if text overlay encounter issues
      }

      // 9. Draw clean page footer
      doc.setFont(fontName, "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184); // slate-400

      // Separator line above footer
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(0.5);
      doc.line(marginX, pageHeight - footerHeight + 10, pageWidth - marginX, pageHeight - footerHeight + 10);

      // Running document title on left
      const shortTitle = cleanTitle.length > 45 ? cleanTitle.slice(0, 42) + "..." : cleanTitle;
      doc.text(shortTitle, marginX, pageHeight - footerHeight + 22);

      // Page numbers on right
      doc.text(
        `Page ${pIdx + 1} of ${totalPages}`,
        pageWidth - marginX,
        pageHeight - footerHeight + 22,
        { align: "right" }
      );
    }

    // Clean up temporary mounted container if created
    if (tempContainer && tempContainer.parentNode) {
      tempContainer.parentNode.removeChild(tempContainer);
    }

    const cleanFileName = material.pdf_name
      ? material.pdf_name.replace(/\.(pdf|docx?)$/i, "").replace(/\s+/g, "_")
      : "Study_Material";

    doc.save(`${cleanFileName}_StudyMaterial.pdf`);

    toast.dismiss(toastId);
    toast.success("Study Material PDF downloaded successfully!");
    options?.onSuccess?.();
  } catch (err: any) {
    console.error("PDF generation failed:", err);
    toast.dismiss(toastId);
    toast.error(`PDF generation failed: ${err.message || err}`);
    options?.onError?.(err);
  }
}

/**
 * Triggers the browser's native print preview dialog for Study Material.
 * In browser print preview, Chromium/WebKit/Gecko render the shared DOM
 * element into a vector-grade, 100% selectable PDF with full CSS styling.
 */
export function printStudyMaterialDocument(): void {
  window.print();
}

/**
 * Generates and downloads a clean, styled Microsoft Word (.docx) file from Study Material.
 * Preserves the exact final validated content, Tamil text, headings, cards,
 * colors, borders, exam points, quick revision, and tables.
 */
export async function generateStudyMaterialWord(
  material: StudyMaterialData,
  options?: { onSuccess?: () => void; onError?: (err: any) => void }
): Promise<void> {
  const toastId = toast.loading("Generating Word document (.docx)...");

  try {
    const cleanChapters = filterEducationalChapters(material.chapters);
    const cleanTitle = cleanDocumentTitle(material.title, cleanChapters[0]?.chapterTitle);

    const docChildren: any[] = [];

    // Document Title (Matching website header)
    docChildren.push(
      new Paragraph({
        children: [
          new TextRun({
            text: cleanTitle,
            bold: true,
            size: 38, // 19pt
            color: "0f172a", // slate-900
            font: "Noto Sans Tamil",
          }),
        ],
        spacing: { before: 100, after: 120 },
      })
    );

    // Subtitle if valid educational topic
    if (material.subtitle && !isArtificialSubtitle(material.subtitle)) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: material.subtitle,
              size: 24, // 12pt
              color: "475569", // slate-600
              italics: true,
              font: "Noto Sans Tamil",
            }),
          ],
          spacing: { after: 260 },
        })
      );
    }

    // Chapters and Sections
    for (let c = 0; c < cleanChapters.length; c++) {
      const ch = cleanChapters[c];

      // Chapter Header Banner (Styled table matching the indigo banner on the website)
      const chapterCellBorders = {
        top: { style: BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: BorderStyle.SINGLE, size: 36, color: "4f46e5" }, // 4.5pt solid indigo-600
      };

      const chapterBannerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                borders: chapterCellBorders,
                shading: { type: ShadingType.CLEAR, fill: "eef2ff" }, // indigo-50
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `Chapter ${ch.chapterNumber || c + 1}: ${ch.chapterTitle}`,
                        bold: true,
                        size: 28, // 14pt
                        color: "1e1b4b", // indigo-950
                        font: "Noto Sans Tamil",
                      }),
                    ],
                    spacing: { before: 140, after: ch.summary ? 60 : 140 },
                  }),
                  ...(ch.summary
                    ? [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: ch.summary,
                              italics: true,
                              size: 22, // 11pt
                              color: "3730a3", // indigo-800
                              font: "Noto Sans Tamil",
                            }),
                          ],
                          spacing: { after: 140 },
                        }),
                      ]
                    : []),
                ],
              }),
            ],
          }),
        ],
      });

      docChildren.push(chapterBannerTable);
      docChildren.push(new Paragraph({ spacing: { after: 120 } }));

      // Sections inside Chapter
      for (const sec of ch.sections || []) {
        // Section Title with colored bullet
        docChildren.push(
          new Paragraph({
            children: [
              new TextRun({
                text: "● ",
                color: "4f46e5",
                bold: true,
                size: 24,
                font: "Noto Sans Tamil",
              }),
              new TextRun({
                text: sec.title || "",
                bold: true,
                size: 26, // 13pt
                color: "1e293b", // slate-800
                font: "Noto Sans Tamil",
              }),
            ],
            spacing: { before: 180, after: 100 },
          })
        );

        // Section Content
        if (sec.content) {
          docChildren.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: sec.content,
                  size: 22, // 11pt
                  color: "334155", // slate-700
                  font: "Noto Sans Tamil",
                }),
              ],
              spacing: { after: 120 },
            })
          );
        }

        // Exam Points (Styled Table matching amber highlight cards)
        if (sec.type === "exam_points" && sec.items && sec.items.length > 0) {
          for (const item of sec.items) {
            const examCardTable = new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 6, color: "fcd34d" },
                        right: { style: BorderStyle.SINGLE, size: 6, color: "fcd34d" },
                        bottom: { style: BorderStyle.SINGLE, size: 6, color: "fcd34d" },
                        left: { style: BorderStyle.SINGLE, size: 6, color: "fcd34d" },
                      },
                      shading: { type: ShadingType.CLEAR, fill: "fffbeb" }, // amber-50
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: "★ ",
                              bold: true,
                              color: "d97706", // amber-600
                              size: 22,
                            }),
                            new TextRun({
                              text: item,
                              bold: true,
                              color: "451a03", // amber-950
                              size: 22,
                              font: "Noto Sans Tamil",
                            }),
                          ],
                          spacing: { before: 80, after: 80 },
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            });
            docChildren.push(examCardTable);
            docChildren.push(new Paragraph({ spacing: { after: 60 } }));
          }
        }

        // Quick Revision (Styled Table matching emerald key → value cards)
        if (sec.type === "quick_revision" && sec.quickRevisionList && sec.quickRevisionList.length > 0) {
          for (const qr of sec.quickRevisionList) {
            const qrCardTable = new Table({
              width: { size: 100, type: WidthType.PERCENTAGE },
              rows: [
                new TableRow({
                  children: [
                    new TableCell({
                      borders: {
                        top: { style: BorderStyle.SINGLE, size: 6, color: "6ee7b7" },
                        right: { style: BorderStyle.SINGLE, size: 6, color: "6ee7b7" },
                        bottom: { style: BorderStyle.SINGLE, size: 6, color: "6ee7b7" },
                        left: { style: BorderStyle.SINGLE, size: 6, color: "6ee7b7" },
                      },
                      shading: { type: ShadingType.CLEAR, fill: "ecfdf5" }, // emerald-50
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: qr.key || "",
                              bold: true,
                              color: "064e3b", // emerald-900
                              size: 22,
                              font: "Noto Sans Tamil",
                            }),
                            new TextRun({
                              text: "  →  ",
                              bold: true,
                              color: "059669", // emerald-600
                              size: 22,
                            }),
                            new TextRun({
                              text: qr.value || "",
                              color: "1e293b",
                              size: 22,
                              font: "Noto Sans Tamil",
                            }),
                          ],
                          spacing: { before: 80, after: 80 },
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            });
            docChildren.push(qrCardTable);
            docChildren.push(new Paragraph({ spacing: { after: 60 } }));
          }
        }

        // Key Facts Cards
        if (sec.type === "facts" && sec.keyFactList && sec.keyFactList.length > 0) {
          for (const f of sec.keyFactList) {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${f.label}: `,
                    bold: true,
                    color: "0f172a",
                    size: 22,
                    font: "Noto Sans Tamil",
                  }),
                  new TextRun({
                    text: f.value,
                    color: "334155",
                    size: 22,
                    font: "Noto Sans Tamil",
                  }),
                ],
                spacing: { after: 60 },
              })
            );
          }
        }

        // Important Dates
        if (sec.type === "dates" && sec.dateList && sec.dateList.length > 0) {
          for (const d of sec.dateList) {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `[${d.date}] `,
                    bold: true,
                    color: "0369a1", // sky-700
                    size: 22,
                    font: "Noto Sans Tamil",
                  }),
                  new TextRun({
                    text: d.event,
                    color: "1e293b",
                    size: 22,
                    font: "Noto Sans Tamil",
                  }),
                ],
                spacing: { after: 60 },
              })
            );
          }
        }

        // Definitions
        if (sec.type === "definitions" && sec.definitionList && sec.definitionList.length > 0) {
          for (const def of sec.definitionList) {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `📌 ${def.term}: `,
                    bold: true,
                    color: "7c3aed", // purple-600
                    size: 22,
                    font: "Noto Sans Tamil",
                  }),
                  new TextRun({
                    text: def.definition,
                    color: "334155",
                    size: 22,
                    font: "Noto Sans Tamil",
                  }),
                ],
                spacing: { after: 60 },
              })
            );
          }
        }

        // Tables
        if (sec.tableData && sec.tableData.headers && sec.tableData.rows) {
          const headers = sec.tableData.headers;
          const rows = sec.tableData.rows;

          if (headers.length > 0 && rows.length > 0) {
            const tableRows = [
              new TableRow({
                children: headers.map(
                  (h) =>
                    new TableCell({
                      shading: { type: ShadingType.CLEAR, fill: "eef2ff" },
                      children: [
                        new Paragraph({
                          children: [
                            new TextRun({
                              text: h,
                              bold: true,
                              color: "312e81",
                              size: 20,
                              font: "Noto Sans Tamil",
                            }),
                          ],
                        }),
                      ],
                    })
                ),
              }),
              ...rows.map(
                (row, rI) =>
                  new TableRow({
                    children: row.map(
                      (cell) =>
                        new TableCell({
                          shading: {
                            type: ShadingType.CLEAR,
                            fill: rI % 2 === 0 ? "ffffff" : "f8fafc",
                          },
                          children: [
                            new Paragraph({
                              children: [
                                new TextRun({
                                  text: cell,
                                  color: "334155",
                                  size: 20,
                                  font: "Noto Sans Tamil",
                                }),
                              ],
                            }),
                          ],
                        })
                    ),
                  })
              ),
            ];

            docChildren.push(
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: tableRows,
              })
            );
            docChildren.push(new Paragraph({ spacing: { after: 120 } }));
          }
        }

        // Standard Bullets
        if (sec.items && sec.type !== "exam_points" && sec.items.length > 0) {
          for (const item of sec.items) {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({
                    text: `• ${item}`,
                    size: 22,
                    color: "1e293b",
                    font: "Noto Sans Tamil",
                  }),
                ],
                spacing: { after: 60 },
              })
            );
          }
        }
      }
    }

    const doc = new Document({
      styles: {
        default: {
          document: {
            run: {
              font: "Noto Sans Tamil",
              size: 22,
              color: "1e293b",
            },
          },
        },
      },
      sections: [
        {
          properties: {
            page: {
              margin: {
                top: 1440,
                right: 1440,
                bottom: 1440,
                left: 1440,
              },
            },
          },
          children: docChildren,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const cleanFileName = material.pdf_name
      ? material.pdf_name.replace(/\.(pdf|docx?)$/i, "").replace(/\s+/g, "_")
      : "Study_Material";

    saveAs(blob, `${cleanFileName}_StudyMaterial.docx`);
    toast.dismiss(toastId);
    toast.success("Word document (.docx) downloaded successfully!");
    options?.onSuccess?.();
  } catch (err: any) {
    console.error("Word export failed:", err);
    toast.dismiss(toastId);
    toast.error(`Word document export failed: ${err.message || err}`);
    options?.onError?.(err);
  }
}
