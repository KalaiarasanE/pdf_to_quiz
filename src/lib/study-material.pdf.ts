import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import {
  StudyMaterialData,
  filterEducationalChapters,
  cleanDocumentTitle,
  isArtificialSubtitle,
} from "./study-material.types";

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
 * High-fidelity, multi-page PDF generation for Study Material.
 * Uses the EXACT shared design system of the website preview, ensuring 100% visual
 * consistency across font, spacing, borders, cards, and Tamil Unicode rendering.
 */
export async function generateStudyMaterialPdf(
  material: StudyMaterialData,
  options?: PdfExportOptions
): Promise<void> {
  const toastId = toast.loading("Generating Study Material PDF...");

  try {
    const cleanChapters = filterEducationalChapters(material.chapters);
    const cleanTitle = cleanDocumentTitle(material.title, cleanChapters[0]?.chapterTitle);

    // Locate the rendered preview DOM element
    let targetEl: HTMLElement | null =
      options?.domElement ||
      (options?.elementId ? document.getElementById(options.elementId) : null) ||
      document.getElementById("study-material-document-content");

    let tempContainer: HTMLElement | null = null;

    // If no DOM element is currently mounted in view, render a temporary styled container
    if (!targetEl) {
      tempContainer = document.createElement("div");
      tempContainer.style.position = "fixed";
      tempContainer.style.left = "-9999px";
      tempContainer.style.top = "0";
      tempContainer.style.width = "820px"; // Standard A4 content container width
      tempContainer.style.backgroundColor = "#ffffff";
      tempContainer.style.zIndex = "-1000";
      tempContainer.innerHTML = buildDocumentHtmlString(material, cleanTitle, cleanChapters);
      document.body.appendChild(tempContainer);
      targetEl = tempContainer;
    }

    // Capture the target DOM element at high DPI using html2canvas
    const scale = 2.0; // 2x scale for crisp 192 DPI print-grade resolution
    const canvas = await html2canvas(targetEl, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#ffffff",
      logging: false,
      windowWidth: 820,
    });

    if (tempContainer && tempContainer.parentNode) {
      tempContainer.parentNode.removeChild(tempContainer);
    }

    // A4 dimensions in PDF points (72 pt per inch)
    // A4 = 595.28 pt width x 841.89 pt height
    const pdfPageWidth = 595.28;
    const pdfPageHeight = 841.89;

    const marginPt = 36; // 0.5 inch margins
    const headerHeightPt = 32;
    const footerHeightPt = 32;
    const usableWidthPt = pdfPageWidth - marginPt * 2;
    const usableHeightPt = pdfPageHeight - headerHeightPt - footerHeightPt;

    // Convert PDF usable dimensions to canvas pixels
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const pxPerPt = canvasWidth / usableWidthPt;
    const pageSliceHeightPx = usableHeightPt * pxPerPt;

    // Identify intelligent block-aware break points
    const blockElements = targetEl.querySelectorAll(".pdf-block, .chapter-container");
    const breakPositionsPx: number[] = [];
    const rootTop = targetEl.getBoundingClientRect().top;

    blockElements.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const relativeTopPx = (rect.top - rootTop) * scale;
      if (relativeTopPx > 20 && relativeTopPx < canvasHeight - 20) {
        breakPositionsPx.push(relativeTopPx);
      }
    });

    // Calculate slice boundaries
    const pageSlices: { startY: number; endY: number }[] = [];
    let currentY = 0;

    while (currentY < canvasHeight) {
      let targetEndY = currentY + pageSliceHeightPx;

      if (targetEndY >= canvasHeight) {
        pageSlices.push({ startY: currentY, endY: canvasHeight });
        break;
      }

      // Find the best clean split point near targetEndY
      // Prefer breaking before the closest block above targetEndY
      const candidateBreak = breakPositionsPx
        .filter((y) => y > currentY + pageSliceHeightPx * 0.4 && y <= targetEndY)
        .pop();

      if (candidateBreak && targetEndY - candidateBreak < pageSliceHeightPx * 0.35) {
        targetEndY = candidateBreak;
      }

      pageSlices.push({ startY: currentY, endY: targetEndY });
      currentY = targetEndY;
    }

    const totalPages = pageSlices.length;

    // Initialize jsPDF document
    const doc = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
      compress: true,
    });

    // Embed Noto Sans Tamil into PDF VFS for Unicode text selection and headers
    const base64TamilFont = await getEmbeddedTamilFont();
    if (base64TamilFont) {
      try {
        doc.addFileToVFS("NotoSansTamil.ttf", base64TamilFont);
        doc.addFont("NotoSansTamil.ttf", "NotoSansTamil", "normal");
        doc.setFont("NotoSansTamil", "normal");
      } catch (err) {
        console.warn("Could not register Tamil font in jsPDF VFS:", err);
      }
    }

    const setDocFont = (bold: boolean = false) => {
      if (base64TamilFont) {
        doc.setFont("NotoSansTamil", "normal");
      } else {
        doc.setFont("helvetica", bold ? "bold" : "normal");
      }
    };

    // Render each page slice onto PDF
    for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
      if (pageIdx > 0) {
        doc.addPage();
      }

      const slice = pageSlices[pageIdx];
      const sliceH = slice.endY - slice.startY;

      // Create a canvas slice
      const pageCanvas = document.createElement("canvas");
      pageCanvas.width = canvasWidth;
      pageCanvas.height = sliceH;
      const ctx = pageCanvas.getContext("2d");

      if (ctx) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvasWidth, sliceH);
        ctx.drawImage(
          canvas,
          0,
          slice.startY,
          canvasWidth,
          sliceH,
          0,
          0,
          canvasWidth,
          sliceH
        );
      }

      const imgData = pageCanvas.toDataURL("image/jpeg", 0.95);
      const renderedHeightPt = sliceH / pxPerPt;

      // Draw Header on secondary pages
      if (pageIdx > 0) {
        doc.setDrawColor(226, 232, 240); // slate-200
        doc.setLineWidth(0.75);
        doc.line(marginPt, 26, pdfPageWidth - marginPt, 26);

        setDocFont(false);
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184); // slate-400
        doc.text(cleanTitle.slice(0, 55), marginPt, 20);
        doc.text("Study Notes", pdfPageWidth - marginPt, 20, { align: "right" });
      }

      // Draw the pixel-perfect page canvas
      const topY = pageIdx === 0 ? marginPt : headerHeightPt;
      doc.addImage(
        imgData,
        "JPEG",
        marginPt,
        topY,
        usableWidthPt,
        renderedHeightPt,
        undefined,
        "FAST"
      );

      // Draw Footer & Page Numbering on all pages
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.75);
      doc.line(
        marginPt,
        pdfPageHeight - footerHeightPt + 10,
        pdfPageWidth - marginPt,
        pdfPageHeight - footerHeightPt + 10
      );

      setDocFont(false);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Page ${pageIdx + 1} of ${totalPages}`,
        pdfPageWidth - marginPt,
        pdfPageHeight - 14,
        { align: "right" }
      );
    }

    // Save and download PDF directly
    const cleanName = material.pdf_name.replace(/\.(pdf|docx?)$/i, "").replace(/\s+/g, "_");
    const downloadFileName = `${cleanName}_Study_Material.pdf`;

    doc.save(downloadFileName);

    toast.dismiss(toastId);
    toast.success(`Study Material PDF downloaded (${downloadFileName})!`);
    if (options?.onSuccess) options.onSuccess();
  } catch (err: any) {
    toast.dismiss(toastId);
    console.error("Study Material PDF generation error:", err);
    toast.error("Failed to generate Study Material PDF.");
    if (options?.onError) options.onError(err);
  }
}

/**
 * Builds standalone HTML markup matching the shared design system
 * for off-screen rendering when DOM element is not currently in viewport.
 */
function buildDocumentHtmlString(
  material: StudyMaterialData,
  title: string,
  chapters: any[]
): string {
  const subtitleHtml =
    material.subtitle && !isArtificialSubtitle(material.subtitle)
      ? `<p style="font-size: 14px; color: #475569; margin-top: 6px; font-weight: 500;">${escapeHtml(
          material.subtitle
        )}</p>`
      : "";

  let chaptersHtml = "";
  for (let c = 0; c < chapters.length; c++) {
    const ch = chapters[c];
    const sourceBadge = ch.sourcePages
      ? `<span style="background: rgba(255,255,255,0.9); color: #3730a3; font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px; border: 1px solid #c7d2fe; margin-right: 8px;">${escapeHtml(
          ch.sourcePages
        )}</span>`
      : "";

    let sectionsHtml = "";
    for (let s = 0; s < (ch.sections || []).length; s++) {
      const sec = ch.sections[s];

      let secContent = "";
      if (sec.content) {
        secContent += `<p style="font-size: 14px; color: #334155; line-height: 1.6; padding-left: 12px; border-left: 2px solid #cbd5e1; margin-bottom: 12px;">${escapeHtml(
          sec.content
        )}</p>`;
      }

      if (sec.type === "exam_points" && sec.items) {
        secContent += `<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;">`;
        for (const item of sec.items) {
          secContent += `<div style="padding: 12px; background: #fffbeb; border: 1px solid #fcd34d; border-radius: 12px; display: flex; gap: 10px; font-size: 14px; font-weight: 600; color: #451a03; line-height: 1.5;"><span style="color: #d97706;">★</span><span>${escapeHtml(
            item
          )}</span></div>`;
        }
        secContent += `</div>`;
      } else if (sec.type === "quick_revision" && sec.quickRevisionList) {
        secContent += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 12px;">`;
        for (const qr of sec.quickRevisionList) {
          secContent += `<div style="padding: 10px 14px; background: #ecfdf5; border: 1px solid #6ee7b7; border-radius: 12px; display: flex; justify-content: space-between; align-items: center;"><span style="font-weight: 800; color: #064e3b; font-size: 13px;">${escapeHtml(
            qr.key
          )}</span><span style="color: #059669; margin: 0 8px;">→</span><span style="font-weight: 600; color: #1e293b; font-size: 13px; text-align: right;">${escapeHtml(
            qr.value
          )}</span></div>`;
        }
        secContent += `</div>`;
      } else if (sec.type === "facts" && sec.keyFactList) {
        secContent += `<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px;">`;
        for (const f of sec.keyFactList) {
          secContent += `<div style="padding: 10px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; font-size: 13px;"><strong style="color: #0f172a;">${escapeHtml(
            f.label
          )}:</strong> <span style="color: #334155;">${escapeHtml(f.value)}</span></div>`;
        }
        secContent += `</div>`;
      } else if (sec.type === "dates" && sec.dateList) {
        secContent += `<div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px;">`;
        for (const d of sec.dateList) {
          secContent += `<div style="padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; display: flex; align-items: center; gap: 12px; font-size: 13px;"><span style="background: #e0f2fe; color: #0369a1; font-weight: 800; padding: 2px 8px; border-radius: 6px; font-size: 11px;">${escapeHtml(
            d.date
          )}</span><span style="color: #1e293b; font-weight: 500;">${escapeHtml(d.event)}</span></div>`;
        }
        secContent += `</div>`;
      } else if (sec.items) {
        secContent += `<ul style="margin: 0; padding-left: 8px; list-style: none;">`;
        for (const item of sec.items) {
          secContent += `<li style="display: flex; align-items: flex-start; gap: 10px; font-size: 14px; color: #1e293b; line-height: 1.6; margin-bottom: 6px;"><span style="height: 6px; width: 6px; border-radius: 50%; background: #4f46e5; margin-top: 8px; shrink: 0;"></span><span>${escapeHtml(
            item
          )}</span></li>`;
        }
        secContent += `</ul>`;
      }

      sectionsHtml += `
        <div class="pdf-block" style="margin-top: 16px;">
          <div style="display: flex; align-items: center; gap: 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px;">
            <span style="height: 10px; width: 10px; border-radius: 50%; background: #4f46e5;"></span>
            <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: #1e293b;">${escapeHtml(
              sec.title
            )}</h3>
          </div>
          ${secContent}
        </div>
      `;
    }

    chaptersHtml += `
      <div class="chapter-container" style="margin-top: 28px;">
        <div class="pdf-block" style="padding: 14px 18px; background: #eef2ff; border-left: 4px solid #4f46e5; border-radius: 0 12px 12px 0; display: flex; justify-content: space-between; align-items: center;">
          <h2 style="margin: 0; font-size: 18px; font-weight: 800; color: #1e1b4b;">${escapeHtml(
            ch.chapterTitle
          )}</h2>
          <div>
            ${sourceBadge}
            <span style="background: #4f46e5; color: #ffffff; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 9999px;">Chapter ${
              ch.chapterNumber || c + 1
            }</span>
          </div>
        </div>
        ${
          ch.summary
            ? `<p style="font-size: 13px; color: #3730a3; font-style: italic; margin: 8px 0 16px 4px;">${escapeHtml(
                ch.summary
              )}</p>`
            : ""
        }
        <div style="padding-left: 6px;">
          ${sectionsHtml}
        </div>
      </div>
    `;
  }

  return `
    <div style="font-family: 'Noto Sans Tamil Local', 'Noto Sans Tamil', 'Inter', sans-serif; padding: 36px 40px; background: #ffffff; color: #0f172a; width: 800px; box-sizing: border-box;">
      <div class="pdf-block" style="border-bottom: 2px solid #4f46e5; padding-bottom: 16px; margin-bottom: 24px;">
        <h1 style="margin: 0; font-size: 26px; font-weight: 900; color: #0f172a; line-height: 1.3;">${escapeHtml(
          title
        )}</h1>
        ${subtitleHtml}
      </div>
      <div>
        ${chaptersHtml}
      </div>
    </div>
  `;
}

