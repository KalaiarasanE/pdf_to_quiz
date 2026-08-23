import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType } from "docx";
import { saveAs } from "file-saver";
import { toast } from "sonner";
import { StudyMaterialData } from "./study-material.types";

export interface PdfExportOptions {
  onSuccess?: () => void;
  onError?: (err: any) => void;
}

export async function generateStudyMaterialPdf(
  material: StudyMaterialData,
  options?: PdfExportOptions
): Promise<void> {
  const toastId = toast.loading("Generating Study Material PDF...");

  try {
    // Gather all text to check for non-Latin Unicode scripts
    let fullText = material.title + " " + (material.subtitle || "");
    for (const ch of material.chapters) {
      fullText += " " + ch.chapterTitle + " " + (ch.summary || "");
      for (const sec of ch.sections) {
        fullText += " " + sec.title + " " + (sec.content || "");
        if (sec.items) fullText += " " + sec.items.join(" ");
        if (sec.keyFactList) fullText += " " + sec.keyFactList.map(f => `${f.label} ${f.value}`).join(" ");
        if (sec.dateList) fullText += " " + sec.dateList.map(d => `${d.date} ${d.event}`).join(" ");
        if (sec.peopleList) fullText += " " + sec.peopleList.map(p => `${p.name} ${p.role} ${p.contribution}`).join(" ");
        if (sec.definitionList) fullText += " " + sec.definitionList.map(d => `${d.term} ${d.definition}`).join(" ");
        if (sec.quickRevisionList) fullText += " " + sec.quickRevisionList.map(q => `${q.key} ${q.value}`).join(" ");
        if (sec.tableData) {
          fullText += " " + sec.tableData.headers.join(" ") + " " + sec.tableData.rows.map(r => r.join(" ")).join(" ");
        }
      }
    }

    let fontName = "helvetica";
    let fontFileName = "";
    let fontUrls: string[] = [];

    if (/[\u0B80-\u0BFF]/.test(fullText)) {
      fontName = "NotoSansTamil";
      fontFileName = "NotoSansTamil-Regular.ttf";
      fontUrls = [
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTamil/NotoSansTamil-Regular.ttf",
        "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTamil/NotoSansTamil-Regular.ttf",
      ];
    } else if (/[\u0900-\u097F]/.test(fullText)) {
      fontName = "NotoSansDevanagari";
      fontFileName = "NotoSansDevanagari-Regular.ttf";
      fontUrls = [
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
        "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
      ];
    } else if (/[\u0C00-\u0C7F]/.test(fullText)) {
      fontName = "NotoSansTelugu";
      fontFileName = "NotoSansTelugu-Regular.ttf";
      fontUrls = [
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTelugu/NotoSansTelugu-Regular.ttf",
        "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTelugu/NotoSansTelugu-Regular.ttf",
      ];
    } else if (/[\u0C80-\u0CFF]/.test(fullText)) {
      fontName = "NotoSansKannada";
      fontFileName = "NotoSansKannada-Regular.ttf";
      fontUrls = [
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansKannada/NotoSansKannada-Regular.ttf",
        "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansKannada/NotoSansKannada-Regular.ttf",
      ];
    } else if (/[\u0D00-\u0D7F]/.test(fullText)) {
      fontName = "NotoSansMalayalam";
      fontFileName = "NotoSansMalayalam-Regular.ttf";
      fontUrls = [
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansMalayalam/NotoSansMalayalam-Regular.ttf",
        "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansMalayalam/NotoSansMalayalam-Regular.ttf",
      ];
    } else if (Array.from(fullText).some((char) => char.charCodeAt(0) > 127)) {
      fontName = "NotoSans";
      fontFileName = "NotoSans-Regular.ttf";
      fontUrls = [
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
        "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
      ];
    }

    let base64Font: string | null = null;
    if (fontUrls.length > 0) {
      for (const url of fontUrls) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const arrayBuffer = await res.arrayBuffer();
            let binary = "";
            const bytes = new Uint8Array(arrayBuffer);
            const len = bytes.byteLength;
            for (let i = 0; i < len; i++) {
              binary += String.fromCharCode(bytes[i]);
            }
            base64Font = window.btoa(binary);
            break;
          }
        } catch {
          // try next font mirror
        }
      }
    }

    const doc = new jsPDF({
      orientation: "portrait",
      unit: "pt",
      format: "a4",
      compress: true,
    });

    if (base64Font && fontFileName && fontName) {
      doc.addFileToVFS(fontFileName, base64Font);
      doc.addFont(fontFileName, fontName, "normal", "Identity-H");
      doc.setFont(fontName, "normal");
    }

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const marginX = 45;
    const marginTop = 50;
    const marginBottom = 45;
    const contentWidth = pageWidth - marginX * 2;

    let y = marginTop;

    const setFont = (bold: boolean = false) => {
      if (fontName === "helvetica") {
        doc.setFont("helvetica", bold ? "bold" : "normal");
      } else {
        doc.setFont(fontName, "normal");
      }
    };

    const checkPageBreak = (neededHeight: number) => {
      if (y + neededHeight > pageHeight - marginBottom) {
        doc.addPage();
        if (base64Font && fontFileName && fontName) {
          doc.setFont(fontName, "normal");
        }
        y = marginTop;
        drawPageHeader();
      }
    };

    const drawPageHeader = () => {
      // Subtle header bar on secondary pages
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.setLineWidth(0.75);
      doc.line(marginX, 32, pageWidth - marginX, 32);

      setFont(false);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184); // slate-400
      doc.text("QUIZCRACK — EXAM STUDY MATERIAL", marginX, 26);
      doc.text(material.title.slice(0, 40), pageWidth - marginX, 26, { align: "right" });
    };

    // ==========================================
    // 🎨 FIRST PAGE COVER / HERO HEADER
    // ==========================================
    // Top Brand Pill
    doc.setFillColor(99, 102, 241); // Indigo-500
    doc.roundedRect(marginX, y, 95, 18, 4, 4, "F");
    setFont(true);
    doc.setFontSize(8);
    doc.setTextColor(255, 255, 255);
    doc.text("STUDY MATERIAL", marginX + 8, y + 12);

    // Language Badge
    if (material.language) {
      doc.setFillColor(241, 245, 249); // slate-100
      doc.roundedRect(marginX + 102, y, 60, 18, 4, 4, "F");
      setFont(false);
      doc.setFontSize(8);
      doc.setTextColor(71, 85, 105);
      doc.text(material.language.toUpperCase(), marginX + 110, y + 12);
    }

    y += 28;

    // Document Title (H1)
    setFont(true);
    doc.setFontSize(22);
    doc.setTextColor(15, 23, 42); // slate-900
    const titleLines = doc.splitTextToSize(material.title, contentWidth) as string[];
    titleLines.forEach((line) => {
      doc.text(line, marginX, y);
      y += 24;
    });

    // Subtitle / Meta
    if (material.subtitle) {
      setFont(false);
      doc.setFontSize(11);
      doc.setTextColor(100, 116, 139); // slate-500
      const subLines = doc.splitTextToSize(material.subtitle, contentWidth) as string[];
      subLines.forEach((line) => {
        doc.text(line, marginX, y);
        y += 14;
      });
    }

    // Divider Line
    y += 6;
    doc.setDrawColor(99, 102, 241); // Indigo accent line
    doc.setLineWidth(2);
    doc.line(marginX, y, marginX + 60, y);
    doc.setDrawColor(226, 232, 240); // slate-200
    doc.setLineWidth(0.75);
    doc.line(marginX + 65, y, pageWidth - marginX, y);

    y += 18;

    // Quick Stats Bar
    doc.setFillColor(248, 250, 252); // slate-50
    doc.setDrawColor(226, 232, 240);
    doc.roundedRect(marginX, y, contentWidth, 24, 4, 4, "FD");
    setFont(false);
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    const statsText = `Chapters: ${material.chapters.length}   •   Total Key Points: ${material.total_points || "Comprehensive"}   •   Estimated Revision: ~${material.estimated_read_time_minutes || 10} mins   •   Source: ${material.pdf_name}`;
    doc.text(statsText, marginX + 10, y + 15);

    y += 34;

    // ==========================================
    // 📖 CHAPTERS & SECTIONS RENDERING
    // ==========================================
    for (let cIdx = 0; cIdx < material.chapters.length; cIdx++) {
      const ch = material.chapters[cIdx];

      // Chapter Header Banner
      checkPageBreak(50);

      // Chapter Pill/Banner Box
      doc.setFillColor(238, 242, 255); // indigo-50
      doc.setDrawColor(199, 210, 254); // indigo-200
      doc.roundedRect(marginX, y, contentWidth, 28, 4, 4, "FD");

      // Left vertical accent bar
      doc.setFillColor(99, 102, 241);
      doc.rect(marginX, y, 4, 28, "F");

      setFont(true);
      doc.setFontSize(13);
      doc.setTextColor(67, 56, 202); // indigo-700
      doc.text(ch.chapterTitle, marginX + 14, y + 18);

      y += 36;

      // Chapter Summary if any
      if (ch.summary) {
        checkPageBreak(30);
        setFont(false);
        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105);
        const sumLines = doc.splitTextToSize(ch.summary, contentWidth - 10) as string[];
        sumLines.forEach((line) => {
          doc.text(line, marginX + 5, y);
          y += 14;
        });
        y += 8;
      }

      // Render each section in chapter
      for (const sec of ch.sections) {
        // Section Heading
        checkPageBreak(40);

        // Section Type icon/pill styling
        let badgeColor = [99, 102, 241]; // indigo
        let badgeBg = [238, 242, 255];
        let sectionTextColor = [15, 23, 42];

        if (sec.type === "exam_points") {
          badgeColor = [217, 119, 6]; // amber-600
          badgeBg = [254, 243, 199]; // amber-100
          sectionTextColor = [180, 83, 9];
        } else if (sec.type === "quick_revision") {
          badgeColor = [16, 185, 129]; // emerald-500
          badgeBg = [209, 250, 229]; // emerald-100
        } else if (sec.type === "facts" || sec.type === "dates") {
          badgeColor = [6, 182, 212]; // cyan-500
          badgeBg = [207, 250, 254]; // cyan-100
        }

        // Section Title
        setFont(true);
        doc.setFontSize(12);
        doc.setTextColor(sectionTextColor[0], sectionTextColor[1], sectionTextColor[2]);
        doc.text(sec.title, marginX + 4, y + 10);

        // Underline section title
        const secTitleWidth = doc.getTextWidth(sec.title);
        doc.setDrawColor(badgeColor[0], badgeColor[1], badgeColor[2]);
        doc.setLineWidth(1.2);
        doc.line(marginX + 4, y + 14, marginX + 4 + Math.min(secTitleWidth, contentWidth), y + 14);

        y += 24;

        // 1. Introduction Content
        if (sec.content) {
          checkPageBreak(30);
          setFont(false);
          doc.setFontSize(10);
          doc.setTextColor(51, 65, 85);
          const cLines = doc.splitTextToSize(sec.content, contentWidth - 10) as string[];
          cLines.forEach((line) => {
            doc.text(line, marginX + 5, y);
            y += 14;
          });
          y += 8;
        }

        // 2. Exam Important Points Box (Highlighted with border & gold/amber tint)
        if (sec.type === "exam_points" && sec.items && sec.items.length > 0) {
          for (const item of sec.items) {
            setFont(false);
            doc.setFontSize(9.5);
            const itemLines = doc.splitTextToSize(item, contentWidth - 36) as string[];
            const boxH = Math.max(22, itemLines.length * 13 + 12);

            checkPageBreak(boxH + 6);

            doc.setFillColor(255, 251, 235); // amber-50
            doc.setDrawColor(245, 158, 11); // amber-500
            doc.roundedRect(marginX, y, contentWidth, boxH, 3, 3, "FD");

            // Left Gold Indicator Bar
            doc.setFillColor(217, 119, 6);
            doc.rect(marginX, y, 3.5, boxH, "F");

            // Star / Bullet symbol
            setFont(true);
            doc.setFontSize(9);
            doc.setTextColor(217, 119, 6);
            doc.text("★", marginX + 8, y + 13);

            setFont(false);
            doc.setFontSize(9.5);
            doc.setTextColor(69, 26, 3); // dark amber/brown

            let textY = y + 13;
            itemLines.forEach((line) => {
              doc.text(line, marginX + 22, textY);
              textY += 13;
            });

            y += boxH + 6;
          }
          y += 6;
        }

        // 3. Quick Revision (Arrow pairs: Key → Value)
        else if (sec.type === "quick_revision" && sec.quickRevisionList && sec.quickRevisionList.length > 0) {
          for (const pair of sec.quickRevisionList) {
            const pairText = `${pair.key}  →  ${pair.value}`;
            setFont(false);
            doc.setFontSize(9.5);
            const pairLines = doc.splitTextToSize(pairText, contentWidth - 30) as string[];
            const cardH = Math.max(20, pairLines.length * 13 + 10);

            checkPageBreak(cardH + 4);

            doc.setFillColor(240, 253, 244); // emerald-50
            doc.setDrawColor(187, 247, 208); // emerald-200
            doc.roundedRect(marginX, y, contentWidth, cardH, 3, 3, "FD");

            // Left Green Indicator Bar
            doc.setFillColor(16, 185, 129);
            doc.rect(marginX, y, 3, cardH, "F");

            setFont(true);
            doc.setFontSize(9.5);
            doc.setTextColor(6, 78, 59); // emerald-900

            let textY = y + 12;
            pairLines.forEach((line) => {
              doc.text(line, marginX + 12, textY);
              textY += 13;
            });

            y += cardH + 4;
          }
          y += 6;
        }

        // 4. Important Dates (Date badge + event)
        else if (sec.type === "dates" && sec.dateList && sec.dateList.length > 0) {
          for (const d of sec.dateList) {
            setFont(false);
            doc.setFontSize(9.5);
            const eventLines = doc.splitTextToSize(d.event, contentWidth - 110) as string[];
            const rowH = Math.max(20, eventLines.length * 13 + 8);

            checkPageBreak(rowH + 4);

            // Date Badge
            doc.setFillColor(224, 242, 254); // sky-100
            doc.roundedRect(marginX, y, 80, 17, 3, 3, "F");
            setFont(true);
            doc.setFontSize(8.5);
            doc.setTextColor(3, 105, 161); // sky-700
            doc.text(d.date, marginX + 6, y + 12);

            // Event description
            setFont(false);
            doc.setFontSize(9.5);
            doc.setTextColor(30, 41, 59);
            let textY = y + 12;
            eventLines.forEach((line) => {
              doc.text(line, marginX + 90, textY);
              textY += 13;
            });

            y += rowH + 4;
          }
          y += 6;
        }

        // 5. Important People (Person card)
        else if (sec.type === "people" && sec.peopleList && sec.peopleList.length > 0) {
          for (const p of sec.peopleList) {
            const desc = `${p.role ? `[${p.role}] ` : ""}${p.contribution}`;
            setFont(false);
            doc.setFontSize(9.5);
            const descLines = doc.splitTextToSize(desc, contentWidth - 25) as string[];
            const cardH = descLines.length * 13 + 22;

            checkPageBreak(cardH + 6);

            doc.setFillColor(248, 250, 252);
            doc.setDrawColor(226, 232, 240);
            doc.roundedRect(marginX, y, contentWidth, cardH, 3, 3, "FD");

            // Name
            setFont(true);
            doc.setFontSize(10);
            doc.setTextColor(15, 23, 42);
            doc.text(`👤 ${p.name}`, marginX + 10, y + 14);

            // Role / Contribution
            setFont(false);
            doc.setFontSize(9);
            doc.setTextColor(71, 85, 105);
            let textY = y + 27;
            descLines.forEach((line) => {
              doc.text(line, marginX + 10, textY);
              textY += 13;
            });

            y += cardH + 6;
          }
          y += 6;
        }

        // 6. Definitions (Term in bold with clear definition)
        else if (sec.type === "definitions" && sec.definitionList && sec.definitionList.length > 0) {
          for (const def of sec.definitionList) {
            setFont(false);
            doc.setFontSize(9.5);
            const defLines = doc.splitTextToSize(def.definition, contentWidth - 25) as string[];
            const blockH = defLines.length * 13 + 22;

            checkPageBreak(blockH + 5);

            doc.setFillColor(245, 243, 255); // purple-50
            doc.setDrawColor(221, 214, 254); // purple-200
            doc.roundedRect(marginX, y, contentWidth, blockH, 3, 3, "FD");

            // Term Header
            setFont(true);
            doc.setFontSize(10);
            doc.setTextColor(109, 40, 217); // purple-700
            doc.text(`📌 ${def.term}`, marginX + 10, y + 14);

            // Definition Text
            setFont(false);
            doc.setFontSize(9.5);
            doc.setTextColor(51, 65, 85);
            let textY = y + 27;
            defLines.forEach((line) => {
              doc.text(line, marginX + 10, textY);
              textY += 13;
            });

            y += blockH + 6;
          }
          y += 6;
        }

        // 7. Key Facts (Label: Value list or cards)
        else if (sec.type === "facts" && sec.keyFactList && sec.keyFactList.length > 0) {
          for (const fact of sec.keyFactList) {
            const factText = `${fact.label}: ${fact.value}`;
            setFont(false);
            doc.setFontSize(9.5);
            const factLines = doc.splitTextToSize(factText, contentWidth - 25) as string[];
            const factH = Math.max(18, factLines.length * 13 + 8);

            checkPageBreak(factH + 4);

            // Bullet dot
            doc.setFillColor(99, 102, 241);
            doc.circle(marginX + 6, y + 9, 2.5, "F");

            setFont(true);
            doc.setFontSize(9.5);
            doc.setTextColor(15, 23, 42);

            let textY = y + 12;
            factLines.forEach((line, li) => {
              if (li > 0) setFont(false);
              doc.text(line, marginX + 16, textY);
              textY += 13;
            });

            y += factH + 4;
          }
          y += 6;
        }

        // 8. Structured Table
        else if (sec.tableData && sec.tableData.headers && sec.tableData.rows && sec.tableData.rows.length > 0) {
          const numCols = sec.tableData.headers.length;
          const colWidth = contentWidth / numCols;
          const headerHeight = 22;

          checkPageBreak(headerHeight + 30);

          // Table Header
          doc.setFillColor(238, 242, 255); // indigo-50
          doc.rect(marginX, y, contentWidth, headerHeight, "F");
          doc.setDrawColor(199, 210, 254);
          doc.setLineWidth(0.75);
          doc.rect(marginX, y, contentWidth, headerHeight, "S");

          setFont(true);
          doc.setFontSize(9);
          doc.setTextColor(67, 56, 202);

          sec.tableData.headers.forEach((h, hi) => {
            doc.text(h, marginX + hi * colWidth + 6, y + 14);
          });

          y += headerHeight;

          // Table Rows
          sec.tableData.rows.forEach((row, ri) => {
            const isEven = ri % 2 === 0;
            const rowHeight = 18;
            checkPageBreak(rowHeight + 10);

            if (isEven) {
              doc.setFillColor(248, 250, 252);
              doc.rect(marginX, y, contentWidth, rowHeight, "F");
            }

            doc.setDrawColor(226, 232, 240);
            doc.rect(marginX, y, contentWidth, rowHeight, "S");

            setFont(false);
            doc.setFontSize(8.5);
            doc.setTextColor(51, 65, 85);

            row.forEach((cell, ci) => {
              const cellText = String(cell || "").slice(0, 35);
              doc.text(cellText, marginX + ci * colWidth + 6, y + 12);
            });

            y += rowHeight;
          });

          y += 12;
        }

        // 9. Standard Bullet Points / Concepts / Items
        else if (sec.items && sec.items.length > 0) {
          for (let pIdx = 0; pIdx < sec.items.length; pIdx++) {
            const point = sec.items[pIdx];
            setFont(false);
            doc.setFontSize(9.5);
            const pointLines = doc.splitTextToSize(point, contentWidth - 25) as string[];
            const itemH = pointLines.length * 13 + 4;

            checkPageBreak(itemH + 4);

            // Draw bullet dot
            doc.setFillColor(99, 102, 241); // indigo bullet
            doc.circle(marginX + 6, y + 7, 2, "F");

            doc.setTextColor(30, 41, 59); // slate-800
            let textY = y + 10;
            pointLines.forEach((line) => {
              doc.text(line, marginX + 16, textY);
              textY += 13;
            });

            y += itemH + 3;
          }
          y += 8;
        }
      }

      y += 12; // Gap after chapter
    }

    // ==========================================
    // 📄 FOOTER & PAGE NUMBERS ON ALL PAGES
    // ==========================================
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);
      doc.setDrawColor(226, 232, 240);
      doc.setLineWidth(0.75);
      doc.line(marginX, pageHeight - 30, pageWidth - marginX, pageHeight - 30);

      setFont(false);
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(
        `Generated by QuizCrack • Competitive Exam Study Series`,
        marginX,
        pageHeight - 18
      );
      doc.text(
        `Page ${p} of ${totalPages}`,
        pageWidth - marginX,
        pageHeight - 18,
        { align: "right" }
      );
    }

    // Direct auto-download (NO browser print preview modal)
    const cleanName = material.pdf_name.replace(/\.(pdf|docx?)$/i, "").replace(/\s+/g, "_");
    const downloadFileName = `${cleanName}_Study_Material.pdf`;

    doc.save(downloadFileName);

    toast.dismiss(toastId);
    toast.success(`Study Material PDF downloaded (${downloadFileName})!`);
    if (options?.onSuccess) options.onSuccess();
  } catch (err) {
    toast.dismiss(toastId);
    console.error("Study Material PDF generation error:", err);
    toast.error("Failed to generate Study Material PDF.");
    if (options?.onError) options.onError(err);
  }
}

