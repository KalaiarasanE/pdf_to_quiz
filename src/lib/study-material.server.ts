import {
  StudyMaterialChapter,
  StudyMaterialData,
  StudyMaterialSection,
  StudyMaterialStreamProgress,
} from "./study-material.types";

export interface StudyMaterialConfig {
  text?: string;
  pageList?: { pageNum: number; text: string }[];
  totalPages?: number;
  pdfName: string;
  apiKey?: string;
  apiProvider?: "gemini" | "openai" | "lovable";
  modelName?: string;
  env?: any;
  selectedLanguage?: string;
}

interface PageChunk {
  chunkIndex: number;
  chapterNumber: number;
  sourcePagesLabel: string;
  text: string;
  pageCount: number;
}

export async function* generateStudyMaterialStream(
  config: StudyMaterialConfig,
): AsyncGenerator<StudyMaterialStreamProgress, void, unknown> {
  const {
    text = "",
    pageList = [],
    totalPages,
    pdfName,
    apiKey,
    apiProvider = "gemini",
    modelName,
    env,
    selectedLanguage,
  } = config;

  const serverGeminiKey =
    (env && typeof env === "object" && (env as any).GEMINI_API_KEY) || process.env.GEMINI_API_KEY;
  const serverOpenAIKey =
    (env && typeof env === "object" && (env as any).OPENAI_API_KEY) || process.env.OPENAI_API_KEY;
  const serverLovableKey =
    (env && typeof env === "object" && (env as any).LOVABLE_API_KEY) || process.env.LOVABLE_API_KEY;

  yield {
    stage: "analyzing",
    message: "Analyzing full document structure and extracting all page content...",
  };

  // 1. Prepare Page Chunks with Strict Full Document Coverage
  const chunks: PageChunk[] = [];

  if (pageList && pageList.length > 0) {
    const totalPagesCount = pageList.length;
    // Step size based on document length to ensure deep, exhaustive notes
    let step = 1;
    if (totalPagesCount > 40) step = 4;
    else if (totalPagesCount > 18) step = 3;
    else if (totalPagesCount > 6) step = 2;
    else step = 1; // 1 page per chunk for short documents (<=6 pages) for maximum detail

    let chunkIdx = 0;
    for (let p = 0; p < totalPagesCount; p += step) {
      const pageSlice = pageList.slice(p, p + step);
      const startPage = pageSlice[0].pageNum;
      const endPage = pageSlice[pageSlice.length - 1].pageNum;
      const sourcePagesLabel =
        startPage === endPage ? `Page ${startPage}` : `Pages ${startPage}–${endPage}`;

      const chunkText = pageSlice
        .map((page) => `--- [PAGE ${page.pageNum} OF ${totalPagesCount}] ---\n${page.text}`)
        .join("\n\n");

      // Only add chunk if it has extractable content
      if (chunkText.trim().length > 20) {
        chunkIdx++;
        chunks.push({
          chunkIndex: chunkIdx,
          chapterNumber: chunkIdx,
          sourcePagesLabel,
          text: chunkText,
          pageCount: pageSlice.length,
        });
      }
    }
  } else {
    // Break raw text by page markers or paragraph blocks (~3500 chars per chunk)
    const MAX_CHUNK_CHARS = 4000;
    const pageDelimiters = text.split(/(?:--- Page \d+ ---|\n\s*---\s*\n|\f)/i);

    if (pageDelimiters.length > 1) {
      let chunkIdx = 0;
      for (let i = 0; i < pageDelimiters.length; i++) {
        const pText = pageDelimiters[i].trim();
        if (pText.length > 30) {
          chunkIdx++;
          chunks.push({
            chunkIndex: chunkIdx,
            chapterNumber: chunkIdx,
            sourcePagesLabel: `Section ${chunkIdx}`,
            text: pText,
            pageCount: 1,
          });
        }
      }
    } else {
      const paragraphs = text.split(/\n\s*\n/);
      let currentChunkText = "";
      let chunkIdx = 0;

      for (const p of paragraphs) {
        if ((currentChunkText + "\n\n" + p).length > MAX_CHUNK_CHARS && currentChunkText.length > 0) {
          chunkIdx++;
          chunks.push({
            chunkIndex: chunkIdx,
            chapterNumber: chunkIdx,
            sourcePagesLabel: `Section ${chunkIdx}`,
            text: currentChunkText.trim(),
            pageCount: 1,
          });
          currentChunkText = p;
        } else {
          currentChunkText += (currentChunkText ? "\n\n" : "") + p;
        }
      }

      if (currentChunkText.trim()) {
        chunkIdx++;
        chunks.push({
          chunkIndex: chunkIdx,
          chapterNumber: chunkIdx,
          sourcePagesLabel: `Section ${chunkIdx}`,
          text: currentChunkText.trim(),
          pageCount: 1,
        });
      }
    }
  }

  // Fallback if no chunks generated
  if (chunks.length === 0) {
    chunks.push({
      chunkIndex: 1,
      chapterNumber: 1,
      sourcePagesLabel: "Complete Document",
      text: text || "Educational content",
      pageCount: totalPages || 1,
    });
  }

  const docTotalPages = totalPages || pageList.length || chunks.length;

  yield {
    stage: "detecting_chapters",
    message: `Identified ${docTotalPages} pages across ${chunks.length} structured chapters. Processing all content...`,
    totalChapters: chunks.length,
  };

  // Language instructions
  const languageInstruction =
    selectedLanguage && selectedLanguage === "Tanglish"
      ? `You MUST write the entire study material in Tanglish (Tamil language written phonetically using standard Latin/English alphabet). Rules for Tanglish: Do NOT use Tamil Unicode characters. Translate Tamil vocabulary and sentence structure into Latin letters phonetically (e.g., "India oda capital Delhi", "1773 la Regulating Act kondu vandhanga"). Maintain clear, natural, and standard Tanglish suitable for competitive exam revision.`
      : selectedLanguage && selectedLanguage !== "mixed"
      ? `You MUST write the entire study material in "${selectedLanguage}" language.`
      : `You MUST detect the primary language of the uploaded document (e.g., Tamil, English, Hindi, Telugu, etc.) and write the entire study material in the EXACT same language as the uploaded document. For example, if the document is in Tamil, output proper Tamil Unicode. Never translate unless the user explicitly requests translation. Use proper Unicode without corrupted characters.`;

  let globalDocTitle = pdfName.replace(/\.(pdf|docx?)$/i, "").replace(/[_-]/g, " ");
  const completedChaptersMap = new Map<number, StudyMaterialChapter>();

  // Process chunks sequentially or in parallel batches with maximum depth
  const concurrency = Math.min(3, chunks.length);
  let nextChunkIdx = 0;

  async function processChunk(chunk: PageChunk): Promise<{ chapter: StudyMaterialChapter; docTitle?: string }> {
    const systemPrompt = `You are a world-class educational author and competitive exam preparation expert (UPSC, TNPSC, SSC, State PSCs, University Exams).
Your mission is to transform raw PDF page content into comprehensive, high-yield, exam-oriented study material that students can rapidly study and revise.

CRITICAL FULL-PAGE COVERAGE RULES:
1. DO NOT summarize or compress this content into a brief 1-page summary.
2. The user has specifically requested FULL coverage of EVERY page in this document.
3. Read EVERY concept, theory, statutory act, constitutional article, historical event, formula, percentage, date, definition, and example on the provided page(s).
4. Convert all long paragraphs into structured, easy-to-read study points with subheadings.
5. PRESERVE 100% of all facts, dates, names, scientific terms, formulas, and definitions. ZERO content loss.
6. LANGUAGE RULE: ${languageInstruction}
7. STRUCTURE TO INCLUDE (Only include sections that are actually relevant to the content; DO NOT create empty sections):
   - "introduction": 2-3 sentence overview of this specific chapter/topic's significance.
   - "concepts": Key principles/theories broken down into structured bullet points with bold subheadings.
   - "points": Core factual points and analytical takeaways.
   - "facts": Specific data points, numbers, statistics, constitutional articles, or scientific values.
   - "dates": Chronological timeline of important dates & historical milestones (with date and event description).
   - "people": Important personalities, authors, scientists, leaders with their key contribution.
   - "definitions": Concise technical / conceptual definitions.
   - "examples": Practical illustrations and examples mentioned in the text.
   - "exam_points": HIGHEST PRIORITY exam-oriented points, high-yield traps, and memory cues.
   - "quick_revision": Rapid memory trigger pairs in format (Key → Quick Fact/Significance), e.g. "1773 → Regulating Act enacted".
   - "table": If comparative or classified information exists (e.g. differences, categories, schedules), include a structured table.

OUTPUT FORMAT:
Return STRICT JSON ONLY. No markdown wrappers (\`\`\`json), no commentary.

The JSON MUST conform to this exact schema:
{
  "documentTitle": "Main Title of the Complete Study Material",
  "chapterTitle": "Specific Chapter/Topic Title for ${chunk.sourcePagesLabel}",
  "summary": "1-2 line concise summary of this chapter",
  "sections": [
    {
      "id": "sec-1",
      "type": "introduction" | "concepts" | "points" | "facts" | "dates" | "people" | "definitions" | "examples" | "exam_points" | "quick_revision" | "table",
      "title": "Section Heading (e.g. முக்கிய கருத்துக்கள் / Important Concepts)",
      "content": "Short text if type is introduction",
      "items": ["Point 1", "Point 2", "Point 3"],
      "keyFactList": [{"label": "Fact Label", "value": "Fact detail"}],
      "dateList": [{"date": "Year/Date", "event": "Milestone event description"}],
      "peopleList": [{"name": "Person Name", "role": "Title/Role", "contribution": "Key contribution"}],
      "definitionList": [{"term": "Term Name", "definition": "Clear concise definition"}],
      "quickRevisionList": [{"key": "1773", "value": "Regulating Act enacted"}],
      "tableData": {
        "headers": ["Col 1", "Col 2", "Col 3"],
        "rows": [["Val 1", "Val 2", "Val 3"]]
      }
    }
  ]
}`;

    const prompt = `Process and convert all educational content from ${chunk.sourcePagesLabel} (Part ${chunk.chapterNumber} of ${chunks.length}) into comprehensive, high-yield study material:

"""
${chunk.text}
"""`;

    let chapterData: any = null;

    try {
      const rawResponse = await callAiModel({
        systemPrompt,
        prompt,
        apiKey,
        apiProvider,
        modelName,
        serverGeminiKey,
        serverOpenAIKey,
        serverLovableKey,
      });

      const cleanJson = extractJson(rawResponse);
      chapterData = JSON.parse(cleanJson);
    } catch (err) {
      console.error(`AI call failed for chapter ${chunk.chapterNumber}:`, err);
      chapterData = createFallbackChapter(chunk.text, chunk.chapterNumber, globalDocTitle, chunk.sourcePagesLabel);
    }

    const validatedChapter: StudyMaterialChapter = {
      chapterNumber: chunk.chapterNumber,
      chapterTitle:
        chapterData?.chapterTitle ||
        `Chapter ${chunk.chapterNumber}: ${chunk.sourcePagesLabel} Notes`,
      summary: chapterData?.summary || "",
      sourcePages: chunk.sourcePagesLabel,
      sections:
        Array.isArray(chapterData?.sections) && chapterData.sections.length > 0
          ? chapterData.sections.filter((s: any) => isValidSection(s))
          : createFallbackChapter(chunk.text, chunk.chapterNumber, globalDocTitle, chunk.sourcePagesLabel).sections,
    };

    return {
      chapter: validatedChapter,
      docTitle: chapterData?.documentTitle,
    };
  }

  // Execute processing with live streaming updates
  while (nextChunkIdx < chunks.length) {
    const batchSize = Math.min(concurrency, chunks.length - nextChunkIdx);
    const currentBatch = chunks.slice(nextChunkIdx, nextChunkIdx + batchSize);
    nextChunkIdx += batchSize;

    yield {
      stage: "generating_chapter",
      message: `Creating Study Material for ${currentBatch.map((c) => c.sourcePagesLabel).join(", ")}...`,
      currentChapter: currentBatch[0].chapterNumber,
      totalChapters: chunks.length,
      completedChapters: Array.from(completedChaptersMap.values()),
    };

    const results = await Promise.all(currentBatch.map((c) => processChunk(c)));

    for (let r = 0; r < results.length; r++) {
      const { chapter, docTitle } = results[r];
      if (docTitle && globalDocTitle === pdfName.replace(/\.(pdf|docx?)$/i, "").replace(/[_-]/g, " ")) {
        globalDocTitle = docTitle;
      }
      completedChaptersMap.set(chapter.chapterNumber, chapter);

      // Count study points in this chapter
      let chapterPoints = 0;
      for (const sec of chapter.sections) {
        if (sec.items) chapterPoints += sec.items.length;
        if (sec.keyFactList) chapterPoints += sec.keyFactList.length;
        if (sec.dateList) chapterPoints += sec.dateList.length;
        if (sec.definitionList) chapterPoints += sec.definitionList.length;
        if (sec.quickRevisionList) chapterPoints += sec.quickRevisionList.length;
      }

      yield {
        stage: "generating_chapter",
        message: `✓ Chapter ${chapter.chapterNumber} (${chapter.sourcePages || `Part ${chapter.chapterNumber}`}): ${chapter.chapterTitle} completed (${chapterPoints} points)`,
        currentChapter: chapter.chapterNumber,
        totalChapters: chunks.length,
        chapterTitle: chapter.chapterTitle,
        completedChapters: Array.from(completedChaptersMap.values()),
      };
    }
  }

  // Sort chapters chronologically
  const finalChapters = Array.from(completedChaptersMap.values()).sort(
    (a, b) => a.chapterNumber - b.chapterNumber,
  );

  yield {
    stage: "finalizing",
    message: `Finalizing complete Study Material covering all ${docTotalPages} pages...`,
    completedChapters: finalChapters,
  };

  // Calculate total points and read time
  let totalPointsCount = 0;
  for (const ch of finalChapters) {
    for (const sec of ch.sections) {
      if (sec.items) totalPointsCount += sec.items.length;
      if (sec.keyFactList) totalPointsCount += sec.keyFactList.length;
      if (sec.dateList) totalPointsCount += sec.dateList.length;
      if (sec.peopleList) totalPointsCount += sec.peopleList.length;
      if (sec.definitionList) totalPointsCount += sec.definitionList.length;
      if (sec.quickRevisionList) totalPointsCount += sec.quickRevisionList.length;
      if (sec.tableData) totalPointsCount += sec.tableData.rows.length;
    }
  }

  const estimatedReadTime = Math.max(2, Math.round(totalPointsCount * 0.35));

  const finalMaterial: StudyMaterialData = {
    id: Math.random().toString(36).substring(2, 9),
    pdf_name: pdfName,
    title: globalDocTitle,
    subtitle: `Complete Document Study Notes & Quick Revision Guide (${docTotalPages} Pages Covered)`,
    language: selectedLanguage || "Auto",
    totalPages: docTotalPages,
    created_at: new Date().toISOString(),
    chapters: finalChapters,
    total_points: totalPointsCount,
    estimated_read_time_minutes: estimatedReadTime,
  };

  yield {
    stage: "completed",
    message: `Completed! Processed all ${docTotalPages} pages into ${finalChapters.length} comprehensive chapters (${totalPointsCount} study points).`,
    completedChapters: finalChapters,
    studyMaterial: finalMaterial,
  };
}

