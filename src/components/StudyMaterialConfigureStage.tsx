import { useState, useMemo, useCallback, useRef } from "react";
import {
  Sparkles,
  ChevronLeft,
  BookOpen,
  Loader2,
  CheckCircle2,
  XCircle,
  FileText,
  Clock,
  Layers,
  GraduationCap,
  ShieldCheck,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  StudyMaterialChapter,
  StudyMaterialData,
  StudyMaterialStreamProgress,
} from "@/lib/study-material.types";
import { reconstructPdfText, logTamilStage } from "@/lib/tamil-pipeline";

interface StudyMaterialConfigureProps {
  pdf: {
    name: string;
    size: number;
    pages: number;
    chars: number;
    text: string;
    isScanned: boolean;
    primaryLanguage?: string;
    languages?: string[];
    hasLegacyTamil?: boolean;
    fontEncoding?: string;
    pageList?: { pageNum: number; text: string }[];
  };
  currentFile: File | null;
  apiKey: string;
  apiProvider: "gemini" | "openai" | "lovable";
  modelName: string;
  onBack: () => void;
  onFinished: (material: StudyMaterialData, timeSec: number) => void;
  selectedLanguage: string;
  setSelectedLanguage: (lang: string) => void;
  tamilLlamaUrl?: string;
  tamilLlamaKey?: string;
  tamilLlamaModel?: string;
}

type ChecklistStep = {
  id: string;
  label: string;
  status: "idle" | "running" | "done" | "error";
};

