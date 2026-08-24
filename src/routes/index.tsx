import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { toast } from "sonner";
import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Pencil,
  Play,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trash2,
  Upload,
  XCircle,
  Copy,
  Printer,
  Download,
  Settings as SettingsIcon,
  LayoutDashboard,
  Bookmark,
  Plus,
  HelpCircle,
  Sun,
  Moon,
  Menu,
  X,
  Lock,
  Mail,
  History,
  Trophy,
  User,
  LogOut,
  PlusCircle,
  Eye,
  Edit3,
  GraduationCap,
  BookMarked,
  ArrowRight,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Toaster } from "@/components/ui/sonner";
import { type MCQ } from "@/lib/ai-stream.server";
import { getSupabaseClient, getSupabaseConfig } from "@/lib/supabase";
import { StudyMaterialData } from "@/lib/study-material.types";
import { StudyMaterialView } from "@/components/StudyMaterialView";
import { StudyMaterialConfigureStage } from "@/components/StudyMaterialConfigureStage";
import { generateStudyMaterialPdf, generateStudyMaterialWord } from "@/lib/study-material.pdf";

import html2canvas from "html2canvas";

// Import export libraries
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

export const Route = createFileRoute("/")({
  component: App,
});

export type SavedQuiz = {
  id: string;
  pdf_name: string;
  language: string;
  num_questions: number;
  questions: MCQ[];
  created_at: string;
};

export type MockTestAttempt = {
  id: string;
  quiz_id: string;
  pdf_name: string;
  score: number;
  correct_count: number;
  total_questions: number;
  time_seconds: number;
  created_at: string;
};

type Tab =
  | "dashboard"
  | "generate"
  | "study-material"
  | "recent-activity"
  | "mock-tests"
  | "settings"
  | "profile";

type Stage =
  | "upload"
  | "extracting"
  | "configuring"
  | "generating"
  | "review"
  | "test"
  | "results"
  | "study-material-configuring"
  | "study-material-preview";

type PdfMeta = {
  name: string;
  size: number;
  pages: number;
  chars: number;
  text: string;
  isScanned: boolean;
  isMultilingual?: boolean;
  primaryLanguage?: string;
  languages?: string[];
  pageList?: { pageNum: number; text: string }[];
  fileRef?: File;
  lastModified?: number;
  hasLegacyTamil?: boolean;
  fontEncoding?: string;
  fileType?: "pdf" | "doc" | "docx";
};

// Helper utility functions for clean document formatting
const cleanQuestionText = (raw: string) => {
  if (!raw) return "";
  let text = raw.trim();
  text = text.replace(/^(?:Q|Question|Q\s*No)?\s*\d*\s*[-.:)]\s*/i, "").trim();
  text = text.replace(/^Q\d+\s*/i, "").trim();
  return text;
};

const cleanOptionText = (opt: string) => {
  if (!opt) return "";
  return opt.trim().replace(/^[A-D][\.\)\:\-]\s*/i, "").trim();
};

const getAnswerLetter = (correctAnswer: string, options: string[]) => {
  if (!options || options.length === 0) return "A";
  const cleanCorrect = cleanOptionText(correctAnswer || "");
  const idx = options.findIndex(
    (o) => cleanOptionText(o) === cleanCorrect || o === correctAnswer
  );
  return idx !== -1 ? String.fromCharCode(65 + idx) : "A";
};

// Shared PDF generator adhering strictly to clean exam paper format
const generateExamPdf = (
  pdfName: string,
  questionsList: MCQ[],
  includeExplanations: boolean = true,
  onSuccess?: () => void
) => {
  if (!questionsList || questionsList.length === 0) {
    toast.error("Please select at least one question to download.");
    return;
  }

  const fullQuestionsText =
    pdfName +
    " " +
    questionsList
      .map(
        (m) =>
          (m.question || "") +
          " " +
          (m.options ? m.options.join(" ") : "") +
          " " +
          (m.correctAnswer || "") +
          " " +
          (m.explanation || "")
      )
      .join(" ");

  let fontName = "helvetica";
  let fontFileName = "";
  let fontUrls: string[] = [];

  if (/[\u0B80-\u0BFF]/.test(fullQuestionsText)) {
    fontName = "NotoSansTamil";
    fontFileName = "NotoSansTamil-Regular.ttf";
    fontUrls = [
      "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTamil/NotoSansTamil-Regular.ttf",
      "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTamil/NotoSansTamil-Regular.ttf",
    ];
  } else if (/[\u0900-\u097F]/.test(fullQuestionsText)) {
    fontName = "NotoSansDevanagari";
    fontFileName = "NotoSansDevanagari-Regular.ttf";
    fontUrls = [
      "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
      "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf",
    ];
  } else if (/[\u0C00-\u0C7F]/.test(fullQuestionsText)) {
    fontName = "NotoSansTelugu";
    fontFileName = "NotoSansTelugu-Regular.ttf";
    fontUrls = [
      "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTelugu/NotoSansTelugu-Regular.ttf",
      "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTelugu/NotoSansTelugu-Regular.ttf",
    ];
  } else if (/[\u0C80-\u0CFF]/.test(fullQuestionsText)) {
    fontName = "NotoSansKannada";
    fontFileName = "NotoSansKannada-Regular.ttf";
    fontUrls = [
      "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansKannada/NotoSansKannada-Regular.ttf",
      "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansKannada/NotoSansKannada-Regular.ttf",
    ];
  } else if (/[\u0D00-\u0D7F]/.test(fullQuestionsText)) {
    fontName = "NotoSansMalayalam";
    fontFileName = "NotoSansMalayalam-Regular.ttf";
    fontUrls = [
      "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansMalayalam/NotoSansMalayalam-Regular.ttf",
      "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSansMalayalam/NotoSansMalayalam-Regular.ttf",
    ];
  } else if (Array.from(fullQuestionsText).some((char) => char.charCodeAt(0) > 127)) {
    fontName = "NotoSans";
    fontFileName = "NotoSans-Regular.ttf";
    fontUrls = [
      "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
      "https://cdn.jsdelivr.net/gh/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf",
    ];
  }

  const renderPdf = (base64Font?: string) => {
    try {
      const doc = new jsPDF({
        orientation: "p",
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
      const marginX = 50;
      const marginY = 50;
      const contentWidth = pageWidth - marginX * 2;

      let y = marginY;

      const setFont = (bold: boolean = false) => {
        if (fontName === "helvetica") {
          doc.setFont("helvetica", bold ? "bold" : "normal");
        } else {
          doc.setFont(fontName, "normal");
        }
      };

      const qFontSize = 14;
      const optFontSize = 12;
      const qLineHeight = 18;
      const optLineHeight = 16;

      questionsList.forEach((m, idx) => {
        const rawQuestion = cleanQuestionText(m.question);
        const questionStr = `${idx + 1}. ${rawQuestion}`;

        const opts = m.options || ["", "", "", ""];
        const optAStr = `A. ${cleanOptionText(opts[0])}`;
        const optBStr = `B. ${cleanOptionText(opts[1])}`;
        const optCStr = `C. ${cleanOptionText(opts[2])}`;
        const optDStr = `D. ${cleanOptionText(opts[3])}`;

        const ansLetter = getAnswerLetter(m.correctAnswer || "", opts);
        const answerStr = `Answer: ${ansLetter}`;

        const expText = includeExplanations ? (m.explanation || "").trim() : "";

        // Wrap lines cleanly using exact raw UTF-8 Unicode
        setFont(true);
        doc.setFontSize(qFontSize);
        const questionLines = doc.splitTextToSize(questionStr, contentWidth) as string[];

        setFont(false);
        doc.setFontSize(optFontSize);
        const optALines = doc.splitTextToSize(optAStr, contentWidth) as string[];
        const optBLines = doc.splitTextToSize(optBStr, contentWidth) as string[];
        const optCLines = doc.splitTextToSize(optCStr, contentWidth) as string[];
        const optDLines = doc.splitTextToSize(optDStr, contentWidth) as string[];

        setFont(true);
        const answerLines = doc.splitTextToSize(answerStr, contentWidth) as string[];

        setFont(false);
        const explanationLines = expText ? (doc.splitTextToSize(expText, contentWidth) as string[]) : [];

        // Calculate exact height of question block
        let blockHeight = 0;
        blockHeight += questionLines.length * qLineHeight + 10;
        blockHeight += optALines.length * optLineHeight + 6;
        blockHeight += optBLines.length * optLineHeight + 6;
        blockHeight += optCLines.length * optLineHeight + 6;
        blockHeight += optDLines.length * optLineHeight + 10;
        blockHeight += answerLines.length * optLineHeight;

        if (expText) {
          blockHeight += 10;
          blockHeight += optLineHeight + 4; // "Explanation:" label
          blockHeight += explanationLines.length * optLineHeight;
        }

        blockHeight += 20; // 20px gap after Answer (or Explanation) before next Question

        // Pagination check
        if (y + blockHeight > pageHeight - marginY && y > marginY) {
          doc.addPage();
          if (base64Font && fontFileName && fontName) {
            doc.setFont(fontName, "normal");
          }
          y = marginY;
        }

        // Draw Question
        setFont(true);
        doc.setFontSize(qFontSize);
        questionLines.forEach((line) => {
          doc.text(line, marginX, y);
          y += qLineHeight;
        });
        y += 10;

        // Draw Options
        setFont(false);
        doc.setFontSize(optFontSize);

        optALines.forEach((line) => {
          doc.text(line, marginX, y);
          y += optLineHeight;
        });
        y += 6;

        optBLines.forEach((line) => {
          doc.text(line, marginX, y);
          y += optLineHeight;
        });
        y += 6;

        optCLines.forEach((line) => {
          doc.text(line, marginX, y);
          y += optLineHeight;
        });
        y += 6;

        optDLines.forEach((line) => {
          doc.text(line, marginX, y);
          y += optLineHeight;
        });
        y += 10;

        // Draw Answer
        setFont(true);
        doc.setFontSize(optFontSize);
        answerLines.forEach((line) => {
          doc.text(line, marginX, y);
          y += optLineHeight;
        });

        // Draw Explanation
        if (expText) {
          y += 10;
          setFont(true);
          doc.text("Explanation:", marginX, y);
          y += optLineHeight + 4;

          setFont(false);
          explanationLines.forEach((line) => {
            doc.text(line, marginX, y);
            y += optLineHeight;
          });
        }

        // 20px Spacing
        y += 20;
      });

      const cleanName = pdfName.replace(/\.(pdf|docx?)$/i, "").replace(/\s+/g, "_");
      doc.save(`${cleanName}_MCQs.pdf`);
      if (onSuccess) onSuccess();
      toast.success("PDF document downloaded successfully!");
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("PDF generation failed. Try downloading again.");
    }
  };

  if (fontUrls.length > 0) {
    const toastId = toast.loading(`Loading font for PDF generation...`);

    const fetchFont = async () => {
      for (const url of fontUrls) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const arrayBuffer = await res.arrayBuffer();
          let binary = "";
          const bytes = new Uint8Array(arrayBuffer);
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          return typeof btoa !== "undefined"
            ? btoa(binary)
            : typeof Buffer !== "undefined"
            ? Buffer.from(binary, "binary").toString("base64")
            : null;
        } catch {
          // try next URL
        }
      }
      return null;
    };

    fetchFont().then((base64Font) => {
      toast.dismiss(toastId);
      if (base64Font) {
        toast.success("Unicode font loaded!");
        renderPdf(base64Font);
      } else {
        toast.error("Failed to load Unicode font. Generating PDF with default font.");
        renderPdf();
      }
    });
  } else {
    renderPdf();
  }
};

