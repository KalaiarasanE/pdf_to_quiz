export type StudyMaterialSectionType =
  | "introduction"
  | "concepts"
  | "points"
  | "facts"
  | "dates"
  | "people"
  | "definitions"
  | "examples"
  | "exam_points"
  | "quick_revision"
  | "table";

export interface KeyFactItem {
  label: string;
  value: string;
}

export interface ImportantDateItem {
  date: string;
  event: string;
  significance?: string;
}

export interface ImportantPersonItem {
  name: string;
  role: string;
  contribution: string;
}

export interface DefinitionItem {
  term: string;
  definition: string;
}

export interface QuickRevisionItem {
  key: string;
  value: string;
}

export interface TableData {
  headers: string[];
  rows: string[][];
}

export interface StudyMaterialSection {
  id: string;
  type: StudyMaterialSectionType;
  title: string;
  content?: string;
  items?: string[];
  keyFactList?: KeyFactItem[];
  dateList?: ImportantDateItem[];
  peopleList?: ImportantPersonItem[];
  definitionList?: DefinitionItem[];
  quickRevisionList?: QuickRevisionItem[];
  tableData?: TableData;
  highlight?: boolean;
}

export interface StudyMaterialChapter {
  chapterNumber: number;
  chapterTitle: string;
  summary?: string;
  sourcePages?: string;
  sections: StudyMaterialSection[];
}

export interface StudyMaterialData {
  id: string;
  pdf_name: string;
  title: string;
  subtitle?: string;
  language: string;
  totalPages?: number;
  created_at: string;
  chapters: StudyMaterialChapter[];
  total_points?: number;
  estimated_read_time_minutes?: number;
}

export interface StudyMaterialStreamProgress {
  stage: "analyzing" | "detecting_chapters" | "generating_chapter" | "finalizing" | "completed" | "error";
  message: string;
  currentChapter?: number;
  totalChapters?: number;
  chapterTitle?: string;
  completedChapters?: StudyMaterialChapter[];
  studyMaterial?: StudyMaterialData;
  error?: string;
}

/**
 * Checks if a section or chapter title indicates non-educational content
 * (e.g. copyright, legal disclaimer, usage guidelines, original document overview/preface).
 */
export function isNonEducationalSectionTitle(title: string): boolean {
  if (!title) return true;
  const t = title.trim().toLowerCase();

  const patterns = [
    /\bcopyright\b/i,
    /\busage\s*guidelines?\b/i,
    /\bterms\s*(and|&)\s*conditions\b/i,
    /\bterms\s*of\s*(use|service)\b/i,
    /\blegal\s*(disclaimer|notice)\b/i,
    /\bdisclaimer\b/i,
    /\bunauthorized\s*(reproduction|copying|distribution)\b/i,
    /\blicens(e|ing)(\s*information)?\b/i,
    /\bgovernment\s*ownership\b/i,
    /\b(website|platform|hosting|source)\s*info(rmation)?\b/i,
    /\bcontact\s*(info(rmation)?|us)\b/i,
    /\bfree\s*service\b/i,
    /\boverview\s*of\s*(this\s*)?(study\s*material|document|booklet|pdf)\b/i,
    /^overview$/i,
    /^preface$/i,
    /^acknowledgements?$/i,
    /^about\s*(this\s*(document|booklet|material|pdf)|us)$/i,
    /^curated\s*by/i,
    /^administrative\s*info(rmation)?/i,
  ];

  return patterns.some((p) => p.test(t));
}

/**
 * Checks if a specific text line/item contains non-educational administrative,
 * legal, copyright, platform info, or original document preface/overview boilerplate.
 */
