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
import { StudyMaterialData, StudyMaterialChapter, StudyMaterialSection } from "@/lib/study-material.types";
import { generateStudyMaterialPdf, generateStudyMaterialWord } from "@/lib/study-material.pdf";

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

  const filteredChapters = useMemo(() => {
    if (!searchQuery.trim()) return material.chapters;
    const q = searchQuery.toLowerCase();
    return material.chapters
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
  }, [material.chapters, searchQuery]);

  // Copy Full Material to Clipboard
  const handleCopyAll = () => {
    let plain = `# ${material.title}\n${material.subtitle || ""}\n\n`;
    for (const ch of material.chapters) {
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
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/40 pb-5">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={onBack} className="gap-1.5 h-9">
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                Study Material Preview
              </h1>
              <Badge className="bg-indigo-500/10 text-indigo-500 border-indigo-500/20 text-[10px] font-bold">
                A4 BOOK FORMAT
              </Badge>
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
            className="gap-1.5 h-9 text-xs"
          >
            <Edit3 className="h-3.5 w-3.5" />
            <span>{isEditing ? "Done Editing" : "Edit Notes"}</span>
          </Button>

          {/* Copy Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyAll}
            className="gap-1.5 h-9 text-xs"
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
            className="gap-1.5 h-9 text-xs"
            title="Download Word (.docx)"
          >
            <FileText className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">DOCX</span>
          </Button>

          {/* Download Study Material PDF (Primary) */}
          <Button
            onClick={handleDownloadPdf}
            disabled={downloadingPdf}
            className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold shadow-lg shadow-indigo-500/20 gap-2 h-9 px-4 text-xs md:text-sm"
          >
            <Download className="h-4 w-4" />
            <span>Download Study Material</span>
          </Button>

          {/* Fullscreen view toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFullscreen(!fullscreen)}
            className="h-9 w-9"
            title={fullscreen ? "Exit Fullscreen" : "Fullscreen View"}
          >
            {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      {/* Filter & Chapter Jump Strip */}
      <div className="flex flex-col sm:flex-row gap-3 items-center justify-between bg-card/40 backdrop-blur-sm border border-border p-3.5 rounded-xl">
        <div className="flex items-center gap-2 w-full sm:w-auto flex-1">
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search concepts, dates, facts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs bg-background/50"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto max-w-full pb-1 sm:pb-0 scrollbar-thin">
          <span className="text-xs text-muted-foreground font-semibold shrink-0">Chapters:</span>
          {material.chapters.map((ch, idx) => (
            <Button
              key={idx}
              variant={activeChapterIndex === idx ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                setActiveChapterIndex(idx);
                const el = document.getElementById(`chapter-${idx}`);
                if (el) el.scrollIntoView({ behavior: "smooth" });
              }}
              className="h-7 text-xs px-2.5 shrink-0 rounded-lg"
            >
              Ch {idx + 1}
            </Button>
          ))}
        </div>
      </div>

      {/* 📖 A4 EDUCATIONAL PUBLICATION DOCUMENT PREVIEW */}
      <div className="bg-white text-slate-900 rounded-2xl shadow-xl border border-slate-200 p-6 md:p-12 font-sans select-text">
        {/* Document Header Bar */}
        <div className="border-b-2 border-indigo-500 pb-6 mb-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 bg-indigo-600 text-white font-bold text-xs rounded-md uppercase tracking-wider">
                STUDY MATERIAL
              </span>
              <span className="px-2.5 py-1 bg-slate-100 text-slate-700 font-semibold text-xs rounded-md border border-slate-200 uppercase">
                {material.language || "Unicode"}
              </span>
              {material.totalPages && (
                <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 font-semibold text-xs rounded-md border border-emerald-200">
                  {material.totalPages} Pages Covered
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <BookOpen className="h-3.5 w-3.5 text-indigo-500" />
                {material.chapters.length} Chapters
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3.5 w-3.5 text-indigo-500" />
                ~{material.estimated_read_time_minutes || 10} min revision
              </span>
            </div>
          </div>

          {/* Document Title */}
          {isEditing ? (
            <Input
              value={material.title}
              onChange={(e) => handleUpdate({ ...material, title: e.target.value })}
              className="text-2xl font-black text-slate-900 bg-slate-50 border-slate-300"
            />
          ) : (
            <h1 className="text-2xl md:text-4xl font-black tracking-tight text-slate-900 leading-tight">
              {material.title}
            </h1>
          )}

          {/* Document Subtitle */}
          <p className="text-sm md:text-base text-slate-600 mt-2 font-medium">
            {material.subtitle || "Complete Document Study Notes & Quick Revision Guide"}
          </p>

          {/* Source Document Tag */}
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-500">
            <span>Source Document:</span>
            <span className="font-semibold text-slate-800 truncate max-w-xs md:max-w-md">
              {material.pdf_name}
            </span>
          </div>
        </div>

        {/* Chapters Content Container */}
        <div className="space-y-12">
          {filteredChapters.map((ch, chIdx) => (
            <div key={chIdx} id={`chapter-${chIdx}`} className="space-y-6 pt-2">
              {/* Chapter Banner */}
              <div className="p-4 bg-gradient-to-r from-indigo-50 to-indigo-100/50 border-l-4 border-indigo-600 rounded-r-xl">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex-1 min-w-[240px]">
                    {isEditing ? (
                      <Input
                        value={ch.chapterTitle}
                        onChange={(e) => {
                          const newChapters = [...material.chapters];
                          newChapters[chIdx].chapterTitle = e.target.value;
                          handleUpdate({ ...material, chapters: newChapters });
                        }}
                        className="font-bold text-lg bg-white border-slate-300"
                      />
                    ) : (
                      <h2 className="text-xl md:text-2xl font-extrabold text-indigo-900">
                        {ch.chapterTitle}
                      </h2>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {ch.sourcePages && (
                      <Badge variant="outline" className="bg-white/80 text-indigo-800 text-xs font-semibold border-indigo-300">
                        {ch.sourcePages}
                      </Badge>
                    )}
                    <Badge className="bg-indigo-600 text-white font-bold text-xs">
                      Chapter {ch.chapterNumber}
                    </Badge>
                  </div>
                </div>

                {ch.summary && (
                  <p className="text-xs md:text-sm text-indigo-800 mt-2 italic leading-relaxed">
                    {ch.summary}
                  </p>
                )}
              </div>

              {/* Chapter Sections */}
              <div className="space-y-6 pl-1 md:pl-2">
                {ch.sections.map((sec, sIdx) => (
                  <div key={sec.id || sIdx} className="space-y-3">
                    {/* Section Title */}
                    <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
                      <div className="flex items-center gap-2">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            sec.type === "exam_points"
                              ? "bg-amber-500"
                              : sec.type === "quick_revision"
                              ? "bg-emerald-500"
                              : sec.type === "facts" || sec.type === "dates"
                              ? "bg-cyan-500"
                              : "bg-indigo-600"
                          }`}
                        />
                        <h3 className="font-bold text-base md:text-lg text-slate-800">
                          {sec.title}
                        </h3>
                      </div>

                      {sec.type === "exam_points" && (
                        <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] font-bold">
                          HIGH-YIELD EXAM FOCUS
                        </Badge>
                      )}
                      {sec.type === "quick_revision" && (
                        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] font-bold">
                          MEMORY REVISION
                        </Badge>
                      )}
                    </div>

                    {/* 1. Introduction Content */}
                    {sec.content && (
                      <p className="text-sm md:text-base text-slate-700 leading-relaxed pl-3 border-l-2 border-slate-300">
                        {sec.content}
                      </p>
                    )}

                    {/* 2. Exam Important Points (Golden/Amber Highlight Box) */}
                    {sec.type === "exam_points" && sec.items && (
                      <div className="space-y-2.5">
                        {sec.items.map((item, iIdx) => (
                          <div
                            key={iIdx}
                            className="p-3.5 bg-amber-50/80 border border-amber-300 rounded-xl flex items-start gap-3 shadow-xs"
                          >
                            <Star className="h-4 w-4 text-amber-600 shrink-0 mt-0.5 fill-amber-500" />
                            <p className="text-sm md:text-[15px] font-medium text-amber-950 leading-relaxed">
                              {item}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 3. Quick Revision (Arrow Key → Value Pairs) */}
                    {sec.type === "quick_revision" && sec.quickRevisionList && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {sec.quickRevisionList.map((qr, qIdx) => (
                          <div
                            key={qIdx}
                            className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-xl flex items-center justify-between gap-3"
                          >
                            <span className="font-extrabold text-emerald-900 text-sm">
                              {qr.key}
                            </span>
                            <ArrowRight className="h-4 w-4 text-emerald-600 shrink-0" />
                            <span className="font-semibold text-slate-800 text-xs md:text-sm text-right flex-1">
                              {qr.value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 4. Key Facts List */}
                    {sec.type === "facts" && sec.keyFactList && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {sec.keyFactList.map((f, fIdx) => (
                          <div
                            key={fIdx}
                            className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-2.5"
                          >
                            <span className="h-2 w-2 rounded-full bg-indigo-600 mt-1.5 shrink-0" />
                            <div className="text-xs md:text-sm">
                              <span className="font-bold text-slate-900 mr-1.5">{f.label}:</span>
                              <span className="text-slate-700">{f.value}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 5. Important Dates Timeline */}
                    {sec.type === "dates" && sec.dateList && (
                      <div className="space-y-2">
                        {sec.dateList.map((d, dIdx) => (
                          <div
                            key={dIdx}
                            className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3"
                          >
                            <span className="px-2.5 py-1 bg-sky-100 text-sky-800 font-extrabold text-xs rounded-md shrink-0 border border-sky-200">
                              {d.date}
                            </span>
                            <span className="text-xs md:text-sm text-slate-800 font-medium">
                              {d.event}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 6. Important People Cards */}
                    {sec.type === "people" && sec.peopleList && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {sec.peopleList.map((p, pIdx) => (
                          <div
                            key={pIdx}
                            className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1"
                          >
                            <div className="flex items-center gap-2">
                              <User className="h-4 w-4 text-indigo-600" />
                              <span className="font-bold text-slate-900 text-sm">{p.name}</span>
                              {p.role && (
                                <Badge variant="outline" className="text-[10px] py-0 h-4">
                                  {p.role}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-slate-600 pl-6 leading-relaxed">
                              {p.contribution}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 7. Definitions / Glossary Cards */}
                    {sec.type === "definitions" && sec.definitionList && (
                      <div className="space-y-2.5">
                        {sec.definitionList.map((def, defIdx) => (
                          <div
                            key={defIdx}
                            className="p-3.5 bg-purple-50/70 border border-purple-200 rounded-xl space-y-1"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-purple-900 text-sm">
                                📌 {def.term}
                              </span>
                            </div>
                            <p className="text-xs md:text-sm text-slate-700 leading-relaxed pl-5">
                              {def.definition}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 8. Structured Table */}
                    {sec.tableData && sec.tableData.headers && sec.tableData.rows && (
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full text-xs md:text-sm text-left">
                          <thead className="bg-indigo-50 border-b border-indigo-200 text-indigo-900 font-bold">
                            <tr>
                              {sec.tableData.headers.map((h, hIdx) => (
                                <th key={hIdx} className="p-3">
                                  {h}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {sec.tableData.rows.map((row, rIdx) => (
                              <tr
                                key={rIdx}
                                className={rIdx % 2 === 0 ? "bg-white" : "bg-slate-50"}
                              >
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx} className="p-3 text-slate-700">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* 9. Standard Bullet Points / Concepts */}
                    {sec.items && sec.type !== "exam_points" && (
                      <ul className="space-y-2 pl-2">
                        {sec.items.map((it, itIdx) => (
                          <li key={itIdx} className="flex items-start gap-2.5 text-sm text-slate-800 leading-relaxed">
                            <span className="h-1.5 w-1.5 rounded-full bg-indigo-600 mt-2 shrink-0" />
                            <span>{it}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Document Footer Note */}
        <div className="mt-12 pt-6 border-t border-slate-200 flex flex-wrap items-center justify-between text-xs text-slate-400">
          <span>QuizCrack AI Study Material Series • Educational Revision Document</span>
          <span>© {new Date().getFullYear()} QuizCrack. All rights reserved.</span>
        </div>
      </div>
    </div>
  );
}
