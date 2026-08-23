import { useState, useMemo, useCallback } from "react";
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
import { StudyMaterialData, StudyMaterialChapter, StudyMaterialStreamProgress } from "@/lib/study-material.types";

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
}: StudyMaterialConfigureProps) {
  const [busy, setBusy] = useState(false);
  const [genTime, setGenTime] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [chapterUpdates, setChapterUpdates] = useState<string[]>([]);

  const addLog = useCallback((msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const [checklist, setChecklist] = useState<ChecklistStep[]>([
    { id: "analyze", label: "Analyzing PDF...", status: "idle" },
    { id: "chapters", label: "Detecting Chapters & Topic Structure...", status: "idle" },
    { id: "generate", label: "Creating Study Material...", status: "idle" },
    { id: "finalize", label: "Generating Final Study Material...", status: "idle" },
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
    addLog("Starting AI Study Material Generation...");

    const timerInterval = setInterval(() => {
      setGenTime((t) => t + 1);
    }, 1000);

    try {
      updateStep("analyze", "running");
      addLog(`Preparing document text (${pdf.pages} pages, ${pdf.chars.toLocaleString()} chars)...`);

      // If document text is not full, gather from pageList or sample
      let fullDocumentText = pdf.text || "";
      if (pdf.pageList && pdf.pageList.length > 0) {
        fullDocumentText = pdf.pageList.map((p) => p.text).join("\n\n");
      }

      if (!fullDocumentText || fullDocumentText.length < 50) {
        throw new Error("No readable text content found in document. Please verify the uploaded file.");
      }

      addLog("Sending request to AI Study Material Stream engine...");
      updateStep("analyze", "done");
      updateStep("chapters", "running");

      const response = await fetch("/api/generate-study-material", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: fullDocumentText,
          pdfName: pdf.name,
          apiKey,
          apiProvider,
          modelName,
          selectedLanguage: selectedLanguage || detectedLanguage,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson.error || `Server returned status ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body received from server.");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let finalMaterial: StudyMaterialData | null = null;

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
            const update: StudyMaterialStreamProgress = JSON.parse(line);
            if (update.error) throw new Error(update.error);

            if (update.message) {
              addLog(update.message);
            }

            if (update.stage === "detecting_chapters") {
              updateStep("chapters", "done");
              updateStep("generate", "running");
            } else if (update.stage === "generating_chapter") {
              if (update.chapterTitle) {
                setChapterUpdates((prev) => [
                  ...prev,
                  `✓ Chapter ${update.currentChapter}: ${update.chapterTitle} completed`,
                ]);
              }
            } else if (update.stage === "finalizing") {
              updateStep("generate", "done");
              updateStep("finalize", "running");
            } else if (update.stage === "completed" && update.studyMaterial) {
              finalMaterial = update.studyMaterial;
              updateStep("finalize", "done");
              updateStep("complete", "done");
            }
          } catch (e) {
            // partial json
          }
        }
      }

      clearInterval(timerInterval);

      if (!finalMaterial) {
        throw new Error("Study Material generation could not be completed. Please try again.");
      }

      const elapsed = Math.round((Date.now() - startTime) / 1000);
      toast.success(`Study Material created successfully! (${finalMaterial.chapters.length} chapters)`);

      setTimeout(() => {
        onFinished(finalMaterial!, elapsed);
      }, 600);
    } catch (err: any) {
      clearInterval(timerInterval);
      console.error("Study Material Generation Error:", err);
      updateStep("generate", "error");
      toast.error(err.message || "Failed to generate study material.");
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-3 max-w-5xl mx-auto animate-fade-in">
      <div className="md:col-span-2 space-y-6">
        {!busy ? (
          <Card className="p-8 bg-card/40 backdrop-blur-sm border-border space-y-8">
            <div>
              <div className="flex items-center gap-2.5 text-indigo-500 mb-1">
                <GraduationCap className="h-6 w-6" />
                <span className="text-xs font-bold uppercase tracking-wider">AI Study Material Engine</span>
              </div>
              <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                Create Structured Study Notes
              </h2>
              <p className="mt-1.5 text-sm text-muted-foreground leading-relaxed">
                Transform lengthy PDF chapters into concise, revision-ready, exam-oriented study material
                with key facts, definitions, dates, exam points, and quick revision notes.
              </p>
            </div>

            {/* Language & Customization */}
            <div className="space-y-6 border-t border-border/40 pt-6">
              <div>
                <Label className="mb-2.5 block text-sm font-semibold flex items-center gap-1.5">
                  <BookOpen className="h-4 w-4 text-indigo-500" />
                  Document Language & Preservation
                </Label>

                <div className="space-y-3.5">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground p-3 rounded-xl border border-border/40 bg-muted/20">
                    <span>Detected Language:</span>
                    <Badge
                      variant="secondary"
                      className="bg-indigo-500/10 text-indigo-400 border-indigo-500/20 font-bold"
                    >
                      {detectedLanguage}
                    </Badge>
                  </div>

                  <div>
                    <Label className="text-xs text-muted-foreground mb-1.5 block">
                      Target Output Language (Defaults to detected document language)
                    </Label>
                    <Select
                      value={selectedLanguage || detectedLanguage}
                      onValueChange={(val) => setSelectedLanguage(val)}
                    >
                      <SelectTrigger className="w-full md:w-80 bg-background/50 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={detectedLanguage}>
                          Original ({detectedLanguage})
                        </SelectItem>
                        {detectedLanguage !== "English" && <SelectItem value="English">English</SelectItem>}
                        {detectedLanguage !== "Tamil" && <SelectItem value="Tamil">Tamil (தமிழ்)</SelectItem>}
                        {detectedLanguage !== "Tanglish" && (
                          <SelectItem value="Tanglish">Tanglish (Tamil in Latin)</SelectItem>
                        )}
                        {detectedLanguage !== "Hindi" && <SelectItem value="Hindi">Hindi (हिन्दी)</SelectItem>}
                        {detectedLanguage !== "Telugu" && <SelectItem value="Telugu">Telugu (తెలుగు)</SelectItem>}
                        {detectedLanguage !== "Kannada" && <SelectItem value="Kannada">Kannada (ಕನ್ನಡ)</SelectItem>}
                        {detectedLanguage !== "Malayalam" && (
                          <SelectItem value="Malayalam">Malayalam (മലയാളം)</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Study Material Highlights Feature List */}
              <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-xl space-y-2 text-xs text-muted-foreground">
                <span className="font-bold text-foreground text-xs block">
                  Included Study Material Sections:
                </span>
                <div className="grid grid-cols-2 gap-2 pt-1 text-[11px]">
                  <span>✓ Main Topic & Intro</span>
                  <span>✓ Important Concepts</span>
                  <span>✓ Key Facts & Statistics</span>
                  <span>✓ Important Dates & Timeline</span>
                  <span>✓ Important People</span>
                  <span>✓ Definitions & Glossary</span>
                  <span>✓ Exam Important Points (★)</span>
                  <span>✓ Quick Revision (Key → Fact)</span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-6 border-t border-border/30">
                <Button variant="outline" onClick={onBack} disabled={busy}>
                  <ChevronLeft className="mr-1.5 h-4 w-4" />
                  Back
                </Button>
                <Button
                  onClick={handleStartGeneration}
                  disabled={busy}
                  className="flex-1 bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 hover:from-indigo-700 hover:to-purple-700 font-bold shadow-lg shadow-indigo-500/25 h-11 text-sm text-white"
                >
                  <Sparkles className="mr-2 h-4 w-4 animate-spin-slow" />
                  Create Study Material
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          /* Live Generation Progress Screen */
          <Card className="p-8 bg-card/60 backdrop-blur-sm border-border space-y-8">
            <div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                  <h2 className="text-2xl font-bold tracking-tight">Generating Study Material...</h2>
                </div>
                <div className="text-sm font-mono bg-indigo-500/10 text-indigo-400 px-3 py-1 rounded-md">
                  Elapsed: {genTime}s
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Analyzing chapters, extracting high-yield points, and formatting study notes.
              </p>
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

            {/* Chapter Completion Badges */}
            {chapterUpdates.length > 0 && (
              <div className="space-y-2 border-t border-border/30 pt-4">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Chapter Progress
                </span>
                <div className="space-y-1.5">
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
                Pipeline Logs
              </span>
              <div className="bg-black/50 border border-border/60 rounded-xl p-4 font-mono text-xs text-indigo-300 h-36 overflow-y-auto space-y-1.5 scrollbar-thin">
                {logs.length === 0 ? (
                  <div className="text-muted-foreground italic">Initializing AI pipeline...</div>
                ) : (
                  logs.map((log, idx) => <div key={idx}>{log}</div>)
                )}
              </div>
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
              <span className="font-semibold">{pdf.pages}</span>
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
              <span className="text-muted-foreground">Format</span>
              <Badge variant="outline" className="text-xs">
                A4 Study Book
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