export function isNonEducationalText(text: string): boolean {
  if (!text) return true;
  const t = text.trim();
  if (t.length === 0) return true;

  const patterns = [
    // 1. Copyright & reproduction notices
    /^(copyright\s*©?|©|\(c\))\s*\d{4}/i,
    /\bcopyright\s*(notice|and\s*usage|guidelines|policy)\b/i,
    /all\s*rights\s*(are\s*)?reserved/i,
    /unauthorized\s*(reproduction|copying|distribution|sharing|publication)\s*is\s*(strictly\s*)?prohibited/i,
    /no\s*part\s*of\s*this\s*(publication|book|document|material|pdf)\s*may\s*be\s*reproduced/i,
    /strictly\s*prohibited\s*without\s*(prior\s*)?permission/i,

    // 2. Legal / Terms / Disclaimers / Guidelines
    /copyright\s*and\s*usage\s*guidelines/i,
    /terms\s*(and|&)\s*conditions/i,
    /terms\s*of\s*(use|service)/i,
    /legal\s*disclaimer/i,
    /^disclaimer\s*[:—–-]/i,
    /licensing\s*information/i,
    /licensed\s*under\s*(creative\s*commons|gnu|mit|apache)/i,
    /government\s*ownership\s*(statement)?/i,

    // 3. Free service & administrative statements
    /this\s*(study\s*)?material\s*is\s*provided\s*(as\s*a\s*)?free\s*(service|of\s*cost)/i,
    /free\s*service\s*for\s*(all\s*)?(aspirants|students)/i,
    /not\s*for\s*sale\s*or\s*commercial\s*use/i,
    /free\s*study\s*material\s*provided\s*by/i,

    // 4. Contact & Platform / Hosting links
    /(website|platform|hosted\s*on|downloaded\s*from|source\s*document)\s*[:—–-]\s*(https?:\/\/|www\.)/i,
    /(for\s*more\s*(study\s*)?materials?\s*visit|visit\s*us\s*at)\s*[:—–-]?\s*(https?:\/\/|www\.)/i,
    /(contact\s*information|contact\s*us|helpline|email\s*id|phone\s*no)\s*[:—–-]/i,
    /join\s*(our\s*)?(official\s*)?telegram\s*channel/i,
    /follow\s*us\s*on\s*(instagram|youtube|facebook|twitter|x)/i,

    // 5. Original overview / preface / curated by
    /overview\s*of\s*(this\s*)?study\s*material/i,
    /this\s*study\s*material\s*is\s*(curated|prepared|developed|compiled)\s*by/i,
    /^curated\s*by\s*[:—–-]/i,
    /^about\s*this\s*(document|booklet|study\s*material)/i,
  ];

  return patterns.some((p) => p.test(t));
}

/**
 * Checks if a subtitle is an artificial cover boilerplate.
 */
export function isArtificialSubtitle(subtitle: string): boolean {
  if (!subtitle) return true;
  const s = subtitle.trim();
  if (s.length === 0) return true;

  const patterns = [
    /\d+\s*pages?\s*covered/i,
    /complete\s*document\s*study\s*notes/i,
    /generated\s*by/i,
    /quizcrack/i,
    /ai\s*study\s*material/i,
    /study\s*material\s*series/i,
    /overview\s*of\s*study\s*material/i,
  ];

  return patterns.some((p) => p.test(s));
}

/**
 * Cleans document title to ensure it is the real educational subject topic,
 * never artificial cover or file boilerplate.
 */
export function cleanDocumentTitle(title: string, fallbackSubject?: string): string {
  if (!title) return fallbackSubject || "Educational Study Notes";
  let clean = title.trim();

  // If title is artificial cover text, non-educational header, or generic
  if (
    isNonEducationalSectionTitle(clean) ||
    /^(study\s*material|untitled|document|pdf|study\s*notes)$/i.test(clean) ||
    /\d+\s*pages?\s*covered/i.test(clean) ||
    /study\s*material\s*(english|tamil|hindi|telugu)?/i.test(clean)
  ) {
    if (fallbackSubject && !isNonEducationalSectionTitle(fallbackSubject)) {
      return fallbackSubject.replace(/\.(pdf|docx?)$/i, "").replace(/[_-]/g, " ").trim();
    }
  }

  // Remove file extensions or raw separators
  clean = clean.replace(/\.(pdf|docx?)$/i, "").replace(/[_-]/g, " ").trim();
  return clean || fallbackSubject || "Educational Study Notes";
}

/**
 * Cleans and filters sections in a chapter to retain strictly educational content.
 */
