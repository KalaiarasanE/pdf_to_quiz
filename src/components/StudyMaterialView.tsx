import { useState, useMemo, useRef } from "react";
import {
  Download,
  Copy,
  Printer,
  Edit3,
  Check,
  ChevronLeft,
  BookOpen,
  Sparkles,
  Calendar,
  User,
  HelpCircle,
  Clock,
  Search,
  FileText,
  Star,
  ArrowRight,
  Maximize2,
  Minimize2,
  Trash2,
  Plus,
  Table as TableIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  StudyMaterialData,
  StudyMaterialChapter,
  StudyMaterialSection,
  filterEducationalChapters,
  cleanDocumentTitle,
  isArtificialSubtitle,
} from "@/lib/study-material.types";
import { StudyMaterialDocument } from "@/components/StudyMaterialDocument";
import {
  generateStudyMaterialPdf,
  generateStudyMaterialWord,
  printStudyMaterialDocument,
} from "@/lib/study-material.pdf";

interface StudyMaterialViewProps {
  material: StudyMaterialData;
  onBack: () => void;
  onUpdateMaterial?: (updated: StudyMaterialData) => void;
}

export function StudyMaterialView({
  material: initialMaterial,
  onBack,
  onUpdateMaterial,
}: StudyMaterialViewProps) {
  const [material, setMaterial] = useState<StudyMaterialData>(initialMaterial);
  const [isEditing, setIsEditing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeChapterIndex, setActiveChapterIndex] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Synchronize state when updated
  const handleUpdate = (newMaterial: StudyMaterialData) => {
    setMaterial(newMaterial);
    if (onUpdateMaterial) onUpdateMaterial(newMaterial);
  };

  const cleanChapters = useMemo(() => filterEducationalChapters(material.chapters), [material.chapters]);
  const cleanTitle = useMemo(
    () => cleanDocumentTitle(material.title, cleanChapters[0]?.chapterTitle),
    [material.title, cleanChapters],
  );

  const filteredChapters = useMemo(() => {
    if (!searchQuery.trim()) return cleanChapters;
    const q = searchQuery.toLowerCase();
    return cleanChapters
      .map((ch) => {
        const matchesChapter = ch.chapterTitle.toLowerCase().includes(q) || (ch.summary && ch.summary.toLowerCase().includes(q));
        const filteredSections = ch.sections.filter((sec) => {
          const matchTitle = sec.title.toLowerCase().includes(q);
          const matchContent = sec.content && sec.content.toLowerCase().includes(q);
          const matchItems = sec.items && sec.items.some((it) => it.toLowerCase().includes(q));
          const matchQuickRev = sec.quickRevisionList && sec.quickRevisionList.some((qr) => qr.key.toLowerCase().includes(q) || qr.value.toLowerCase().includes(q));
          const matchFacts = sec.keyFactList && sec.keyFactList.some((f) => f.label.toLowerCase().includes(q) || f.value.toLowerCase().includes(q));
          const matchDates = sec.dateList && sec.dateList.some((d) => d.date.toLowerCase().includes(q) || d.event.toLowerCase().includes(q));
          const matchDefs = sec.definitionList && sec.definitionList.some((d) => d.term.toLowerCase().includes(q) || d.definition.toLowerCase().includes(q));
          return matchTitle || matchContent || matchItems || matchQuickRev || matchFacts || matchDates || matchDefs;
        });

        if (matchesChapter || filteredSections.length > 0) {
          return {
            ...ch,
            sections: filteredSections.length > 0 ? filteredSections : ch.sections,
          };
        }
        return null;
      })
      .filter(Boolean) as StudyMaterialChapter[];
  }, [cleanChapters, searchQuery]);

  // Copy Full Material to Clipboard
  const handleCopyAll = () => {
    const hasValidSubtitle = material.subtitle && !isArtificialSubtitle(material.subtitle);
    let plain = `# ${cleanTitle}\n${hasValidSubtitle ? material.subtitle + "\n\n" : "\n"}`;
    for (const ch of cleanChapters) {
      plain += `## ${ch.chapterTitle}\n${ch.summary ? ch.summary + "\n\n" : ""}`;
      for (const sec of ch.sections) {
        plain += `### ${sec.title}\n`;
        if (sec.content) plain += `${sec.content}\n\n`;
        if (sec.items) {
          sec.items.forEach((it) => (plain += `• ${it}\n`));
          plain += "\n";
        }
        if (sec.quickRevisionList) {
          sec.quickRevisionList.forEach((q) => (plain += `${q.key} → ${q.value}\n`));
          plain += "\n";
        }
        if (sec.keyFactList) {
          sec.keyFactList.forEach((f) => (plain += `• ${f.label}: ${f.value}\n`));
          plain += "\n";
        }
        if (sec.dateList) {
          sec.dateList.forEach((d) => (plain += `[${d.date}] ${d.event}\n`));
          plain += "\n";
        }
        if (sec.definitionList) {
          sec.definitionList.forEach((d) => (plain += `📌 ${d.term}: ${d.definition}\n`));
          plain += "\n";
        }
      }
    }
    navigator.clipboard.writeText(plain);
    toast.success("Study Material notes copied to clipboard!");
  };

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    await generateStudyMaterialPdf(material, {
      elementId: "study-material-document-content",
      onSuccess: () => setDownloadingPdf(false),
      onError: () => setDownloadingPdf(false),
    });
  };

  const handleDownloadDocx = async () => {
    setDownloadingDocx(true);
    await generateStudyMaterialWord(material, {
      onSuccess: () => setDownloadingDocx(false),
      onError: () => setDownloadingDocx(false),
    });
  };

  return (
    <div
      ref={containerRef}
      className={`space-y-6 animate-fade-in ${
        fullscreen
          ? "fixed inset-0 z-50 bg-background overflow-y-auto p-4 md:p-8"
          : "max-w-5xl mx-auto"
      }`}
    >
      {/* Top Header & Actions Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-5">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 h-10 rounded-full px-4 text-xs">
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-black tracking-tight text-foreground">
                Study Material Preview
              </h1>
              <span className="woblo-badge text-[10px] uppercase font-bold">
                A4 BOOK FORMAT
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Review your structured study notes below or download high-quality PDF.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Edit Mode Toggle */}
          <Button
            variant={isEditing ? "default" : "outline"}
            size="sm"
            onClick={() => setIsEditing(!isEditing)}
            className="gap-1.5 h-10 rounded-full text-xs px-4"
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span>{isEditing ? "Done Editing" : "Edit Notes"}</span>
          </Button>

          {/* Copy Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyAll}
            className="gap-1.5 h-10 rounded-full text-xs px-3.5"
            title="Copy Notes to Clipboard"
          >
            <Copy className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Copy</span>
          </Button>

          {/* Download DOCX */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownloadDocx}
            disabled={downloadingDocx}
            className="gap-1.5 h-10 rounded-full text-xs px-3.5"
            title="Download Word (.docx)"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">DOCX</span>
          </Button>

          {/* Download Study Material PDF (Primary Real Text) */}
          <Button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="bg-primary hover:bg-primary/90 text-white font-bold shadow-[0_0_20px_rgba(26,64,255,0.4)] gap-2 h-10 px-4 rounded-full text-xs md:text-sm"
            title="Download real selectable text PDF with embedded font"
          >
            <Download className="h-4 w-4" />
            <span>Download PDF</span>
          </Button>

          {/* Browser Native Print / PDF Preview */}
          <Button
            variant="outline"
            size="sm"
            onClick={printStudyMaterialDocument}
            className="gap-1.5 h-10 rounded-full text-xs px-3.5"
            title="Open browser print preview (100% styled vector PDF)"
          >
            <Printer className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Print / Browser PDF</span>
          </Button>

          {/* Fullscreen view toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFullscreen(!fullscreen)}
            className="h-10 w-10 rounded-full"
            title={fullscreen ? "Exit Fullscreen" : "Fullscreen View"}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Filter & Chapter Jump Strip */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between woblo-glass p-3.5 rounded-2xl">
        <div className="flex items-center gap-2 w-full sm:w-auto flex-1">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search concepts, dates, facts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-10 text-xs bg-background/50 rounded-xl border-border/80"
            />
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-1 sm:pb-0 scrollbar-thin">
          <span className="text-xs text-muted-foreground font-semibold shrink-0">Chapters:</span>
          {cleanChapters.map((ch, idx) => (
            <button
              key={idx}
              onClick={() => {
                setActiveChapterIndex(idx);
                const el = document.getElementById(`chapter-${idx}`);
                if (el) el.scrollIntoView({ behavior: "smooth" });
              }}
              className={`h-8 text-xs px-3 shrink-0 rounded-full font-medium transition-all ${
                activeChapterIndex === idx
                  ? "bg-primary text-white shadow-[0_0_12px_rgba(26,64,255,0.35)] font-bold"
                  : "text-muted-foreground hover:text-foreground hover:bg-white/[0.06]"
              }`}
            >
              Ch {idx + 1}
            </button>
          ))}
        </div>
      </div>

      {/* 📖 A4 EDUCATIONAL DOCUMENT PREVIEW */}
      <StudyMaterialDocument
        id="study-material-document-content"
        material={material}
        chapters={filteredChapters}
        isEditing={isEditing}
        onUpdateMaterial={handleUpdate}
      />
    </div>
  );
}
