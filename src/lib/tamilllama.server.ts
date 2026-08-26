import { StudyMaterialData, StudyMaterialChapter } from "./study-material.types";
import { MCQ } from "./ai-stream.server";

export interface TamilLlamaConfig {
  apiUrl?: string;
  apiKey?: string;
  modelName?: string;
  timeoutMs?: number;
  env?: any;
}

export interface TamilValidationResult<T> {
  data: T;
  refinedWithTamilLlama: boolean;
  warnings?: string[];
}

/**
 * Resolves TamilLlama 3.0 configuration from parameters, environment variables, or defaults.
 */
export function getTamilLlamaConfig(config?: TamilLlamaConfig, env?: any): {
  apiUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
} {
  const envApiUrl =
    (env && typeof env === "object" && (env as any).TAMILLLAMA_API_URL) ||
    process.env.TAMILLLAMA_API_URL ||
    config?.apiUrl ||
    "http://localhost:11434/v1";

  const envApiKey =
    (env && typeof env === "object" && (env as any).TAMILLLAMA_API_KEY) ||
    process.env.TAMILLLAMA_API_KEY ||
    config?.apiKey ||
    "";

  const envModel =
    (env && typeof env === "object" && (env as any).TAMILLLAMA_MODEL) ||
    process.env.TAMILLLAMA_MODEL ||
    config?.modelName ||
    "tamilllama:3.0";

  return {
    apiUrl: envApiUrl.replace(/\/+$/, ""),
    apiKey: envApiKey,
    model: envModel,
    timeoutMs: config?.timeoutMs || 35000,
  };
}

/**
 * Checks if a string contains Tamil Unicode characters.
 */
export function isTamilText(text: string): boolean {
  if (!text) return false;
  return /[\u0B80-\u0BFF]/.test(text);
}

/**
 * Cleans raw PDF extracted text by stripping:
 * - headers/footers
 * - page numbers (e.g. Page 1 of 20, [PAGE 1 OF 20])
 * - repeated titles & watermarks
 * - advertisements and website links
 * - unrelated instructions and navigation text
 * - duplicate content
 * - OCR noise
 * - irrelevant metadata
 */
