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
  sections: StudyMaterialSection[];
}

export interface StudyMaterialData {
  id: string;
  pdf_name: string;
  title: string;
  subtitle?: string;
  language: string;
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