// Word (.docx) generator for Study Material
export async function generateStudyMaterialWord(
  material: StudyMaterialData,
  options?: PdfExportOptions
): Promise<void> {
  const toastId = toast.loading("Generating Study Material Word (.docx)...");

  try {
    const docChildren: (Paragraph | Table)[] = [];

    // Title
    docChildren.push(
      new Paragraph({
        text: material.title,
        heading: HeadingLevel.TITLE,
        spacing: { before: 0, after: 120 },
      })
    );

    // Subtitle
    if (material.subtitle) {
      docChildren.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${material.subtitle} • Generated by QuizCrack`,
              italics: true,
              color: "64748b",
            }),
          ],
          spacing: { after: 300 },
        })
      );
    }

    // Chapters
    for (const ch of material.chapters) {
      // Chapter Heading (H1)
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

      // Sections
      for (const sec of ch.sections) {
        // Section Title (H2)
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

        if (sec.definitionList) {
          sec.definitionList.forEach((def) => {
            docChildren.push(
              new Paragraph({
                children: [
                  new TextRun({ text: `${def.term}: `, bold: true, color: "7c3aed" }),
                  new TextRun({ text: def.definition }),
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
  } catch (err) {
    toast.dismiss(toastId);
    console.error("Word generation error:", err);
    toast.error("Failed to generate Word document.");
    if (options?.onError) options.onError(err);
  }
}
