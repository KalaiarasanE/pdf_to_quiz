import { useMemo } from "react";
import { Star, ArrowRight, User, Table as TableIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  StudyMaterialData,
  StudyMaterialChapter,
  StudyMaterialSection,
  cleanDocumentTitle,
  isArtificialSubtitle,
} from "@/lib/study-material.types";

interface StudyMaterialDocumentProps {
  material: StudyMaterialData;
  chapters?: StudyMaterialChapter[];
  isEditing?: boolean;
  onUpdateMaterial?: (updated: StudyMaterialData) => void;
  id?: string;
  className?: string;
}

/**
 * Shared Design System Component for Study Material.
 * Used by BOTH the interactive Website Preview and the PDF Export engine,
 * guaranteeing 100% visual consistency in typography, spacing, colors, borders,
 * tables, cards, and Tamil Unicode rendering.
 */
export function StudyMaterialDocument({
  material,
  chapters,
  isEditing = false,
  onUpdateMaterial,
  id = "study-material-document-content",
  className = "",
}: StudyMaterialDocumentProps) {
  const displayChapters = chapters || material.chapters || [];
  const cleanTitle = useMemo(
    () => cleanDocumentTitle(material.title, displayChapters[0]?.chapterTitle),
    [material.title, displayChapters]
  );

  const handleUpdateTitle = (newTitle: string) => {
    if (onUpdateMaterial) {
      onUpdateMaterial({ ...material, title: newTitle });
    }
  };

  const handleUpdateChapterTitle = (chIdx: number, newTitle: string) => {
    if (onUpdateMaterial) {
      const updated = [...material.chapters];
      if (updated[chIdx]) {
        updated[chIdx] = { ...updated[chIdx], chapterTitle: newTitle };
        onUpdateMaterial({ ...material, chapters: updated });
      }
    }
  };

  return (
    <div
      id={id}
      className={`bg-white text-slate-900 rounded-2xl shadow-xl border border-slate-200 p-6 md:p-12 select-text ${className}`}
      style={{
        fontFamily:
          "'Noto Sans Tamil Local', 'Noto Sans Tamil', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      {/* 📖 DOCUMENT TITLE & ACCENT DIVIDER */}
      <div className="pdf-block border-b-2 border-indigo-600 pb-6 mb-8">
        {isEditing ? (
          <Input
            value={material.title}
            onChange={(e) => handleUpdateTitle(e.target.value)}
            className="text-2xl md:text-3xl font-black text-slate-900 bg-slate-50 border-slate-300"
          />
        ) : (
          <h1 className="text-2xl md:text-4xl font-black tracking-tight text-slate-900 leading-tight">
            {cleanTitle}
          </h1>
        )}

        {/* Subtitle if valid educational topic */}
        {material.subtitle && !isArtificialSubtitle(material.subtitle) && (
          <p className="text-sm md:text-base text-slate-600 mt-2 font-medium">
            {material.subtitle}
          </p>
        )}
      </div>

      {/* 📖 CHAPTERS & SECTIONS */}
      <div className="space-y-12">
        {displayChapters.map((ch, chIdx) => (
          <div
            key={ch.chapterNumber || chIdx}
            id={`chapter-${chIdx}`}
            className="chapter-container space-y-6 pt-2"
          >
            {/* Chapter Header Banner */}
            <div
              className="pdf-block p-4 bg-gradient-to-r from-indigo-50 via-indigo-50 to-indigo-100/60 border-l-4 border-indigo-600 rounded-r-xl shadow-2xs"
              style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex-1 min-w-[240px]">
                  {isEditing ? (
                    <Input
                      value={ch.chapterTitle}
                      onChange={(e) => handleUpdateChapterTitle(chIdx, e.target.value)}
                      className="font-bold text-lg bg-white border-slate-300"
                    />
                  ) : (
                    <h2 className="text-xl md:text-2xl font-black text-indigo-950">
                      {ch.chapterTitle}
                    </h2>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {ch.sourcePages && (
                    <Badge
                      variant="outline"
                      className="bg-white/90 text-indigo-800 text-xs font-semibold border-indigo-300 px-2.5 py-0.5"
                    >
                      {ch.sourcePages}
                    </Badge>
                  )}
                  <Badge className="bg-indigo-600 text-white font-bold text-xs px-2.5 py-0.5">
                    Chapter {ch.chapterNumber || chIdx + 1}
                  </Badge>
                </div>
              </div>

              {ch.summary && (
                <p className="text-xs md:text-sm text-indigo-900 mt-2 italic leading-relaxed font-normal">
                  {ch.summary}
                </p>
              )}
            </div>

            {/* Chapter Sections */}
            <div className="space-y-6 pl-1 md:pl-2">
              {ch.sections.map((sec, sIdx) => (
                <div
                  key={sec.id || sIdx}
                  className="pdf-block space-y-3 pt-2"
                  style={{ breakInside: "avoid", pageBreakInside: "avoid" }}
                >
                  {/* Section Title */}
                  <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`h-2.5 w-2.5 rounded-full shrink-0 ${
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
                      <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-[10px] font-bold">
                        HIGH-YIELD EXAM FOCUS
                      </Badge>
                    )}
                    {sec.type === "quick_revision" && (
                      <Badge className="bg-emerald-100 text-emerald-900 border-emerald-300 text-[10px] font-bold">
                        MEMORY REVISION
                      </Badge>
                    )}
                  </div>

                  {/* 1. Introduction Content */}
                  {sec.content && (
                    <p className="text-sm md:text-base text-slate-700 leading-relaxed pl-3 border-l-2 border-slate-300 font-normal">
                      {sec.content}
                    </p>
                  )}

                  {/* 2. Exam Important Points Box (Amber/Gold Card) */}
                  {sec.type === "exam_points" && sec.items && (
                    <div className="space-y-2.5">
                      {sec.items.map((item, iIdx) => (
                        <div
                          key={iIdx}
                          className="p-3.5 bg-amber-50/90 border border-amber-300 rounded-xl flex items-start gap-3 shadow-2xs"
                        >
                          <Star className="h-4 w-4 text-amber-600 shrink-0 mt-0.5 fill-amber-500" />
                          <p className="text-sm md:text-[15px] font-semibold text-amber-950 leading-relaxed">
                            {item}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 3. Quick Revision (Arrow pairs: Key → Value) */}
                  {sec.type === "quick_revision" && sec.quickRevisionList && (
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {sec.quickRevisionList.map((qr, qIdx) => (
                        <div
                          key={qIdx}
                          className="p-3 bg-emerald-50/90 border border-emerald-300 rounded-xl flex items-center justify-between gap-3 shadow-2xs"
                        >
                          <span className="font-extrabold text-emerald-950 text-sm">
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
                    <div className="grid gap-2.5 sm:grid-cols-2">
                      {sec.keyFactList.map((f, fIdx) => (
                        <div
                          key={fIdx}
                          className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start gap-2.5 shadow-2xs"
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
                          className="p-2.5 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-3 shadow-2xs"
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
                          className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1 shadow-2xs"
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
                          className="p-3.5 bg-purple-50/80 border border-purple-200 rounded-xl space-y-1 shadow-2xs"
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
                    <div className="overflow-x-auto rounded-xl border border-slate-200 shadow-2xs">
                      <table className="w-full text-xs md:text-sm text-left">
                        <thead className="bg-indigo-50 border-b border-indigo-200 text-indigo-950 font-bold">
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

                  {/* 9. Standard Bullet Points */}
                  {sec.items && sec.type !== "exam_points" && (
                    <ul className="space-y-2 pl-2">
                      {sec.items.map((it, itIdx) => (
                        <li
                          key={itIdx}
                          className="flex items-start gap-2.5 text-sm text-slate-800 leading-relaxed"
                        >
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
    </div>
  );
}