function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Word (.docx) export for Study Material
 */
export async function generateStudyMaterialWord(
  material: StudyMaterialData,
  options?: PdfExportOptions
): Promise<void> {
  const toastId = toast.loading("Generating Study Material Word (.docx)...");

  try {
    const cleanChapters = filterEducationalChapters(material.chapters);
    const cleanTitle = cleanDocumentTitle(material.title, cleanChapters[0]?.chapterTitle);
    const docChildren: Paragraph[] = [];

    // Title
    docChildren.push(
      new Paragraph({
        text: cleanTitle,
        heading: HeadingLevel.TITLE,
        spacing: { before: 0, after: 120 },
      })
    );

    if (material.subtitle && !isArtificialSubtitle(material.subtitle)) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: material.subtitle,
              italics: true,
              color: "64748b",
            }),
          ],
          spacing: { after: 300 },
        })
      );
    }

    // Chapters
    for (const ch of cleanChapters) {
      docChildren.push(
        new Paragraph({
          text: ch.chapterTitle,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 300, after: 140 },
        })
      );

      if (ch.summary) {
        docChildren.push(
          new Paragraph({
            children: [new TextRun({ text: ch.summary, italics: true })],
            spacing: { after: 180 },
          })
        );
      }

      for (const sec of ch.sections) {
        docChildren.push(
          new Paragraph({
            text: sec.title,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          })
        );

        if (sec.content) {
          docChildren.push(
            new Paragraph({
              text: sec.content,
              spacing: { after: 120 },
            })
          );
        }

        if (sec.items) {
          sec.items.forEach((it) => {
            docChildren.push(
              new Paragraph({
                text: `• ${it}`,
                spacing: { after: 80 },
              })
            );
          });
        }

        if (sec.quickRevisionList) {
          sec.quickRevisionList.forEach((q) => {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `${q.key} → `, bold: true, color: "065f46" }),
                  new TextRun({ text: q.value, color: "0f172a" }),
                ],
                spacing: { after: 80 },
              })
            );
          });
        }

        if (sec.keyFactList) {
          sec.keyFactList.forEach((f) => {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `${f.label}: `, bold: true }),
                  new TextRun({ text: f.value }),
                ],
                spacing: { after: 80 },
              })
            );
          });
        }

        if (sec.dateList) {
          sec.dateList.forEach((d) => {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `[${d.date}] `, bold: true, color: "0284c7" }),
                  new TextRun({ text: d.event }),
                ],
                spacing: { after: 80 },
              })
            );
          });
        }
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children: docChildren }],
    });

    const blob = await Packer.toBlob(doc);
    const cleanName = material.pdf_name.replace(/\.(pdf|docx?)$/i, "").replace(/\s+/g, "_");
    saveAs(blob, `${cleanName}_Study_Material.docx`);

    toast.dismiss(toastId);
    toast.success("Study Material Word (.docx) downloaded!");
    if (options?.onSuccess) options.onSuccess();
  } catch (err: any) {
    toast.dismiss(toastId);
    console.error("Word generation error:", err);
    toast.error("Failed to generate Word document.");
    if (options?.onError) options.onError(err);
  }
}