export function filterEducationalSections(sections: StudyMaterialSection[]): StudyMaterialSection[] {
  if (!Array.isArray(sections)) return [];

  const filtered: StudyMaterialSection[] = [];

  for (const sec of sections) {
    if (!sec || isNonEducationalSectionTitle(sec.title)) {
      continue;
    }

    const cleanSec: StudyMaterialSection = {
      ...sec,
    };

    // Filter intro content if non-educational
    if (cleanSec.content && isNonEducationalText(cleanSec.content)) {
      cleanSec.content = undefined;
    }

    // Filter items
    if (Array.isArray(cleanSec.items)) {
      cleanSec.items = cleanSec.items.filter((it) => !isNonEducationalText(it));
    }

    // Filter key facts
    if (Array.isArray(cleanSec.keyFactList)) {
      cleanSec.keyFactList = cleanSec.keyFactList.filter(
        (f) =>
          !isNonEducationalText(f.label) &&
          !isNonEducationalText(f.value) &&
          !isNonEducationalSectionTitle(f.label),
      );
    }

    // Filter dates
    if (Array.isArray(cleanSec.dateList)) {
      cleanSec.dateList = cleanSec.dateList.filter(
        (d) => !isNonEducationalText(d.event) && !isNonEducationalText(d.date),
      );
    }

    // Filter people
    if (Array.isArray(cleanSec.peopleList)) {
      cleanSec.peopleList = cleanSec.peopleList.filter(
        (p) =>
          !isNonEducationalText(p.name) &&
          !isNonEducationalText(p.contribution) &&
          !isNonEducationalSectionTitle(p.name),
      );
    }

    // Filter definitions
    if (Array.isArray(cleanSec.definitionList)) {
      cleanSec.definitionList = cleanSec.definitionList.filter(
        (d) =>
          !isNonEducationalText(d.term) &&
          !isNonEducationalText(d.definition) &&
          !isNonEducationalSectionTitle(d.term),
      );
    }

    // Filter quick revisions
    if (Array.isArray(cleanSec.quickRevisionList)) {
      cleanSec.quickRevisionList = cleanSec.quickRevisionList.filter(
        (q) => !isNonEducationalText(q.key) && !isNonEducationalText(q.value),
      );
    }

    // Check if section still has valid educational content
    const hasItems = Array.isArray(cleanSec.items) && cleanSec.items.length > 0;
    const hasContent = typeof cleanSec.content === "string" && cleanSec.content.trim().length > 0;
    const hasKeyFacts = Array.isArray(cleanSec.keyFactList) && cleanSec.keyFactList.length > 0;
    const hasDates = Array.isArray(cleanSec.dateList) && cleanSec.dateList.length > 0;
    const hasPeople = Array.isArray(cleanSec.peopleList) && cleanSec.peopleList.length > 0;
    const hasDefs = Array.isArray(cleanSec.definitionList) && cleanSec.definitionList.length > 0;
    const hasQuickRev = Array.isArray(cleanSec.quickRevisionList) && cleanSec.quickRevisionList.length > 0;
    const hasTable =
      cleanSec.tableData &&
      Array.isArray(cleanSec.tableData.headers) &&
      Array.isArray(cleanSec.tableData.rows) &&
      cleanSec.tableData.rows.length > 0;

    if (
      hasItems ||
      hasContent ||
      hasKeyFacts ||
      hasDates ||
      hasPeople ||
      hasDefs ||
      hasQuickRev ||
      hasTable
    ) {
      filtered.push(cleanSec);
    }
  }

  return filtered;
}

/**
 * Cleans and filters an entire array of chapters, removing non-educational chapters
 * and renumbering remaining chapters sequentially.
 */
export function filterEducationalChapters(chapters: StudyMaterialChapter[]): StudyMaterialChapter[] {
  if (!Array.isArray(chapters)) return [];

  const validChapters: StudyMaterialChapter[] = [];

  for (const ch of chapters) {
    if (!ch) continue;

    // Filter sections first
    const educationalSections = filterEducationalSections(ch.sections || []);

    // If chapter title is non-educational and has no educational sections, skip it
    if (isNonEducationalSectionTitle(ch.chapterTitle) && educationalSections.length === 0) {
      continue;
    }

    // If no educational sections at all, skip
    if (educationalSections.length === 0) {
      continue;
    }

    // Clean summary
    let cleanSummary = ch.summary;
    if (cleanSummary && isNonEducationalText(cleanSummary)) {
      cleanSummary = undefined;
    }

    // Clean chapter title if it was non-educational
    let cleanChapterTitle = ch.chapterTitle;
    if (isNonEducationalSectionTitle(cleanChapterTitle)) {
      cleanChapterTitle = educationalSections[0]?.title || `Chapter ${validChapters.length + 1}`;
    }

    validChapters.push({
      ...ch,
      chapterNumber: validChapters.length + 1,
      chapterTitle: cleanChapterTitle,
      summary: cleanSummary,
      sections: educationalSections,
    });
  }

  return validChapters;
}
