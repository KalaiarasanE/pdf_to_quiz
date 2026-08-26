import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import {
  StudyMaterialData,
  filterEducationalChapters,
  cleanDocumentTitle,
  isArtificialSubtitle,
} from "./study-material.types";
import {
  normalizeTamilUnicode,
  cleanUnwantedTamilSymbols,
  logTamilStage,
  isTamilText,
} from "./tamil-pipeline";

export interface PdfExportOptions {
  elementId?: string;
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
 * High-fidelity, real vector-text PDF generation for Study Material using jsPDF.
 * - Text is 100% real selectable, searchable, copyable Unicode text.
 * - Embeds Noto Sans Tamil TrueType font directly in the PDF file.
 * - Visually matches the website preview: cards, exam points (★), quick revision (→), tables, dates, definitions.
 * - Uses block-aware pagination to prevent awkward cuts.
 */
export async function generateStudyMaterialPdf(
  material: StudyMaterialData,
  options?: PdfExportOptions
): Promise<void> {
  const toastId = toast.loading("Generating real text Study Material PDF...");

  try {
    const cleanChapters = filterEducationalChapters(material.chapters);
    const cleanTitle = cleanDocumentTitle(material.title, cleanChapters[0]?.chapterTitle);

    // Diagnostic Log Stage F: Content passed to PDF renderer
    logTamilStage(
      "F",
      "Content Passed to PDF Renderer",
      `Title: ${cleanTitle} | Chapters: ${cleanChapters.length}`
    );

    // Load embedded Tamil font
    const base64Font = await getEmbeddedTamilFont();

    const doc = new jsPDF({
      orientation: "p",
      unit: "pt",
      format: "a4",
      compress: true,
    });

    const fontName = base64Font ? "NotoSansTamil" : "helvetica";
    if (base64Font) {
      doc.addFileToVFS("NotoSansTamil.ttf", base64Font);
      doc.addFont("NotoSansTamil.ttf", "NotoSansTamil", "normal");
      doc.setFont("NotoSansTamil", "normal");
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 42;
    const marginY = 45;
    const contentWidth = pageWidth - marginX * 2;
    const footerHeight = 35;
    const maxY = pageHeight - footerHeight;

    let y = marginY;
    let pageCount = 1;

    const setTamilFont = (_bold: boolean = false) => {
      doc.setFont(fontName, "normal");
    };

    const checkPageBreak = (neededHeight: number) => {
      if (y + neededHeight > maxY) {
        doc.addPage();
        pageCount++;
        y = marginY + 15;
        // Draw top subtle running header on continuation pages
        doc.setFontSize(8);
        doc.setTextColor(148, 163, 184); // slate-400
        setTamilFont(false);
        const headerText = cleanTitle.length > 50 ? cleanTitle.slice(0, 48) + "..." : cleanTitle;
        doc.text(headerText, marginX, marginY - 10);
        doc.setDrawColor(226, 232, 240);
        doc.setLineWidth(0.5);
        doc.line(marginX, marginY - 5, pageWidth - marginX, marginY - 5);
      }
    };

    // ==========================================
    // 1. DOCUMENT HEADER
    // ==========================================
    checkPageBreak(80);

    // Main Document Title
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42); // slate-900
    setTamilFont(true);
    const titleLines = doc.splitTextToSize(cleanTitle, contentWidth);
    doc.text(titleLines, marginX, y);
    y += titleLines.length * 22;

    // Subtitle if educational
    if (material.subtitle && !isArtificialSubtitle(material.subtitle)) {
      const cleanSub = cleanUnwantedTamilSymbols(normalizeTamilUnicode(material.subtitle));
      doc.setFontSize(11);
      doc.setTextColor(71, 85, 105); // slate-600
      setTamilFont(false);
      const subLines = doc.splitTextToSize(cleanSub, contentWidth);
      doc.text(subLines, marginX, y);
      y += subLines.length * 15;
    }

    y += 6;
    // Indigo accent bar under document header
    doc.setDrawColor(99, 102, 241); // indigo-500
    doc.setLineWidth(2.5);
    doc.line(marginX, y, marginX + contentWidth, y);
    y += 24;

    // ==========================================
    // 2. CHAPTERS
    // ==========================================
    for (let cIdx = 0; cIdx < cleanChapters.length; cIdx++) {
      const ch = cleanChapters[cIdx];
      const cleanChTitle = cleanUnwantedTamilSymbols(normalizeTamilUnicode(ch.chapterTitle));
      const cleanChSummary = ch.summary ? cleanUnwantedTamilSymbols(normalizeTamilUnicode(ch.summary)) : "";

      // Chapter banner estimated height
      const bannerTitleLines = doc.splitTextToSize(`Chapter ${ch.chapterNumber || cIdx + 1}: ${cleanChTitle}`, contentWidth - 40);
      const summaryLines = cleanChSummary ? doc.splitTextToSize(cleanChSummary, contentWidth - 40) : [];
      const bannerHeight = 24 + bannerTitleLines.length * 18 + (summaryLines.length ? summaryLines.length * 14 + 10 : 0);

      checkPageBreak(bannerHeight + 30);

      // Chapter Banner Box (gradient-style soft indigo with left border)
      doc.setFillColor(238, 242, 255); // indigo-50
      doc.roundedRect(marginX, y, contentWidth, bannerHeight, 6, 6, "F");

      // Left Accent Border
      doc.setFillColor(79, 70, 229); // indigo-600
      doc.rect(marginX, y, 5, bannerHeight, "F");

      let bannerInnerY = y + 18;

      // Chapter Title Text
      doc.setFontSize(13);
      doc.setTextColor(49, 46, 129); // indigo-900
      setTamilFont(true);
      doc.text(bannerTitleLines, marginX + 16, bannerInnerY);
      bannerInnerY += bannerTitleLines.length * 18;

      // Summary Text
      if (summaryLines.length > 0) {
        doc.setFontSize(9.5);
        doc.setTextColor(67, 56, 202); // indigo-700
        setTamilFont(false);
        doc.text(summaryLines, marginX + 16, bannerInnerY);
      }

      y += bannerHeight + 16;

      // Chapter Sections
      for (const sec of ch.sections || []) {
        const cleanSecTitle = cleanUnwantedTamilSymbols(normalizeTamilUnicode(sec.title || ""));
        const cleanContent = sec.content ? cleanUnwantedTamilSymbols(normalizeTamilUnicode(sec.content)) : "";

        checkPageBreak(40);

        // Section Title with indicator dot
        doc.setFillColor(79, 70, 229); // indigo-600
        doc.circle(marginX + 4, y - 4, 3, "F");

        doc.setFontSize(12);
        doc.setTextColor(30, 41, 59); // slate-800
        setTamilFont(true);
        const secTitleLines = doc.splitTextToSize(cleanSecTitle, contentWidth - 25);
        doc.text(secTitleLines, marginX + 14, y);
        y += secTitleLines.length * 16;

        // Section Title Underline
        doc.setDrawColor(241, 245, 249); // slate-100
        doc.setLineWidth(1);
        doc.line(marginX, y + 2, marginX + contentWidth, y + 2);
        y += 10;

        // Section Introduction Content
        if (cleanContent) {
          doc.setFontSize(10);
          doc.setTextColor(51, 65, 85); // slate-700
          setTamilFont(false);
          const contentLines = doc.splitTextToSize(cleanContent, contentWidth - 18);
          const blockH = contentLines.length * 15 + 8;
          checkPageBreak(blockH);

          // Left border line for quote-style paragraph
          doc.setDrawColor(203, 213, 225); // slate-300
          doc.setLineWidth(2);
          doc.line(marginX + 2, y, marginX + 2, y + blockH - 6);

          doc.text(contentLines, marginX + 12, y + 10);
          y += blockH + 6;
        }

        // Exam Points (★ Amber Highlight Cards)
        if (sec.type === "exam_points" && sec.items && sec.items.length > 0) {
          for (const item of sec.items) {
            const cleanItem = cleanUnwantedTamilSymbols(normalizeTamilUnicode(item));
            doc.setFontSize(9.5);
            doc.setTextColor(69, 26, 3); // amber-950
            setTamilFont(false);
            const itemLines = doc.splitTextToSize(cleanItem, contentWidth - 40);
            const cardHeight = Math.max(26, itemLines.length * 14 + 14);

            checkPageBreak(cardHeight + 6);

            // Amber Card Background
            doc.setFillColor(254, 243, 199); // amber-100
            doc.setDrawColor(252, 211, 77); // amber-300
            doc.setLineWidth(0.8);
            doc.roundedRect(marginX, y, contentWidth, cardHeight, 5, 5, "FD");

            // Star symbol
            doc.setTextColor(217, 119, 6); // amber-600
            doc.setFontSize(10);
            doc.text("★", marginX + 10, y + 14);

            // Item text
            doc.setTextColor(69, 26, 3);
            doc.setFontSize(9.5);
            doc.text(itemLines, marginX + 26, y + 14);

            y += cardHeight + 8;
          }
        }

        // Quick Revision (Emerald Key → Value Pairs)
        if (sec.type === "quick_revision" && sec.quickRevisionList && sec.quickRevisionList.length > 0) {
          for (const qr of sec.quickRevisionList) {
            const cleanKey = cleanUnwantedTamilSymbols(normalizeTamilUnicode(qr.key || ""));
            const cleanVal = cleanUnwantedTamilSymbols(normalizeTamilUnicode(qr.value || ""));
            const combinedText = `${cleanKey}  →  ${cleanVal}`;

            doc.setFontSize(9.5);
            setTamilFont(false);
            const qrLines = doc.splitTextToSize(combinedText, contentWidth - 30);
            const cardHeight = Math.max(24, qrLines.length * 14 + 12);

            checkPageBreak(cardHeight + 6);

            // Emerald Card
            doc.setFillColor(236, 253, 245); // emerald-50
            doc.setDrawColor(110, 231, 183); // emerald-300
            doc.setLineWidth(0.8);
            doc.roundedRect(marginX, y, contentWidth, cardHeight, 5, 5, "FD");

            doc.setTextColor(6, 78, 59); // emerald-900
            doc.text(qrLines, marginX + 12, y + 14);

            y += cardHeight + 6;
          }
        }

        // Key Facts
        if (sec.type === "facts" && sec.keyFactList && sec.keyFactList.length > 0) {
          for (const f of sec.keyFactList) {
            const cleanLbl = cleanUnwantedTamilSymbols(normalizeTamilUnicode(f.label || ""));
            const cleanV = cleanUnwantedTamilSymbols(normalizeTamilUnicode(f.value || ""));
            const factText = `${cleanLbl}: ${cleanV}`;

            doc.setFontSize(9.5);
            setTamilFont(false);
            const factLines = doc.splitTextToSize(factText, contentWidth - 30);
            const cardH = Math.max(22, factLines.length * 14 + 10);

            checkPageBreak(cardH + 4);

            doc.setFillColor(248, 250, 252); // slate-50
            doc.setDrawColor(226, 232, 240); // slate-200
            doc.roundedRect(marginX, y, contentWidth, cardH, 4, 4, "FD");

            doc.setFillColor(79, 70, 229);
            doc.circle(marginX + 10, y + cardH / 2, 2.5, "F");

            doc.setTextColor(15, 23, 42);
            doc.text(factLines, marginX + 20, y + 13);
            y += cardH + 5;
          }
        }

        // Important Dates
        if (sec.type === "dates" && sec.dateList && sec.dateList.length > 0) {
          for (const d of sec.dateList) {
            const cleanD = cleanUnwantedTamilSymbols(normalizeTamilUnicode(d.date || ""));
            const cleanEvt = cleanUnwantedTamilSymbols(normalizeTamilUnicode(d.event || ""));
            const dateFull = `[${cleanD}] ${cleanEvt}`;

            doc.setFontSize(9.5);
            setTamilFont(false);
            const dLines = doc.splitTextToSize(dateFull, contentWidth - 30);
            const cardH = Math.max(22, dLines.length * 14 + 10);

            checkPageBreak(cardH + 4);

            doc.setFillColor(240, 249, 255); // sky-50
            doc.setDrawColor(186, 230, 253); // sky-200
            doc.roundedRect(marginX, y, contentWidth, cardH, 4, 4, "FD");

            doc.setTextColor(3, 105, 161); // sky-700
            doc.text(dLines, marginX + 12, y + 13);
            y += cardH + 5;
          }
        }

        // Definitions
        if (sec.type === "definitions" && sec.definitionList && sec.definitionList.length > 0) {
          for (const def of sec.definitionList) {
            const cleanTerm = cleanUnwantedTamilSymbols(normalizeTamilUnicode(def.term || ""));
            const cleanDef = cleanUnwantedTamilSymbols(normalizeTamilUnicode(def.definition || ""));
            const defText = `📌 ${cleanTerm}: ${cleanDef}`;

            doc.setFontSize(9.5);
            setTamilFont(false);
            const defLines = doc.splitTextToSize(defText, contentWidth - 30);
            const cardH = Math.max(24, defLines.length * 14 + 12);

            checkPageBreak(cardH + 5);

            doc.setFillColor(250, 245, 255); // purple-50
            doc.setDrawColor(233, 213, 255); // purple-200
            doc.roundedRect(marginX, y, contentWidth, cardH, 4, 4, "FD");

            doc.setTextColor(88, 28, 135); // purple-900
            doc.text(defLines, marginX + 12, y + 14);
            y += cardH + 6;
          }
        }

        // Structured Table
        if (sec.tableData && sec.tableData.headers && sec.tableData.rows) {
          const headers = sec.tableData.headers.map((h) => cleanUnwantedTamilSymbols(normalizeTamilUnicode(h)));
          const rows = sec.tableData.rows.map((row) =>
            row.map((cell) => cleanUnwantedTamilSymbols(normalizeTamilUnicode(cell)))
          );

          if (headers.length > 0 && rows.length > 0) {
            const colWidth = contentWidth / headers.length;
            const rowHeight = 22;

            checkPageBreak(rowHeight * (rows.length + 1) + 15);

            // Table Header Row
            doc.setFillColor(238, 242, 255); // indigo-50
            doc.setDrawColor(199, 210, 254); // indigo-200
            doc.rect(marginX, y, contentWidth, rowHeight, "FD");

            doc.setFontSize(9.5);
            doc.setTextColor(49, 46, 129); // indigo-900
            setTamilFont(true);
            headers.forEach((h, colI) => {
              doc.text(h, marginX + colI * colWidth + 6, y + 14);
            });
            y += rowHeight;

            // Table Data Rows
            doc.setFontSize(9);
            setTamilFont(false);
            rows.forEach((row, rI) => {
              checkPageBreak(rowHeight + 4);
              doc.setFillColor(rI % 2 === 0 ? 255 : 248, rI % 2 === 0 ? 255 : 250, rI % 2 === 0 ? 255 : 252);
              doc.setDrawColor(226, 232, 240);
              doc.rect(marginX, y, contentWidth, rowHeight, "FD");

              doc.setTextColor(51, 65, 85);
              row.forEach((cell, colI) => {
                const cellText = cell.length > 35 ? cell.slice(0, 32) + "..." : cell;
                doc.text(cellText, marginX + colI * colWidth + 6, y + 14);
              });
              y += rowHeight;
            });
            y += 8;
          }
        }

        // Standard Bullet Points
        if (sec.items && sec.type !== "exam_points" && sec.items.length > 0) {
          for (const item of sec.items) {
            const cleanBullet = cleanUnwantedTamilSymbols(normalizeTamilUnicode(item));
            doc.setFontSize(9.5);
            doc.setTextColor(30, 41, 59); // slate-800
            setTamilFont(false);
            const bLines = doc.splitTextToSize(cleanBullet, contentWidth - 25);
            const bHeight = bLines.length * 15 + 4;

            checkPageBreak(bHeight);

            // Bullet dot
            doc.setFillColor(79, 70, 229);
            doc.circle(marginX + 6, y + 5, 2.5, "F");

            doc.text(bLines, marginX + 16, y + 8);
            y += bHeight;
          }
        }

        y += 10;
      }

      y += 14;
    }

    // ==========================================
    // 3. FOOTERS ON ALL PAGES
    // ==========================================
    const totalPages = doc.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setFontSize(8.5);
      doc.setTextColor(148, 163, 184); // slate-400
      setTamilFont(false);

      // Separator line above footer
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.5);
      doc.line(marginX, pageHeight - footerHeight + 10, pageWidth - marginX, pageHeight - footerHeight + 10);

      // Page numbers centered
      doc.text(
        `Page ${p} of ${totalPages}`,
        pageWidth / 2,
        pageHeight - footerHeight + 22,
        { align: "center" }
      );
    }