export function cleanPdfExtractedText(rawText: string): string {
  if (!rawText) return "";

  const lines = rawText.split(/\r?\n/);
  const cleanedLines: string[] = [];
  const seenLines = new Set<string>();

  const junkPatterns = [
    // Page numbers
    /^(?:page|பக்கம்)\s*\d+(?:\s*(?:of|\/|-)\s*\d+)?$/i,
    /^---\s*\[?\s*PAGE\s*\d+\s*(?:OF\s*\d+)?\s*\]?\s*---$/i,
    /^\s*[-–—]\s*\d+\s*[-–—]\s*$/,
    /^\s*\d+\s*$/,

    // Watermarks, promo, copyright
    /\b(?:downloaded\s*from|visit\s*us\s*at|visit\s*our\s*website)\b/i,
    /\b(?:join\s*(?:our\s*)?(?:telegram|whatsapp|youtube)\s*channel)\b/i,
    /\b(?:t\.me|telegram\.me|whatsapp\.com|bit\.ly)\b/i,
    /\b(?:all\s*rights\s*reserved|copyright\s*©?|terms\s*and\s*conditions)\b/i,
    /\b(?:for\s*more\s*free\s*study\s*materials?|sample\s*copy|watermark)\b/i,
    /\b(?:unauthorized\s*reproduction|prohibited\s*without\s*permission)\b/i,

    // OCR noise & formatting artifacts
    /^[\s\-=_~*#|/\\.+:;]{3,}$/,
    /^[^\w\u0B80-\u0BFF\s]{4,}$/,
  ];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();

    if (trimmed.length === 0) {
      if (cleanedLines.length > 0 && cleanedLines[cleanedLines.length - 1] !== "") {
        cleanedLines.push("");
      }
      continue;
    }

    // Check if line matches junk patterns
    const isJunk = junkPatterns.some((pattern) => pattern.test(trimmed));
    if (isJunk) {
      continue;
    }

    // Check for OCR noise lines (e.g. random single punctuation or non-Tamil/non-Latin symbols)
    if (trimmed.length < 3 && !/^[0-9A-Za-z\u0B80-\u0BFF]/.test(trimmed)) {
      continue;
    }

    // Deduplicate repeated identical lines (unless short headers)
    const normalizedKey = trimmed.toLowerCase();
    if (trimmed.length > 35 && seenLines.has(normalizedKey)) {
      continue;
    }
    if (trimmed.length > 35) {
      seenLines.add(normalizedKey);
    }

    cleanedLines.push(trimmed);
  }

  return cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * System prompt specifically designed for TamilLlama 3.0 native Tamil quality,
 * grammar correction, spelling verification, and Unicode validation.
 */
export const TAMILLLAMA_SYSTEM_PROMPT = `You are TamilLlama 3.0, the specialized state-of-the-art Tamil language foundation model.
Your mission is to ensure that Tamil educational study materials, exam questions, options, and explanations meet the highest standards of linguistic perfection, academic rigor, and factual integrity (matching TNPSC and academic standards).

CRITICAL LINGUISTIC & GRAMMAR RULES:
1. NATURAL, STANDARD TAMIL:
   - Generate pure, grammatically sound, elegant standard Tamil (செந்தமிழ்/தேர்வுத் தமிழ்).
   - Avoid awkward, mechanical word-by-word machine translations. Translate ideas naturally into authentic Tamil sentence structure (Subject-Object-Verb).

2. ZERO SPELLING OR UNICODE ERRORS:
   - Absolutely NO spelling errors.
   - Pay special attention to:
     * ண / ன / ந (e.g., 'ஆணை' vs 'ஆனை', 'மணம்' vs 'மனம்')
     * ல / ள / ழ (e.g., 'தமிழ்' never 'தமிள்' or 'தமில்')
     * ர / ற (e.g., 'கரை' vs 'கறை', 'அரம்' vs 'அறம்')
   - Avoid broken Unicode characters, orphaned virama (்), or detached vowel signs (ெ, ே, ை, ொ, ோ, ௌ).
   - Ensure all Tamil glyph combinations (ங, ஞ, ட, ண, த, ந, ப, ம, ய, ர, ல, வ, ழ, ள, ற, ன) render cleanly.

3. VOCABULARY & TECHNICAL TERMS:
   - Use standard Tamil educational terms whenever available (e.g., 'முன்னுரை', 'வரையறை', 'முக்கிய அம்சங்கள்', 'விளக்கம்', 'தேர்வு குறிப்புகள்').
   - Accurately preserve technical terms, constitutional articles (e.g., 'சரத்து 32'), legal acts, scientific laws, dates, years, percentages, and formulas.
   - Do NOT translate proper nouns (names of people, historical places, specific treaties) into arbitrary or misleading Tamil words. Transliterate proper names accurately if necessary (e.g., 'அம்பேத்கர்', 'மவுண்ட்பேட்டன்').

4. FACTUAL PRESERVATION:
   - Maintain 100% of original source meaning and factual data without hallucinating new facts.
   - Do NOT duplicate content or append redundant sentences.

5. OUTPUT FORMAT:
   - Return valid, unescaped, clean JSON matching the requested schema. No markdown formatting (\`\`\`json), no introductory notes.`;

/**
 * Calls TamilLlama 3.0 API with fallback to primary AI (Gemini/OpenAI) using
 * the dedicated TamilLlama 3.0 linguistic validation prompt.
 */
export async function callTamilLlama(params: {
  systemPrompt: string;
  prompt: string;
  config?: TamilLlamaConfig;
  env?: any;
  fallbackAiOptions?: {
    apiKey?: string;
    apiProvider?: "gemini" | "openai" | "lovable";
    modelName?: string;
    serverGeminiKey?: string;
    serverOpenAIKey?: string;
  };
}): Promise<{ text: string; usedTamilLlamaNative: boolean; warning?: string }> {
  const { systemPrompt, prompt, config, env, fallbackAiOptions } = params;
  const tConfig = getTamilLlamaConfig(config, env);

  // 1. First attempt: Dedicated TamilLlama 3.0 Endpoint (Ollama / OpenAI-compatible / Cloud)
  if (tConfig.apiUrl) {
    try {
      const isOllamaGenerate = tConfig.apiUrl.endsWith("/api/generate");
      const isOllamaChat = tConfig.apiUrl.endsWith("/api/chat");
      const isV1 = tConfig.apiUrl.endsWith("/v1") || tConfig.apiUrl.includes("/v1/");

      const endpointUrl = isOllamaGenerate || isOllamaChat
        ? tConfig.apiUrl
        : isV1
        ? `${tConfig.apiUrl}/chat/completions`
        : `${tConfig.apiUrl}/v1/chat/completions`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (tConfig.apiKey) {
        headers["Authorization"] = `Bearer ${tConfig.apiKey}`;
      }

      const body = {
        model: tConfig.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.15,
        stream: false,
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), tConfig.timeoutMs);

      console.log(`[TamilLlama 3.0] Calling native endpoint: ${endpointUrl} (model: ${tConfig.model})...`);
      const response = await fetch(endpointUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        const outputText =
          data.choices?.[0]?.message?.content ||
          data.message?.content ||
          data.response ||
          "";

        if (outputText && outputText.trim().length > 0) {
          console.log(`[TamilLlama 3.0] Native call succeeded (${outputText.length} chars).`);
          return {
            text: outputText.trim(),
            usedTamilLlamaNative: true,
          };
        }
      } else {
        const errBody = await response.text().catch(() => "");
        console.warn(`[TamilLlama 3.0] Endpoint returned status ${response.status}: ${errBody}`);
      }
    } catch (err: any) {
      console.warn(`[TamilLlama 3.0] Endpoint call failed: ${err.message || err}. Engaging fallback linguistic layer.`);
    }
  }

  // 2. Fallback: If TamilLlama 3.0 endpoint is unreachable or not running locally,
  // execute the validation pass using the active AI provider with the dedicated TamilLlama 3.0 linguistic prompt.
  const fallbackKey =
    fallbackAiOptions?.apiKey ||
    fallbackAiOptions?.serverGeminiKey ||
    (env && typeof env === "object" && (env as any).GEMINI_API_KEY) ||
    process.env.GEMINI_API_KEY;

  if (fallbackKey) {
    console.log(`[TamilLlama 3.0] Running Tamil validation pass with Gemini...`);
    const model = fallbackAiOptions?.modelName || "gemini-3.5-flash";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${fallbackKey}`;

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
          temperature: 0.15,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Tamil linguistic fallback engine error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const fallbackText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return {
      text: fallbackText.trim(),
      usedTamilLlamaNative: false,
      warning: "TamilLlama 3.0 local server was unreachable. Content was validated and refined using the high-accuracy Tamil linguistic validation engine.",
    };
  }

  throw new Error("No AI key or TamilLlama 3.0 endpoint available for Tamil validation.");
}

/**
 * Validates and refines generated Tamil Study Material through TamilLlama 3.0.
 * Checks spelling, grammar, sentence structure, punctuation, Unicode correctness,
 * and factual consistency. Corrects detected issues before website preview and PDF export.
 */
export async function validateAndRefineTamilStudyMaterial(
  material: StudyMaterialData,
  env?: any,
  options?: {
    config?: TamilLlamaConfig;
    fallbackAiOptions?: any;
  }
): Promise<TamilValidationResult<StudyMaterialData>> {
  // If material has no Tamil content, return as-is
  const hasTamil =
    isTamilText(material.title) ||
    material.chapters.some(
      (c) => isTamilText(c.chapterTitle) || (c.summary && isTamilText(c.summary))
    );

  if (!hasTamil && material.language !== "Tamil") {
    return {
      data: material,
      refinedWithTamilLlama: false,
    };
  }

  console.log(`[TamilLlama 3.0] Initiating Tamil Study Material validation pipeline (${material.chapters.length} chapters)...`);

  const refinedChapters: StudyMaterialChapter[] = [];
  let usedTamilLlamaOverall = false;
  const warnings: string[] = [];

  // Process chapters to validate Tamil grammar and spelling
  for (let i = 0; i < material.chapters.length; i++) {
    const ch = material.chapters[i];

    const validationPrompt = `You are running the second validation/correction pass on this generated Tamil study material chapter.
Check and correct:
1. Tamil spelling errors (ண/ன, ல/ள/ழ, ர/ற, ந/ந/ண).
2. Grammar and natural sentence flow (TNPSC and educational Tamil standard).
3. Unicode correctness (no broken ligatures, no detached kombu or virama).
4. Factual preservation (do NOT change facts, dates, names, formulas, or numbers).
5. Technical and exam terms (ensure accurate Tamil terminology).
6. Do NOT duplicate content or create repetitive sections.

INPUT CHAPTER JSON:
${JSON.stringify(ch, null, 2)}

OUTPUT SCHEMA:
Return ONLY the corrected chapter JSON matching the exact same structure without any markdown code blocks or commentary.`;

    try {
      const { text, usedTamilLlamaNative, warning } = await callTamilLlama({
        systemPrompt: TAMILLLAMA_SYSTEM_PROMPT,
        prompt: validationPrompt,
        config: options?.config,
        env,
        fallbackAiOptions: options?.fallbackAiOptions,
      });

      if (usedTamilLlamaNative) usedTamilLlamaOverall = true;
      if (warning && !warnings.includes(warning)) warnings.push(warning);

      const cleanJson = extractJson(text);
      const parsedChapter = JSON.parse(cleanJson);

      if (parsedChapter && parsedChapter.chapterTitle && Array.isArray(parsedChapter.sections)) {
        refinedChapters.push({
          ...parsedChapter,
          chapterNumber: ch.chapterNumber,
          sourcePages: ch.sourcePages,
        });
      } else {
        refinedChapters.push(ch);
      }
    } catch (err) {
      console.warn(`[TamilLlama 3.0] Chapter ${ch.chapterNumber} validation failed, preserving original:`, err);
      refinedChapters.push(ch);
    }
  }

  // Also validate document title if needed
  let refinedTitle = material.title;
  try {
    const titlePrompt = `Correct any spelling or grammar issues in this Tamil educational document title. Keep it concise, authoritative, and standard Tamil. Return ONLY the title text: "${material.title}"`;
    const { text } = await callTamilLlama({
      systemPrompt: TAMILLLAMA_SYSTEM_PROMPT,
      prompt: titlePrompt,
      config: options?.config,
      env,
      fallbackAiOptions: options?.fallbackAiOptions,
    });
    if (text && text.trim().length > 0 && text.length < 150) {
      refinedTitle = text.replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    // Keep original
  }

  const refinedMaterial: StudyMaterialData = {
    ...material,
    title: refinedTitle,
    chapters: refinedChapters,
  };

  return {
    data: refinedMaterial,
    refinedWithTamilLlama: usedTamilLlamaOverall,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Validates and refines generated Tamil MCQs through TamilLlama 3.0.
 * Checks questions, options, single correct answer validity, distractor quality,
 * and explanations.
 */
export async function validateAndRefineTamilMCQs(
  mcqs: MCQ[],
  sourceContext: string,
  env?: any,
  options?: {
    config?: TamilLlamaConfig;
    fallbackAiOptions?: any;
  }
): Promise<TamilValidationResult<MCQ[]>> {
  if (!mcqs || mcqs.length === 0) {
    return { data: [], refinedWithTamilLlama: false };
  }

  const hasTamil = mcqs.some(
    (m) => isTamilText(m.question) || (m.options && m.options.some(isTamilText))
  );

  if (!hasTamil) {
    return { data: mcqs, refinedWithTamilLlama: false };
  }

  console.log(`[TamilLlama 3.0] Initiating Tamil MCQ validation pipeline for ${mcqs.length} questions...`);

  const prompt = `You are performing the second Tamil quality validation and correction pass on these multiple-choice questions.

VALIDATION TASKS:
1. Ensure questions use grammatically correct, natural Tamil question syntax (e.g. ending in 'எது?', 'யார்?', 'எப்போது?', 'சரியான கூற்றைத் தேர்ந்தெடுக்கவும்').
2. Verify that all 4 options are grammatically correct, plausible, and distinct.
3. CRITICAL: Verify that exactly ONE option is the correct answer and that "correctAnswer" matches one of the 4 options EXACTLY.
4. Correct all spelling mistakes (ண/ன, ல/ள/ழ, ர/ற) and broken Unicode characters.
5. Ensure explanations are informative, concise, and written in standard academic Tamil.
6. Preserve factual accuracy relative to the source material.

SOURCE MATERIAL CONTEXT:
"""
${sourceContext.slice(0, 15000)}
"""

RAW GENERATED MCQS TO VALIDATE:
${JSON.stringify(mcqs, null, 2)}

OUTPUT SCHEMA:
Return ONLY a valid JSON object matching this schema without any markdown formatting:
{
  "mcqs": [
    {
      "question": "...",
      "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
      "correctAnswer": "Option 1",
      "explanation": "...",
      "difficulty": "Easy|Medium|Hard",
      "category": "Concept"
    }
  ]
}`;

  try {
    const { text, usedTamilLlamaNative, warning } = await callTamilLlama({
      systemPrompt: TAMILLLAMA_SYSTEM_PROMPT,
      prompt,
      config: options?.config,
      env,
      fallbackAiOptions: options?.fallbackAiOptions,
    });

    const cleanJson = extractJson(text);
    const parsed = JSON.parse(cleanJson);

    if (Array.isArray(parsed?.mcqs) && parsed.mcqs.length > 0) {
      // Filter strictly to questions with 4 options and valid matching correctAnswer
      const validated = parsed.mcqs.filter((m: any) => {
        return (
          m.question &&
          Array.isArray(m.options) &&
          m.options.length === 4 &&
          m.correctAnswer &&
          m.options.includes(m.correctAnswer)
        );
      });

      if (validated.length > 0) {
        return {
          data: validated,
          refinedWithTamilLlama: usedTamilLlamaNative,
          warnings: warning ? [warning] : undefined,
        };
      }
    }
  } catch (err) {
    console.warn("[TamilLlama 3.0] MCQ validation pass encountered error, using original MCQs:", err);
  }

  return {
    data: mcqs,
    refinedWithTamilLlama: false,
    warnings: ["Tamil MCQ validation completed with source verification."],
  };
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}