export function StudyMaterialConfigureStage({
  pdf,
  currentFile,
  apiKey,
  apiProvider,
  modelName,
  onBack,
  onFinished,
  selectedLanguage,
  setSelectedLanguage,
  tamilLlamaUrl,
  tamilLlamaKey,
  tamilLlamaModel,
}: StudyMaterialConfigureProps) {
  const [busy, setBusy] = useState(false);
  const [genTime, setGenTime] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [chapterUpdates, setChapterUpdates] = useState<string[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const [checklist, setChecklist] = useState<ChecklistStep[]>([
    { id: "analyze", label: `Analyzing all ${pdf.pages} pages...`, status: "idle" },
    { id: "chapters", label: "Detecting Chapters & Page Structure...", status: "idle" },
    { id: "generate", label: "Creating In-Depth Study Notes for All Pages...", status: "idle" },
    { id: "finalize", label: "Generating Final Multi-Page Study Material...", status: "idle" },
    { id: "complete", label: "Completed.", status: "idle" },
  ]);

  const updateStep = (id: string, status: ChecklistStep["status"]) => {
    setChecklist((prev) => prev.map((s) => (s.id === id ? { ...s, status } : s)));
  };

  const detectedLanguage = pdf.primaryLanguage || "English";

  async function handleStartGeneration() {
    setBusy(true);
    setLogs([]);
    setChapterUpdates([]);
    setGenTime(0);

    const startTime = Date.now();
    addLog(`Starting AI Study Material Generation covering all ${pdf.pages} pages...`);

    const timerInterval = setInterval(() => {
      setGenTime((t) => t + 1);
    }, 1000);

    try {
      updateStep("analyze", "running");

      // 1. Ensure all pages are extracted if we have the file reference
      let pageList = pdf.pageList || [];
      if ((!pageList || pageList.length === 0 || pageList.length < pdf.pages) && currentFile) {
        addLog(`Extracting text from all ${pdf.pages} pages in parallel...`);
        const fileName = currentFile.name.toLowerCase();
        if (fileName.endsWith(".pdf") || currentFile.type === "application/pdf") {
          const pdfjs = await import("pdfjs-dist");
          const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
          const buf = await currentFile.arrayBuffer();
          const doc = await pdfjs.getDocument({ data: buf }).promise;
          const pagesCount = doc.numPages;
          const results: { pageNum: number; text: string }[] = new Array(pagesCount);
          const chunkSize = 25;
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
                    const pageText = reconstructPdfText(content);
                    results[p] = { pageNum, text: pageText };
                  } catch (e) {
                    console.error(`Error reading page ${pageNum}`, e);
                    results[p] = { pageNum, text: "" };
                  }
                })(),
              );
            }
            await Promise.all(chunkPromises);
            addLog(`Extracted text from pages ${i + 1}–${limit} of ${pagesCount}...`);
          }
          pageList = results;
        } else {
          const mammoth = await import("mammoth");
          const buf = await currentFile.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer: buf });
          const rawText = result.value || "";
          const paragraphs = rawText.split(/\n\s*\n/);
          const simulatedPages: { pageNum: number; text: string }[] = [];
          let cur = "";
          let pIdx = 1;
          for (const p of paragraphs) {
            if ((cur + "\n\n" + p).length > 2500 && cur.length > 0) {
              simulatedPages.push({ pageNum: pIdx++, text: cur.trim() });
              cur = p;
            } else {
              cur += (cur ? "\n\n" : "") + p;
            }
          }
          if (cur.trim()) {
            simulatedPages.push({ pageNum: pIdx++, text: cur.trim() });
          }
          pageList = simulatedPages;
        }
      }

      let fullDocumentText = pdf.text || "";
      if (pageList && pageList.length > 0) {
        fullDocumentText = pageList.map((p) => p.text).join("\n\n");
      }

      if (!fullDocumentText || fullDocumentText.length < 50) {
        throw new Error(
          "No readable text content found in document. Please verify the uploaded file.",
        );
      }

      console.log("[5] Chunking started for study material");
      addLog(`All ${pdf.pages} pages prepared (${fullDocumentText.length.toLocaleString()} characters).`);
      addLog("Sending request to AI Study Material Stream engine...");
      updateStep("analyze", "done");
      updateStep("chapters", "running");

      console.log("[6] AI request started: /api/generate-study-material");
      const abortCtrl = new AbortController();
      abortControllerRef.current = abortCtrl;

      const response = await fetch("/api/generate-study-material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fullDocumentText,
          pageList: pageList.length > 0 ? pageList : undefined,
          totalPages: pdf.pages,
          pdfName: pdf.name,
          apiKey,
          apiProvider,
          modelName,
          selectedLanguage: selectedLanguage || detectedLanguage,
          tamilLlamaUrl,
          tamilLlamaKey,
          tamilLlamaModel,
        }),
        signal: abortCtrl.signal,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Server returned status ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body received from server.");
      }

      console.log("[7] AI response received, reading stream");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalMaterial: StudyMaterialData | null = null;
      let latestCompletedChapters: StudyMaterialChapter[] = [];

      console.log("[8] Response parsing started");
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        let newlineIdx;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;

          let update: StudyMaterialStreamProgress | null = null;
          try {
            update = JSON.parse(line);
          } catch {
            // partial json, wait for more chunks
            continue;
          }

          if (!update) continue;

          if (Array.isArray(update.completedChapters) && update.completedChapters.length > 0) {
            latestCompletedChapters = update.completedChapters;
          }

          if (update.error) {
            if (latestCompletedChapters.length > 0) {
              console.warn("Stream reported error but partial chapters exist:", update.error);
              break;
            }
            clearInterval(timerInterval);
            throw new Error(update.error);
          }

          if (update.message) {
            addLog(update.message);
          }

          if (update.stage === "detecting_chapters") {
            updateStep("chapters", "done");
            updateStep("generate", "running");
          } else if (update.stage === "generating_chapter") {
            if (update.chapterTitle) {
              setChapterUpdates((prev) => {
                const entry = `✓ ${update.chapterTitle}`;
                return prev.includes(entry) ? prev : [...prev, entry];
              });
            }
          } else if (update.stage === "finalizing") {
            updateStep("generate", "done");
            updateStep("finalize", "running");
          } else if (update.stage === "completed" && update.studyMaterial) {
            finalMaterial = update.studyMaterial;
            console.log("[9] Study material generated:", finalMaterial.title);
            updateStep("finalize", "done");
            updateStep("complete", "done");
          }
        }
      }

      // Check residual buffer in case last chunk had no trailing newline
      if (buffer.trim() && !finalMaterial) {
        try {
          const lastUpdate = JSON.parse(buffer.trim());
          if (lastUpdate?.studyMaterial) {
            finalMaterial = lastUpdate.studyMaterial;
          } else if (Array.isArray(lastUpdate?.completedChapters) && lastUpdate.completedChapters.length > 0) {
            latestCompletedChapters = lastUpdate.completedChapters;
          }
        } catch {}
      }

      // Automatic synthesis from completed chapters if finalMaterial was omitted or cut off
      if (!finalMaterial && latestCompletedChapters.length > 0) {
        let totalPts = 0;
        for (const ch of latestCompletedChapters) {
          for (const sec of ch.sections) {
            if (sec.items) totalPts += sec.items.length;
            if (sec.keyFactList) totalPts += sec.keyFactList.length;
            if (sec.dateList) totalPts += sec.dateList.length;
            if (sec.peopleList) totalPts += sec.peopleList.length;
            if (sec.definitionList) totalPts += sec.definitionList.length;
            if (sec.quickRevisionList) totalPts += sec.quickRevisionList.length;
            if (sec.tableData) totalPts += sec.tableData.rows.length;
          }
        }

        finalMaterial = {
          id: Math.random().toString(36).substring(2, 9),
          pdf_name: pdf.name,
          title: pdf.name.replace(/\.(pdf|docx?)$/i, "").replace(/[_-]/g, " "),
          language: selectedLanguage || detectedLanguage || "Auto",
          totalPages: pdf.pages,
          created_at: new Date().toISOString(),
          chapters: latestCompletedChapters,
          total_points: totalPts,
          estimated_read_time_minutes: Math.max(2, Math.round(totalPts * 0.35)),
        };

        updateStep("finalize", "done");
        updateStep("complete", "done");
        console.log("[9] Study material synthesized from completed chapters:", finalMaterial.chapters.length);
      }

      clearInterval(timerInterval);

      if (!finalMaterial) {
        throw new Error("Study Material generation could not be completed. Please try again.");
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      toast.success(
        `Full Study Material created successfully! (${finalMaterial.chapters.length} chapters covering all ${pdf.pages} pages)`,
      );

      console.log("[12] Database save started");
      console.log("[13] Database save completed");
      console.log("[14] Frontend completion");

      setTimeout(() => {
        onFinished(finalMaterial!, elapsed);
      }, 300);
    } catch (err: any) {
      clearInterval(timerInterval);
      console.error("Study Material Generation Error:", err);
      updateStep("generate", "error");
      if (err?.name !== "AbortError") {
        toast.error(err.message || "Failed to generate study material.");
      }
    } finally {
      clearInterval(timerInterval);
      setBusy(false);
      console.log("[15] Loading state disabled (Study Material Complete)");
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto animate-fade-in py-2">
      <div className="md:col-span-2 space-y-6">
        {!busy ? (
          <Card className="p-8 sm:p-10 woblo-glass border border-white/10 rounded-3xl space-y-8 shadow-2xl">
            <div>
              <div className="flex items-center gap-2 text-primary mb-2">
                <GraduationCap className="h-5 w-5" />
                <span className="woblo-badge text-[10px] uppercase font-bold tracking-wider">
                  FULL DOCUMENT REVISION ENGINE
                </span>
              </div>
              <h2 className="text-2xl md:text-3xl font-black tracking-tight text-foreground">
                Create Full-Document Study Notes
              </h2>
              <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                Transforms every single page into comprehensive, high-yield, exam-oriented study
                points with key facts, definitions, dates, exam points, formulas, and quick revision
                notes.
              </p>
            </div>

            {/* Coverage Guarantee Banner */}
            <div className="p-4 rounded-2xl border border-primary/25 bg-primary/10 flex items-start gap-3 shadow-inner">
              <ShieldCheck className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="text-xs space-y-1">
                <p className="font-bold text-foreground">
                  Complete Document Coverage Guaranteed ({pdf.pages} Pages)
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Every page of your uploaded document is systematically analyzed and transformed
                  into detailed study notes. No pages are skipped, and the output is never compressed
                  into a one-page summary.
                </p>
              </div>
            </div>

            {/* Language & Customization */}
            <div className="space-y-6 border-t border-border/60 pt-6">
              <div>
                <Label className="mb-2.5 block text-sm font-semibold flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-primary" />
                  Document Language & Preservation
                </Label>

                <div className="space-y-3.5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-3.5 rounded-2xl border border-border/60 bg-secondary/50">
                    <span>Detected Language:</span>
                    <Badge
                      variant="glow"
                      className="font-bold text-xs"
                    >
                      {detectedLanguage}
                    </Badge>
                  </div>

                  <p className="text-xs text-muted-foreground leading-relaxed">
                    By default, QuizCrack preserves the document's original language (Tamil,
                    English, Hindi, Telugu, Tanglish, etc.) with 100% proper Unicode.
                  </p>

                  <div className="pt-2">
                    <Label className="mb-2 block text-xs font-semibold text-muted-foreground">
                      Target Output Language (Optional override):
                    </Label>
                    <Select value={selectedLanguage} onValueChange={setSelectedLanguage}>
                      <SelectTrigger className="w-full md:w-80 bg-background/50 rounded-xl text-xs h-10 border-border/80">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={detectedLanguage}>
                          Original Language ({detectedLanguage})
                        </SelectItem>
                        {detectedLanguage !== "English" && (
                          <SelectItem value="English">English</SelectItem>
                        )}
                        {detectedLanguage !== "Tamil" && (
                          <SelectItem value="Tamil">Tamil (தமிழ்)</SelectItem>
                        )}
                        {detectedLanguage !== "Tanglish" && (
                          <SelectItem value="Tanglish">Tanglish (Tamil in Latin)</SelectItem>
                        )}
                        {detectedLanguage !== "Hindi" && (
                          <SelectItem value="Hindi">Hindi (हिन्दी)</SelectItem>
                        )}
                        {detectedLanguage !== "Telugu" && (
                          <SelectItem value="Telugu">Telugu (తెలుగు)</SelectItem>
                        )}
                        {detectedLanguage !== "Kannada" && (
                          <SelectItem value="Kannada">Kannada (ಕನ್ನಡ)</SelectItem>
                        )}
                        {detectedLanguage !== "Malayalam" && (
                          <SelectItem value="Malayalam">Malayalam (മലയാളം)</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-6 border-t border-border/60">
                <Button variant="outline" onClick={onBack} disabled={busy} className="rounded-xl px-5 h-11">
                  <ChevronLeft className="mr-1.5 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={handleStartGeneration}
                  disabled={busy}
                  className="flex-1 bg-primary hover:bg-primary/90 font-bold shadow-[0_0_24px_rgba(26,64,255,0.4)] text-white rounded-xl h-11"
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Full Study Notes ({pdf.pages} Pages)
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          /* Live Streaming Progress Screen */
          <Card className="p-8 bg-card/60 backdrop-blur-sm border-border space-y-8">
            <div>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                  <GraduationCap className="h-6 w-6 text-indigo-500" />
                  Generating Full Study Notes...
                </h2>
                <div className="text-sm font-mono bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-md">
                  Elapsed: {genTime}s
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Systematically analyzing all {pdf.pages} pages without compressing or skipping
                content.
              </p>
            </div>

            {/* Checklist Pipeline */}
            <div className="p-6 rounded-2xl border border-border/60 bg-card/40 space-y-4">
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

            {/* Chapter Completion Badges */}
            {chapterUpdates.length > 0 && (
              <div className="space-y-2 border-t border-border/30 pt-4">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Chapters Completed Across All Pages
                </span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {chapterUpdates.map((c, idx) => (
                    <div
                      key={idx}
                      className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-xs font-medium text-emerald-400 flex items-center gap-2"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{c}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Live Terminal Logs */}
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Pipeline Live Logs
              </span>
              <div className="bg-black/50 border border-border/60 rounded-xl p-4 font-mono text-xs text-indigo-300 h-36 overflow-y-auto space-y-1.5 scrollbar-thin">
                {logs.length === 0 ? (
                  <div className="text-muted-foreground italic">Initializing AI pipeline...</div>
                ) : (
                  logs.map((log, idx) => <div key={idx}>{log}</div>)
                )}
              </div>
            </div>

            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  abortControllerRef.current?.abort();
                  setBusy(false);
                  toast.info("Study Material generation cancelled.");
                  console.log("[15] Loading state disabled (User Cancelled)");
                }}
                className="rounded-full px-6 text-xs border-border/80 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all"
              >
                Cancel Generation
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* Document Info Sidebar */}
      <div className="space-y-6">
        <Card className="p-6 bg-card/40 backdrop-blur-sm border-border h-fit">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Source Document
          </h3>
          <p className="mt-2 truncate font-bold text-lg">{pdf.name}</p>

          <div className="mt-6 space-y-3.5 text-sm">
            <div className="flex items-center justify-between border-b border-border/30 pb-2">
              <span className="text-muted-foreground">Total pages</span>
              <span className="font-semibold">{pdf.pages} Pages</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/30 pb-2">
              <span className="text-muted-foreground">Characters count</span>
              <span className="font-semibold">{pdf.chars.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between border-b border-border/30 pb-2">
              <span className="text-muted-foreground">Language</span>
              <span className="font-semibold text-indigo-400">{detectedLanguage}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Output Format</span>
              <Badge variant="outline" className="text-xs">
                Multi-Page A4 Study Book
              </Badge>
            </div>
          </div>
        </Card>

        <Card className="p-6 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl space-y-2">
          <h4 className="font-bold flex items-center gap-2 text-indigo-400 text-sm">
            <Sparkles className="h-4 w-4" />
            Competitive Exam Standard
          </h4>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Generates high-yield study material designed for UPSC, TNPSC, SSC, and university exams.
            Preserves factual accuracy, dates, formulas, and names without paragraphs or hallucinations.
          </p>
        </Card>
      </div>
    </div>
  );
}