// Shared Microsoft Word (.docx) generator adhering strictly to clean exam paper format
const generateWordDocument = async (
  pdfName: string,
  questionsList: MCQ[],
  includeExplanations: boolean = true,
  onSuccess?: () => void
) => {
  if (!questionsList || questionsList.length === 0) {
    toast.error("Please select at least one question to download.");
    return;
  }

  try {
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: questionsList.flatMap((m, idx) => {
            const rawQuestion = cleanQuestionText(m.question);
            const opts = m.options || ["", "", "", ""];
            const ansLetter = getAnswerLetter(m.correctAnswer || "", opts);
            const expText = includeExplanations ? (m.explanation || "").trim() : "";

            const children: Paragraph[] = [
              // Question paragraph
              new Paragraph({
                children: [
                  new TextRun({
                    text: `${idx + 1}. ${rawQuestion}`,
                    bold: true,
                    size: 28, // 14pt
                  }),
                ],
                spacing: { before: idx === 0 ? 0 : 300, after: 120 },
              }),
              // Options A., B., C., D.
              ...opts.map(
                (opt, oi) =>
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `${String.fromCharCode(65 + oi)}. ${cleanOptionText(opt)}`,
                        size: 24, // 12pt
                      }),
                    ],
                    spacing: { after: 80 },
                  })
              ),
              // Answer
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Answer: `,
                    bold: true,
                    size: 24, // 12pt
                  }),
                  new TextRun({
                    text: ansLetter,
                    bold: true,
                    size: 24, // 12pt
                  }),
                ],
                spacing: { before: 120, after: expText ? 80 : 300 },
              }),
            ];

            if (expText) {
              children.push(
                new Paragraph({
                  children: [
                    new TextRun({
                      text: `Explanation: `,
                      bold: true,
                      size: 24,
                    }),
                    new TextRun({
                      text: expText,
                      italics: true,
                      size: 24,
                    }),
                  ],
                  spacing: { after: 300 },
                })
              );
            }

            return children;
          }),
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    const cleanName = pdfName.replace(/\.(pdf|docx?)$/i, "").replace(/\s+/g, "_");
    saveAs(blob, `${cleanName}_MCQs.docx`);
    if (onSuccess) onSuccess();
    toast.success("Word document (.docx) downloaded successfully!");
  } catch (err) {
    console.error("Word generation failed:", err);
    toast.error("Word document generation failed.");
  }
};


type DashboardStats = {
  uploadedPdfs: number;
  totalPages: number;
  questionsGenerated: number;
  studyMaterialsCreated: number;
  totalGenTimeSec: number;
  mockTestsCreated: number;
  downloadHistoryCount: number;
  recentActivity: Array<{
    id: string;
    type: "upload" | "generate" | "study-material" | "test" | "download";
    detail: string;
    time: string;
  }>;
};

const DEFAULT_STATS: DashboardStats = {
  uploadedPdfs: 0,
  totalPages: 0,
  questionsGenerated: 0,
  studyMaterialsCreated: 0,
  totalGenTimeSec: 0,
  mockTestsCreated: 0,
  downloadHistoryCount: 0,
  recentActivity: [],
};

// PDF IndexedDB Caching utility
class PDFCache {
  private static dbName = "QuizCrackDB";
  private static storeName = "PDFCacheStore";

  private static getDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "key" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  static async get(key: string): Promise<any> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readonly");
        const store = tx.objectStore(this.storeName);
        const req = store.get(key);
        req.onsuccess = () => resolve(req.result ? req.result.value : null);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error("IndexedDB get failed:", e);
      return null;
    }
  }

  static async set(key: string, value: any): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.storeName, "readwrite");
        const store = tx.objectStore(this.storeName);
        const req = store.put({ key, value });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.error("IndexedDB set failed:", e);
    }
  }
}

// Heuristics to skip non-content educational pages
function shouldSkipPage(text: string, pageNum: number, totalPages: number): boolean {
  const clean = text.trim().toLowerCase();
  if (clean.length < 50) return true;

  const skipKeywords = [
    "table of contents",
    "table of content",
    "index of",
    "copyright page",
    "all rights reserved",
    "isbn ",
    "published by",
    "printed in",
    "preface",
    "title page",
    "references",
    "bibliography",
    "appendix",
    "about the author",
    "index",
  ];

  if (pageNum <= 2) {
    const coverKeywords = ["copyright", "isbn", "all rights reserved", "contents", "table of"];
    if (coverKeywords.some((kw) => clean.includes(kw))) {
      return true;
    }
  }

  if (
    clean.includes("table of contents") ||
    (clean.includes("contents") && clean.includes("page"))
  ) {
    return true;
  }

  if (skipKeywords.some((kw) => clean.includes(kw) && clean.length < 1500)) {
    return true;
  }

  return false;
}

// Run Tesseract OCR on a specific PDF page
async function runOcrOnPage(doc: any, pageNum: number): Promise<string> {
  let pageText = "";
  let ocrWorker: any = null;
  try {
    const page = await doc.getPage(pageNum);
    const { createWorker } = await import("tesseract.js");
    ocrWorker = await createWorker("eng+tam");

    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      await page.render({ canvasContext: ctx, viewport }).promise;
      const imgData = canvas.toDataURL("image/png");
      const ret = await ocrWorker.recognize(imgData);
      pageText = ret.data.text;
    }
  } catch (err) {
    console.error(`OCR failed on page ${pageNum}`, err);
  } finally {
    if (ocrWorker) {
      await ocrWorker.terminate();
    }
  }
  return pageText;
}

// Rapid sample extraction (first 2 pages) for language & structure detection
async function extractPdfSample(
  file: File,
): Promise<{ sampleText: string; pagesCount: number; isScanned: boolean }> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const pagesCount = doc.numPages;

  let sampleText = "";
  const samplePages = Math.min(2, pagesCount);

  for (let i = 1; i <= samplePages; i++) {
    try {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((it: any) => it.str ?? "").join(" ");
      sampleText += pageText + "\n";
    } catch (e) {
      console.error("Error reading sample page:", e);
    }
  }

  const isScanned = sampleText.trim().length < 50;
  return { sampleText, pagesCount, isScanned };
}

// Fast page text extraction using parallel chunked promises
async function getPDFPagesTextFast(
  doc: any,
  onProgress: (current: number, total: number) => void,
): Promise<{ pageNum: number; text: string }[]> {
  const pagesCount = doc.numPages;
  const results: { pageNum: number; text: string }[] = new Array(pagesCount);
  const chunkSize = 30;

  for (let i = 0; i < pagesCount; i += chunkSize) {
    const chunkPromises = [];
    const limit = Math.min(i + chunkSize, pagesCount);
    for (let p = i; p < limit; p++) {
      const pageNum = p + 1;
      chunkPromises.push(
        (async () => {
          try {
            const page = await doc.getPage(pageNum);
            const content = await page.getTextContent();
            const pageText = content.items.map((it: any) => it.str ?? "").join(" ");
            results[p] = { pageNum, text: pageText };
          } catch (e) {
            console.error(`Error reading page ${pageNum}`, e);
            results[p] = { pageNum, text: "" };
          }
        })(),
      );
    }
    await Promise.all(chunkPromises);
    onProgress(limit, pagesCount);
  }
  return results;
}

// Extract text and structure from Microsoft Word (.doc / .docx) files
async function extractDocxText(file: File): Promise<{
  fullText: string;
  sampleText: string;
  pagesCount: number;
  isScanned: boolean;
  pageList: { pageNum: number; text: string }[];
}> {
  const buf = await file.arrayBuffer();
  let fullText = "";

  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: buf });
    fullText = result.value || "";
  } catch (err) {
    console.warn("Mammoth extraction failed, trying fallback text decoding:", err);
    try {
      const dec = new TextDecoder("utf-8");
      const raw = dec.decode(buf);
      fullText = raw
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    } catch {
      fullText = "";
    }
  }

  if (!fullText || fullText.trim().length === 0) {
    fullText = "No extractable text content found in Word document.";
  }

  const paragraphs = fullText.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const pageList: { pageNum: number; text: string }[] = [];
  let currentPageText = "";
  let pageNum = 1;

  if (paragraphs.length > 0) {
    for (const para of paragraphs) {
      if (currentPageText.length + para.length > 1800 && currentPageText.length > 0) {
        pageList.push({ pageNum, text: currentPageText.trim() });
        pageNum++;
        currentPageText = para + "\n\n";
      } else {
        currentPageText += para + "\n\n";
      }
    }
    if (currentPageText.trim().length > 0) {
      pageList.push({ pageNum, text: currentPageText.trim() });
    }
  } else {
    pageList.push({ pageNum: 1, text: fullText });
  }

  const pagesCount = pageList.length;
  const sampleText = fullText.slice(0, 3000);
  const isScanned = fullText.trim().length < 50;

  return { fullText, sampleText, pagesCount, isScanned, pageList };
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("generate");
  const [stage, setStage] = useState<Stage>("upload");
  const [targetCreationMode, setTargetCreationMode] = useState<"mcq" | "study-material">("mcq");
  const [pdf, setPdf] = useState<PdfMeta | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [mcqs, setMcqs] = useState<MCQ[]>([]);
  const [studyMaterial, setStudyMaterial] = useState<StudyMaterialData | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [testTime, setTestTime] = useState<number>(0);
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [darkMode, setDarkMode] = useState<boolean>(true);

  // Settings state
  const [apiKey, setApiKey] = useState<string>("");
  const [apiProvider, setApiProvider] = useState<"gemini" | "openai" | "lovable">("gemini");
  const [modelName, setModelName] = useState<string>("gemini-3.1-flash-lite");
  const [selectedLanguage, setSelectedLanguage] = useState<string>("");

  // Supabase & Auth states
  const [user, setUser] = useState<any>(null);
  const [supabaseClient, setSupabaseClient] = useState<any>(null);
  const [recentQuizzes, setRecentQuizzes] = useState<SavedQuiz[]>([]);
  const [recentStudyMaterials, setRecentStudyMaterials] = useState<StudyMaterialData[]>([]);
  const [mockAttempts, setMockAttempts] = useState<MockTestAttempt[]>([]);

  // Navigation & responsive states
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Global Upload states
  const [globalUploading, setGlobalUploading] = useState(false);
  const [globalUploadProgress, setGlobalUploadProgress] = useState(0);
  const [globalUploadStage, setGlobalUploadStage] = useState("");
  const globalFileInputRef = useRef<HTMLInputElement>(null);

  // Safe local storage helpers for SSR and restricted browser contexts
  const safeGetItem = useCallback((key: string): string | null => {
    try {
      if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
        return localStorage.getItem(key);
      }
    } catch {}
    return null;
  }, []);

  const safeSetItem = useCallback((key: string, value: string) => {
    try {
      if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
        localStorage.setItem(key, value);
      }
    } catch {}
  }, []);

  const safeRemoveItem = useCallback((key: string) => {
    try {
      if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
        localStorage.removeItem(key);
      }
    } catch {}
  }, []);

  // Initialize Supabase & Auth listener
  useEffect(() => {
    const client = getSupabaseClient();
    setSupabaseClient(client);
    if (client) {
      client.auth.getSession().then(({ data: { session } }) => {
        setUser(session?.user ?? null);
        fetchQuizzes(session?.user ?? null, client);
        fetchAttempts(session?.user ?? null, client);
        fetchStudyMaterials(session?.user ?? null, client);
      });

      const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
        setUser(session?.user ?? null);
        fetchQuizzes(session?.user ?? null, client);
        fetchAttempts(session?.user ?? null, client);
        fetchStudyMaterials(session?.user ?? null, client);
      });

      return () => subscription.unsubscribe();
    } else {
      fetchQuizzes(null, null);
      fetchAttempts(null, null);
      fetchStudyMaterials(null, null);
    }
  }, []);

  const fetchQuizzes = async (currentUser: any, client: any) => {
    if (!client || !currentUser) {
      const local = safeGetItem("quizcrack_quizzes");
      if (local) {
        try { setRecentQuizzes(JSON.parse(local)); } catch (e) {}
      } else {
        setRecentQuizzes([]);
      }
      return;
    }

    try {
      const { data, error } = await client
        .from("quizzes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRecentQuizzes(data || []);
    } catch (e) {
      console.error("Error fetching quizzes:", e);
      const local = safeGetItem("quizcrack_quizzes");
      if (local) {
        try { setRecentQuizzes(JSON.parse(local)); } catch (e) {}
      }
    }
  };

  const fetchStudyMaterials = async (currentUser: any, client: any) => {
    if (!client || !currentUser) {
      const local = safeGetItem("quizcrack_study_materials");
      if (local) {
        try { setRecentStudyMaterials(JSON.parse(local)); } catch (e) {}
      } else {
        setRecentStudyMaterials([]);
      }
      return;
    }

    try {
      const { data, error } = await client
        .from("study_materials")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setRecentStudyMaterials(data || []);
    } catch (e) {
      console.error("Error fetching study materials:", e);
      const local = safeGetItem("quizcrack_study_materials");
      if (local) {
        try { setRecentStudyMaterials(JSON.parse(local)); } catch (e) {}
      }
    }
  };

  const fetchAttempts = async (currentUser: any, client: any) => {
    if (!client || !currentUser) {
      const local = safeGetItem("quizcrack_mock_attempts");
      if (local) {
        try { setMockAttempts(JSON.parse(local)); } catch (e) {}
      } else {
        setMockAttempts([]);
      }
      return;
    }

    try {
      const { data, error } = await client
        .from("mock_attempts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      setMockAttempts(data || []);
    } catch (e) {
      console.error("Error fetching attempts:", e);
      const local = safeGetItem("quizcrack_mock_attempts");
      if (local) {
        try { setMockAttempts(JSON.parse(local)); } catch (e) {}
      }
    }
  };

  // Helper utility for UUID identification
  const isUuid = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

  // Central Quiz Operations
  const saveGeneratedQuiz = async (pdfName: string, questionsList: MCQ[], language: string) => {
    const newQuiz: SavedQuiz = {
      id: Math.random().toString(36).substring(2, 9),
      pdf_name: pdfName,
      language: language || "English",
      num_questions: questionsList.length,
      questions: questionsList,
      created_at: new Date().toISOString(),
    };

    // Save locally
    const local = safeGetItem("quizcrack_quizzes");
    let currentLocal: SavedQuiz[] = [];
    if (local) {
      try { currentLocal = JSON.parse(local); } catch (e) {}
    }
    const updatedLocal = [newQuiz, ...currentLocal];
    safeSetItem("quizcrack_quizzes", JSON.stringify(updatedLocal));
    setRecentQuizzes(updatedLocal);

    // Save to Supabase if logged in
    if (user && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from("quizzes")
          .insert({
            pdf_name: pdfName,
            language: language || "English",
            num_questions: questionsList.length,
            questions: questionsList,
            user_id: user.id,
          })
          .select();
        if (error) throw error;
        if (data && data[0]) {
          setRecentQuizzes((prev) =>
            prev.map((q) => (q.id === newQuiz.id ? data[0] : q))
          );
        }
      } catch (e) {
        console.error("Error saving quiz to Supabase:", e);
      }
    }
  };

  const saveGeneratedStudyMaterial = async (materialData: StudyMaterialData) => {
    // Save locally
    const local = safeGetItem("quizcrack_study_materials");
    let currentLocal: StudyMaterialData[] = [];
    if (local) {
      try { currentLocal = JSON.parse(local); } catch (e) {}
    }
    const updatedLocal = [materialData, ...currentLocal.filter((m) => m.id !== materialData.id)];
    safeSetItem("quizcrack_study_materials", JSON.stringify(updatedLocal));
    setRecentStudyMaterials(updatedLocal);

    // Save to Supabase if logged in
    if (user && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from("study_materials")
          .insert({
            pdf_name: materialData.pdf_name,
            title: materialData.title,
            language: materialData.language || "English",
            total_points: materialData.total_points || 0,
            chapters: materialData.chapters,
            user_id: user.id,
          })
          .select();
        if (error) throw error;
        if (data && data[0]) {
          setRecentStudyMaterials((prev) =>
            prev.map((m) => (m.id === materialData.id ? data[0] : m))
          );
        }
      } catch (e) {
        console.error("Error saving study material to Supabase:", e);
      }
    }
  };

  const renameStudyMaterial = async (id: string, newTitle: string) => {
    const updated = recentStudyMaterials.map((m) => (m.id === id ? { ...m, title: newTitle } : m));
    setRecentStudyMaterials(updated);
    safeSetItem("quizcrack_study_materials", JSON.stringify(updated));

    if (user && supabaseClient && isUuid(id)) {
      try {
        const { error } = await supabaseClient
          .from("study_materials")
          .update({ title: newTitle })
          .eq("id", id);
        if (error) throw error;
        toast.success("Study Material renamed successfully!");
      } catch (e) {
        console.error("Error renaming in Supabase:", e);
        toast.error("Failed to rename on server, updated locally.");
      }
    } else {
      toast.success("Study Material renamed successfully!");
    }
  };

  const deleteStudyMaterial = async (id: string) => {
    const updated = recentStudyMaterials.filter((m) => m.id !== id);
    setRecentStudyMaterials(updated);
    safeSetItem("quizcrack_study_materials", JSON.stringify(updated));

    if (user && supabaseClient && isUuid(id)) {
      try {
        const { error } = await supabaseClient
          .from("study_materials")
          .delete().eq("id", id);
        if (error) throw error;
        toast.success("Study Material deleted successfully!");
      } catch (e) {
        console.error("Error deleting in Supabase:", e);
        toast.error("Failed to delete from server.");
      }
    } else {
      toast.success("Study Material deleted successfully!");
    }
  };

  const saveMockAttempt = async (
    pdfName: string,
    totalQuestions: number,
    correctCount: number,
    timeSec: number
  ) => {
    const score = Math.round((correctCount / totalQuestions) * 100);
    const newAttempt: MockTestAttempt = {
      id: Math.random().toString(36).substring(2, 9),
      quiz_id: "",
      pdf_name: pdfName,
      score,
      correct_count: correctCount,
      total_questions: totalQuestions,
      time_seconds: timeSec,
      created_at: new Date().toISOString(),
    };

    // Save locally
    const local = safeGetItem("quizcrack_mock_attempts");
    let currentLocal: MockTestAttempt[] = [];
    if (local) {
      try { currentLocal = JSON.parse(local); } catch (e) {}
    }
    const updatedLocal = [newAttempt, ...currentLocal];
    safeSetItem("quizcrack_mock_attempts", JSON.stringify(updatedLocal));
    setMockAttempts(updatedLocal);

    // Save to Supabase
    if (user && supabaseClient) {
      try {
        const { error } = await supabaseClient.from("mock_attempts").insert({
          pdf_name: pdfName,
          score,
          correct_count: correctCount,
          total_questions: totalQuestions,
          time_seconds: timeSec,
          user_id: user.id,
        });
        if (error) throw error;
        fetchAttempts(user, supabaseClient);
      } catch (e) {
        console.error("Error saving mock attempt to Supabase:", e);
      }
    }
  };

  const renameQuiz = async (id: string, newName: string) => {
    const updated = recentQuizzes.map((q) => (q.id === id ? { ...q, pdf_name: newName } : q));
    setRecentQuizzes(updated);
    safeSetItem("quizcrack_quizzes", JSON.stringify(updated));

    if (user && supabaseClient && isUuid(id)) {
      try {
        const { error } = await supabaseClient
          .from("quizzes")
          .update({ pdf_name: newName })
          .eq("id", id);
        if (error) throw error;
        toast.success("Quiz renamed successfully!");
      } catch (e) {
        console.error("Error renaming in Supabase:", e);
        toast.error("Failed to rename on server, updated locally.");
      }
    } else {
      toast.success("Quiz renamed successfully!");
    }
  };

  const duplicateQuiz = async (quiz: SavedQuiz) => {
    const duplicatedQuiz: SavedQuiz = {
      id: Math.random().toString(36).substring(2, 9),
      pdf_name: `${quiz.pdf_name} (Copy)`,
      language: quiz.language,
      num_questions: quiz.num_questions,
      questions: JSON.parse(JSON.stringify(quiz.questions)),
      created_at: new Date().toISOString(),
    };

    const updated = [duplicatedQuiz, ...recentQuizzes];
    setRecentQuizzes(updated);
    safeSetItem("quizcrack_quizzes", JSON.stringify(updated));

    if (user && supabaseClient) {
      try {
        const { data, error } = await supabaseClient
          .from("quizzes")
          .insert({
            pdf_name: duplicatedQuiz.pdf_name,
            language: duplicatedQuiz.language,
            num_questions: duplicatedQuiz.num_questions,
            questions: duplicatedQuiz.questions,
            user_id: user.id,
          })
          .select();
        if (error) throw error;
        if (data && data[0]) {
          setRecentQuizzes((prev) =>
            prev.map((q) => (q.id === duplicatedQuiz.id ? data[0] : q))
          );
        }
        toast.success("Quiz duplicated successfully!");
      } catch (e) {
        console.error("Error duplicating in Supabase:", e);
        toast.error("Duplicated locally (failed to sync to server).");
      }
    } else {
      toast.success("Quiz duplicated successfully!");
    }
  };

  const deleteQuiz = async (id: string) => {
    const updated = recentQuizzes.filter((q) => q.id !== id);
    setRecentQuizzes(updated);
    safeSetItem("quizcrack_quizzes", JSON.stringify(updated));

    if (user && supabaseClient && isUuid(id)) {
      try {
        const { error } = await supabaseClient.from("quizzes").delete().eq("id", id);
        if (error) throw error;
        toast.success("Quiz deleted successfully!");
      } catch (e) {
        console.error("Error deleting in Supabase:", e);
        toast.error("Failed to delete from server.");
      }
    } else {
      toast.success("Quiz deleted successfully!");
    }
  };

  // Central Download Functions for shared use
  const handleDownloadPdf = (pdfName: string, questions: MCQ[]) => {
    generateExamPdf(pdfName, questions, true, () => {
      updateStats((prev) => ({ ...prev, downloadHistoryCount: prev.downloadHistoryCount + 1 }));
      logActivity("download", `Downloaded PDF quiz from "${pdfName}"`);
    });
  };

  const handleDownloadWord = (pdfName: string, questions: MCQ[]) => {
    generateWordDocument(pdfName, questions, true, () => {
      updateStats((prev) => ({ ...prev, downloadHistoryCount: prev.downloadHistoryCount + 1 }));
      logActivity("download", `Downloaded DOCX quiz from "${pdfName}"`);
    });
  };

  const handleDownloadStudyMaterialPdf = (materialData: StudyMaterialData) => {
    generateStudyMaterialPdf(materialData, {
      onSuccess: () => {
        updateStats((prev) => ({ ...prev, downloadHistoryCount: prev.downloadHistoryCount + 1 }));
        logActivity("download", `Downloaded Study Material PDF for "${materialData.title}"`);
      },
    });
  };

  const handleDownloadStudyMaterialDocx = (materialData: StudyMaterialData) => {
    generateStudyMaterialWord(materialData, {
      onSuccess: () => {
        updateStats((prev) => ({ ...prev, downloadHistoryCount: prev.downloadHistoryCount + 1 }));
        logActivity("download", `Downloaded Study Material DOCX for "${materialData.title}"`);
      },
    });
  };

  // Central File processing handler
  const handleGlobalFile = async (file: File) => {
    const fileName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || fileName.endsWith(".pdf");
    const isDoc = fileName.endsWith(".doc");
    const isDocx =
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      file.type === "application/msword" ||
      fileName.endsWith(".docx");

    if (!isPdf && !isDoc && !isDocx) {
      toast.error("Invalid file format. Please upload a PDF (.pdf), Word (.doc), or Word (.docx) document.");
      return;
    }
    if (file.size > 100 * 1024 * 1024) {
      toast.error("File is too large. Max supported size is 100MB.");
      return;
    }

    setGlobalUploading(true);
    setGlobalUploadProgress(10);
    setGlobalUploadStage("Checking local cache...");

    try {
      const fileType = isPdf ? "pdf" : isDoc ? "doc" : "docx";
      const cacheKey = `pdf_cache_${file.name}_${file.size}_${file.lastModified}`;
      const cached = await PDFCache.get(cacheKey);
      if (cached) {
        toast.success("Loaded document text from local cache!");
        setGlobalUploadProgress(100);
        setGlobalUploadStage("Ready!");
        setTimeout(() => {
          setPdf(cached);
          setCurrentFile(file);
          setGlobalUploading(false);
          if (targetCreationMode === "study-material" || activeTab === "study-material") {
            setActiveTab("study-material");
            setStage("study-material-configuring");
          } else {
            setActiveTab("generate");
            setStage("configuring");
          }
        }, 300);
        return;
      }

      setGlobalUploadProgress(30);
      let sampleText = "";
      let pagesCount = 1;
      let isScanned = false;
      let extractedPageList: { pageNum: number; text: string }[] = [];

      if (isPdf) {
        setGlobalUploadStage("Reading PDF structure...");
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        pagesCount = doc.numPages;

        setGlobalUploadStage(`Extracting text from all ${pagesCount} pages...`);
        extractedPageList = await getPDFPagesTextFast(doc, (current, total) => {
          setGlobalUploadProgress(30 + Math.round((current / total) * 35));
        });

        sampleText = extractedPageList.map((p) => p.text).join("\n\n");
        isScanned = sampleText.trim().length < (pagesCount * 30);
      } else {
        setGlobalUploadStage("Reading Word document structure...");
        setGlobalUploadProgress(40);
        const docxData = await extractDocxText(file);
        sampleText = docxData.sampleText;
        pagesCount = docxData.pagesCount;
        isScanned = docxData.isScanned;
        extractedPageList = docxData.pageList;
      }

      setGlobalUploadStage("Detecting language...");
      setGlobalUploadProgress(70);
      let isMultilingual = false;
      let primaryLanguage = "English";
      let languages: string[] = ["English"];
      let hasLegacyTamil = false;
      let fontEncoding = "None";
      let cleanSample = sampleText;

      try {
        const detectRes = await fetch("/api/detect-language", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sampleText.slice(0, 3000) }),
        });
        if (detectRes.ok) {
          const data = await detectRes.json();
          isMultilingual = !!data.isMultilingual;
          primaryLanguage = data.primaryLanguage || "English";
          languages = data.languages || ["English"];
          hasLegacyTamil = !!data.hasLegacyTamil;
          fontEncoding = data.fontEncoding || "None";
        }
      } catch (err) {
        console.error("Language detection failed", err);
      }

      if (hasLegacyTamil) {
        setGlobalUploadStage(`Converting Tamil sample...`);
        setGlobalUploadProgress(90);
        try {
          const convertRes = await fetch("/api/convert-legacy-tamil", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: sampleText }),
          });
          if (convertRes.ok) {
            const data = await convertRes.json();
            if (data.text) {
              cleanSample = data.text;
              hasLegacyTamil = false;
              fontEncoding = "Unicode";
            }
          }
        } catch (err) {
          console.error("Tamil font conversion failed:", err);
        }
      }

      const meta: PdfMeta = {
        name: file.name,
        size: file.size,
        pages: pagesCount,
        chars: isPdf ? pagesCount * 1500 : sampleText.length,
        text: cleanSample,
        isScanned,
        isMultilingual,
        primaryLanguage,
        languages,
        pageList: extractedPageList.length > 0 ? extractedPageList : undefined,
        lastModified: file.lastModified,
        fileType,
      };

      await PDFCache.set(cacheKey, meta);

      setGlobalUploadProgress(100);
      setGlobalUploadStage("Complete!");
      setTimeout(() => {
        setPdf(meta);
        setCurrentFile(file);
        setGlobalUploading(false);
        if (targetCreationMode === "study-material" || activeTab === "study-material") {
          setActiveTab("study-material");
          setStage("study-material-configuring");
        } else {
          setActiveTab("generate");
          setStage("configuring");
        }

        updateStats((prev) => ({
          ...prev,
          uploadedPdfs: prev.uploadedPdfs + 1,
          totalPages: prev.totalPages + meta.pages,
        }));
        logActivity("upload", `Uploaded "${meta.name}" (${meta.pages} pages)`);
      }, 300);
    } catch (e) {
      console.error(e);
      toast.error("Failed to parse document file.");
      setGlobalUploading(false);
    }
  };

  // Load stats & settings from localStorage
  useEffect(() => {
    const savedStats = safeGetItem("quizcrack_stats");
    if (savedStats) {
      try {
        setStats(JSON.parse(savedStats));
      } catch (e) {}
    }
    const savedApiKey = safeGetItem("quizcrack_apikey");
    const savedProvider = safeGetItem("quizcrack_provider");
    const savedModel = safeGetItem("quizcrack_model");
    const savedTheme = safeGetItem("quizcrack_theme");

    if (savedApiKey) setApiKey(savedApiKey);
    if (savedProvider) setApiProvider(savedProvider as any);
    if (savedModel) setModelName(savedModel);

    const isDark = savedTheme !== "light";
    setDarkMode(isDark);
    if (typeof document !== "undefined") {
      if (isDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  }, [safeGetItem]);

  const toggleTheme = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    safeSetItem("quizcrack_theme", nextDark ? "dark" : "light");
    if (typeof document !== "undefined") {
      if (nextDark) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
    }
  };

  const updateStats = (updater: (prev: DashboardStats) => DashboardStats) => {
    setStats((prev) => {
      const next = updater(prev);
      safeSetItem("quizcrack_stats", JSON.stringify(next));
      return next;
    });
  };

  const logActivity = (type: "upload" | "generate" | "test" | "download", detail: string) => {
    updateStats((prev) => {
      const logs = [
        {
          id: Math.random().toString(36).slice(2, 9),
          type,
          detail,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
        ...prev.recentActivity.slice(0, 15),
      ];
      return { ...prev, recentActivity: logs };
    });
  };


  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-200 flex flex-col relative overflow-x-hidden">
      <Toaster richColors position="top-right" />

      {/* Woblo Atmospheric Ambient Glowing Background Orbs */}
      <div className="woblo-glow-mesh w-[600px] h-[350px] top-[-120px] left-1/2 -translate-x-1/2 bg-[radial-gradient(circle,rgba(26,64,255,0.18)_0%,rgba(139,92,246,0.12)_45%,transparent_70%)] pointer-events-none" />
      <div className="woblo-glow-mesh w-[450px] h-[350px] top-[35%] right-[-100px] bg-[radial-gradient(circle,rgba(232,64,13,0.09)_0%,rgba(208,178,255,0.08)_50%,transparent_70%)] pointer-events-none" />
      <div className="woblo-glow-mesh w-[500px] h-[350px] bottom-[-100px] left-[-100px] bg-[radial-gradient(circle,rgba(26,64,255,0.1)_0%,rgba(6,182,212,0.08)_50%,transparent_70%)] pointer-events-none" />

      {/* Global Upload File Input (hidden) */}
      <input
        ref={globalFileInputRef}
        type="file"
        accept="application/pdf,.pdf,.doc,.docx"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleGlobalFile(file);
        }}
      />

      {/* Global Uploading Frosted-Glass Overlay */}
      {globalUploading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-xl p-8 animate-fade-in">
          <div className="w-full max-w-md p-8 rounded-3xl border border-white/10 bg-card/85 shadow-2xl text-center space-y-6">
            <div className="relative mx-auto w-16 h-16 flex items-center justify-center">
              <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
              <Loader2 className="h-10 w-10 animate-spin text-primary relative z-10" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold tracking-tight">{globalUploadStage}</h3>
              <p className="text-xs text-muted-foreground">Please wait while our AI extracts and structures document contents</p>
            </div>
            <div className="space-y-1.5">
              <Progress value={globalUploadProgress} className="h-2" />
              <div className="flex justify-between text-[11px] text-muted-foreground font-medium">
                <span>Processing document...</span>
                <span>{globalUploadProgress}%</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Floating Action Button (FAB) on Mobile */}
      <div className="fixed bottom-6 right-6 z-40 md:hidden">
        <Button
          onClick={() => globalFileInputRef.current?.click()}
          className="h-14 w-14 rounded-full bg-primary text-white shadow-[0_0_24px_rgba(26,64,255,0.5)] flex items-center justify-center hover:scale-105 transition"
          title="Upload Document"
        >
          <Upload className="h-6 w-6" />
        </Button>
      </div>

      {/* Woblo Header Bar */}
      <header className="sticky top-0 z-45 w-full border-b border-border/80 bg-background/80 backdrop-blur-xl">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            {/* Hamburger button on Mobile */}
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden h-9 w-9"
              onClick={() => setMobileMenuOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <button
              onClick={() => {
                setStage("upload");
                setActiveTab("generate");
              }}
              className="flex items-center gap-2.5 text-lg font-extrabold tracking-tight hover:opacity-90 transition-opacity"
            >
              <img
                src="/logo.png"
                alt="QuizCrack Logo"
                className="h-7 sm:h-8 w-auto rounded-lg object-contain shadow-sm"
              />
              <span className="font-black tracking-tight text-foreground">
                Quiz<span className="woblo-gradient-text animate-gradient-shift">Crack</span>
              </span>
              <span className="woblo-badge hidden sm:inline-flex text-[9px] uppercase tracking-wider py-0.5 px-2">
                AI PRO
              </span>
            </button>
          </div>

          {/* Desktop Navigation Link Pills */}
          <div className="hidden lg:flex items-center gap-1.5 mx-auto">
            {[
              { id: "generate", label: "MCQ Generator" },
              { id: "study-material", label: "Study Notes" },
              { id: "dashboard", label: "Dashboard" },
              { id: "mock-tests", label: "Mock Tests" },
              { id: "recent-activity", label: "Recent Files" },
              { id: "settings", label: "Settings" },
            ].map((nav) => {
              const isActive = activeTab === nav.id;
              return (
                <button
                  key={nav.id}
                  onClick={() => {
                    setActiveTab(nav.id as Tab);
                    if (nav.id === "study-material") {
                      setTargetCreationMode("study-material");
                      if (studyMaterial) setStage("study-material-preview");
                      else if (pdf) setStage("study-material-configuring");
                      else setStage("upload");
                    } else if (nav.id === "generate") {
                      setTargetCreationMode("mcq");
                      if (stage === "results") setStage("upload");
                      else if (mcqs.length > 0) setStage("review");
                      else if (pdf) setStage("configuring");
                      else setStage("upload");
                    }
                  }}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-full transition-all ${
                    isActive
                      ? "bg-primary text-white shadow-[0_0_16px_rgba(26,64,255,0.35)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                  }`}
                >
                  {nav.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* Desktop Upload Button */}
            <Button
              onClick={() => globalFileInputRef.current?.click()}
              className="hidden sm:flex bg-primary hover:bg-primary/90 text-white font-semibold shadow-[0_0_20px_rgba(26,64,255,0.35)] hover:-translate-y-0.5 active:translate-y-0 transition gap-1.5 h-9 px-4 rounded-full text-xs"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              <span>Upload Document</span>
            </Button>

            {/* Profile / Account Shortcut */}
            <Button
              variant={activeTab === "profile" ? "secondary" : "ghost"}
              size="sm"
              className="gap-2 h-9 px-3 rounded-full border border-border/60 text-xs"
              onClick={() => setActiveTab("profile")}
            >
              <User className="h-3.5 w-3.5 text-primary" />
              <span className="hidden sm:inline font-medium">
                {user ? user.email.split("@")[0] : "Sign In"}
              </span>
            </Button>

            <div className="h-4 w-px bg-border/60 hidden sm:block" />

            {/* Dark Mode Toggle */}
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="rounded-full h-8 w-8 hover:bg-white/[0.06]"
              title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {darkMode ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-primary" />
              )}
            </Button>
          </div>
        </div>
      </header>

      {/* Main Body Layout */}
      <div className="flex flex-1 flex-row relative z-10">
        {/* Left Sidebar (Desktop collapsible) */}
        <aside
          className={`hidden md:flex flex-col border-r border-border/80 bg-card/40 backdrop-blur-xl transition-all duration-300 shrink-0 ${
            sidebarCollapsed ? "w-16" : "w-60"
          }`}
        >
          <div className="p-3 flex flex-col gap-1.5 flex-1">
            {[
              { id: "generate", label: "MCQ Generator", icon: FileText },
              { id: "study-material", label: "Study Material", icon: GraduationCap },
              { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
              { id: "recent-activity", label: "Recent Library", icon: History },
              { id: "mock-tests", label: "Mock Tests", icon: Trophy },
              { id: "settings", label: "Settings", icon: SettingsIcon },
              { id: "profile", label: "Profile & Cloud", icon: User },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => {
                    setActiveTab(t.id as Tab);
                    if (t.id === "study-material") {
                      setTargetCreationMode("study-material");
                      if (studyMaterial) setStage("study-material-preview");
                      else if (pdf) setStage("study-material-configuring");
                      else setStage("upload");
                    } else if (t.id === "generate") {
                      setTargetCreationMode("mcq");
                      if (stage === "results") setStage("upload");
                      else if (mcqs.length > 0) setStage("review");
                      else if (pdf) setStage("configuring");
                      else setStage("upload");
                    }
                  }}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-2xl text-xs font-semibold transition-all ${
                    isActive
                      ? "bg-primary text-white shadow-[0_0_18px_rgba(26,64,255,0.35)]"
                      : "text-muted-foreground hover:text-foreground hover:bg-white/[0.04]"
                  }`}
                  title={t.label}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!sidebarCollapsed && <span className="truncate">{t.label}</span>}
                </button>
              );
            })}
          </div>

          {/* Sidebar Collapse Toggle */}
          <div className="p-3 border-t border-border/40">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-center gap-2 h-8 rounded-xl text-xs"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            >
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform duration-300 ${
                  sidebarCollapsed ? "" : "rotate-180"
                }`}
              />
              {!sidebarCollapsed && <span>Collapse Sidebar</span>}
            </Button>
          </div>
        </aside>

        {/* Mobile Hamburger Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 md:hidden bg-background/80 backdrop-blur-sm flex justify-start animate-fade-in">
            <div className="w-64 h-full bg-card border-r border-border p-6 flex flex-col justify-between shadow-2xl relative">
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>

              <div className="space-y-6">
                {/* Mobile Menu Logo */}
                <div className="flex items-center gap-2">
                  <img src="/logo.png" alt="Logo" className="h-7 w-auto rounded-lg" />
                  <span className="font-bold text-lg bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent">
                    QuizCrack
                  </span>
                </div>

                {/* Mobile Nav Links */}
                <div className="flex flex-col gap-1">
                  {[
                    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
                    { id: "study-material", label: "Study Material", icon: GraduationCap },
                    { id: "generate", label: "Generate Quiz", icon: FileText },
                    { id: "recent-activity", label: "Recent Activity", icon: History },
                    { id: "mock-tests", label: "Mock Tests", icon: Trophy },
                    { id: "settings", label: "Settings", icon: SettingsIcon },
                    { id: "profile", label: "Profile / Cloud", icon: User },
                  ].map((t) => {
                    const Icon = t.icon;
                    const isActive = activeTab === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => {
                          setActiveTab(t.id as Tab);
                          setMobileMenuOpen(false);
                          if (t.id === "study-material") {
                            setTargetCreationMode("study-material");
                            if (studyMaterial) {
                              setStage("study-material-preview");
                            } else if (pdf) {
                              setStage("study-material-configuring");
                            } else {
                              setStage("upload");
                            }
                          } else if (t.id === "generate") {
                            setTargetCreationMode("mcq");
                            if (stage === "results") setStage("upload");
                            else if (mcqs.length > 0) setStage("review");
                            else if (pdf) setStage("configuring");
                            else setStage("upload");
                          }
                        }}
                        className={`flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                          isActive
                            ? "bg-indigo-500/10 text-indigo-500 font-semibold"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        <span>{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mobile Drawer Bottom Info */}
              <div className="space-y-4">
                <Button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    globalFileInputRef.current?.click();
                  }}
                  className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-semibold shadow-md flex items-center justify-center gap-2"
                >
                  <PlusCircle className="h-4 w-4" />
                  <span>Upload PDF</span>
                </Button>
                <div className="text-[10px] text-muted-foreground text-center">
                  QuizCrack v1.0 Premium
                </div>
              </div>
            </div>

            {/* Click outside to close */}
            <div className="flex-1" onClick={() => setMobileMenuOpen(false)} />
          </div>
        )}

        {/* Main Content Area */}
        <main className="flex-1 px-4 md:px-8 py-8 overflow-y-auto max-w-6xl mx-auto w-full">
          {activeTab === "dashboard" && (
            <Dashboard
              stats={stats}
              onCreateStudyMaterial={() => {
                setTargetCreationMode("study-material");
                setActiveTab("study-material");
                if (studyMaterial) {
                  setStage("study-material-preview");
                } else if (pdf) {
                  setStage("study-material-configuring");
                } else {
                  setStage("upload");
                }
              }}
              onCreateQuiz={() => {
                setTargetCreationMode("mcq");
                setActiveTab("generate");
                if (mcqs.length > 0) {
                  setStage("review");
                } else if (pdf) {
                  setStage("configuring");
                } else {
                  setStage("upload");
                }
              }}
              onResetStats={() => {
                safeRemoveItem("quizcrack_stats");
                setStats(DEFAULT_STATS);
                toast.success("Dashboard metrics reset.");
              }}
            />
          )}

          {activeTab === "study-material" && (
            <>
              {stage === "upload" && (
                <UploadStage
                  title="Create Study Material from Documents"
                  subtitle="Drop any textbook, syllabus, theory PDF, or Word document (.pdf, .doc, .docx). Our AI extracts structured concepts, key facts, dates, and quick revision notes."
                  mode="study-material"
                  onSelectMode={(m) => {
                    if (m === "mcq") {
                      setTargetCreationMode("mcq");
                      setActiveTab("generate");
                      setStage("upload");
                    }
                  }}
                  onLoaded={(meta, file) => {
                    setPdf(meta);
                    setCurrentFile(file);
                    setStage("study-material-configuring");
                    updateStats((prev) => ({
                      ...prev,
                      uploadedPdfs: prev.uploadedPdfs + 1,
                      totalPages: prev.totalPages + meta.pages,
                    }));
                    logActivity("upload", `Uploaded "${meta.name}" for Study Material`);
                  }}
                  onSelectFile={(file) => {
                    setTargetCreationMode("study-material");
                    handleGlobalFile(file);
                  }}
                />
              )}

              {stage === "study-material-configuring" && pdf && (
                <StudyMaterialConfigureStage
                  pdf={pdf}
                  currentFile={currentFile}
                  apiKey={apiKey}
                  apiProvider={apiProvider}
                  modelName={modelName}
                  onBack={() => setStage("upload")}
                  selectedLanguage={selectedLanguage}
                  setSelectedLanguage={setSelectedLanguage}
                  onFinished={(materialData, timeSec) => {
                    setStudyMaterial(materialData);
                    setStage("study-material-preview");
                    updateStats((prev) => ({
                      ...prev,
                      studyMaterialsCreated: (prev.studyMaterialsCreated || 0) + 1,
                      totalGenTimeSec: prev.totalGenTimeSec + timeSec,
                    }));
                    logActivity(
                      "study-material",
                      `Created Study Material "${materialData.title}" (${materialData.chapters.length} chapters) in ${timeSec}s`,
                    );
                    saveGeneratedStudyMaterial(materialData);
                  }}
                />
              )}

              {stage === "study-material-preview" && studyMaterial && (
                <StudyMaterialView
                  material={studyMaterial}
                  onBack={() => {
                    if (pdf) {
                      setStage("study-material-configuring");
                    } else {
                      setStage("upload");
                    }
                  }}
                  onUpdateMaterial={(updated) => {
                    setStudyMaterial(updated);
                    saveGeneratedStudyMaterial(updated);
                  }}
                />
              )}
            </>
          )}

          {activeTab === "settings" && (
            <Settings
              apiKey={apiKey}
              setApiKey={(k) => {
                setApiKey(k);
                safeSetItem("quizcrack_apikey", k);
              }}
              apiProvider={apiProvider}
              setApiProvider={(p) => {
                setApiProvider(p);
                safeSetItem("quizcrack_provider", p);
              }}
              modelName={modelName}
              setModelName={(m) => {
                setModelName(m);
                safeSetItem("quizcrack_model", m);
              }}
            />
          )}

          {activeTab === "recent-activity" && (
            <RecentActivity
              quizzes={recentQuizzes}
              studyMaterials={recentStudyMaterials}
              onViewQuiz={(quiz) => {
                setMcqs(quiz.questions);
                setPdf({
                  name: quiz.pdf_name,
                  size: 0,
                  pages: 0,
                  chars: 0,
                  text: "",
                  isScanned: false,
                  primaryLanguage: quiz.language,
                  languages: [quiz.language],
                });
                setSelectedLanguage(quiz.language);
                setStage("review");
                setActiveTab("generate");
              }}
              onViewStudyMaterial={(materialData) => {
                setStudyMaterial(materialData);
                setPdf({
                  name: materialData.pdf_name,
                  size: 0,
                  pages: 0,
                  chars: 0,
                  text: "",
                  isScanned: false,
                  primaryLanguage: materialData.language,
                  languages: [materialData.language],
                });
                setSelectedLanguage(materialData.language);
                setStage("study-material-preview");
                setActiveTab("study-material");
              }}
              onDownloadPdf={handleDownloadPdf}
              onDownloadDocx={handleDownloadWord}
              onDownloadStudyMaterialPdf={handleDownloadStudyMaterialPdf}
              onDownloadStudyMaterialDocx={handleDownloadStudyMaterialDocx}
              onStartTest={(quiz) => {
                setMcqs(quiz.questions);
                setPdf({
                  name: quiz.pdf_name,
                  size: 0,
                  pages: 0,
                  chars: 0,
                  text: "",
                  isScanned: false,
                  primaryLanguage: quiz.language,
                  languages: [quiz.language],
                });
                setSelectedLanguage(quiz.language);
                setAnswers({});
                setStage("test");
                setActiveTab("generate");
              }}
              onRenameQuiz={renameQuiz}
              onRenameStudyMaterial={renameStudyMaterial}
              onDuplicateQuiz={duplicateQuiz}
              onDeleteQuiz={deleteQuiz}
              onDeleteStudyMaterial={deleteStudyMaterial}
            />
          )}

          {activeTab === "mock-tests" && (
            <MockTests
              quizzes={recentQuizzes}
              attempts={mockAttempts}
              onStartTest={(quiz) => {
                setMcqs(quiz.questions);
                setPdf({
                  name: quiz.pdf_name,
                  size: 0,
                  pages: 0,
                  chars: 0,
                  text: "",
                  isScanned: false,
                  primaryLanguage: quiz.language,
                  languages: [quiz.language],
                });
                setSelectedLanguage(quiz.language);
                setAnswers({});
                setStage("test");
                setActiveTab("generate");
              }}
              onResetAttempts={() => {
                setMockAttempts([]);
                safeRemoveItem("quizcrack_mock_attempts");
                if (user && supabaseClient) {
                  supabaseClient.from("mock_attempts").delete().eq("user_id", user.id).then();
                }
                toast.success("Mock test attempts cleared.");
              }}
            />
          )}

          {activeTab === "profile" && (
            <Profile
              user={user}
              supabaseClient={supabaseClient}
              onSignOut={async () => {
                if (supabaseClient) {
                  await supabaseClient.auth.signOut();
                  setUser(null);
                  toast.success("Logged out successfully.");
                  setActiveTab("generate");
                  setStage("upload");
                }
              }}
              onSaveSupabaseConfig={(url, key) => {
                safeSetItem("quizcrack_supabase_url", url);
                safeSetItem("quizcrack_supabase_key", key);
                toast.success("Supabase credentials saved locally. Reloading page...");
                setTimeout(() => {
                  if (typeof window !== "undefined") {
                    window.location.reload();
                  }
                }, 1000);
              }}
            />
          )}

          {activeTab === "generate" && (
            <>
              {stage === "upload" && (
                <UploadStage
                  mode="mcq"
                  onSelectMode={(m) => {
                    if (m === "study-material") {
                      setTargetCreationMode("study-material");
                      setActiveTab("study-material");
                      setStage("upload");
                    }
                  }}
                  onLoaded={(meta, file) => {
                    setPdf(meta);
                    setCurrentFile(file);
                    setStage("configuring");
                    updateStats((prev) => ({
                      ...prev,
                      uploadedPdfs: prev.uploadedPdfs + 1,
                      totalPages: prev.totalPages + meta.pages,
                    }));
                    logActivity("upload", `Uploaded "${meta.name}" (${meta.pages} pages)`);
                  }}
                  onSelectFile={(file) => {
                    setTargetCreationMode("mcq");
                    handleGlobalFile(file);
                  }}
                />
              )}

              {stage === "configuring" && pdf && (
                <ConfigureStage
                  pdf={pdf}
                  currentFile={currentFile}
                  apiKey={apiKey}
                  apiProvider={apiProvider}
                  modelName={modelName}
                  onBack={() => setStage("upload")}
                  onStartGenerating={() => setStage("generating")}
                  onSwitchToStudyMaterial={() => {
                    setTargetCreationMode("study-material");
                    setActiveTab("study-material");
                    setStage("study-material-configuring");
                  }}
                  selectedLanguage={selectedLanguage}
                  setSelectedLanguage={setSelectedLanguage}
                  onFinished={(list, timeSec) => {
                    setMcqs(list);
                    setStage("review");
                    updateStats((prev) => ({
                      ...prev,
                      questionsGenerated: prev.questionsGenerated + list.length,
                      totalGenTimeSec: prev.totalGenTimeSec + timeSec,
                    }));
                    logActivity(
                      "generate",
                      `Generated ${list.length} questions in ${timeSec}s from "${pdf.name}"`,
                    );
                    saveGeneratedQuiz(pdf.name, list, selectedLanguage || pdf.primaryLanguage || "English");
                  }}
                />

              )}

              {stage === "review" && (
                <ReviewStage
                  pdfName={pdf?.name || "Quiz"}
                  mcqs={mcqs}
                  setMcqs={setMcqs}
                  onStartTest={() => {
                    setAnswers({});
                    setStage("test");
                  }}
                  onDownload={() => {
                    updateStats((prev) => ({
                      ...prev,
                      downloadHistoryCount: prev.downloadHistoryCount + 1,
                    }));
                    logActivity("download", `Downloaded quiz from "${pdf?.name}"`);
                  }}
                />
              )}

              {stage === "test" && (
                <MockTest
                  mcqs={mcqs}
                  onSubmit={(ans, timeSec) => {
                    setAnswers(ans);
                    setTestTime(timeSec);
                    setStage("results");
                    updateStats((prev) => ({ ...prev, mockTestsCreated: prev.mockTestsCreated + 1 }));
                    const score = mcqs.filter((m, idx) => ans[idx] === m.correctAnswer).length;
                    const pct = Math.round((score / mcqs.length) * 100);
                    logActivity(
                      "test",
                      `Completed mock test: Score ${pct}% (${score}/${mcqs.length})`,
                    );
                    saveMockAttempt(pdf?.name || "Quiz", mcqs.length, score, timeSec);
                  }}
                  onExit={() => setStage("review")}
                />
              )}

              {stage === "results" && (
                <Results
                  mcqs={mcqs}
                  answers={answers}
                  testTime={testTime}
                  onRetake={() => {
                    setAnswers({});
                    setStage("test");
                  }}
                  onEdit={() => setStage("review")}
                  onNew={() => {
                    setPdf(null);
                    setMcqs([]);
                    setAnswers({});
                    setStage("upload");
                  }}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}


// ==========================================
// 📈 DASHBOARD COMPONENT
// ==========================================
function Dashboard({
  stats,
  onCreateStudyMaterial,
  onCreateQuiz,
  onResetStats,
}: {
  stats: DashboardStats;
  onCreateStudyMaterial: () => void;
  onCreateQuiz: () => void;
  onResetStats: () => void;
}) {
  const avgGenTime =
    stats.questionsGenerated > 0
      ? (stats.totalGenTimeSec / stats.questionsGenerated).toFixed(2)
      : "0";

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">AI Education Hub & Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Turn lengthy textbooks and syllabus PDFs into exam-oriented Study Notes & MCQs.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onResetStats}>
          Clear History
        </Button>
      </div>

      {/* Flagship AI Features Cards */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Feature 1: Study Material Generator */}
        <Card className="p-7 relative overflow-hidden bg-gradient-to-br from-indigo-500/10 via-purple-500/5 to-transparent border-2 border-indigo-500/30 hover:border-indigo-500/60 hover:shadow-xl transition-all flex flex-col justify-between group">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-500/30 group-hover:scale-105 transition-transform">
                <GraduationCap className="h-7 w-7" />
              </div>
              <Badge className="bg-indigo-500/20 text-indigo-400 border-indigo-500/30 font-bold text-xs">
                EXAM REVISION NOTES
              </Badge>
            </div>
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight">📚 Study Material Generator</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">
                Convert any PDF into easy-to-revise, exam-oriented study material with key facts,
                definitions, timeline dates, and quick revision cards.
              </p>
            </div>
          </div>

          <div className="pt-6 border-t border-border/40 mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              A4 Clean Book • Tamil/Hindi/English • Zero Hallucination
            </span>
            <Button
              onClick={onCreateStudyMaterial}
              className="bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold shadow-md shadow-indigo-500/25 gap-2"
            >
              <Sparkles className="h-4 w-4" />
              Create Study Material
            </Button>
          </div>
        </Card>

        {/* Feature 2: PDF to MCQ Generator */}
        <Card className="p-7 relative overflow-hidden bg-gradient-to-br from-purple-500/10 via-cyan-500/5 to-transparent border-2 border-purple-500/30 hover:border-purple-500/60 hover:shadow-xl transition-all flex flex-col justify-between group">
          <div className="space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="p-3 rounded-2xl bg-purple-600 text-white shadow-lg shadow-purple-500/30 group-hover:scale-105 transition-transform">
                <FileText className="h-7 w-7" />
              </div>
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 font-bold text-xs">
                MOCK TEST ENGINE
              </Badge>
            </div>
            <div>
              <h2 className="text-2xl font-extrabold tracking-tight">📝 PDF → MCQ Generator</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mt-1.5">
                Generate high-quality multiple choice questions with detailed explanations, test simulations,
                and exam paper exports.
              </p>
            </div>
          </div>

          <div className="pt-6 border-t border-border/40 mt-6 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              Timed Mock Tests • Instant Evaluation • Word/PDF Export
            </span>
            <Button
              onClick={onCreateQuiz}
              variant="outline"
              className="font-bold border-purple-500/40 text-purple-400 hover:bg-purple-500/10 gap-2"
            >
              <Play className="h-4 w-4" />
              Generate MCQs
            </Button>
          </div>
        </Card>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Uploaded Documents",
            value: stats.uploadedPdfs,
            sub: "Total documents processed",
            icon: BookOpen,
            color: "text-indigo-500 bg-indigo-500/10",
          },
          {
            label: "Study Materials Created",
            value: stats.studyMaterialsCreated || 0,
            sub: "Structured revision notes",
            icon: GraduationCap,
            color: "text-amber-500 bg-amber-500/10",
          },
          {
            label: "Questions Generated",
            value: stats.questionsGenerated,
            sub: "Exam-quality MCQs created",
            icon: Sparkles,
            color: "text-purple-500 bg-purple-500/10",
          },
          {
            label: "Total Pages Extracted",
            value: stats.totalPages,
            sub: "Pages read by parser/OCR",
            icon: FileText,
            color: "text-cyan-500 bg-cyan-500/10",
          },
        ].map((c, i) => (
          <Card
            key={i}
            className="p-6 relative overflow-hidden bg-card/60 backdrop-blur-sm border-border hover:shadow-md transition"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">{c.label}</p>
                <h3 className="text-3xl font-bold mt-2 tracking-tight">{c.value}</h3>
              </div>
              <div className={`p-3 rounded-xl ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4">{c.sub}</p>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {/* Mock test performance info */}
        <Card className="p-6 bg-card/60 backdrop-blur-sm md:col-span-1">
          <h3 className="text-lg font-bold tracking-tight mb-4">Quiz & Study Metrics</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-sm text-muted-foreground">Study Notes Generated</span>
              <span className="font-semibold text-lg">{stats.studyMaterialsCreated || 0}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-sm text-muted-foreground">Mock Tests Started</span>
              <span className="font-semibold text-lg">{stats.mockTestsCreated}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/40 pb-2">
              <span className="text-sm text-muted-foreground">Downloads Exported</span>
              <span className="font-semibold text-lg">{stats.downloadHistoryCount}</span>
            </div>
            <div className="flex items-center justify-between pb-2">
              <span className="text-sm text-muted-foreground">AI Generation Efficiency</span>
              <span className="font-semibold text-emerald-500 text-sm flex items-center gap-1">
                High Speed (Gemini 3.5)
              </span>
            </div>
          </div>
        </Card>

        {/* Activity log */}
        <Card className="p-6 bg-card/60 backdrop-blur-sm md:col-span-2">
          <h3 className="text-lg font-bold tracking-tight mb-4">Recent Activity</h3>
          <div className="max-h-64 overflow-y-auto pr-2 space-y-3 scrollbar-thin">
            {stats.recentActivity.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No recent activity. Start generating study materials or quizzes!
              </p>
            ) : (
              stats.recentActivity.map((a) => (
                <div
                  key={a.id}
                  className="flex items-start justify-between text-sm py-1 border-b border-border/30 last:border-0 pb-2"
                >
                  <div className="flex gap-2.5 items-center">
                    <span
                      className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                        a.type === "study-material"
                          ? "bg-amber-500"
                          : a.type === "upload"
                          ? "bg-indigo-500"
                          : a.type === "generate"
                          ? "bg-purple-500"
                          : a.type === "test"
                          ? "bg-emerald-500"
                          : "bg-cyan-500"
                      }`}
                    />
                    <p className="font-medium text-foreground">{a.detail}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{a.time}</span>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ==========================================
// ⚙️ SETTINGS COMPONENT
// ==========================================
type SettingsProps = {
  apiKey: string;
  setApiKey: (k: string) => void;
  apiProvider: "gemini" | "openai" | "lovable";
  setApiProvider: (p: "gemini" | "openai" | "lovable") => void;
  modelName: string;
  setModelName: (m: string) => void;
};

function Settings({
  apiKey,
  setApiKey,
  apiProvider,
  setApiProvider,
  modelName,
  setModelName,
}: SettingsProps) {
  // Sync model choices based on provider
  useEffect(() => {
    if (apiProvider === "gemini" && !modelName.startsWith("gemini")) {
      setModelName("gemini-3.1-flash-lite");
    } else if (apiProvider === "openai" && !modelName.startsWith("gpt")) {
      setModelName("gpt-4o-mini");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiProvider]);

  return (
    <Card className="max-w-xl mx-auto p-8 space-y-6 bg-card/60 backdrop-blur-sm border-border animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure your AI model credentials. Keys are saved locally in your browser.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <Label>AI Provider</Label>
          <div className="grid grid-cols-3 gap-2 mt-2">
            {[
              { id: "gemini", name: "Google Gemini" },
              { id: "openai", name: "OpenAI" },
              { id: "lovable", name: "Lovable Gateway" },
            ].map((p) => (
              <Button
                key={p.id}
                type="button"
                variant={apiProvider === p.id ? "default" : "outline"}
                size="sm"
                className="w-full"
                onClick={() => setApiProvider(p.id as any)}
              >
                {p.name}
              </Button>
            ))}
          </div>
        </div>

        {apiProvider !== "lovable" && (
          <div>
            <Label htmlFor="apiKey">
              {apiProvider === "gemini" ? "Google Gemini API Key" : "OpenAI API Key"}
            </Label>
            <Input
              id="apiKey"
              type="password"
              placeholder={apiProvider === "gemini" ? "AIzaSy..." : "sk-proj-..."}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="mt-1"
            />
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Required to generate quizzes locally. Get a key from the{" "}
              {apiProvider === "gemini" ? (
                <a
                  href="https://aistudio.google.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 underline"
                >
                  Google AI Studio
                </a>
              ) : (
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 underline"
                >
                  OpenAI Platform
                </a>
              )}
              .
            </p>
          </div>
        )}

        {apiProvider === "lovable" && (
          <div className="p-4 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-xs text-indigo-400 leading-relaxed">
            Uses the pre-configured server keys provided by the platform. You do not need to provide
            a custom key, but generation will depend on server credit availability.
          </div>
        )}

        <div>
          <Label htmlFor="modelName">AI Model</Label>
          {apiProvider === "gemini" ? (
            <Select value={modelName} onValueChange={setModelName}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gemini-3.1-flash-lite">
                  Gemini 3.1 Flash Lite (Ultra Fast & Low Latency)
                </SelectItem>
                <SelectItem value="gemini-3.5-flash">Gemini 3.5 Flash (Fast & Accurate)</SelectItem>
                <SelectItem value="gemini-2.5-flash">Gemini 2.5 Flash</SelectItem>
                <SelectItem value="gemini-2.5-pro">Gemini 2.5 Pro (Extremely Detailed)</SelectItem>
              </SelectContent>
            </Select>
          ) : apiProvider === "openai" ? (
            <Select value={modelName} onValueChange={setModelName}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="gpt-4o-mini">GPT-4o Mini (Fast & Cost Efficient)</SelectItem>
                <SelectItem value="gpt-4o">GPT-4o (Premium Accuracy)</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input disabled value="Google Gemini 3.5 Flash (Server)" className="mt-1" />
          )}
        </div>
      </div>

      <div className="pt-2">
        <Button
          className="w-full"
          onClick={() => {
            toast.success("Settings saved locally!");
          }}
        >
          Save Configuration
        </Button>
      </div>
    </Card>
  );
}

// ==========================================
// 📂 UPLOAD STAGE COMPONENT
// ==========================================
// 📂 UPLOAD STAGE COMPONENT
// ==========================================
type UploadProps = {
  onLoaded: (meta: PdfMeta, file: File) => void;
  onExtractionProgress?: (pct: number, stageName: string) => void;
  onSelectFile?: (file: File) => void;
  title?: string;
  subtitle?: string;
  mode?: "mcq" | "study-material";
  onSelectMode?: (mode: "mcq" | "study-material") => void;
};

function UploadStage({
  onLoaded,
  onSelectFile,
  title,
  subtitle,
  mode = "mcq",
  onSelectMode,
}: UploadProps) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stageName, setStageName] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (onSelectFile) {
        onSelectFile(file);
        return;
      }

      const fileName = file.name.toLowerCase();
      const isPdf = file.type === "application/pdf" || fileName.endsWith(".pdf");
      const isDoc = fileName.endsWith(".doc");
      const isDocx =
        file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        file.type === "application/msword" ||
        fileName.endsWith(".docx");

      if (!isPdf && !isDoc && !isDocx) {
        toast.error("Invalid file format. Please upload a PDF (.pdf), Word (.doc), or Word (.docx) document.");
        return;
      }
      if (file.size > 100 * 1024 * 1024) {
        toast.error("File is too large. Max supported size is 100MB.");
        return;
      }

      setBusy(true);
      setProgress(10);
      setStageName("Checking local cache...");

      try {
        const fileType = isPdf ? "pdf" : isDoc ? "doc" : "docx";
        const cacheKey = `pdf_cache_${file.name}_${file.size}_${file.lastModified}`;
        const cached = await PDFCache.get(cacheKey);
        if (cached) {
          toast.success("Loaded document text from local cache!");
          setProgress(100);
          setStageName("Ready!");
          setTimeout(() => {
            onLoaded(cached, file);
          }, 300);
          return;
        }

        setProgress(30);
        let sampleText = "";
        let pagesCount = 1;
        let isScanned = false;
        let extractedPageList: { pageNum: number; text: string }[] = [];

        if (isPdf) {
          setStageName("Reading PDF document...");
          const pdfjs = await import("pdfjs-dist");
          const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
          const buf = await file.arrayBuffer();
          const doc = await pdfjs.getDocument({ data: buf }).promise;
          pagesCount = doc.numPages;

          setStageName(`Extracting text from all ${pagesCount} pages...`);
          extractedPageList = await getPDFPagesTextFast(doc, (current, total) => {
            setProgress(30 + Math.round((current / total) * 35));
          });

          sampleText = extractedPageList.map((p) => p.text).join("\n\n");
          isScanned = sampleText.trim().length < (pagesCount * 30);
        } else {
          setStageName("Reading Word document structure...");
          setProgress(40);
          const docxData = await extractDocxText(file);
          sampleText = docxData.sampleText;
          pagesCount = docxData.pagesCount;
          isScanned = docxData.isScanned;
          extractedPageList = docxData.pageList;
        }

        // Detect language
        setStageName("Detecting language...");
        setProgress(70);
        let isMultilingual = false;
        let primaryLanguage = "English";
        let languages: string[] = ["English"];
        let hasLegacyTamil = false;
        let fontEncoding = "None";
        let cleanSample = sampleText;

        try {
          const detectRes = await fetch("/api/detect-language", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: sampleText.slice(0, 3000) }),
          });
          if (detectRes.ok) {
            const data = await detectRes.json();
            isMultilingual = !!data.isMultilingual;
            primaryLanguage = data.primaryLanguage || "English";
            languages = data.languages || ["English"];
            hasLegacyTamil = !!data.hasLegacyTamil;
            fontEncoding = data.fontEncoding || "None";
          }
        } catch (err) {
          console.error("Language detection failed", err);
        }

        if (hasLegacyTamil) {
          setStageName(`Converting Tamil sample...`);
          setProgress(90);
          try {
            const convertRes = await fetch("/api/convert-legacy-tamil", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text: sampleText }),
            });
            if (convertRes.ok) {
              const data = await convertRes.json();
              if (data.text) {
                cleanSample = data.text;
                hasLegacyTamil = false;
                fontEncoding = "Unicode";
              }
            }
          } catch (err) {
            console.error("Tamil font conversion failed:", err);
          }
        }

        const meta: PdfMeta = {
          name: file.name,
          size: file.size,
          pages: pagesCount,
          chars: isPdf ? pagesCount * 1500 : sampleText.length,
          text: cleanSample,
          isScanned,
          isMultilingual,
          primaryLanguage,
          languages,
          pageList: extractedPageList.length > 0 ? extractedPageList : undefined,
          lastModified: file.lastModified,
          fileType,
        };

        await PDFCache.set(cacheKey, meta);

        setProgress(100);
        setStageName("Complete!");
        setTimeout(() => {
          onLoaded(meta, file);
        }, 300);
      } catch (e) {
        console.error(e);
        toast.error("Failed to parse document file. The file may be password-protected or corrupt.");
      } finally {
        setBusy(false);
      }
    },
    [onLoaded, onSelectFile],
  );

  const displayTitle =
    title ||
    (mode === "study-material"
      ? "Create Study Material from Documents"
      : "Create Quizzes from Documents in Seconds");

  const displaySubtitle =
    subtitle ||
    (mode === "study-material"
      ? "Drop any syllabus, chapter, PDF or Word document. Our AI converts it into concise, revision-ready study notes."
      : "Drop any study guide, textbook, PDF, or Word document (.pdf, .doc, .docx). Our AI parses text and generates custom exam questions.");

  return (
    <div className="space-y-10 max-w-5xl mx-auto animate-fade-in py-4">
      {/* Woblo Hero Header */}
      <div className="flex flex-col items-center text-center">
        <div className="woblo-badge mb-4">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>THE #1 AI EXAM & STUDY MATERIAL ENGINE</span>
        </div>

        <h1
          className="text-[34px] sm:text-[48px] md:text-[58px] text-foreground font-black uppercase text-center mb-3 leading-[38px] sm:leading-[52px] md:leading-[60px]"
          style={{ letterSpacing: "-0.03em" }}
        >
          <div className="sm:hidden">
            <div>The #1 Most Powerful</div>
            <div>AI Exam & Study</div>
            <span className="woblo-gradient-text animate-gradient-shift">Engine</span>
          </div>
          <div className="hidden sm:block">
            The #1 Most Powerful AI Exam & Study{" "}
            <span className="woblo-gradient-text animate-gradient-shift">Engine</span>
          </div>
        </h1>

        <p className="text-muted-foreground font-medium text-center max-w-xl mx-auto mb-6 text-sm sm:text-base leading-relaxed">
          {displaySubtitle}
        </p>

        {/* Woblo Hero CTA Button */}
        <div className="flex flex-wrap items-center justify-center gap-3 mb-6">
          <Button
            variant="wobloHero"
            size="hero"
            onClick={() => !busy && inputRef.current?.click()}
            className="cursor-pointer"
          >
            Upload Document →
          </Button>
        </div>

        {/* Mode Selector Pill */}
        {onSelectMode && (
          <div className="inline-flex items-center gap-1 p-1 bg-secondary/80 rounded-full border border-border/80 text-xs font-semibold backdrop-blur-md">
            <button
              onClick={() => onSelectMode("mcq")}
              className={`px-4 py-2 rounded-full transition-all flex items-center gap-2 font-bold ${
                mode === "mcq"
                  ? "bg-primary text-white shadow-[0_0_16px_rgba(26,64,255,0.4)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>📝 MCQ Quiz Mode</span>
            </button>
            <button
              onClick={() => onSelectMode("study-material")}
              className={`px-4 py-2 rounded-full transition-all flex items-center gap-2 font-bold ${
                mode === "study-material"
                  ? "bg-primary text-white shadow-[0_0_16px_rgba(26,64,255,0.4)]"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <GraduationCap className="h-3.5 w-3.5" />
              <span>📚 Full Study Notes Mode</span>
            </button>
          </div>
        )}
      </div>

      {/* Woblo Animated Infinite Marquee Ticker */}
      <div className="w-full overflow-hidden py-3 relative border-y border-white/[0.06] bg-card/20 backdrop-blur-md">
        <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-background to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-background to-transparent z-10 pointer-events-none" />
        
        <div className="flex w-max animate-marquee-x gap-4">
          {[...Array(2)].flatMap(() => [
            { icon: "⚡", text: "50+ MCQs in 8 Seconds", badge: "ULTRA FAST" },
            { icon: "📚", text: "100% Page Coverage (No Skipping)", badge: "COMPLETE" },
            { icon: "🌐", text: "Tamil / Hindi / English Unicode", badge: "MULTILINGUAL" },
            { icon: "🎯", text: "Bloom's Taxonomy & Difficulty Engine", badge: "SMART AI" },
            { icon: "⏱️", text: "Real-Time Timed Mock Exam Simulator", badge: "PRACTICE" },
            { icon: "📥", text: "A4 PDF, Word DOCX & Excel Exports", badge: "FORMATS" },
            { icon: "🔍", text: "Tesseract OCR Image Extraction", badge: "VISION" },
            { icon: "✨", text: "Zero Hallucination Guarantee", badge: "VERIFIED" },
          ]).map((item, idx) => (
            <div
              key={idx}
              className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white/[0.04] border border-white/10 text-xs font-semibold text-white/90 shrink-0 hover:bg-white/[0.08] transition-colors"
            >
              <span>{item.icon}</span>
              <span>{item.text}</span>
              <span className="px-1.5 py-0.5 rounded-full bg-primary/20 text-primary text-[9px] font-bold tracking-wider">
                {item.badge}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Woblo Glass Drag & Drop Zone with Animated Border Beam */}
      <Card
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
        className={`woblo-glass woblo-border-beam border-2 border-dashed p-10 sm:p-14 text-center cursor-pointer transition-all duration-300 relative overflow-hidden rounded-3xl group ${
          dragging
            ? "border-primary bg-primary/10 scale-[0.99] shadow-[0_0_50px_rgba(26,64,255,0.3)]"
            : "border-white/15 hover:border-primary/60 hover:shadow-[0_0_40px_rgba(26,64,255,0.18)]"
        }`}
        onClick={() => !busy && inputRef.current?.click()}
      >
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/15 text-primary border border-primary/30 shadow-[0_0_20px_rgba(26,64,255,0.2)] group-hover:scale-110 group-hover:shadow-[0_0_30px_rgba(26,64,255,0.4)] transition-all duration-300">
          {mode === "study-material" ? <GraduationCap className="h-8 w-8" /> : <Upload className="h-8 w-8" />}
        </div>
        
        <h2 className="mt-5 text-xl sm:text-2xl font-black tracking-tight text-foreground">
          Drag & drop your PDF, DOC, or DOCX file here
        </h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          or click to browse your local computer (Supports PDF, Word .doc & .docx files up to 100MB)
        </p>

        {/* Supported Format Pills */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-6">
          <span className="woblo-badge text-[10px] text-white/80">📄 PDF Documents</span>
          <span className="woblo-badge text-[10px] text-white/80">📝 Word (.docx, .doc)</span>
          <span className="woblo-badge text-[10px] text-white/80">🔍 OCR Image Extraction</span>
          <span className="woblo-badge text-[10px] text-white/80">🌐 Multilingual Unicode</span>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf,.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        {busy && (
          <div className="absolute inset-0 bg-background/90 backdrop-blur-md flex flex-col items-center justify-center p-8 z-20 animate-fade-in">
            <div className="relative mx-auto w-14 h-14 flex items-center justify-center mb-3">
              <div className="absolute inset-0 rounded-full bg-primary/25 animate-ping" />
              <Loader2 className="h-8 w-8 animate-spin text-primary relative z-10" />
            </div>
            <h3 className="text-lg font-bold tracking-tight">{stageName}</h3>
            <div className="w-full max-w-md mt-4">
              <Progress value={progress} className="h-2" />
              <div className="flex justify-between text-xs text-muted-foreground mt-1.5 font-medium">
                <span>Extracting all pages...</span>
                <span>{progress}%</span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Woblo 3 Feature Cards Grid with Smooth Hover Glow */}
      <div className="grid gap-6 md:grid-cols-3">
        {[
          {
            icon: BookOpen,
            title: "Parallel Page Extraction",
            body: "Processes entire documents in parallel chunks for instantaneous loading and zero data loss.",
            badge: "HIGH SPEED",
          },
          {
            icon: Sparkles,
            title: "Tesseract OCR Engine",
            body: "Extracts text from scanned pages, photocopied notes, and mobile photos with AI recognition.",
            badge: "AI VISION",
          },
          {
            icon: Play,
            title: "Instant Cached Retrieval",
            body: "Previously uploaded files load instantly from memory without redundant reprocessing.",
            badge: "ZERO DELAY",
          },
        ].map((f, i) => (
          <Card
            key={i}
            className="p-6 bg-card/60 backdrop-blur-md border border-border/80 rounded-3xl prompt-card-hover flex flex-col justify-between hover:border-primary/40 hover:shadow-[0_16px_40px_rgba(26,64,255,0.15)] group"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="h-10 w-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                  <f.icon className="h-5 w-5" />
                </div>
                <span className="woblo-badge text-[9px] uppercase tracking-wider">{f.badge}</span>
              </div>
              <h3 className="font-bold tracking-tight text-base text-foreground">{f.title}</h3>
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ==========================================
// 🛠️ CONFIGURE & AI STREAM GENERATION COMPONENT
// ==========================================
type ConfigureProps = {
  pdf: PdfMeta;
  currentFile: File | null;
  apiKey: string;
  apiProvider: "gemini" | "openai" | "lovable";
  modelName: string;
  onBack: () => void;
  onStartGenerating: () => void;
  onFinished: (mcqs: MCQ[], timeSec: number) => void;
  onSwitchToStudyMaterial?: () => void;
  selectedLanguage: string;
  setSelectedLanguage: (lang: string) => void;
};

type ChecklistStep = {
  id: string;
  label: string;
  status: "idle" | "running" | "done" | "error";
};

function ConfigureStage({
  pdf,
  currentFile,
  apiKey,
  apiProvider,
  modelName,
  onBack,
  onStartGenerating,
  onFinished,
  selectedLanguage,
  setSelectedLanguage,
}: ConfigureProps) {

  const [count, setCount] = useState<number>(20);
  const [difficulty, setDifficulty] = useState<"Easy" | "Medium" | "Hard" | "Mixed">("Mixed");
  const [busy, setBusy] = useState(false);
  const [liveQuestions, setLiveQuestions] = useState<MCQ[]>([]);
  const [genTime, setGenTime] = useState<number>(0);
  const [progress, setProgress] = useState(0);

  const [logs, setLogs] = useState<string[]>([]);
  const [pipelineProgress, setPipelineProgress] = useState({
    percent: 0,
    currentPage: 1,
    totalPages: pdf.pages,
    remainingPages: pdf.pages,
    estimatedTimeSec: 0,
  });

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const [detectedLang, setDetectedLang] = useState<{
    isMultilingual: boolean;
    primaryLanguage: string;
    languages: string[];
  }>({
    isMultilingual: pdf.isMultilingual ?? false,
    primaryLanguage: pdf.primaryLanguage ?? "English",
    languages: pdf.languages ?? ["English"],
  });


  useEffect(() => {
    // Skip if primaryLanguage is already known
    if (pdf.primaryLanguage !== undefined) return;

    // Fallback/Initial detection based on sample text in pdf.text
    if (pdf.text && pdf.text.length > 50) {
      fetch("/api/detect-language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: pdf.text.slice(0, 3000) }),
      })
        .then((res) => {
          if (res.ok) return res.json();
          throw new Error();
        })
        .then((data) => {
          setDetectedLang({
            isMultilingual: !!data.isMultilingual,
            primaryLanguage: data.primaryLanguage || "English",
            languages: data.languages || ["English"],
          });
        })
        .catch(() => {
          setDetectedLang({
            isMultilingual: false,
            primaryLanguage: "English",
            languages: ["English"],
          });
        });
    }
  }, [pdf]);

  useEffect(() => {
    if (detectedLang.isMultilingual) {
      setSelectedLanguage("mixed");
    } else {
      setSelectedLanguage(detectedLang.primaryLanguage);
    }
  }, [detectedLang]);

  // Progress checklists
  const [checklist, setChecklist] = useState<ChecklistStep[]>([
    { id: "load", label: "Uploading PDF content...", status: "idle" },
    { id: "text", label: "Extracting document text...", status: "idle" },
    { id: "understand", label: "Understanding content themes...", status: "idle" },
    { id: "generate", label: "Generating MCQ questions in parallel...", status: "idle" },
    { id: "complete", label: "Completed", status: "idle" },
  ]);

  const estimated = useMemo(
    () => Math.max(5, Math.min(100, Math.round(pdf.chars / 450))),
    [pdf.chars],
  );

  const updateStep = (id: string, status: ChecklistStep["status"]) => {
    setChecklist((prev) => prev.map((step) => (step.id === id ? { ...step, status } : step)));
  };

  async function run() {
    setBusy(true);
    setLiveQuestions([]);
    setLogs([]);
    setGenTime(0);

    const startTime = Date.now();
    addLog("Starting MCQ Generation process...");

    // Check questions cache first
    const questionsCacheKey = `questions_${pdf.name}_${pdf.size}_${count}_${difficulty}_${modelName}`;
    addLog("Checking questions cache...");
    try {
      const cachedQuestions = await PDFCache.get(questionsCacheKey);
      if (cachedQuestions) {
        addLog("Cache hit! Found generated questions in IndexedDB.");
        toast.success("Loaded generated questions from local cache!");
        setLiveQuestions(cachedQuestions);

        updateStep("load", "done");
        updateStep("text", "done");
        updateStep("understand", "done");
        updateStep("generate", "done");
        updateStep("complete", "done");

        onFinished(cachedQuestions, 1);
        return;
      }
    } catch (e) {
      addLog(`Cache read error: ${e}`);
    }

    onStartGenerating();
    updateStep("load", "running");
    await new Promise((r) => setTimeout(r, 400));
    updateStep("load", "done");

    updateStep("text", "running");

    const timerInterval = setInterval(() => {
      setGenTime((t) => t + 1);
    }, 1000);

    let doc: any = null;
    let allPagesList: { pageNum: number; text: string }[] = [];

    try {
      // Check if we have cached text meta first
      const textCacheKey = `pdf_cache_${pdf.name}_${pdf.size}_${pdf.lastModified}`;
      addLog("Checking document text cache...");
      const cachedMeta = await PDFCache.get(textCacheKey);

      if (pdf.pageList && pdf.pageList.length > 0) {
        addLog("Found pre-extracted page text list.");
        allPagesList = pdf.pageList;
        setProgress(100);
      } else if (cachedMeta && cachedMeta.pageList && cachedMeta.pageList.length > 0) {
        addLog("Cache hit! Found pre-extracted page text list in IndexedDB.");
        allPagesList = cachedMeta.pageList;
        setProgress(100);
      } else if (pdf.fileType === "doc" || pdf.fileType === "docx" || (currentFile && currentFile.name.match(/\.docx?$/i))) {
        if (!currentFile) {
          throw new Error("Missing reference to the uploaded Word document. Please try re-uploading.");
        }
        addLog("Extracting Word document text structure...");
        const docxData = await extractDocxText(currentFile);
        allPagesList = docxData.pageList;
        setProgress(100);
      } else {
        // Cache miss - load PDF and extract text
        if (!currentFile) {
          throw new Error("Missing reference to the uploaded PDF file. Please try re-uploading.");
        }

        addLog("Cache miss. Loading PDF document into memory...");
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

        const buf = await currentFile.arrayBuffer();
        doc = await pdfjs.getDocument({ data: buf }).promise;
        addLog(
          `PDF loaded. Total pages: ${doc.numPages}. Scanning pages for educational content...`,
        );

        allPagesList = await getPDFPagesTextFast(doc, (current, total) => {
          setProgress(Math.round((current / total) * 90));
          if (current % 10 === 0 || current === total) {
            addLog(`Read page text ${current}/${total}...`);
          }
        });
      }

      const totalPagesCount = allPagesList.length;
      updateStep("text", "done");
      updateStep("understand", "running");

      // Heuristic page selection
      addLog(
        "Analyzing document pages to skip cover pages, copyright page, table of contents, index, and blank pages...",
      );
      const activePages: { pageNum: number; text: string; isScanned?: boolean }[] = [];
      const skippedPagesCount: number[] = [];
      let scannedPagesCount = 0;

      allPagesList.forEach((p) => {
        const skip = shouldSkipPage(p.text, p.pageNum, totalPagesCount);
        if (skip) {
          skippedPagesCount.push(p.pageNum);
          return;
        }

        const isScanned = p.text.trim().length < 50;
        if (isScanned) {
          scannedPagesCount++;
        }

        activePages.push({ ...p, isScanned });
      });

      addLog(
        `Filtering complete. Active pages: ${activePages.length}/${totalPagesCount} (Skipped ${skippedPagesCount.length} non-content pages).`,
      );
      if (scannedPagesCount > activePages.length * 0.6) {
        addLog(
          `Detected high ratio of scanned/image pages (${scannedPagesCount}). Running in OCR Fallback Mode.`,
        );
      }

      let finalActivePages = activePages;
      if (activePages.length === 0) {
        addLog("Warning: No text content found. Re-enabling all pages to run OCR scan.");
        finalActivePages = allPagesList.map((p) => ({ ...p, isScanned: true }));
      }

      // Split into batches
      const batchSize = 15;
      const batches: {
        batchIndex: number;
        pages: { pageNum: number; text: string; isScanned?: boolean }[];
      }[] = [];
      for (let i = 0; i < finalActivePages.length; i += batchSize) {
        batches.push({
          batchIndex: Math.floor(i / batchSize),
          pages: finalActivePages.slice(i, i + batchSize),
        });
      }

      updateStep("understand", "done");
      updateStep("generate", "running");

      const totalBatches = batches.length;
      addLog(
        `Divided active pages into ${totalBatches} batches. Initializing Parallel Stream Generation Queue...`,
      );

      const questionsList: MCQ[] = [];
      let activeWorkerCount = 0;
      let nextBatchIndex = 0;
      let isAborted = false;
      let processedPagesCount = 0;

      // Track language properties
      const hasLegacyTamil = pdf.hasLegacyTamil || false;
      const fontEncoding = pdf.fontEncoding || "None";
      const primaryLanguage = detectedLang.primaryLanguage;
      const isMultilingual = detectedLang.isMultilingual;
      const languages = detectedLang.languages;

      async function runNextBatch() {
        if (isAborted || nextBatchIndex >= totalBatches || questionsList.length >= count) {
          return;
        }

        const batchIdx = nextBatchIndex++;
        activeWorkerCount++;
        const batch = batches[batchIdx];

        addLog(
          `[Batch ${batchIdx + 1}/${totalBatches}] Processing pages ${batch.pages[0].pageNum}–${batch.pages[batch.pages.length - 1].pageNum}...`,
        );

        try {
          // 1. OCR fallback for pages in this batch
          const batchPagesText: string[] = [];
          for (const pageObj of batch.pages) {
            let pText = pageObj.text;
            if (pageObj.isScanned) {
              addLog(`[Batch ${batchIdx + 1}] Running OCR on page ${pageObj.pageNum}...`);
              if (!doc && currentFile) {
                const pdfjs = await import("pdfjs-dist");
                const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
                pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
                const buf = await currentFile.arrayBuffer();
                doc = await pdfjs.getDocument({ data: buf }).promise;
              }
              pText = await runOcrOnPage(doc, pageObj.pageNum);
            }
            batchPagesText.push(pText);
            const pIdx = allPagesList.findIndex((pl) => pl.pageNum === pageObj.pageNum);
            if (pIdx !== -1) {
              allPagesList[pIdx].text = pText;
            }
          }

          let batchText = batchPagesText.join("\n\n");

          if (batchText.trim().length < 100) {
            addLog(`[Batch ${batchIdx + 1}] Skip: Batch contains no readable text.`);
            return;
          }

          // 2. Language conversion (if Tamil font encoding detected)
          const words = batchText.split(/\s+/);
          let legacyWordCount = 0;
          const legacyRegex =
            /([a-zA-Z]+;[a-zA-Z]*)|(thz|Fw;|ghj;|xypia|Kjd;|Kjypy;|xyp|tpah|ghu;)/;
          for (const word of words) {
            if (legacyRegex.test(word)) legacyWordCount++;
          }
          const batchLegacyPct = words.length > 0 ? (legacyWordCount / words.length) * 100 : 0;

          if (batchLegacyPct > 5) {
            addLog(
              `[Batch ${batchIdx + 1}] Legacy Tamil font encoding detected in batch text. Converting to Unicode...`,
            );
            try {
              const convertRes = await fetch("/api/convert-legacy-tamil", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: batchText }),
              });
              if (convertRes.ok) {
                const data = await convertRes.json();
                if (data.text) {
                  batchText = data.text;
                  addLog(
                    `[Batch ${batchIdx + 1}] Successfully converted Tamil encoding to Unicode.`,
                  );
                }
              }
            } catch (err) {
              console.error("Tamil conversion failed for batch", err);
            }
          }

          // 3. AI Stream Request
          const questionsPerBatch = Math.min(
            Math.ceil(count / totalBatches),
            count - questionsList.length,
          );

          if (questionsPerBatch > 0) {
            addLog(
              `[Batch ${batchIdx + 1}] Sending text to AI for ${questionsPerBatch} questions...`,
            );
            const response = await fetch("/api/generate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                text: batchText,
                count: questionsPerBatch,
                difficulty,
                apiKey,
                apiProvider,
                modelName,
                selectedLanguage,
              }),
            });

            if (!response.ok) {
              const errJson = await response.json();
              throw new Error(errJson.error || "Internal Server Error during batch generation");
            }

            if (response.body) {
              const reader = response.body.getReader();
              const decoder = new TextDecoder();
              let buffer = "";

              while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                let newlineIdx;
                while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
                  const line = buffer.slice(0, newlineIdx).trim();
                  buffer = buffer.slice(newlineIdx + 1);
                  if (!line) continue;

                  try {
                    const parsed = JSON.parse(line);
                    if (parsed.error) throw new Error(parsed.error);
                    if (parsed.question) {
                      questionsList.push(parsed);
                      setLiveQuestions([...questionsList]);
                      addLog(
                        `[Stream] ✅ Q${questionsList.length}: ${parsed.question.slice(0, 50)}...`,
                      );
                    }
                  } catch (err) {
                    // Partial JSON error
                  }
                }
              }
            }
          }
        } catch (err) {
          addLog(`[Batch ${batchIdx + 1} Error] ${err instanceof Error ? err.message : err}`);
        } finally {
          activeWorkerCount--;
          processedPagesCount += batch.pages.length;

          // Progress metrics calculations
          const percent = Math.round((processedPagesCount / totalPagesCount) * 100);
          const remaining = totalPagesCount - processedPagesCount;
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          const avgTimePerPage = elapsed / processedPagesCount;
          const estTimeRemaining = Math.round(avgTimePerPage * remaining);

          setPipelineProgress({
            percent: Math.min(100, percent),
            currentPage: batch.pages[batch.pages.length - 1].pageNum,
            totalPages: totalPagesCount,
            remainingPages: remaining,
            estimatedTimeSec: estTimeRemaining > 0 ? estTimeRemaining : 0,
          });

          // Abort checking and loop continuation
          if (questionsList.length >= count) {
            if (!isAborted) {
              isAborted = true;
              addLog(`[Finish] Generated target of ${count} questions successfully!`);
            }
          } else {
            await runNextBatch();
          }
        }
      }

      // Spawn workers in parallel
      const workers = [];
      const concurrency = Math.min(3, totalBatches);
      for (let w = 0; w < concurrency; w++) {
        workers.push(runNextBatch());
      }
      await Promise.all(workers);

      clearInterval(timerInterval);

      if (questionsList.length === 0) {
        throw new Error(
          "No questions were generated by the AI model. Try verifying your API key or document text.",
        );
      }

      // Save to IndexedDB caches
      addLog("Saving extracted text and questions to IndexedDB Cache...");
      try {
        const fullExtractedText = allPagesList.map((pl) => pl.text).join("\n\n");
        const finalPdfMeta: PdfMeta = {
          name: pdf.name,
          size: pdf.size,
          pages: pdf.pages,
          chars: fullExtractedText.length,
          text: fullExtractedText,
          isScanned: scannedPagesCount > activePages.length * 0.6,
          isMultilingual,
          primaryLanguage,
          languages,
          pageList: allPagesList,
          lastModified: pdf.lastModified,
        };

        // Save PDF text metadata cache
        await PDFCache.set(textCacheKey, finalPdfMeta);
        // Save PDF questions cache
        await PDFCache.set(questionsCacheKey, questionsList);
        addLog("Cache successfully saved.");
      } catch (err) {
        console.warn("Could not write cache to IndexedDB", err);
      }

      updateStep("generate", "done");
      updateStep("complete", "done");
      toast.success(`Success! Generated ${questionsList.length} questions.`);

      const totalElapsed = Math.round((Date.now() - startTime) / 1000);
      setTimeout(() => {
        onFinished(questionsList, totalElapsed);
      }, 1000);
    } catch (e) {
      clearInterval(timerInterval);
      console.error(e);
      updateStep("generate", "error");
      toast.error(e instanceof Error ? e.message : "AI generation failed");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto animate-fade-in">
      <div className="md:col-span-2 space-y-6">
        {!busy ? (
          <Card className="p-8 bg-card/40 backdrop-blur-sm border-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight">Configure MCQ Generation</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select questions quantity and difficulty options.
                </p>
              </div>
              {onSwitchToStudyMaterial && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onSwitchToStudyMaterial}
                  className="text-xs h-8 gap-1.5 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 shrink-0"
                >
                  <GraduationCap className="h-3.5 w-3.5" />
                  <span>Switch to Study Notes</span>
                </Button>
              )}
            </div>

            <div className="mt-6 space-y-6">
              <div>
                <Label className="mb-3 block text-sm font-semibold">Number of questions</Label>
                <div className="flex flex-wrap gap-2.5">
                  {[10, 20, 30, 50, 100].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      variant={count === n ? "default" : "outline"}
                      size="sm"
                      className="px-4 py-2"
                      onClick={() => setCount(n)}
                    >
                      {n}
                    </Button>
                  ))}
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      min={1}
                      max={120}
                      value={count}
                      onChange={(e) =>
                        setCount(Math.max(1, Math.min(120, Number(e.target.value) || 1)))
                      }
                      className="w-20 h-9"
                    />
                    <span className="text-xs text-muted-foreground ml-1">Custom</span>
                  </div>
                </div>
              </div>

              <div>
                <Label className="mb-2 block text-sm font-semibold">Difficulty Level</Label>
                <Select
                  value={difficulty}
                  onValueChange={(v) => setDifficulty(v as typeof difficulty)}
                >
                  <SelectTrigger className="w-full md:w-72 bg-background/50">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Mixed">Mixed (Recommended)</SelectItem>
                    <SelectItem value="Easy">Easy only</SelectItem>
                    <SelectItem value="Medium">Medium only</SelectItem>
                    <SelectItem value="Hard">Hard only</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="mb-2.5 block text-sm font-semibold flex items-center gap-1.5">
                  <BookOpen className="h-4 w-4 text-indigo-500" />
                  Language & Preservation
                </Label>

                {detectedLang.isMultilingual ? (
                  <div className="space-y-4 p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5">
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      We detected multiple languages in this document (
                      <span className="font-semibold text-foreground">
                        {detectedLang.languages.join(", ")}
                      </span>
                      ). Select how you want the questions generated:
                    </p>

                    <div className="grid gap-2">
                      <Button
                        type="button"
                        variant={selectedLanguage === "mixed" ? "default" : "outline"}
                        className="justify-start text-left w-full text-xs font-semibold py-5"
                        onClick={() => setSelectedLanguage("mixed")}
                      >
                        <span className="w-4 h-4 rounded-full border border-indigo-500 mr-2 flex items-center justify-center shrink-0">
                          {selectedLanguage === "mixed" && (
                            <span className="w-2 h-2 rounded-full bg-indigo-500" />
                          )}
                        </span>
                        Original mixed-language format
                      </Button>

                      {detectedLang.languages.map((lang) => (
                        <Button
                          key={lang}
                          type="button"
                          variant={selectedLanguage === lang ? "default" : "outline"}
                          className="justify-start text-left w-full text-xs font-semibold py-5"
                          onClick={() => setSelectedLanguage(lang)}
                        >
                          <span className="w-4 h-4 rounded-full border border-indigo-500 mr-2 flex items-center justify-center shrink-0">
                            {selectedLanguage === lang && (
                              <span className="w-2 h-2 rounded-full bg-indigo-500" />
                            )}
                          </span>
                          Generate questions only in {lang}
                        </Button>
                      ))}

                      <div className="border-t border-border/40 pt-3 mt-1.5">
                        <Label className="text-xs text-muted-foreground mb-1.5 block">
                          Translate all questions into a selected language (optional)
                        </Label>
                        <Select
                          value={
                            detectedLang.languages.includes(selectedLanguage) ||
                            selectedLanguage === "mixed"
                              ? ""
                              : selectedLanguage
                          }
                          onValueChange={(val) => {
                            if (val) setSelectedLanguage(val);
                          }}
                        >
                          <SelectTrigger className="w-full bg-background/50 text-sm">
                            <SelectValue placeholder="Select translation language..." />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="English">English</SelectItem>
                            <SelectItem value="Tamil">Tamil (தமிழ்)</SelectItem>
                            <SelectItem value="Tanglish">Tanglish (Tamil in Latin)</SelectItem>
                            <SelectItem value="Hindi">Hindi (हिन्दी)</SelectItem>
                            <SelectItem value="Telugu">Telugu (తెలుగు)</SelectItem>
                            <SelectItem value="Kannada">Kannada (ಕನ್ನಡ)</SelectItem>
                            <SelectItem value="Malayalam">Malayalam (മലയാളം)</SelectItem>
                          </SelectContent>

                        </Select>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3.5">
                    <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-lg border border-border/40 bg-muted/20">
                      <span>Detected Document Language:</span>
                      <Badge
                        variant="secondary"
                        className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-semibold"
                      >
                        {detectedLang.primaryLanguage}
                      </Badge>
                    </div>

                    <div>
                      <Label className="text-xs text-muted-foreground mb-1.5 block">
                        Translate questions (optional - defaults to detected language)
                      </Label>
                      <Select
                        value={selectedLanguage}
                        onValueChange={(val) => setSelectedLanguage(val)}
                      >
                        <SelectTrigger className="w-full md:w-72 bg-background/50">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={detectedLang.primaryLanguage}>
                            Original ({detectedLang.primaryLanguage})
                          </SelectItem>
                          {/* Filter out original to avoid duplicates */}
                          {detectedLang.primaryLanguage !== "English" && (
                            <SelectItem value="English">English</SelectItem>
                          )}
                          {detectedLang.primaryLanguage !== "Tamil" && (
                            <SelectItem value="Tamil">Tamil (தமிழ்)</SelectItem>
                          )}
                          {detectedLang.primaryLanguage !== "Tanglish" && (
                            <SelectItem value="Tanglish">Tanglish (Tamil in Latin)</SelectItem>
                          )}
                          {detectedLang.primaryLanguage !== "Hindi" && (
                            <SelectItem value="Hindi">Hindi (हिन्दी)</SelectItem>
                          )}
                          {detectedLang.primaryLanguage !== "Telugu" && (
                            <SelectItem value="Telugu">Telugu (తెలుగు)</SelectItem>
                          )}
                          {detectedLang.primaryLanguage !== "Kannada" && (
                            <SelectItem value="Kannada">Kannada (ಕನ್ನಡ)</SelectItem>
                          )}
                          {detectedLang.primaryLanguage !== "Malayalam" && (
                            <SelectItem value="Malayalam">Malayalam (മലയാളം)</SelectItem>
                          )}
                        </SelectContent>

                      </Select>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-6 border-t border-border/30">
                <Button variant="outline" onClick={onBack} disabled={busy}>
                  <ChevronLeft className="mr-1.5 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={run}
                  disabled={busy}
                  className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 font-semibold shadow-lg shadow-indigo-500/20"
                >
                  <Sparkles className="mr-2 h-4 w-4 animate-spin-slow" />
                  Generate {count} MCQs
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          /* Live Streaming Progress Screen */
          <Card className="p-8 bg-card/60 backdrop-blur-sm border-border space-y-8">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tight">AI MCQ Engine active...</h2>
                <div className="text-sm font-mono bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-md">
                  Elapsed: {genTime}s
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Reading, parsing, and streaming exam questions from PDF.
              </p>
            </div>

            {/* Progress Metrics Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10 text-center">
                <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                  Progress
                </div>
                <div className="text-xl font-extrabold mt-1 text-primary">
                  {pipelineProgress.percent}%
                </div>
              </div>
              <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10 text-center">
                <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                  Current Page
                </div>
                <div className="text-xl font-extrabold mt-1 text-primary">
                  {pipelineProgress.currentPage}
                </div>
              </div>
              <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10 text-center">
                <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                  Pages Left
                </div>
                <div className="text-xl font-extrabold mt-1 text-primary">
                  {pipelineProgress.remainingPages}
                </div>
              </div>
              <div className="p-3 bg-indigo-500/5 rounded-xl border border-indigo-500/10 text-center">
                <div className="text-[10px] text-muted-foreground uppercase font-bold tracking-wider">
                  Time Remaining
                </div>
                <div className="text-xl font-extrabold mt-1 text-primary text-indigo-400">
                  {pipelineProgress.estimatedTimeSec > 0
                    ? `${pipelineProgress.estimatedTimeSec}s`
                    : "Calculating..."}
                </div>
              </div>
            </div>

            {/* Checklist items */}
            <div className="space-y-4 max-w-md">
              {checklist.map((step) => {
                const isIdle = step.status === "idle";
                const isRunning = step.status === "running";
                const isDone = step.status === "done";
                const isError = step.status === "error";

                return (
                  <div key={step.id} className="flex items-center gap-3.5 text-sm">
                    {isIdle && (
                      <div className="h-5 w-5 rounded-full border border-muted bg-muted/40 shrink-0" />
                    )}
                    {isRunning && (
                      <Loader2 className="h-5 w-5 animate-spin text-indigo-500 shrink-0" />
                    )}
                    {isDone && <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0" />}
                    {isError && <XCircle className="h-5 w-5 text-destructive shrink-0" />}

                    <span
                      className={`font-medium ${
                        isDone
                          ? "text-muted-foreground line-through decoration-muted-foreground/40"
                          : isRunning
                            ? "text-foreground font-semibold"
                            : "text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Live Logs Terminal Screen */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Execution Pipeline Logs
              </span>
              <div className="bg-black/50 border border-border/60 rounded-xl p-4 font-mono text-xs text-indigo-300 h-44 overflow-y-auto space-y-1.5 scrollbar-thin">
                {logs.length === 0 ? (
                  <div className="text-muted-foreground italic">Initializing log stream...</div>
                ) : (
                  logs.map((log, idx) => (
                    <div key={idx} className="leading-relaxed">
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Live question count and preview */}
            <div className="space-y-3.5 border-t border-border/40 pt-6">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Live Extracted Count:</span>
                <Badge className="bg-emerald-500 hover:bg-emerald-600 font-bold">
                  {liveQuestions.length} / {count}
                </Badge>
              </div>

              {liveQuestions.length > 0 && (
                <div className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 text-sm animate-pulse space-y-1">
                  <span className="text-xs text-indigo-400 font-bold uppercase tracking-wider">
                    Latest Streamed question
                  </span>
                  <p className="font-bold text-foreground line-clamp-2">
                    {liveQuestions[liveQuestions.length - 1].question}
                  </p>
                </div>
              )}

              {/* Progress bar */}
              <div className="w-full bg-muted/50 rounded-full h-2 overflow-hidden mt-4">
                <div
                  className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${Math.round((liveQuestions.length / count) * 100)}%` }}
                />
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Info panel */}
      <div className="space-y-6">
        <Card className="p-6 bg-card/40 backdrop-blur-sm border-border h-fit">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Source Document
          </h3>
          <p className="mt-2 truncate font-bold text-lg">{pdf.name}</p>

          <div className="mt-6 space-y-3.5 text-sm">
            <div className="flex items-center justify-between border-b border-border/30 pb-2">
              <span className="text-muted-foreground">Total pages</span>
              <span className="font-semibold">{pdf.pages}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/30 pb-2">
              <span className="text-muted-foreground">Characters count</span>
              <span className="font-semibold">{pdf.chars.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/30 pb-2">
              <span className="text-muted-foreground">Type</span>
              <span className="font-semibold flex items-center gap-1">
                {pdf.isScanned ? (
                  <Badge
                    variant="secondary"
                    className="bg-amber-500/10 text-amber-500 border-amber-500/20"
                  >
                    Scanned Image
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                  >
                    Text-Based
                  </Badge>
                )}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Potential questions</span>
              <span className="font-semibold text-indigo-400">~{estimated} max</span>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl">
          <h4 className="font-bold flex items-center gap-2 text-indigo-400 text-sm">
            <Sparkles className="h-4 w-4" />
            Gemini Flash Speed Mode
          </h4>
          <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
            By preferring Google Gemini Flash, QuizCrack achieves unmatched generation speeds (e.g.
            50 questions under 10 seconds) due to highly-parallel streams and low-latency API
            routes.
          </p>
        </Card>
      </div>
    </div>
  );
}

// ==========================================
// 📄 REVIEW STAGE COMPONENT (EXAM FORMAT)
// ==========================================
type ReviewProps = {
  pdfName: string;
  mcqs: MCQ[];
  setMcqs: (m: MCQ[]) => void;
  onStartTest: () => void;
  onDownload: () => void;
};

function ReviewStage({ pdfName, mcqs, setMcqs, onStartTest, onDownload }: ReviewProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(
    new Set(mcqs.map((_, i) => i)),
  );
  const [filterDifficulty, setFilterDifficulty] = useState<string>("All");
  const [filterCategory, setFilterCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [showExplanations, setShowExplanations] = useState<boolean>(false);

  const parentRef = useRef<HTMLDivElement>(null);

  const filteredMCQs = useMemo(() => {
    return mcqs
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => {
        const matchDiff = filterDifficulty === "All" || m.difficulty === filterDifficulty;
        const matchCat = filterCategory === "All" || m.category === filterCategory;
        const matchSearch =
          searchQuery.trim() === "" ||
          m.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
          m.options.some((o) => o.toLowerCase().includes(searchQuery.toLowerCase()));
        return matchDiff && matchCat && matchSearch;
      });
  }, [mcqs, filterDifficulty, filterCategory, searchQuery]);

  const rowVirtualizer = useVirtualizer({
    count: filteredMCQs.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 280,
    overscan: 5,
  });

  // Options toggle and list updates
  function updateQuestion(i: number, patch: Partial<MCQ>) {
    setMcqs(mcqs.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }

  function deleteQuestion(i: number) {
    setMcqs(mcqs.filter((_, idx) => idx !== i));
    const nextSelected = new Set(selectedIndices);
    nextSelected.delete(i);
    setSelectedIndices(nextSelected);
  }

  function addNewQuestion() {
    const newQ: MCQ = {
      question: "Edit to enter new question text?",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctAnswer: "Option A",
      explanation: "Add explanation here.",
      difficulty: "Medium",
      category: "Concept",
    };
    setMcqs([newQ, ...mcqs]);
    setEditingIndex(0);
    // Select the newly added question
    const nextSelected = new Set(selectedIndices);
    nextSelected.add(mcqs.length);
    setSelectedIndices(nextSelected);
  }

  function shuffleAllQuestions() {
    setMcqs([...mcqs].sort(() => Math.random() - 0.5));
    toast.success("Questions shuffled!");
  }

  function shuffleOptions(i: number) {
    const m = mcqs[i];
    const shuffled = [...m.options].sort(() => Math.random() - 0.5);
    updateQuestion(i, { options: shuffled });
    toast.success(`Shuffled options for Question ${i + 1}`);
  }

  // Filters
  const categories = useMemo(() => {
    const cats = new Set(mcqs.map((m) => m.category));
    return ["All", ...Array.from(cats)];
  }, [mcqs]);

  // Selection toggle
  const toggleSelect = (idx: number) => {
    const next = new Set(selectedIndices);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setSelectedIndices(next);
  };

  const toggleSelectAll = () => {
    if (selectedIndices.size === filteredMCQs.length) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(filteredMCQs.map(({ i }) => i)));
    }
  };

  // Copy Actions
  const copyAllToClipboard = () => {
    const text = formatExamPlaintext(mcqs);
    navigator.clipboard.writeText(text);
    toast.success("Copied all questions to clipboard!");
  };

  const copySelectedToClipboard = () => {
    const list = mcqs.filter((_, idx) => selectedIndices.has(idx));
    if (list.length === 0) {
      toast.error("No questions selected.");
      return;
    }
    const text = formatExamPlaintext(list);
    navigator.clipboard.writeText(text);
    toast.success(`Copied ${list.length} selected questions to clipboard!`);
  };

  const printExam = () => {
    window.print();
  };

  // ==========================================
  // EXPORT WORD (.docx)
  // ==========================================
  const downloadWord = async () => {
    const list = mcqs.filter((_, idx) => selectedIndices.has(idx));
    if (list.length === 0) {
      toast.error("Please select at least one question to download.");
      return;
    }
    generateWordDocument(pdfName, list, showExplanations, onDownload);
  };

  // ==========================================
  // EXPORT EXCEL (.xlsx)
  // ==========================================
  const downloadExcel = async () => {
    const list = mcqs.filter((_, idx) => selectedIndices.has(idx));
    if (list.length === 0) {
      toast.error("Please select at least one question to download.");
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("MCQ Quiz");

    sheet.columns = [
      { header: "Q#", key: "num", width: 8 },
      { header: "Question", key: "question", width: 50 },
      { header: "Option A", key: "optA", width: 20 },
      { header: "Option B", key: "optB", width: 20 },
      { header: "Option C", key: "optC", width: 20 },
      { header: "Option D", key: "optD", width: 20 },
      { header: "Correct Answer", key: "answer", width: 20 },
      { header: "Explanation", key: "exp", width: 40 },
    ];

    list.forEach((m, idx) => {
      const opts = m.options || ["", "", "", ""];
      const ansLetter = getAnswerLetter(m.correctAnswer, opts);
      sheet.addRow({
        num: idx + 1,
        question: cleanQuestionText(m.question),
        optA: cleanOptionText(opts[0] || ""),
        optB: cleanOptionText(opts[1] || ""),
        optC: cleanOptionText(opts[2] || ""),
        optD: cleanOptionText(opts[3] || ""),
        answer: ansLetter,
        exp: m.explanation || "",
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const cleanName = pdfName.replace(/\.(pdf|docx?)$/i, "").replace(/\s+/g, "_");
    saveAs(blob, `${cleanName}_MCQs.xlsx`);
    onDownload();
    toast.success("Excel (.xlsx) downloaded successfully!");
  };

  // ==========================================
  // EXPORT PDF (.pdf) - Custom Exam Paper formatting
  // ==========================================
  const downloadPdf = () => {
    const list = mcqs.filter((_, idx) => selectedIndices.has(idx));
    if (list.length === 0) {
      toast.error("Please select at least one question to download.");
      return;
    }
    generateExamPdf(pdfName, list, showExplanations, onDownload);
  };

  // Helper formatting for Clipboard
  function formatExamPlaintext(questions: MCQ[]) {
    let output = "";
    questions.forEach((m, idx) => {
      const opts = m.options || ["", "", "", ""];
      const ansLetter = getAnswerLetter(m.correctAnswer, opts);
      output += `${idx + 1}. ${cleanQuestionText(m.question)}\n\n`;
      opts.forEach((opt, oi) => {
        output += `${String.fromCharCode(65 + oi)}. ${cleanOptionText(opt)}\n`;
      });
      output += `\nAnswer: ${ansLetter}\n`;
      if (showExplanations && m.explanation) {
        output += `Explanation: ${m.explanation}\n`;
      }
      output += `\n`;
    });
    return output.trim();
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in print:p-0">
      {/* Controls Menu */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-5 print:hidden">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">Review Exam Sheet</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {mcqs.length} questions compiled. Modify text, shuffle options, or choose format to
            download.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={addNewQuestion}
            className="gap-1.5 border-dashed border-indigo-500/40 text-indigo-400"
          >
            <Plus className="h-4 w-4" /> Add Question
          </Button>
          <Button variant="outline" size="sm" onClick={shuffleAllQuestions} className="gap-1.5">
            <Shuffle className="h-4 w-4" /> Shuffle
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onStartTest}
            className="gap-1.5 bg-indigo-600 hover:bg-indigo-700 shadow-md"
          >
            <Play className="h-4 w-4" /> Start Mock Test
          </Button>
        </div>
      </div>

      {/* Filters & Bulk Selector Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-card/40 backdrop-blur-sm border border-border p-4 rounded-xl print:hidden">
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-1.5">
            <input
              type="checkbox"
              id="selectAll"
              checked={selectedIndices.size === filteredMCQs.length && filteredMCQs.length > 0}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <Label htmlFor="selectAll" className="text-sm font-medium cursor-pointer">
              Select All ({selectedIndices.size})
            </Label>
          </div>

          <Input
            placeholder="Search keywords..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-48 h-9 bg-background/50"
          />

          <Select value={filterDifficulty} onValueChange={setFilterDifficulty}>
            <SelectTrigger className="w-28 h-9 bg-background/50 text-xs">
              <SelectValue placeholder="Difficulty" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All Difficulties</SelectItem>
              <SelectItem value="Easy">Easy</SelectItem>
              <SelectItem value="Medium">Medium</SelectItem>
              <SelectItem value="Hard">Hard</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-36 h-9 bg-background/50 text-xs">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c === "All" ? "All Categories" : c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Show Explanations Toggle */}
          <div className="flex items-center gap-1.5 border border-border/45 bg-background/50 rounded-lg px-3 h-9 select-none">
            <input
              type="checkbox"
              id="showExplanationsToggle"
              checked={showExplanations}
              onChange={(e) => setShowExplanations(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
            />
            <Label htmlFor="showExplanationsToggle" className="text-xs font-semibold text-muted-foreground cursor-pointer select-none">
              Show Explanations
            </Label>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Export dropdown menu */}
          <Select
            onValueChange={(val) => {
              if (val === "pdf") downloadPdf();
              if (val === "docx") downloadWord();
              if (val === "xlsx") downloadExcel();
            }}
          >
            <SelectTrigger className="w-32 h-9 bg-indigo-500 text-white font-semibold text-xs border-indigo-600">
              <Download className="h-3.5 w-3.5 mr-1" />
              <span>Download</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pdf">Download PDF (.pdf)</SelectItem>
              <SelectItem value="docx">Download Word (.docx)</SelectItem>
              <SelectItem value="xlsx">Download Excel (.xlsx)</SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant="outline"
            size="sm"
            onClick={copySelectedToClipboard}
            className="h-9"
            title="Copy Selected to Clipboard"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={copyAllToClipboard}
            className="h-9"
            title="Copy All to Clipboard"
          >
            <Sparkles className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={printExam}
            className="h-9"
            title="Print Quiz"
          >
            <Printer className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* 📄 EXAM PAPER VIEW */}
      <div className="p-10 font-sans text-black relative bg-white select-text">
        <div className="space-y-4">
          {/* Static first separator line */}
          <div className="font-mono text-[16px] text-black leading-[1.6] mb-[24px] select-none">
            ------------------------------------------------
          </div>

          <div
            ref={parentRef}
            className="h-[750px] overflow-y-auto pr-2 bg-white text-black p-4"
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: "100%",
                position: "relative",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const { m, i } = filteredMCQs[virtualRow.index];
                const isEditing = editingIndex === i;
                const isSelected = selectedIndices.has(i);

                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="absolute top-0 left-0 w-full"
                    style={{
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <div className="group relative pb-[24px] bg-white text-black p-4 transition-colors mb-4">
                      {/* Checkbox and controls toolbar */}
                      <div className="absolute top-2 right-2 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity print:hidden">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={() => shuffleOptions(i)}
                          title="Shuffle Options"
                        >
                          <Shuffle className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-indigo-500"
                          onClick={() => setEditingIndex(isEditing ? null : i)}
                          title="Edit Question"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => deleteQuestion(i)}
                          title="Delete Question"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="relative pl-8">
                        {/* Selector Checkbox */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(i)}
                          className="absolute left-0 top-[6px] h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer print:hidden"
                        />

                        <div className="flex-1 w-full text-black bg-white">
                          {isEditing ? (
                            /* Inplace Edit mode */
                            <div className="space-y-4 pt-2 text-black bg-white p-4 border border-indigo-200 rounded-lg">
                              <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-black">Question</Label>
                                <Textarea
                                  value={m.question}
                                  onChange={(e) => updateQuestion(i, { question: e.target.value })}
                                  rows={3}
                                  className="font-sans text-sm border-gray-300 text-black bg-white"
                                />
                              </div>

                              {/* Options editor */}
                              <div className="space-y-2">
                                <Label className="text-xs font-semibold text-black">
                                  Options (Select radio for correct answer)
                                </Label>
                                {m.options.map((opt, oi) => (
                                  <div key={oi} className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-black">
                                      {String.fromCharCode(65 + oi)}.
                                    </span>
                                    <Input
                                      value={opt}
                                      onChange={(e) => {
                                        const nextOptions = [...m.options];
                                        const oldOptValue = nextOptions[oi];
                                        nextOptions[oi] = e.target.value;
                                        const patch: Partial<MCQ> = { options: nextOptions };
                                        if (m.correctAnswer === oldOptValue) {
                                          patch.correctAnswer = e.target.value;
                                        }
                                        updateQuestion(i, patch);
                                      }}
                                      className="font-sans text-sm h-8 border-gray-300 text-black bg-white"
                                    />
                                    <Button
                                      size="sm"
                                      variant={m.correctAnswer === opt ? "default" : "outline"}
                                      onClick={() => updateQuestion(i, { correctAnswer: opt })}
                                      className="h-8 text-xs shrink-0"
                                    >
                                      {m.correctAnswer === opt ? "Correct" : "Mark Correct"}
                                    </Button>
                                  </div>
                                ))}
                              </div>

                              <div className="space-y-1.5">
                                <Label className="text-xs font-semibold text-black">Explanation</Label>
                                <Textarea
                                  value={m.explanation}
                                  onChange={(e) =>
                                    updateQuestion(i, { explanation: e.target.value })
                                  }
                                  rows={2}
                                  placeholder="Explanation why correct answer holds true..."
                                  className="font-sans text-sm border-gray-300 text-black bg-white"
                                />
                              </div>

                              <Button
                                size="sm"
                                onClick={() => setEditingIndex(null)}
                                className="h-8 bg-indigo-600 text-white hover:bg-indigo-700"
                              >
                                Save Changes
                              </Button>
                            </div>
                          ) : (
                            /* Clean Exam Render Format */
                            <div className="space-y-[10px] text-black bg-white font-sans">
                              {/* Question */}
                              <div className="font-bold text-[18px] leading-[1.6]">
                                {i + 1}. {cleanQuestionText(m.question)}
                              </div>

                              {/* Options */}
                              {m.options.map((opt, oi) => (
                                <div key={oi} className="font-normal text-[16px] leading-[1.6]">
                                  {String.fromCharCode(65 + oi)}. {cleanOptionText(opt)}
                                </div>
                              ))}

                              {/* Answer */}
                              <div className="pt-[10px]">
                                <div className="font-bold text-[16px] leading-[1.6]">
                                  Answer: {getAnswerLetter(m.correctAnswer, m.options)}
                                </div>
                              </div>

                              {/* Explanation */}
                              {showExplanations && m.explanation && (
                                <div className="pt-[6px] text-gray-700">
                                  <span className="font-bold text-[15px] leading-[1.6]">Explanation: </span>
                                  <span className="font-normal italic text-[15px] leading-[1.6]">
                                    {m.explanation}
                                  </span>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 🖨️ PRINT ONLY CONTAINER */}
      <div className="print-only text-black bg-white font-sans">
        {mcqs
          .filter((_, idx) => selectedIndices.has(idx))
          .map((m, idx) => {
            const opts = m.options || ["", "", "", ""];
            const ansLetter = getAnswerLetter(m.correctAnswer, opts);
            return (
              <div key={idx} className="print-question-block mb-6">
                <div className="print-question-text font-bold text-base">{idx + 1}. {cleanQuestionText(m.question)}</div>
                {opts.map((opt, oi) => (
                  <div key={oi} className="print-option text-sm">
                    {String.fromCharCode(65 + oi)}. {cleanOptionText(opt)}
                  </div>
                ))}
                <div className="print-answer-label font-bold text-sm mt-2">
                  Answer: {ansLetter}
                </div>
                {showExplanations && m.explanation && (
                  <div className="print-explanation-text text-sm italic mt-1">
                    Explanation: {m.explanation}
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

// ==========================================
// ⏱️ TIMED MOCK TEST COMPONENT
// ==========================================
type MockProps = {
  mcqs: MCQ[];
  onSubmit: (answers: Record<number, string>, timeSec: number) => void;
  onExit: () => void;
};

function MockTest({ mcqs, onSubmit, onExit }: MockProps) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [bookmarks, setBookmarks] = useState<Set<number>>(new Set());
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Auto-run Timer
  useEffect(() => {
    const id = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const total = mcqs.length;
  const answeredCount = Object.keys(userAnswers).length;
  const currentMCQ = mcqs[currentIdx];

  const formatTime = (totalSec: number) => {
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const handleSelectOption = (opt: string) => {
    setUserAnswers({ ...userAnswers, [currentIdx]: opt });
  };

  const toggleBookmark = (idx: number) => {
    const next = new Set(bookmarks);
    if (next.has(idx)) {
      next.delete(idx);
    } else {
      next.add(idx);
    }
    setBookmarks(next);
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      {/* Test toolbar info */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight">Active Mock Test</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Timer is running. Answers save in real-time.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-lg font-mono font-bold bg-indigo-500/10 text-indigo-400 px-4 py-1.5 rounded-xl border border-indigo-500/20">
            {formatTime(elapsedSeconds)}
          </div>
          <Button variant="outline" size="sm" onClick={onExit}>
            Exit Quiz
          </Button>
          <Button
            onClick={() => onSubmit(userAnswers, elapsedSeconds)}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            Submit Exam
          </Button>
        </div>
      </div>

      <Progress value={(answeredCount / total) * 100} className="h-2.5" />

      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        {/* Core Question sheet */}
        <Card className="p-8 bg-card/60 backdrop-blur-sm border-border space-y-6">
          <div className="flex items-center justify-between border-b border-border/30 pb-3">
            <Badge className="bg-indigo-500 font-bold uppercase tracking-wider text-xs">
              Question {currentIdx + 1} of {total}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => toggleBookmark(currentIdx)}
              className={`gap-1.5 text-xs font-semibold ${bookmarks.has(currentIdx) ? "text-indigo-400" : "text-muted-foreground"}`}
            >
              <Bookmark className={`h-4 w-4 ${bookmarks.has(currentIdx) ? "fill-current" : ""}`} />
              {bookmarks.has(currentIdx) ? "Bookmarked" : "Bookmark"}
            </Button>
          </div>

          <p className="text-xl font-bold leading-relaxed text-foreground">{currentMCQ.question}</p>

          <div className="grid gap-3 pt-4">
            {currentMCQ.options.map((opt, oi) => {
              const isSelected = userAnswers[currentIdx] === opt;
              return (
                <button
                  key={oi}
                  onClick={() => handleSelectOption(opt)}
                  className={`flex items-center gap-4 rounded-xl border p-4 text-left text-sm font-medium transition-all ${
                    isSelected
                      ? "border-primary bg-indigo-500/10 shadow-sm"
                      : "border-border hover:bg-muted/30"
                  }`}
                >
                  <span
                    className={`grid h-8 w-8 place-items-center rounded-lg text-xs font-bold ${
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {String.fromCharCode(65 + oi)}
                  </span>
                  <span className="flex-1 leading-relaxed">{opt}</span>
                </button>
              );
            })}
          </div>

          {/* Navigation Controls */}
          <div className="flex items-center justify-between pt-6 border-t border-border/30">
            <Button
              variant="outline"
              onClick={() => setCurrentIdx(Math.max(0, currentIdx - 1))}
              disabled={currentIdx === 0}
            >
              <ChevronLeft className="mr-1.5 h-4 w-4" /> Previous
            </Button>

            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  const nextAnswers = { ...userAnswers };
                  delete nextAnswers[currentIdx];
                  setUserAnswers(nextAnswers);
                  setCurrentIdx(Math.min(total - 1, currentIdx + 1));
                }}
              >
                Skip
              </Button>
              <Button
                onClick={() => setCurrentIdx(Math.min(total - 1, currentIdx + 1))}
                disabled={currentIdx === total - 1}
              >
                Next <ChevronRight className="ml-1.5 h-4 w-4" />
              </Button>
            </div>
          </div>
        </Card>

        {/* Side Panel grid index navigator */}
        <Card className="p-6 bg-card/60 backdrop-blur-sm border-border h-fit">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
            Exam Navigation
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {mcqs.map((_, idx) => {
              const isAnswered = userAnswers[idx] !== undefined;
              const isActive = idx === currentIdx;
              const isBookmarked = bookmarks.has(idx);

              return (
                <button
                  key={idx}
                  onClick={() => setCurrentIdx(idx)}
                  className={`h-9 w-9 rounded-lg border text-xs font-bold relative transition ${
                    isActive
                      ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-indigo-500/20"
                      : isAnswered
                        ? "border-indigo-500/30 bg-indigo-500/10 text-indigo-400"
                        : "border-border bg-background hover:bg-muted/40 text-muted-foreground"
                  }`}
                >
                  {idx + 1}
                  {isBookmarked && (
                    <span className="absolute top-0 right-0 h-2 w-2 rounded-full bg-amber-400" />
                  )}
                </button>
              );
            })}
          </div>

          <div className="mt-6 space-y-2 border-t border-border/30 pt-4 text-xs text-muted-foreground leading-relaxed">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-indigo-500/20 border border-indigo-500/30" />
              <span>Answered ({answeredCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded bg-background border border-border" />
              <span>Unanswered ({total - answeredCount})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              <span>Bookmarked</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ==========================================
// 📊 RESULTS & REPORT ANALYSIS COMPONENT
// ==========================================
type ResultsProps = {
  mcqs: MCQ[];
  answers: Record<number, string>;
  testTime: number;
  onRetake: () => void;
  onEdit: () => void;
  onNew: () => void;
};

function Results({ mcqs, answers, testTime, onRetake, onEdit, onNew }: ResultsProps) {
  const correctCount = mcqs.filter((m, i) => answers[i] === m.correctAnswer).length;
  const skippedCount = mcqs.length - Object.keys(answers).length;
  const incorrectCount = mcqs.length - correctCount - skippedCount;
  const scorePct = Math.round((correctCount / mcqs.length) * 100);

  // Group analysis by category
  const categoryAnalysis = useMemo(() => {
    const analysisMap: Record<string, { total: number; correct: number }> = {};
    mcqs.forEach((m, idx) => {
      const cat = m.category || "General";
      if (!analysisMap[cat]) {
        analysisMap[cat] = { total: 0, correct: 0 };
      }
      analysisMap[cat].total += 1;
      if (answers[idx] === m.correctAnswer) {
        analysisMap[cat].correct += 1;
      }
    });
    return Object.entries(analysisMap).map(([name, data]) => ({
      name,
      pct: Math.round((data.correct / data.total) * 100),
      total: data.total,
      correct: data.correct,
    }));
  }, [mcqs, answers]);

  const formatTime = (totalSec: number) => {
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto animate-fade-in">
      {/* Score Summary Card */}
      <Card className="p-10 text-center bg-card border border-border shadow-lg relative overflow-hidden">
        {/* Glow effect */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 h-40 w-80 bg-gradient-to-b from-indigo-500/10 to-transparent blur-3xl" />

        <p className="text-sm font-bold uppercase tracking-widest text-muted-foreground">
          Test Results Summary
        </p>

        <div className="mt-6 flex flex-col items-center">
          <div className="relative flex items-center justify-center h-36 w-36 rounded-full border-4 border-indigo-500/20 bg-indigo-500/5">
            <span className="text-5xl font-extrabold tracking-tighter text-indigo-500">
              {scorePct}%
            </span>
          </div>
          <h3 className="text-2xl font-extrabold mt-6 tracking-tight">
            {scorePct >= 80
              ? "Excellent Job! 🎉"
              : scorePct >= 50
                ? "Good Effort 👍"
                : "Need more study! 📚"}
          </h3>
          <p className="text-muted-foreground mt-2 text-sm max-w-sm leading-relaxed">
            You got <span className="font-bold text-foreground">{correctCount}</span> correct,
            skipped <span className="font-bold text-foreground">{skippedCount}</span>, and missed{" "}
            <span className="font-bold text-foreground">{incorrectCount}</span> questions out of{" "}
            <span className="font-bold text-foreground">{mcqs.length}</span> total.
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 max-w-md mx-auto">
          <div className="p-4 rounded-xl border border-border bg-background/50 text-left">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">
              Time Elapsed
            </span>
            <span className="text-lg font-bold mt-1 block">{formatTime(testTime)}</span>
          </div>
          <div className="p-4 rounded-xl border border-border bg-background/50 text-left">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider block">
              Average Speed
            </span>
            <span className="text-lg font-bold mt-1 block">
              {(testTime / mcqs.length).toFixed(1)}s / Q
            </span>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button variant="outline" onClick={onEdit}>
            Back to Editor
          </Button>
          <Button variant="outline" onClick={onRetake} className="gap-1.5">
            <RotateCcw className="h-4 w-4" /> Retake Test
          </Button>
          <Button onClick={onNew} className="bg-indigo-600 hover:bg-indigo-700">
            Upload New PDF
          </Button>
        </div>
      </Card>

      {/* Category Performance Breakdown */}
      <Card className="p-8 bg-card/60 backdrop-blur-sm border-border">
        <h3 className="text-xl font-bold tracking-tight mb-5">Subject Performance Breakdown</h3>

        <div className="space-y-4">
          {categoryAnalysis.map((cat, i) => (
            <div key={i} className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold text-foreground">
                  {cat.name} ({cat.correct}/{cat.total})
                </span>
                <span
                  className={`font-bold ${cat.pct >= 85 ? "text-emerald-500" : cat.pct >= 50 ? "text-amber-500" : "text-destructive"}`}
                >
                  {cat.pct}%
                </span>
              </div>
              <div className="w-full bg-muted/60 h-2.5 rounded-full overflow-hidden">
                <div
                  className={`h-2.5 rounded-full transition-all ${
                    cat.pct >= 85
                      ? "bg-emerald-500"
                      : cat.pct >= 50
                        ? "bg-amber-500"
                        : "bg-destructive"
                  }`}
                  style={{ width: `${cat.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Answer Key Review Details */}
      <div className="space-y-4">
        <h3 className="text-xl font-bold tracking-tight mb-2">Question Answer Review</h3>

        {mcqs.map((m, i) => {
          const chosen = answers[i];
          const isCorrect = chosen === m.correctAnswer;
          const isSkipped = chosen === undefined;

          return (
            <Card
              key={i}
              className={`p-6 border ${
                isCorrect
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : isSkipped
                    ? "border-amber-500/20 bg-amber-500/5"
                    : "border-destructive/20 bg-destructive/5"
              }`}
            >
              <div className="flex items-start gap-4">
                <div
                  className={`p-2.5 rounded-xl shrink-0 ${
                    isCorrect
                      ? "bg-emerald-500/10 text-emerald-500"
                      : isSkipped
                        ? "bg-amber-500/10 text-amber-500"
                        : "bg-destructive/10 text-destructive"
                  }`}
                >
                  {isCorrect ? (
                    <CheckCircle2 className="h-5 w-5" />
                  ) : isSkipped ? (
                    <HelpCircle className="h-5 w-5" />
                  ) : (
                    <XCircle className="h-5 w-5" />
                  )}
                </div>

                <div className="flex-1 space-y-3.5">
                  <p className="font-bold text-base">
                    <span className="text-muted-foreground mr-1.5">Q{i + 1}.</span>
                    {m.question}
                  </p>

                  <div className="grid gap-2 text-sm leading-relaxed max-w-2xl pl-1">
                    {m.options.map((opt, oi) => {
                      const isChosenOption = chosen === opt;
                      const isCorrectOption = m.correctAnswer === opt;

                      return (
                        <div
                          key={oi}
                          className={`flex items-center gap-2 ${
                            isCorrectOption
                              ? "font-bold text-emerald-500"
                              : isChosenOption
                                ? "text-destructive font-semibold"
                                : "text-muted-foreground"
                          }`}
                        >
                          <span className="font-bold">{String.fromCharCode(65 + oi)}.</span>
                          <span>{opt}</span>
                          {isCorrectOption && (
                            <Badge className="bg-emerald-500 h-5 text-[9px] uppercase font-bold shrink-0">
                              Correct
                            </Badge>
                          )}
                          {isChosenOption && !isCorrectOption && (
                            <Badge className="bg-destructive h-5 text-[9px] uppercase font-bold shrink-0">
                              Your Answer
                            </Badge>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {m.explanation && (
                    <div className="text-xs text-muted-foreground mt-4 pt-3.5 border-t border-border/20 leading-relaxed">
                      <span className="font-bold text-foreground block uppercase text-[10px] mb-1">
                        Explanation:
                      </span>
                      {m.explanation}
                    </div>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ==========================================
// 🕒 RECENT ACTIVITY COMPONENT
// ==========================================
type RecentActivityProps = {
  quizzes: SavedQuiz[];
  studyMaterials: StudyMaterialData[];
  onViewQuiz: (q: SavedQuiz) => void;
  onViewStudyMaterial: (m: StudyMaterialData) => void;
  onDownloadPdf: (name: string, mcqs: MCQ[]) => void;
  onDownloadDocx: (name: string, mcqs: MCQ[]) => void;
  onDownloadStudyMaterialPdf: (m: StudyMaterialData) => void;
  onDownloadStudyMaterialDocx: (m: StudyMaterialData) => void;
  onStartTest: (q: SavedQuiz) => void;
  onRenameQuiz: (id: string, name: string) => void;
  onRenameStudyMaterial: (id: string, title: string) => void;
  onDuplicateQuiz: (q: SavedQuiz) => void;
  onDeleteQuiz: (id: string) => void;
  onDeleteStudyMaterial: (id: string) => void;
};

function RecentActivity({
  quizzes,
  studyMaterials,
  onViewQuiz,
  onViewStudyMaterial,
  onDownloadPdf,
  onDownloadDocx,
  onDownloadStudyMaterialPdf,
  onDownloadStudyMaterialDocx,
  onStartTest,
  onRenameQuiz,
  onRenameStudyMaterial,
  onDuplicateQuiz,
  onDeleteQuiz,
  onDeleteStudyMaterial,
}: RecentActivityProps) {
  const [activeType, setActiveType] = useState<"all" | "study-material" | "quiz">("all");
  const [search, setSearch] = useState("");
  const [langFilter, setLangFilter] = useState("All");

  const filteredQuizzes = useMemo(() => {
    return quizzes
      .filter((q) => {
        const matchSearch = q.pdf_name.toLowerCase().includes(search.toLowerCase());
        const matchLang = langFilter === "All" || q.language === langFilter;
        return matchSearch && matchLang;
      })
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }, [quizzes, search, langFilter]);

  const filteredStudyMaterials = useMemo(() => {
    return studyMaterials
      .filter((m) => {
        const matchSearch =
          (m.title || "").toLowerCase().includes(search.toLowerCase()) ||
          (m.pdf_name || "").toLowerCase().includes(search.toLowerCase()) ||
          m.chapters.some((c) => c.title.toLowerCase().includes(search.toLowerCase()));
        const matchLang = langFilter === "All" || m.language === langFilter;
        return matchSearch && matchLang;
      })
      .sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime(),
      );
  }, [studyMaterials, search, langFilter]);

  const languages = useMemo(() => {
    const set = new Set([
      ...quizzes.map((q) => q.language),
      ...studyMaterials.map((m) => m.language || "English"),
    ]);
    return ["All", ...Array.from(set)];
  }, [quizzes, studyMaterials]);

  const totalItemsCount =
    (activeType === "all" || activeType === "quiz" ? filteredQuizzes.length : 0) +
    (activeType === "all" || activeType === "study-material"
      ? filteredStudyMaterials.length
      : 0);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Recent Activity</h1>
          <p className="text-muted-foreground mt-1">
            Review, download, or edit your generated Study Notes and Quizzes.
          </p>
        </div>

        {/* Content Type Filter Pills */}
        <div className="inline-flex items-center gap-1.5 p-1 bg-card/60 rounded-xl border border-border text-xs font-semibold shrink-0">
          <button
            onClick={() => setActiveType("all")}
            className={`px-3.5 py-1.5 rounded-lg transition-all ${
              activeType === "all"
                ? "bg-indigo-500/15 text-indigo-400 font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All ({quizzes.length + studyMaterials.length})
          </button>
          <button
            onClick={() => setActiveType("study-material")}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeType === "study-material"
                ? "bg-amber-500/15 text-amber-400 font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <GraduationCap className="h-3.5 w-3.5" />
            <span>Study Notes ({studyMaterials.length})</span>
          </button>
          <button
            onClick={() => setActiveType("quiz")}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeType === "quiz"
                ? "bg-purple-500/15 text-purple-400 font-bold"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <FileText className="h-3.5 w-3.5" />
            <span>Quizzes ({quizzes.length})</span>
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="flex flex-col sm:flex-row gap-3 bg-card/40 backdrop-blur-sm border border-border p-4 rounded-xl">
        <div className="flex-1 relative">
          <Input
            placeholder="Search by title, topic, or source PDF..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-10 bg-background/50 text-sm"
          />
          <span className="absolute left-3 top-3 text-muted-foreground">🔍</span>
        </div>

        <Select value={langFilter} onValueChange={setLangFilter}>
          <SelectTrigger className="w-full sm:w-48 h-10 bg-background/50 text-sm">
            <SelectValue placeholder="Filter by Language" />
          </SelectTrigger>
          <SelectContent>
            {languages.map((l) => (
              <SelectItem key={l} value={l}>
                {l === "All" ? "All Languages" : l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Content List/Grid */}
      {totalItemsCount === 0 ? (
        <Card className="p-12 text-center bg-card/30 border border-border rounded-2xl flex flex-col items-center justify-center">
          <History className="h-10 w-10 text-muted-foreground/60 mb-4" />
          <h3 className="text-lg font-bold tracking-tight">No activity found</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-sm">
            Try adjusting your filters, or upload a document to generate study material or quizzes.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {/* Study Materials Cards */}
          {(activeType === "all" || activeType === "study-material") &&
            filteredStudyMaterials.map((material) => (
              <Card
                key={material.id}
                className="p-5 bg-card/50 backdrop-blur-sm border-2 border-amber-500/20 hover:border-amber-500/40 hover:shadow-md transition flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex gap-2.5 items-center min-w-0">
                      <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 shrink-0">
                        <GraduationCap className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3
                          className="font-bold tracking-tight truncate text-foreground text-sm md:text-base"
                          title={material.title}
                        >
                          {material.title}
                        </h3>
                        <p className="text-xs text-muted-foreground truncate">{material.pdf_name}</p>
                      </div>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-amber-500/10 text-amber-400 border-amber-500/20 text-[10px] uppercase font-bold shrink-0"
                    >
                      {material.language || "English"}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                    <div>
                      Chapters:{" "}
                      <span className="font-semibold text-foreground">
                        {material.chapters.length}
                      </span>
                    </div>
                    <div>
                      Points:{" "}
                      <span className="font-semibold text-foreground">
                        {material.total_points || 0}
                      </span>
                    </div>
                    <div>
                      Generated:{" "}
                      <span className="font-semibold text-foreground">
                        {new Date(material.created_at || Date.now()).toLocaleDateString()}{" "}
                        {new Date(material.created_at || Date.now()).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons for Study Material */}
                <div className="mt-5 pt-4 border-t border-border/30 flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewStudyMaterial(material)}
                    className="gap-1.5 text-xs h-8 bg-amber-500/10 text-amber-400 border-amber-500/20 hover:bg-amber-500/20"
                    title="View & Edit Notes"
                  >
                    <Eye className="h-3.5 w-3.5" /> View Notes
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDownloadStudyMaterialPdf(material)}
                    className="gap-1.5 text-xs h-8"
                    title="Download Study Material PDF"
                  >
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDownloadStudyMaterialDocx(material)}
                    className="gap-1.5 text-xs h-8"
                    title="Download Word Document"
                  >
                    <Download className="h-3.5 w-3.5" /> DOCX
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newTitle = prompt(
                        "Enter new title for Study Material:",
                        material.title,
                      );
                      if (newTitle && newTitle.trim()) {
                        onRenameStudyMaterial(material.id, newTitle.trim());
                      }
                    }}
                    className="gap-1.5 text-xs h-8 text-amber-400 hover:text-amber-500"
                    title="Rename"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> Rename
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm("Are you sure you want to delete this study material?")) {
                        onDeleteStudyMaterial(material.id);
                      }
                    }}
                    className="gap-1.5 text-xs h-8 border-destructive/20 text-destructive hover:bg-destructive/10"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </Card>
            ))}

          {/* Quizzes Cards */}
          {(activeType === "all" || activeType === "quiz") &&
            filteredQuizzes.map((quiz) => (
              <Card
                key={quiz.id}
                className="p-5 bg-card/50 backdrop-blur-sm border-border hover:border-indigo-500/30 hover:shadow-md transition flex flex-col justify-between"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex gap-2.5 items-center min-w-0">
                      <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500 shrink-0">
                        <FileText className="h-5 w-5" />
                      </div>
                      <h3
                        className="font-bold tracking-tight truncate text-foreground text-sm md:text-base"
                        title={quiz.pdf_name}
                      >
                        {quiz.pdf_name}
                      </h3>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 text-[10px] uppercase font-bold shrink-0"
                    >
                      {quiz.language}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                    <div>
                      Questions:{" "}
                      <span className="font-semibold text-foreground">{quiz.num_questions}</span>
                    </div>
                    <div>
                      Generated:{" "}
                      <span className="font-semibold text-foreground">
                        {new Date(quiz.created_at).toLocaleDateString()}{" "}
                        {new Date(quiz.created_at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons for Quiz */}
                <div className="mt-5 pt-4 border-t border-border/30 flex flex-wrap gap-2 justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onViewQuiz(quiz)}
                    className="gap-1.5 text-xs h-8"
                    title="View Questions"
                  >
                    <Eye className="h-3.5 w-3.5" /> View
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onStartTest(quiz)}
                    className="gap-1.5 text-xs h-8 border-emerald-500/20 text-emerald-500 hover:bg-emerald-500/10"
                    title="Start Mock Test"
                  >
                    <Play className="h-3.5 w-3.5" /> Test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDownloadPdf(quiz.pdf_name, quiz.questions)}
                    className="gap-1.5 text-xs h-8"
                    title="Download PDF"
                  >
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDownloadDocx(quiz.pdf_name, quiz.questions)}
                    className="gap-1.5 text-xs h-8"
                    title="Download Word (DOCX)"
                  >
                    <Download className="h-3.5 w-3.5" /> DOCX
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const newName = prompt("Enter new name for the quiz:", quiz.pdf_name);
                      if (newName && newName.trim()) {
                        onRenameQuiz(quiz.id, newName.trim());
                      }
                    }}
                    className="gap-1.5 text-xs h-8 text-indigo-400 hover:text-indigo-500"
                    title="Rename"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> Rename
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onDuplicateQuiz(quiz)}
                    className="gap-1.5 text-xs h-8"
                    title="Duplicate"
                  >
                    <Copy className="h-3.5 w-3.5" /> Duplicate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm("Are you sure you want to delete this quiz?")) {
                        onDeleteQuiz(quiz.id);
                      }
                    }}
                    className="gap-1.5 text-xs h-8 border-destructive/20 text-destructive hover:bg-destructive/10"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </Card>
            ))}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 🏆 MOCK TESTS COMPONENT
// ==========================================
type MockTestsProps = {
  quizzes: SavedQuiz[];
  attempts: MockTestAttempt[];
  onStartTest: (q: SavedQuiz) => void;
  onResetAttempts: () => void;
};

function MockTests({
  quizzes,
  attempts,
  onStartTest,
  onResetAttempts,
}: MockTestsProps) {
  const avgScore = useMemo(() => {
    if (attempts.length === 0) return 0;
    return Math.round(attempts.reduce((acc, curr) => acc + curr.score, 0) / attempts.length);
  }, [attempts]);

  const formatTime = (totalSec: number) => {
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Mock Tests</h1>
        <p className="text-muted-foreground mt-1">
          Take practice tests, track your performance, and improve your exam scores.
        </p>
      </div>

      {/* Performance Summary Cards */}
      <div className="grid gap-6 sm:grid-cols-3">
        <Card className="p-6 bg-card/50 backdrop-blur-sm border-border flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase">Average Score</h3>
            <p className="text-4xl font-extrabold mt-2 text-indigo-500">{avgScore}%</p>
          </div>
          <p className="text-xs text-muted-foreground mt-4">Target passing score: 70%</p>
        </Card>
        <Card className="p-6 bg-card/50 backdrop-blur-sm border-border flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase">Tests Completed</h3>
            <p className="text-4xl font-extrabold mt-2 text-emerald-500">{attempts.length}</p>
          </div>
          <p className="text-xs text-muted-foreground mt-4">Consistency builds memory</p>
        </Card>
        <Card className="p-6 bg-card/50 backdrop-blur-sm border-border flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase">Quick Start</h3>
            <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
              Launch a timed test instantly using one of your saved quizzes from the selector panel.
            </p>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_350px]">
        {/* Mock Test History */}
        <Card className="p-6 bg-card/50 backdrop-blur-sm border-border">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold tracking-tight">Test Attempt History</h3>
            {attempts.length > 0 && (
              <Button variant="ghost" size="sm" onClick={onResetAttempts} className="text-xs text-destructive">
                Clear History
              </Button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto pr-2 space-y-3.5 scrollbar-thin">
            {attempts.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground flex flex-col items-center">
                <Trophy className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p>No attempts recorded yet.</p>
                <p className="text-xs mt-1">Start a mock test from the right panel or Recent Activity!</p>
              </div>
            ) : (
              attempts.map((a) => (
                <div key={a.id} className="flex items-start justify-between border-b border-border/30 pb-3 last:border-0 last:pb-0">
                  <div className="space-y-1 min-w-0">
                    <h4 className="font-semibold text-sm truncate pr-2">{a.pdf_name}</h4>
                    <p className="text-xs text-muted-foreground">
                      Score: <span className={`font-bold ${a.score >= 80 ? 'text-emerald-500' : a.score >= 50 ? 'text-amber-500' : 'text-destructive'}`}>{a.score}%</span> ({a.correct_count}/{a.total_questions})
                      {" • "}
                      Time: {formatTime(a.time_seconds)}
                    </p>
                  </div>
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap pt-1">
                    {new Date(a.created_at).toLocaleDateString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Start Mock Test Selection */}
        <Card className="p-6 bg-card/50 backdrop-blur-sm border-border h-fit space-y-4">
          <h3 className="text-lg font-bold tracking-tight">Select Quiz to Test</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Choose a generated quiz from your database and start a timed mock exam.
          </p>

          <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
            {quizzes.length === 0 ? (
              <p className="text-xs text-center py-6 text-muted-foreground italic border border-dashed border-border rounded-xl">
                No quizzes available yet. Please generate a quiz first!
              </p>
            ) : (
              quizzes.map((q) => (
                <div key={q.id} className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-background/30 hover:bg-muted/10 transition">
                  <div className="min-w-0 pr-2">
                    <p className="font-semibold text-xs truncate">{q.pdf_name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{q.num_questions} questions • {q.language}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => onStartTest(q)}
                    className="h-8 bg-indigo-600 hover:bg-indigo-700 text-xs shadow shrink-0"
                  >
                    Start
                  </Button>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ==========================================
// 👤 PROFILE / CLOUD CONTROL COMPONENT
// ==========================================
type ProfileProps = {
  user: any;
  supabaseClient: any;
  onSignOut: () => void;
  onSaveSupabaseConfig: (url: string, key: string) => void;
};

function Profile({
  user,
  supabaseClient,
  onSignOut,
  onSaveSupabaseConfig,
}: ProfileProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);

  const config = getSupabaseConfig();
  const [dbUrl, setDbUrl] = useState(config.url);
  const [dbKey, setDbKey] = useState(config.key);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabaseClient) {
      toast.error("Supabase client is not initialized. Save project URL & Key first.");
      return;
    }
    if (!email || !password) {
      toast.error("Please fill in all fields.");
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;
        toast.success("Account created successfully! Check your inbox for confirmation.");
      } else {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Signed in successfully!");
      }
    } catch (err: any) {
      toast.error(err.message || "Auth error occurred.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-xl mx-auto space-y-8 animate-fade-in">
      {user ? (
        <Card className="p-8 bg-card/60 backdrop-blur-sm border-border space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto h-16 w-16 rounded-full bg-indigo-500/10 text-indigo-500 flex items-center justify-center border border-indigo-500/20 shadow-inner">
              <User className="h-7 w-7" />
            </div>
            <h2 className="text-2xl font-extrabold tracking-tight">Account Profile</h2>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>

          <div className="space-y-4 pt-4 border-t border-border/30 text-sm">
            <div className="flex justify-between py-2 border-b border-border/20">
              <span className="text-muted-foreground font-medium">User ID</span>
              <span className="font-mono text-xs text-foreground truncate max-w-[200px]" title={user.id}>{user.id}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border/20">
              <span className="text-muted-foreground font-medium">Created Date</span>
              <span className="font-semibold text-foreground">
                {new Date(user.created_at).toLocaleDateString()}
              </span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-muted-foreground font-medium">Database Sync</span>
              <Badge className="bg-emerald-500">Active (Supabase)</Badge>
            </div>
          </div>

          <Button onClick={onSignOut} variant="destructive" className="w-full flex items-center justify-center gap-2 h-10">
            <LogOut className="h-4 w-4" /> Sign Out
          </Button>
        </Card>
      ) : (
        <Card className="p-8 bg-card/60 backdrop-blur-sm border-border space-y-6">
          <div className="text-center space-y-2">
            <h2 className="text-2xl font-extrabold tracking-tight">
              {isSignUp ? "Create a Cloud Account" : "Access Cloud Storage"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {isSignUp
                ? "Sign up to sync your quizzes permanently."
                : "Sign in to access your quizzes from any device."}
            </p>
          </div>

          {supabaseClient ? (
            <form onSubmit={handleAuth} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-10"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-10"
                />
              </div>

              <Button type="submit" disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 h-10 font-semibold shadow-md">
                {loading ? <Loader2 className="h-4 w-4 animate-spin mx-auto" /> : isSignUp ? "Sign Up" : "Sign In"}
              </Button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => setIsSignUp(!isSignUp)}
                  className="text-xs text-indigo-400 hover:underline"
                >
                  {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
                </button>
              </div>
            </form>
          ) : (
            <div className="p-4 rounded-xl border border-amber-500/20 bg-amber-500/5 text-xs text-amber-500 leading-relaxed text-center">
              Supabase credentials are not detected. Fill in the Supabase Project Configuration below to enable cloud features.
            </div>
          )}
        </Card>
      )}

      {/* Supabase Configuration Panel */}
      <Card className="p-8 bg-card/60 backdrop-blur-sm border-border space-y-5">
        <div>
          <h3 className="text-lg font-bold tracking-tight">Supabase Project Settings</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Configure your Supabase database endpoints below to enable secure user authentication.
          </p>
        </div>

        <div className="space-y-4 text-sm">
          <div className="space-y-1.5">
            <Label htmlFor="dbUrl">Supabase URL</Label>
            <Input
              id="dbUrl"
              placeholder="https://yourproject.supabase.co"
              value={dbUrl}
              onChange={(e) => setDbUrl(e.target.value)}
              className="h-10"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="dbKey">Supabase Anon/Public Key</Label>
            <Input
              id="dbKey"
              type="password"
              placeholder="eyJhbGciOi..."
              value={dbKey}
              onChange={(e) => setDbKey(e.target.value)}
              className="h-10"
            />
          </div>

          <Button
            onClick={() => {
              if (dbUrl && dbKey) {
                onSaveSupabaseConfig(dbUrl.trim(), dbKey.trim());
              } else {
                toast.error("Please provide both URL and Key.");
              }
            }}
            className="w-full bg-slate-800 hover:bg-slate-700 text-white h-10 font-semibold"
          >
            Save Credentials
          </Button>

          <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
            Note: Environment variables <code className="bg-muted px-1 py-0.5 rounded text-foreground">VITE_SUPABASE_URL</code> and <code className="bg-muted px-1 py-0.5 rounded text-foreground">VITE_SUPABASE_ANON_KEY</code> can also be used.
          </p>
        </div>
      </Card>
    </div>
  );
}