async function callAiModel({
  systemPrompt,
  prompt,
  apiKey,
  apiProvider = "gemini",
  modelName,
  serverGeminiKey,
  serverOpenAIKey,
  serverLovableKey,
}: {
  systemPrompt: string;
  prompt: string;
  apiKey?: string;
  apiProvider?: "gemini" | "openai" | "lovable";
  modelName?: string;
  serverGeminiKey?: string;
  serverOpenAIKey?: string;
  serverLovableKey?: string;
}): Promise<string> {
  if (apiProvider === "gemini") {
    const key = apiKey || serverGeminiKey;
    if (!key) throw new Error("Missing Gemini API Key");
    const model = modelName || "gemini-3.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: `${systemPrompt}\n\n${prompt}` }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else if (apiProvider === "openai") {
    const key = apiKey || serverOpenAIKey;
    if (!key) throw new Error("Missing OpenAI API Key");
    const model = modelName || "gpt-4o-mini";
    const url = "https://api.openai.com/v1/chat/completions";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  } else {
    // Lovable gateway
    const key = serverLovableKey;
    if (!key) throw new Error("Missing Lovable API Key");
    const url = "https://ai.gateway.lovable.dev/v1/chat/completions";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": key,
      },
      body: JSON.stringify({
        model: "google/gemini-3.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Lovable API error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }
}

function isValidSection(sec: any): boolean {
  if (!sec || typeof sec !== "object" || !sec.title) return false;
  const hasItems = Array.isArray(sec.items) && sec.items.length > 0;
  const hasContent = typeof sec.content === "string" && sec.content.trim().length > 0;
  const hasKeyFacts = Array.isArray(sec.keyFactList) && sec.keyFactList.length > 0;
  const hasDates = Array.isArray(sec.dateList) && sec.dateList.length > 0;
  const hasPeople = Array.isArray(sec.peopleList) && sec.peopleList.length > 0;
  const hasDefs = Array.isArray(sec.definitionList) && sec.definitionList.length > 0;
  const hasQuickRev = Array.isArray(sec.quickRevisionList) && sec.quickRevisionList.length > 0;
  const hasTable =
    sec.tableData &&
    Array.isArray(sec.tableData.headers) &&
    Array.isArray(sec.tableData.rows) &&
    sec.tableData.rows.length > 0;

  return (
    hasItems ||
    hasContent ||
    hasKeyFacts ||
    hasDates ||
    hasPeople ||
    hasDefs ||
    hasQuickRev ||
    hasTable
  );
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

function createFallbackChapter(
  chunkText: string,
  chapterNum: number,
  docTitle: string,
  sourcePagesLabel: string = `Chapter ${chapterNum}`,
): StudyMaterialChapter {
  const lines = chunkText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 20 && !l.startsWith("---"));
  const samplePoints = lines.slice(0, 10);

  return {
    chapterNumber: chapterNum,
    chapterTitle: `Chapter ${chapterNum}: ${docTitle} (${sourcePagesLabel})`,
    summary: `Comprehensive study points extracted for ${sourcePagesLabel}.`,
    sourcePages: sourcePagesLabel,
    sections: [
      {
        id: `sec-${chapterNum}-1`,
        type: "concepts",
        title: "Important Concepts & Theory",
        items:
          samplePoints.length > 0
            ? samplePoints
            : ["Key educational takeaway points extracted for revision."],
      },
      {
        id: `sec-${chapterNum}-2`,
        type: "exam_points",
        title: "Exam Important Points",
        items: samplePoints.slice(0, 5).map((p) => `High-Yield Point: ${p}`),
        highlight: true,
      },
    ],
  };
}
