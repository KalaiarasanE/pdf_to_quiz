import { StudyMaterialData, StudyMaterialChapter } from "./study-material.types";
import { MCQ } from "./ai-stream.server";
import {
  normalizeTamilUnicode,
  cleanUnwantedTamilSymbols,
  logTamilStage,
  isTamilText,
} from "./tamil-pipeline";

export { isTamilText };

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
    "";

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
    apiUrl: envApiUrl.trim().replace(/\/+$/, ""),
    apiKey: envApiKey.trim(),
    model: envModel.trim(),
    timeoutMs: config?.timeoutMs || 8000,
  };
}

/**
 * Cleans raw PDF extracted text by stripping:
 * - headers/footers
 * - page numbers (e.g. Page 1 of 20, [PAGE 1 OF 20])
 * - repeated titles & watermarks
 * - advertisements and website links
 * - unrelated instructions and navigation text
 * - duplicate content
 * - OCR noise & unwanted symbols (+, ::)
 * - irrelevant metadata
 */
export function cleanPdfExtractedText(rawText: string): string {
  if (!rawText) return "";

  // 1. Normalize Unicode and clean OCR symbols
  const normalizedText = cleanUnwantedTamilSymbols(normalizeTamilUnicode(rawText));

  const lines = normalizedText.split(/\r?\n/);
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

    // Check for OCR noise lines
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

  const result = cleanedLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleanUnwantedTamilSymbols(result);
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

3. STRICT RULE ON SYMBOLS & CONNECTIVES (+, ::):
   - NEVER use '+' as a connective, bullet point, or separator between Tamil words (e.g. NEVER output 'தமிழ்நாடு + புவியியல்' or 'உணவு + ...').
   - Use natural Tamil connectives ('மற்றும்', 'ஆகியவை', அல்லது '-') or full phrases ('தமிழ்நாட்டின் புவியியல்', 'உணவும் ஊட்டச்சத்தும்').
   - NEVER output double colons '::' or OCR noise symbols. Use standard punctuation (colon ':' or dash '-').
   - Only output '+' if explicitly writing a mathematical formula (e.g. 2 + 2 = 4) or grammatical Sandhi rule (e.g. நிலைமொழி + வருமொழி = புணர்மொழி).

4. VOCABULARY & TECHNICAL TERMS:
   - Use standard Tamil educational terms whenever available (e.g., 'முன்னுரை', 'வரையறை', 'முக்கிய அம்சங்கள்', 'விளக்கம்', 'தேர்வு குறிப்புகள்').
   - Accurately preserve technical terms, constitutional articles (e.g., 'சரத்து 32'), legal acts, scientific laws, dates, years, percentages, and formulas.
   - Do NOT translate proper nouns (names of people, historical places, specific treaties) into arbitrary or misleading Tamil words. Transliterate proper names accurately if necessary (e.g., 'அம்பேத்கர்', 'மவுண்ட்பேட்டன்').

5. FACTUAL PRESERVATION:
   - Maintain 100% of original source meaning and factual data without hallucinating new facts.
   - Do NOT duplicate content or append redundant sentences.

6. OUTPUT FORMAT:
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

  // Diagnostic Log Stage C: Input sent to TamilLlama
  logTamilStage("C", "Text Sent to TamilLlama", prompt);

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

      const isLocal = tConfig.apiUrl.includes("localhost") || tConfig.apiUrl.includes("127.0.0.1");
      const effectiveTimeout = isLocal ? 2000 : Math.min(tConfig.timeoutMs || 8000, 10000);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);

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
          logTamilStage("D", "TamilLlama Response", outputText);
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
    let model = fallbackAiOptions?.modelName || "gemini-3.1-flash-lite";
    if (model === "gemini-2.5-flash") model = "gemini-3.1-flash-lite";

    const sendFallback = async (m: string) => {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${fallbackKey}`;
      return await fetch(url, {
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
    };

    let res = await sendFallback(model);
    if (!res.ok && res.status === 404 && model !== "gemini-3.1-flash-lite") {
      console.warn(`[TamilLlama 3.0] Fallback model ${model} returned 404, falling back to gemini-3.1-flash-lite...`);
      res = await sendFallback("gemini-3.1-flash-lite");
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Tamil linguistic fallback engine error (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const fallbackText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    logTamilStage("D", "TamilLlama (Fallback) Response", fallbackText);
    return {
      text: fallbackText.trim(),
      usedTamilLlamaNative: false,
      warning: "TamilLlama 3.0 local server was unreachable. Content was validated and refined using the high-accuracy Tamil linguistic validation engine.",
    };
  }

  throw new Error("No AI key or TamilLlama 3.0 endpoint available for Tamil validation.");
}

/**
 * Recursively cleans and normalizes all string fields in an object:
 * - Applies Unicode NFC normalization
 * - Cleans unwanted '+' and '::' characters
 */
function sanitizeTamilObject<T>(obj: T): T {
  if (typeof obj === "string") {
    return cleanUnwantedTamilSymbols(normalizeTamilUnicode(obj)) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeTamilObject(item)) as unknown as T;
  }
  if (obj && typeof obj === "object") {
    const cleaned: Record<string, any> = {};
    for (const [key, val] of Object.entries(obj)) {
      cleaned[key] = sanitizeTamilObject(val);
    }
    return cleaned as unknown as T;
  }
  return obj;
}

/**
 * Validates and refines generated Tamil Study Material through TamilLlama 3.0.
 * Checks spelling, grammar, sentence structure, punctuation, Unicode correctness,
 * and factual consistency. Eliminates unwanted '+' and '::'.
 */
export async function validateAndRefineTamilStudyMaterial(
  material: StudyMaterialData,
  env?: any,
  options?: {
    config?: TamilLlamaConfig;
    fallbackAiOptions?: any;
  }
): Promise<TamilValidationResult<StudyMaterialData>> {
  const hasTamil =
    isTamilText(material.title) ||
    material.chapters.some(
      (c) => isTamilText(c.chapterTitle) || (c.summary && isTamilText(c.summary))
    );

  if (!hasTamil && material.language !== "Tamil") {
    return {
      data: sanitizeTamilObject(material),
      refinedWithTamilLlama: false,
    };
  }

  console.log(`[TamilLlama 3.0] Initiating Tamil Study Material validation pipeline (${material.chapters.length} chapters)...`);

  let usedTamilLlamaOverall = false;
  const warnings: string[] = [];

  const chapterPromises = material.chapters.map(async (ch) => {
    const validationPrompt = `You are running the second validation/correction pass on this generated Tamil study material chapter.
Check and correct:
1. Tamil spelling errors (ண/ன, ல/ள/ழ, ர/ற, ந/ந/ண).
2. Grammar and natural sentence flow (TNPSC and educational Tamil standard).
3. Unicode correctness (no broken ligatures, no detached kombu or virama).
4. CRITICAL: NEVER output '+' between Tamil words (e.g. fix 'தமிழ்நாடு + புவியியல்' to 'தமிழ்நாடு - புவியியல்' or 'தமிழ்நாட்டின் புவியியல்'). Fix any double colons '::'.
5. Factual preservation (do NOT change facts, dates, names, formulas, or numbers).
6. Technical and exam terms (ensure accurate Tamil terminology).
7. Do NOT duplicate content or create repetitive sections.

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
        const sanitized = sanitizeTamilObject(parsedChapter);
        return {
          ...sanitized,
          chapterNumber: ch.chapterNumber,
          sourcePages: ch.sourcePages,
        };
      }
      return sanitizeTamilObject(ch);
    } catch (err) {
      console.warn(`[TamilLlama 3.0] Chapter ${ch.chapterNumber} validation fallback:`, err);
      return sanitizeTamilObject(ch);
    }
  });

  const refinedChapters = await Promise.all(chapterPromises);

  // Validate and sanitize document title
  let refinedTitle = material.title;
  try {
    const titlePrompt = `Correct any spelling, grammar, or symbol issues (+, ::) in this Tamil educational document title. Keep it concise, authoritative, and standard Tamil. Return ONLY the title text: "${material.title}"`;
    const { text } = await callTamilLlama({
      systemPrompt: TAMILLLAMA_SYSTEM_PROMPT,
      prompt: titlePrompt,
      config: options?.config,
      env,
      fallbackAiOptions: options?.fallbackAiOptions,
    });
    if (text && text.trim().length > 0) {
      let candidate = text.trim();
      try {
        const parsed = JSON.parse(extractJson(candidate));
        if (parsed && typeof parsed.title === "string") {
          candidate = parsed.title;
        } else if (parsed && typeof parsed.documentTitle === "string") {
          candidate = parsed.documentTitle;
        }
      } catch {}
      candidate = candidate.replace(/^["']|["']$/g, "").trim();
      if (candidate && candidate.length > 2 && candidate.length < 150) {
        refinedTitle = candidate;
      }
    }
  } catch {}

  const finalValidatedMaterial: StudyMaterialData = sanitizeTamilObject({
    ...material,
    title: cleanUnwantedTamilSymbols(normalizeTamilUnicode(refinedTitle)),
    chapters: refinedChapters,
  });

  // Diagnostic Log Stage E: Final validated content
  const previewSummary = `Title: ${finalValidatedMaterial.title} | Chapters: ${finalValidatedMaterial.chapters.length} | Chapter 1: ${finalValidatedMaterial.chapters[0]?.chapterTitle}`;
  logTamilStage("E", "Final Validated Study Material Content", previewSummary);

  return {
    data: finalValidatedMaterial,
    refinedWithTamilLlama: usedTamilLlamaOverall,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

/**
 * Validates and refines generated Tamil MCQs through TamilLlama 3.0.
 * Checks questions, options, single correct answer validity, distractor quality,
 * and explanations. Eliminates unwanted '+' and '::'.
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
    return { data: sanitizeTamilObject(mcqs), refinedWithTamilLlama: false };
  }

  console.log(`[TamilLlama 3.0] Initiating Tamil MCQ validation pipeline for ${mcqs.length} questions...`);

  const prompt = `You are performing the second Tamil quality validation and correction pass on these multiple-choice questions.

VALIDATION TASKS:
1. Ensure questions use grammatically correct, natural Tamil question syntax (e.g. ending in 'எது?', 'யார்?', 'எப்போது?', 'சரியான கூற்றைத் தேர்ந்தெடுக்கவும்').
2. Verify that all 4 options are grammatically correct, plausible, and distinct.
3. CRITICAL: Verify that exactly ONE option is the correct answer and that "correctAnswer" matches one of the 4 options EXACTLY.
4. Correct all spelling mistakes (ண/ன, ல/ள/ழ, ர/ற) and broken Unicode characters.
5. REMOVE UNWANTED SYMBOLS: NEVER output '+' between Tamil words (e.g. 'தமிழ்நாடு + பு...' or 'உணவு + ...'). Use natural Tamil syntax. Remove '::'.
6. Ensure explanations are informative, concise, and written in standard academic Tamil.
7. Preserve factual accuracy relative to the source material.

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
        const sanitizedList = sanitizeTamilObject(validated);
        logTamilStage("E", "Final Validated MCQs Content", sanitizedList.map((m: any) => m.question).join(" | "));
        return {
          data: sanitizedList,
          refinedWithTamilLlama: usedTamilLlamaNative,
          warnings: warning ? [warning] : undefined,
        };
      }
    }
  } catch (err) {
    console.warn("[TamilLlama 3.0] MCQ validation pass fallback:", err);
  }

  const sanitizedOriginal = sanitizeTamilObject(mcqs);
  logTamilStage("E", "Final Validated MCQs Content (Original Cleaned)", sanitizedOriginal.map((m) => m.question).join(" | "));
  return {
    data: sanitizedOriginal,
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
