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

import html2canvas from "html2canvas";

// Import export libraries
import { jsPDF } from "jspdf";
import { Document, Packer, Paragraph, TextRun } from "docx";
import ExcelJS from "exceljs";
import { saveAs } from "file-saver";

export const Route = createFileRoute("/")({
  component: App,
});

type Tab = "dashboard" | "generate" | "settings";
type Stage = "upload" | "extracting" | "configuring" | "generating" | "review" | "test" | "results";

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
};

type DashboardStats = {
  uploadedPdfs: number;
  totalPages: number;
  questionsGenerated: number;
  totalGenTimeSec: number;
  mockTestsCreated: number;
  downloadHistoryCount: number;
  recentActivity: Array<{
    id: string;
    type: "upload" | "generate" | "test" | "download";
    detail: string;
    time: string;
  }>;
};

const DEFAULT_STATS: DashboardStats = {
  uploadedPdfs: 0,
  totalPages: 0,
  questionsGenerated: 0,
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

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("generate");
  const [stage, setStage] = useState<Stage>("upload");
  const [pdf, setPdf] = useState<PdfMeta | null>(null);
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [mcqs, setMcqs] = useState<MCQ[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [testTime, setTestTime] = useState<number>(0);
  const [stats, setStats] = useState<DashboardStats>(DEFAULT_STATS);
  const [darkMode, setDarkMode] = useState<boolean>(true);

  // Settings state
  const [apiKey, setApiKey] = useState<string>("");
  const [apiProvider, setApiProvider] = useState<"gemini" | "openai" | "lovable">("gemini");
  const [modelName, setModelName] = useState<string>("gemini-3.1-flash-lite");

  // Load stats & settings from localStorage
  useEffect(() => {
    const savedStats = localStorage.getItem("quizcrack_stats");
    if (savedStats) {
      try {
        setStats(JSON.parse(savedStats));
      } catch (e) {}
    }
    const savedApiKey = localStorage.getItem("quizcrack_apikey");
    const savedProvider = localStorage.getItem("quizcrack_provider");
    const savedModel = localStorage.getItem("quizcrack_model");
    const savedTheme = localStorage.getItem("quizcrack_theme");

    if (savedApiKey) setApiKey(savedApiKey);
    if (savedProvider) setApiProvider(savedProvider as any);
    if (savedModel) setModelName(savedModel);

    // Default dark theme
    const isDark = savedTheme !== "light";
    setDarkMode(isDark);
    if (isDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  }, []);

  const toggleTheme = () => {
    const nextDark = !darkMode;
    setDarkMode(nextDark);
    localStorage.setItem("quizcrack_theme", nextDark ? "dark" : "light");
    if (nextDark) {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
  };

  const updateStats = (updater: (prev: DashboardStats) => DashboardStats) => {
    setStats((prev) => {
      const next = updater(prev);
      localStorage.setItem("quizcrack_stats", JSON.stringify(next));
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
    <div className="min-h-screen bg-background text-foreground transition-colors duration-200">
      <Toaster richColors position="top-right" />

      {/* Header bar */}
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <button
            onClick={() => {
              setStage("upload");
              setActiveTab("generate");
            }}
            className="flex items-center gap-3 text-xl font-bold tracking-tight hover:opacity-90"
          >
            <img
              src="/logo.png"
              alt="QuizCrack Logo"
              className="h-10 w-auto rounded-lg object-contain"
            />
            <span className="bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 bg-clip-text text-transparent">
              QuizCrack
            </span>
            <Badge variant="outline" className="border-indigo-500/30 text-indigo-500 text-[10px]">
              PREMIUM
            </Badge>
          </button>

          <nav className="flex items-center gap-1 md:gap-2">
            <Button
              variant={activeTab === "dashboard" ? "secondary" : "ghost"}
              size="sm"
              className="gap-2"
              onClick={() => setActiveTab("dashboard")}
            >
              <LayoutDashboard className="h-4 w-4" />
              <span className="hidden md:inline">Dashboard</span>
            </Button>
            <Button
              variant={activeTab === "generate" ? "secondary" : "ghost"}
              size="sm"
              className="gap-2"
              onClick={() => {
                setActiveTab("generate");
                if (stage === "results") setStage("upload");
              }}
            >
              <FileText className="h-4 w-4" />
              <span className="hidden md:inline">Generate</span>
            </Button>
            <Button
              variant={activeTab === "settings" ? "secondary" : "ghost"}
              size="sm"
              className="gap-2"
              onClick={() => setActiveTab("settings")}
            >
              <SettingsIcon className="h-4 w-4" />
              <span className="hidden md:inline">Settings</span>
            </Button>

            <div className="mx-2 h-4 w-px bg-border" />

            <Button variant="ghost" size="icon" onClick={toggleTheme} className="rounded-full">
              {darkMode ? (
                <Sun className="h-4 w-4 text-amber-400" />
              ) : (
                <Moon className="h-4 w-4 text-indigo-500" />
              )}
            </Button>
          </nav>
        </div>
      </header>

      {/* Main Container */}
      <main className="mx-auto max-w-6xl px-6 py-8">
        {activeTab === "dashboard" && (
          <Dashboard
            stats={stats}
            onResetStats={() => {
              localStorage.removeItem("quizcrack_stats");
              setStats(DEFAULT_STATS);
              toast.success("Dashboard metrics reset.");
            }}
          />
        )}

        {activeTab === "settings" && (
          <Settings
            apiKey={apiKey}
            setApiKey={(k) => {
              setApiKey(k);
              localStorage.setItem("quizcrack_apikey", k);
            }}
            apiProvider={apiProvider}
            setApiProvider={(p) => {
              setApiProvider(p);
              localStorage.setItem("quizcrack_provider", p);
            }}
            modelName={modelName}
            setModelName={(m) => {
              setModelName(m);
              localStorage.setItem("quizcrack_model", m);
            }}
          />
        )}

        {activeTab === "generate" && (
          <>
            {stage === "upload" && (
              <UploadStage
                onLoaded={(meta, file) => {
                  setPdf(meta);
                  setCurrentFile(file);
                  setStage("configuring");
                  // Update stats
                  updateStats((prev) => ({
                    ...prev,
                    uploadedPdfs: prev.uploadedPdfs + 1,
                    totalPages: prev.totalPages + meta.pages,
                  }));
                  logActivity("upload", `Uploaded "${meta.name}" (${meta.pages} pages)`);
                }}
                onExtractionProgress={() => {}}
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
  );
}

// ==========================================
// 📈 DASHBOARD COMPONENT
// ==========================================
function Dashboard({ stats, onResetStats }: { stats: DashboardStats; onResetStats: () => void }) {
  const avgGenTime =
    stats.questionsGenerated > 0
      ? (stats.totalGenTimeSec / stats.questionsGenerated).toFixed(2)
      : "0";

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Analytics Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Track your quiz generation history, PDF metrics, and performance.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onResetStats}>
          Clear History
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: "Uploaded PDFs",
            value: stats.uploadedPdfs,
            sub: "Total documents processed",
            icon: BookOpen,
            color: "text-indigo-500 bg-indigo-500/10",
          },
          {
            label: "Total Pages Extracted",
            value: stats.totalPages,
            sub: "Pages read by parser/OCR",
            icon: FileText,
            color: "text-cyan-500 bg-cyan-500/10",
          },
          {
            label: "Questions Generated",
            value: stats.questionsGenerated,
            sub: "Exam-quality MCQs created",
            icon: Sparkles,
            color: "text-purple-500 bg-purple-500/10",
          },
          {
            label: "Avg Speed (Sec/Q)",
            value: avgGenTime,
            sub: "Seconds per generated question",
            icon: Loader2,
            color: "text-emerald-500 bg-emerald-500/10",
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
          <h3 className="text-lg font-bold tracking-tight mb-4">Quiz Metrics</h3>
          <div className="space-y-4">
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
                High Speed (Gemini)
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
                No recent activity. Start generating quizzes!
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
                        a.type === "upload"
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
type UploadProps = {
  onLoaded: (meta: PdfMeta, file: File) => void;
  onExtractionProgress: (pct: number, stageName: string) => void;
};

function UploadStage({ onLoaded }: UploadProps) {
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stageName, setStageName] = useState("");
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
        toast.error("Invalid file. Please upload a PDF file.");
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
        setStageName("Reading PDF structure...");
        const { sampleText, pagesCount, isScanned } = await extractPdfSample(file);

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
          chars: pagesCount * 1500, // Estimated characters count
          text: cleanSample,
          isScanned,
          isMultilingual,
          primaryLanguage,
          languages,
          lastModified: file.lastModified,
        };

        setProgress(100);
        setStageName("Complete!");
        setTimeout(() => {
          onLoaded(meta, file);
        }, 300);
      } catch (e) {
        console.error(e);
        toast.error("Failed to parse PDF. The file may be password-protected or corrupt.");
      } finally {
        setBusy(false);
      }
    },
    [onLoaded],
  );

  return (
    <div className="space-y-8 max-w-4xl mx-auto animate-fade-in">
      <div className="space-y-3 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight md:text-5xl bg-gradient-to-r from-indigo-500 via-purple-500 to-cyan-500 bg-clip-text text-transparent">
          Create Quizzes from PDFs in Seconds
        </h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Drop any study guide, research paper, textbook, or scanned PDF. Our AI parses pages in
          parallel, runs OCR when needed, and generates custom exam questions.
        </p>
      </div>

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
        className={`border-2 border-dashed p-14 text-center cursor-pointer transition-all duration-300 relative overflow-hidden bg-card/40 backdrop-blur-sm ${
          dragging
            ? "border-primary bg-indigo-500/10 scale-[0.99]"
            : "border-border hover:border-indigo-500/50 hover:bg-card/60"
        }`}
        onClick={() => !busy && inputRef.current?.click()}
      >
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-indigo-500/10 text-indigo-500 shadow-md">
          <Upload className="h-7 w-7" />
        </div>
        <h2 className="mt-5 text-xl font-bold tracking-tight">Drag & drop your PDF file here</h2>
        <p className="mt-2 text-sm text-muted-foreground max-w-sm mx-auto">
          or click to browse your local files (Supports scanned documents & files up to 100MB)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
          }}
        />

        {busy && (
          <div className="absolute inset-0 bg-background/90 backdrop-blur-sm flex flex-col items-center justify-center p-8 z-10">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
            <h3 className="text-lg font-bold tracking-tight">{stageName}</h3>
            <div className="w-full max-w-md mt-4">
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-right mt-1.5">
                {progress}% completed
              </p>
            </div>
          </div>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-3">
        {[
          {
            icon: BookOpen,
            title: "Parallel Extraction",
            body: "Processes all PDF pages concurrently for maximum processing throughput.",
          },
          {
            icon: Sparkles,
            title: "Tesseract OCR Fallback",
            body: "Extracts text from scanned pages, notes, and photos using AI-powered image recognition.",
          },
          {
            icon: Play,
            title: "Instant Cached Loads",
            body: "Re-uploading files instantly retrieves cached extractions from browser memory.",
          },
        ].map((f, i) => (
          <Card key={i} className="p-6 bg-card/40 backdrop-blur-sm border-border">
            <f.icon className="h-6 w-6 text-indigo-500" />
            <h3 className="mt-4 font-bold tracking-tight text-base">{f.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{f.body}</p>
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

  const [selectedLanguage, setSelectedLanguage] = useState<string>("");

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

      if (cachedMeta && cachedMeta.pageList && cachedMeta.pageList.length > 0) {
        addLog("Cache hit! Found pre-extracted page text list in IndexedDB.");
        allPagesList = cachedMeta.pageList;
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
            <h2 className="text-2xl font-bold tracking-tight">Configure AI Generation</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Select questions quantity and difficulty options.
            </p>

            <div className="mt-8 space-y-6">
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
    estimateSize: () => 220,
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

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: `Extracted ${list.length} Questions`,
                  bold: true,
                  size: 32,
                }),
              ],
              spacing: { after: 200 },
            }),
            ...list.flatMap((m, idx) => [
              new Paragraph({
                text: "------------------------------------------------",
                spacing: { before: 100, after: 100 },
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Q${idx + 1}`,
                    bold: true,
                  }),
                ],
              }),
              new Paragraph({
                text: m.question,
                spacing: { after: 120 },
              }),
              ...m.options.map(
                (opt, oi) =>
                  new Paragraph({
                    text: `${String.fromCharCode(65 + oi)}. ${opt}`,
                    spacing: { after: 60 },
                  }),
              ),
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Answer:",
                    bold: true,
                  }),
                ],
                spacing: { before: 100 },
              }),
              new Paragraph({
                text: `${String.fromCharCode(65 + m.options.indexOf(m.correctAnswer))}. ${m.correctAnswer}`,
                spacing: { after: 150 },
              }),
            ]),
          ],
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, `${pdfName.replace(".pdf", "")}_quiz.docx`);
    onDownload();
    toast.success("Word document (.docx) download started.");
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
      { header: "Correct Answer", key: "answer", width: 25 },
      { header: "Explanation", key: "explanation", width: 40 },
      { header: "Difficulty", key: "difficulty", width: 12 },
      { header: "Category", key: "category", width: 15 },
    ];

    list.forEach((m, idx) => {
      sheet.addRow({
        num: `Q${idx + 1}`,
        question: m.question,
        optA: m.options[0],
        optB: m.options[1],
        optC: m.options[2],
        optD: m.options[3],
        answer: `${String.fromCharCode(65 + m.options.indexOf(m.correctAnswer))}. ${m.correctAnswer}`,
        explanation: m.explanation,
        difficulty: m.difficulty,
        category: m.category,
      });
    });

    // Formatting
    sheet.getRow(1).font = { bold: true };

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    saveAs(blob, `${pdfName.replace(".pdf", "")}_quiz.xlsx`);
    onDownload();
    toast.success("Excel sheet (.xlsx) download started.");
  };

  // ==========================================
  // EXPORT PDF (.pdf) - Custom Exam Paper formatting
  // ==========================================
  // Helper for Indic script reordering (shaping)
  const shapeIndicText = (text: string) => {
    let shaped = text;

    // 1. Tamil shaping
    shaped = shaped.replace(/([க-ஹ])\u0BC6/g, "\u0BC6$1"); // ெ
    shaped = shaped.replace(/([க-ஹ])\u0BC7/g, "\u0BC7$1"); // ே
    shaped = shaped.replace(/([க-ஹ])\u0BC8/g, "\u0BC8$1"); // ை
    shaped = shaped.replace(/([க-ஹ])\u0BCA/g, "\u0BC6$1\u0BBE"); // ொ -> ெ + consonant + ா
    shaped = shaped.replace(/([க-ஹ])\u0BCB/g, "\u0BC7$1\u0BBE"); // ோ -> ே + consonant + ா
    shaped = shaped.replace(/([க-ஹ])\u0BCC/g, "\u0BC6$1\u0BD7"); // ௌ -> ெ + consonant + ள-sign

    // 2. Devanagari (Hindi) shaping
    shaped = shaped.replace(/([क-ह])\u093F/g, "\u093F$1"); // ि
    shaped = shaped.replace(/([ക-ഹ])\u0D46/g, "\u0D46$1"); // െ
    shaped = shaped.replace(/([ക-ഹ])\u0D47/g, "\u0D47$1"); // േ
    shaped = shaped.replace(/([ക-ഹ])\u0D48/g, "\u0D48$1"); // ൈ
    shaped = shaped.replace(/([ക-ഹ])\u0D4A/g, "\u0D46$1\u0D3E"); // ൊ
    shaped = shaped.replace(/([ക-ഹ])\u0D4B/g, "\u0D47$1\u0D3E"); // ോ

    return shaped;
  };

  const downloadPdf = () => {
    const list = mcqs.filter((_, idx) => selectedIndices.has(idx));
    if (list.length === 0) {
      toast.error("Please select at least one question to download.");
      return;
    }

    const fullQuestionsText =
      pdfName +
      " " +
      list.map((m) => m.question + " " + m.options.join(" ") + " " + m.correctAnswer).join(" ");

    let fontName = "helvetica";
    let fontUrl = "";
    let fontFileName = "";

    if (/[\u0B80-\u0BFF]/.test(fullQuestionsText)) {
      fontName = "NotoSansTamil";
      fontFileName = "NotoSansTamil-Regular.ttf";
      fontUrl =
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTamil/NotoSansTamil-Regular.ttf";
    } else if (/[\u0900-\u097F]/.test(fullQuestionsText)) {
      fontName = "NotoSansDevanagari";
      fontFileName = "NotoSansDevanagari-Regular.ttf";
      fontUrl =
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansDevanagari/NotoSansDevanagari-Regular.ttf";
    } else if (/[\u0C00-\u0C7F]/.test(fullQuestionsText)) {
      fontName = "NotoSansTelugu";
      fontFileName = "NotoSansTelugu-Regular.ttf";
      fontUrl =
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansTelugu/NotoSansTelugu-Regular.ttf";
    } else if (/[\u0C80-\u0CFF]/.test(fullQuestionsText)) {
      fontName = "NotoSansKannada";
      fontFileName = "NotoSansKannada-Regular.ttf";
      fontUrl =
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansKannada/NotoSansKannada-Regular.ttf";
    } else if (/[\u0D00-\u0D7F]/.test(fullQuestionsText)) {
      fontName = "NotoSansMalayalam";
      fontFileName = "NotoSansMalayalam-Regular.ttf";
      fontUrl =
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSansMalayalam/NotoSansMalayalam-Regular.ttf";
    } else if (Array.from(fullQuestionsText).some((char) => char.charCodeAt(0) > 127)) {
      fontName = "NotoSans";
      fontFileName = "NotoSans-Regular.ttf";
      fontUrl =
        "https://raw.githubusercontent.com/googlefonts/noto-fonts/main/hinted/ttf/NotoSans/NotoSans-Regular.ttf";
    }

    const generateAndSave = (base64Font?: string) => {
      try {
        const doc = new jsPDF({
          orientation: "p",
          unit: "pt",
          format: "a4",
          compress: true,
        });

        if (base64Font && fontFileName && fontName) {
          doc.addFileToVFS(fontFileName, base64Font);
          doc.addFont(fontFileName, fontName, "normal");
          doc.setFont(fontName, "normal");
        }

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        // Margins: Top/Bottom 20mm (~56.7pt), Left/Right 18mm (~51pt)
        const marginX = 51.0;
        const marginY = 56.7;
        const contentWidth = pageWidth - marginX * 2;

        let y = marginY;

        const setSafeFont = (style: "normal" | "bold" | "italic" | "bolditalic") => {
          if (fontName === "helvetica") {
            doc.setFont("helvetica", style);
          } else {
            doc.setFont(fontName, "normal");
          }
        };

        // Header
        setSafeFont("bold");
        doc.setFontSize(18);
        doc.text(`Extracted ${list.length} Questions`, marginX, y);
        y += 25;

        doc.setFontSize(10);
        setSafeFont("normal");
        const shapedPdfName = fontName !== "helvetica" ? shapeIndicText(pdfName) : pdfName;
        doc.text(`Source Document: ${shapedPdfName}`, marginX, y);
        y += 30;

        // Wrap and shape helper to prevent splitting vowel signs across lines
        const wrapAndShape = (text: string, maxWidth: number): string[] => {
          const rawLines = doc.splitTextToSize(text, maxWidth) as string[];
          return rawLines.map((line) => (fontName !== "helvetica" ? shapeIndicText(line) : line));
        };

        list.forEach((m, idx) => {
          // Prepare content lines
          const qText = m.question;
          const optTexts = m.options;
          const ansText = m.correctAnswer;
          const expText = m.explanation || "";

          // Wrap questions and options
          const questionLines = wrapAndShape(qText, contentWidth);
          const optALines = wrapAndShape(`A. ${optTexts[0]}`, contentWidth);
          const optBLines = wrapAndShape(`B. ${optTexts[1]}`, contentWidth);
          const optCLines = wrapAndShape(`C. ${optTexts[2]}`, contentWidth);
          const optDLines = wrapAndShape(`D. ${optTexts[3]}`, contentWidth);

          const ansIndex = optTexts.indexOf(ansText);
          const ansLetter = ansIndex !== -1 ? String.fromCharCode(65 + ansIndex) : "A";
          const answerLines = wrapAndShape(`${ansLetter}. ${ansText}`, contentWidth);

          const explanationLines = expText ? wrapAndShape(expText, contentWidth) : [];

          // Calculate precise block height for pagination (1.6 line height)
          let blockHeight = 0;
          blockHeight += 15; // divider line space
          blockHeight += 28.8 + 10; // Question Number label (18pt) + Paragraph Gap
          blockHeight += questionLines.length * 28.8 + 10; // Question Text (18pt) + Paragraph Gap
          blockHeight += optALines.length * 25.6 + 10; // Option A (16pt) + Paragraph Gap
          blockHeight += optBLines.length * 25.6 + 10; // Option B (16pt) + Paragraph Gap
          blockHeight += optCLines.length * 25.6 + 10; // Option C (16pt) + Paragraph Gap
          blockHeight += optDLines.length * 25.6; // Option D (16pt)
          blockHeight += 10; // Paragraph Gap
          blockHeight += 25.6 + 10; // "Answer:" label (16pt) + Paragraph Gap
          blockHeight += answerLines.length * 25.6; // Answer Text (16pt)

          if (expText) {
            blockHeight += 10; // Paragraph Gap
            blockHeight += 24.0 + 10; // "Explanation:" label (15pt) + Paragraph Gap
            blockHeight += explanationLines.length * 24.0; // Explanation Text (15pt)
          }

          blockHeight += 20; // Question Gap (bottom spacing)

          // Page break check (prevents splitting a question block across pages)
          if (y + blockHeight > pageHeight - marginY) {
            doc.addPage();
            if (base64Font && fontFileName && fontName) {
              doc.setFont(fontName, "normal");
            }
            y = marginY;
          }

          // Separator line
          doc.setDrawColor(220);
          doc.setLineDashPattern([2, 2], 0);
          doc.line(marginX, y, pageWidth - marginX, y);
          y += 15;

          // Question Number (e.g. 1) - 18px Left Aligned
          doc.setFontSize(18);
          setSafeFont("bold");
          doc.text(`${idx + 1}`, marginX, y);
          y += 28.8 + 10;

          // Question Text - 18px Semi Bold Left Aligned
          setSafeFont("bold");
          questionLines.forEach((line) => {
            doc.text(line, marginX, y);
            y += 28.8;
          });
          y += 10;

          // Options - 16px Regular Left Aligned
          doc.setFontSize(16);
          setSafeFont("normal");

          const drawOptionGroup = (lines: string[], addGap: boolean) => {
            lines.forEach((line) => {
              doc.text(line, marginX, y);
              y += 25.6;
            });
            if (addGap) y += 10;
          };

          drawOptionGroup(optALines, true);
          drawOptionGroup(optBLines, true);
          drawOptionGroup(optCLines, true);
          drawOptionGroup(optDLines, false);
          y += 10;

          // Answer Label - 16px Bold Left Aligned
          doc.setFontSize(16);
          setSafeFont("bold");
          doc.text("Answer:", marginX, y);
          y += 25.6 + 10;

          // Answer Text - 16px Bold Left Aligned
          answerLines.forEach((line) => {
            doc.text(line, marginX, y);
            y += 25.6;
          });

          // Explanation (if present) - 15px Regular Left Aligned
          if (expText) {
            y += 10;
            doc.setFontSize(15);
            setSafeFont("bolditalic");
            doc.text("Explanation:", marginX, y);
            y += 24.0 + 10;

            setSafeFont("italic");
            explanationLines.forEach((line) => {
              doc.text(line, marginX, y);
              y += 24.0;
            });
          }

          y += 20; // Question Gap
        });

        doc.save(`${pdfName.replace(".pdf", "")}_quiz.pdf`);
        onDownload();
        toast.success("PDF document downloaded successfully!");
      } catch (err) {
        console.error("PDF generation failed:", err);
        toast.error("PDF generation failed. Try downloading again.");
      }
    };

    if (fontUrl) {
      const toastId = toast.loading(
        `Downloading Unicode font (${fontName}) to render PDF correctly...`,
      );
      fetch(fontUrl)
        .then((res) => {
          if (!res.ok) throw new Error("Font fetch failed");
          return res.arrayBuffer();
        })
        .then((arrayBuffer) => {
          let binary = "";
          const bytes = new Uint8Array(arrayBuffer);
          const len = bytes.byteLength;
          for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          const base64 = window.btoa(binary);
          toast.dismiss(toastId);
          toast.success("Unicode font loaded successfully!");
          generateAndSave(base64);
        })
        .catch((err) => {
          toast.dismiss(toastId);
          console.error("Font loading error:", err);
          toast.error("Failed to load Unicode font. Generating PDF with default font.");
          generateAndSave();
        });
    } else {
      generateAndSave();
    }
  };

  // Helper formatting for Clipboard
  function formatExamPlaintext(questions: MCQ[]) {
    let output = `Extracted ${questions.length} Questions\n\n`;
    questions.forEach((m, idx) => {
      output += `------------------------------------------------\n\n`;
      output += `Q${idx + 1}\n\n`;
      output += `${m.question}\n\n`;
      m.options.forEach((opt, oi) => {
        output += `${String.fromCharCode(65 + oi)}. ${opt}\n\n`;
      });
      output += `Answer:\n`;
      const ansIdx = m.options.indexOf(m.correctAnswer);
      const letter = ansIdx !== -1 ? String.fromCharCode(65 + ansIdx) : "A";
      output += `${letter}. ${m.correctAnswer}\n\n`;
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
      <Card className="p-10 font-mono text-foreground border border-border shadow-lg relative bg-card overflow-hidden">
        {/* Top Header info (Watermark / Paper feeling) */}
        <div className="text-center border-b-2 border-double border-border pb-6 mb-8">
          <h3 className="text-2xl font-bold tracking-widest uppercase">EXAM QUESTIONNAIRE</h3>
          <p className="text-xs text-muted-foreground mt-1.5 uppercase font-semibold">
            TOTAL QUESTIONS COMPILED: {mcqs.length}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">SOURCE DOCUMENT: {pdfName}</p>
        </div>

        <div className="space-y-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase pb-2">
            Extracted {filteredMCQs.length} Questions (Matching Filters)
          </p>

          <div
            ref={parentRef}
            className="h-[750px] overflow-y-auto pr-2 border border-border/40 rounded-xl bg-card/25 p-4 shadow-inner"
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
                    <div className="group relative border-b border-dashed border-border/60 pb-8 hover:bg-muted/5 p-4 rounded-lg transition-colors mb-4 bg-card/40 backdrop-blur-sm">
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

                      <div className="flex items-start gap-4">
                        {/* Selector Checkbox */}
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(i)}
                          className="mt-1.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 print:hidden"
                        />

                        <div className="flex-1 space-y-4 w-full">
                          {/* Q# and Meta badges */}
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm tracking-wide">Q{i + 1}</span>
                            <Badge
                              variant="outline"
                              className="text-[10px] text-muted-foreground uppercase"
                            >
                              {m.difficulty}
                            </Badge>
                            <Badge
                              variant="outline"
                              className="text-[10px] text-muted-foreground uppercase"
                            >
                              {m.category}
                            </Badge>
                          </div>

                          {isEditing ? (
                            /* Inplace Edit mode */
                            <div className="space-y-4 pt-2">
                              <div className="space-y-1.5">
                                <Label className="text-xs font-semibold">Question</Label>
                                <Textarea
                                  value={m.question}
                                  onChange={(e) => updateQuestion(i, { question: e.target.value })}
                                  rows={3}
                                  className="font-mono text-sm"
                                />
                              </div>

                              {/* Options editor */}
                              <div className="space-y-2">
                                <Label className="text-xs font-semibold">
                                  Options (Select radio for correct answer)
                                </Label>
                                {m.options.map((opt, oi) => (
                                  <div key={oi} className="flex items-center gap-2">
                                    <span className="text-sm font-bold">
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
                                      className="font-mono text-sm h-8"
                                    />
                                    <Button
                                      size="xs"
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
                                <Label className="text-xs font-semibold">Explanation</Label>
                                <Textarea
                                  value={m.explanation}
                                  onChange={(e) =>
                                    updateQuestion(i, { explanation: e.target.value })
                                  }
                                  rows={2}
                                  placeholder="Explanation why correct answer holds true..."
                                  className="font-mono text-sm"
                                />
                              </div>

                              <Button
                                size="sm"
                                onClick={() => setEditingIndex(null)}
                                className="h-8"
                              >
                                Save Changes
                              </Button>
                            </div>
                          ) : (
                            /* Clean Exam Render Format */
                            <div className="space-y-3.5">
                              <p className="text-base font-medium leading-relaxed whitespace-pre-line pr-8">
                                {m.question}
                              </p>

                              {/* Custom 4 options block */}
                              <div className="grid gap-2 grid-cols-1 md:grid-cols-2 pt-2">
                                {m.options.map((opt, oi) => {
                                  const isCorrect = opt === m.correctAnswer;
                                  return (
                                    <div
                                      key={oi}
                                      className={`text-sm leading-relaxed ${isCorrect ? "font-bold text-indigo-500" : ""}`}
                                    >
                                      <span className="font-bold mr-2 text-muted-foreground">
                                        {String.fromCharCode(65 + oi)}.
                                      </span>
                                      {opt}
                                    </div>
                                  );
                                })}
                              </div>

                              <div className="pt-2 flex flex-col gap-1">
                                <div className="text-sm font-semibold">Answer:</div>
                                <div className="text-sm font-bold text-indigo-500">
                                  {String.fromCharCode(65 + m.options.indexOf(m.correctAnswer))}.{" "}
                                  {m.correctAnswer}
                                </div>
                              </div>

                              {m.explanation && (
                                <p className="text-xs text-muted-foreground mt-2 border-t border-border/10 pt-2 leading-relaxed">
                                  <span className="font-bold uppercase tracking-wider text-[10px] text-foreground block mb-0.5">
                                    Why:
                                  </span>
                                  {m.explanation}
                                </p>
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
      </Card>
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