    const cleanFileName = material.pdf_name
      ? material.pdf_name.replace(/\.(pdf|docx?)$/i, "").replace(/\s+/g, "_")
      : "Study_Material";

    doc.save(`${cleanFileName}_StudyMaterial.pdf`);

    toast.dismiss(toastId);
    toast.success("Real text Study Material PDF downloaded successfully!");
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
 * Generates and downloads a clean Microsoft Word (.docx) file from Study Material.
 */
export async function generateStudyMaterialWord(
  material: StudyMaterialData,
  options?: { onSuccess?: () => void; onError?: (err: any) => void }
): Promise<void> {
  const toastId = toast.loading("Generating Word document (.docx)...");

  try {
    const cleanChapters = filterEducationalChapters(material.chapters);
    const cleanTitle = cleanDocumentTitle(material.title, cleanChapters[0]?.chapterTitle);

    const docChildren: any[] = [
      new Paragraph({
        text: cleanTitle,
        heading: HeadingLevel.TITLE,
        spacing: { after: 200 },
      }),
    ];

    if (material.subtitle && !isArtificialSubtitle(material.subtitle)) {
      docChildren.push(
        new Paragraph({
          text: cleanUnwantedTamilSymbols(normalizeTamilUnicode(material.subtitle)),
          spacing: { after: 300 },
        })
      );
    }

    for (let c = 0; c < cleanChapters.length; c++) {
      const ch = cleanChapters[c];
      const chTitle = cleanUnwantedTamilSymbols(normalizeTamilUnicode(ch.chapterTitle));
      docChildren.push(
        new Paragraph({
          text: `Chapter ${ch.chapterNumber || c + 1}: ${chTitle}`,
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 300, after: 150 },
        })
      );

      if (ch.summary) {
        docChildren.push(
          new Paragraph({
            text: cleanUnwantedTamilSymbols(normalizeTamilUnicode(ch.summary)),
            spacing: { after: 200 },
          })
        );
      }

      for (const sec of ch.sections || []) {
        const secTitle = cleanUnwantedTamilSymbols(normalizeTamilUnicode(sec.title || ""));
        docChildren.push(
          new Paragraph({
            text: secTitle,
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 200, after: 100 },
          })
        );

        if (sec.content) {
          docChildren.push(
            new Paragraph({
              text: cleanUnwantedTamilSymbols(normalizeTamilUnicode(sec.content)),
              spacing: { after: 150 },
            })
          );
        }

        if (sec.items && sec.items.length > 0) {
          for (const item of sec.items) {
            docChildren.push(
              new Paragraph({
                text: `• ${cleanUnwantedTamilSymbols(normalizeTamilUnicode(item))}`,
                spacing: { after: 80 },
              })
            );
          }
        }

        if (sec.quickRevisionList && sec.quickRevisionList.length > 0) {
          for (const qr of sec.quickRevisionList) {
            docChildren.push(
              new Paragraph({
                text: `• ${cleanUnwantedTamilSymbols(normalizeTamilUnicode(qr.key))} → ${cleanUnwantedTamilSymbols(normalizeTamilUnicode(qr.value))}`,
                spacing: { after: 80 },
              })
            );
          }
        }
      }
    }

    const doc = new Document({
      sections: [{ properties: {}, children: docChildren }],
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
