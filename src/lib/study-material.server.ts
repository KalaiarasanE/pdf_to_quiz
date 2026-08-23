import { StudyMaterialChapter, StudyMaterialData, StudyMaterialSection, StudyMaterialStreamProgress } from "./study-material.types";

export interface StudyMaterialConfig {
  text: string;
  pdfName: string;
  apiKey?: string;
  apiProvider?: "gemini" | "openai" | "lovable";
  modelName?: string;
  env?: any;
  selectedLanguage?: string;
}

export async function* generateStudyMaterialStream(
  config: StudyMaterialConfig
): AsyncGenerator<StudyMaterialStreamProgress, void, unknown> {
  const {
    text,
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
    message: "AI analyzing complete document structure and concepts...",
  };

  // Language instructions
  const languageInstruction =
    selectedLanguage && selectedLanguage === "Tanglish"
      ? `You MUST write the entire study material in Tanglish (Tamil language written phonetically using standard Latin/English alphabet). Rules for Tanglish: Do NOT use Tamil Unicode characters. Translate Tamil vocabulary and sentence structure into Latin letters phonetically (e.g., "India oda capital Delhi", "1773 la Regulating Act kondu vandhanga"). Maintain clear, natural, and standard Tanglish suitable for competitive exam revision.`
      : selectedLanguage && selectedLanguage !== "mixed"
      ? `You MUST write the entire study material in "${selectedLanguage}" language.`
      : `You MUST detect the primary language of the uploaded document (e.g., Tamil, English, Hindi, Telugu, etc.) and write the entire study material in the EXACT same language as the uploaded document. For example, if the document is in Tamil, output Tamil Unicode. Never translate unless the user explicitly requests translation. Use proper Unicode without corrupted characters.` ;

  // Split text into chunks if very large (e.g. > 45000 chars)
  const MAX_CHUNK_CHARS = 45000;
  const chunks: string[] = [];
  
  if (text.length <= MAX_CHUNK_CHARS) {
    chunks.push(text);
  } else {
    // Break by double newlines or pages
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = "";
    for (const p of paragraphs) {
      if ((currentChunk + "\n\n" + p).length > MAX_CHUNK_CHARS && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());
        currentChunk = p;
      } else {
        currentChunk += (currentChunk ? "\n\n" : "") + p;
      }
    }
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }
  }

  yield {
    stage: "detecting_chapters",
    message: `Identified ${chunks.length > 1 ? `${chunks.length} major sections` : "document content"}. Extracting structured notes...`,
    totalChapters: chunks.length,
  };

  const completedChapters: StudyMaterialChapter[] = [];
  let globalDocTitle = pdfName.replace(/\.(pdf|docx?)$/i, "").replace(/[_-]/g, " ");

  for (let i = 0; i < chunks.length; i++) {
    const chunkText = chunks[i];
    const chapterNum = i + 1;

    yield {
      stage: "generating_chapter",
      message: `Creating Study Material for ${chunks.length > 1 ? `Chapter ${chapterNum}` : "document"}...`,
      currentChapter: chapterNum,
      totalChapters: chunks.length,
      completedChapters: [...completedChapters],
    };

    const systemPrompt = `You are a world-class educational author and competitive exam preparation expert (UPSC, TNPSC, SSC, State PSCs).
Your mission is to transform raw PDF theory text into concise, high-yield, exam-oriented study material that students can rapidly read and revise.

CRITICAL RULES:
1. DO NOT summarize into long paragraphs.
2. Convert all content into short points, bullet points, numbered subpoints, key facts, highlight definitions, important dates, key personalities, and rapid-revision pairs.
3. LANGUAGE RULE: ${languageInstruction}
4. DO NOT invent facts, outside details, or hallucinate. Use ONLY facts directly provided in the text.
5. PRESERVE all dates, numbers, statutory acts, names, scientific terms, formulas, and percentages with 100% accuracy.
6. STRUCTURE TO INCLUDE (Only include sections that are actually relevant to the content; DO NOT create empty sections):
   - "introduction": Short 2-3 sentence overview of topic significance.
   - "concepts": Key principles/theories broken down into structured bullet points with subheadings.
   - "points": Core factual points and analytical takeaways.
   - "facts": Key facts, numbers, statistics, constitutional articles, or scientific values.
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
  "documentTitle": "Main Title of the Study Material",
  "chapterTitle": "Chapter or Section Title",
  "summary": "1-2 line concise summary",
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

    const prompt = `Analyze this text content (Part ${chapterNum} of ${chunks.length}) and generate structured, exam-oriented study material:

"""
${chunkText}
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
      console.error(`AI call failed for chapter ${chapterNum}:`, err);
      // Fallback: create a basic structured chapter from the text if AI fails
      chapterData = createFallbackChapter(chunkText, chapterNum, globalDocTitle);
    }

    if (chapterData) {
      if (chapterData.documentTitle && i === 0) {
        globalDocTitle = chapterData.documentTitle;
      }

      const validatedChapter: StudyMaterialChapter = {
        chapterNumber: chapterNum,
        chapterTitle: chapterData.chapterTitle || `Chapter ${chapterNum}: ${globalDocTitle}`,
        summary: chapterData.summary || "",
        sections: Array.isArray(chapterData.sections)
          ? chapterData.sections.filter((s: any) => isValidSection(s))
          : [],
      };

      // Ensure at least one section exists
      if (validatedChapter.sections.length === 0) {
        validatedChapter.sections = createFallbackChapter(chunkText, chapterNum, globalDocTitle).sections;
      }

      completedChapters.push(validatedChapter);

      yield {
        stage: "generating_chapter",
        message: `✓ Chapter ${chapterNum} completed (${validatedChapter.sections.length} sections created)`,
        currentChapter: chapterNum,
        totalChapters: chunks.length,
        chapterTitle: validatedChapter.chapterTitle,
        completedChapters: [...completedChapters],
      };
    }
  }

  yield {
    stage: "finalizing",
    message: "Generating Final Study Material...",
    completedChapters,
  };

  // Calculate total points and read time
  let totalPointsCount = 0;
  for (const ch of completedChapters) {
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

  const estimatedReadTime = Math.max(2, Math.round(totalPointsCount * 0.4));

  const finalMaterial: StudyMaterialData = {
    id: Math.random().toString(36).substring(2, 9),
    pdf_name: pdfName,
    title: globalDocTitle,
    subtitle: `Exam-Oriented Study Notes & Quick Revision Guide`,
    language: selectedLanguage || "Auto",
    created_at: new Date().toISOString(),
    chapters: completedChapters,
    total_points: totalPointsCount,
    estimated_read_time_minutes: estimatedReadTime,
  };

  yield {
    stage: "completed",
    message: "Completed.",
    completedChapters,
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
  const hasTable = sec.tableData && Array.isArray(sec.tableData.headers) && Array.isArray(sec.tableData.rows) && sec.tableData.rows.length > 0;

  return hasItems || hasContent || hasKeyFacts || hasDates || hasPeople || hasDefs || hasQuickRev || hasTable;
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}

function createFallbackChapter(chunkText: string, chapterNum: number, docTitle: string): StudyMaterialChapter {
  const lines = chunkText.split("\n").map((l) => l.trim()).filter((l) => l.length > 20);
  const samplePoints = lines.slice(0, 8);

  return {
    chapterNumber: chapterNum,
    chapterTitle: `Chapter ${chapterNum}: ${docTitle}`,
    summary: "Key concepts extracted from the uploaded document.",
    sections: [
      {
        id: `sec-${chapterNum}-1`,
        type: "concepts",
        title: "Important Concepts",
        items: samplePoints.length > 0 ? samplePoints : ["Content extraction summary for revision."],
      },
      {
        id: `sec-${chapterNum}-2`,
        type: "exam_points",
        title: "Exam Important Points",
        items: samplePoints.slice(0, 4).map((p) => `Important: ${p}`),
        highlight: true,
      },
    ],
  };
}
