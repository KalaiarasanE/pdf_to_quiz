import { Readable } from "stream";

export interface StreamConfig {
  text: string;
  count: number;
  difficulty: "Easy" | "Medium" | "Hard" | "Mixed";
  apiKey?: string;
  apiProvider?: "gemini" | "openai" | "lovable";
  modelName?: string;
  env?: any;
  selectedLanguage?: string;
}

export type MCQ = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: "Easy" | "Medium" | "Hard";
  category: string;
};

export async function* generateMCQStream(config: StreamConfig): AsyncGenerator<MCQ, void, unknown> {
  const {
    text,
    count,
    difficulty,
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

  // Truncate long texts
  const MAX_CHARS = 100000;
  const sourceText = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

  const difficultyLine =
    difficulty === "Mixed"
      ? "Use a mix of Easy, Medium, and Hard difficulty levels."
      : `All questions must be ${difficulty} difficulty.`;

  const languageInstruction =
    selectedLanguage && selectedLanguage === "Tanglish"
      ? `You MUST generate all questions, options, correct answers, and explanations in Tanglish (Tamil language written phonetically using standard English/Latin letters). Rules for Tanglish: Do NOT use Tamil Unicode characters (e.g. தமிழ்). Translate Tamil vocabulary and sentence structure into Latin letters phonetically (e.g., "India oda capital enna?" or "Ulagathin miga uyarndha sigaram edhu?"). Distractors and explanations must also be in readable Tanglish. Maintain proper readability and natural Tanglish sentences.`
      : selectedLanguage && selectedLanguage !== "mixed"
        ? `You MUST output all questions, options, correct answers, and explanations in the "${selectedLanguage}" language.`
        : selectedLanguage === "mixed"
          ? `You MUST output all questions, options, correct answers, and explanations in the original mixed-language format of the study material.`
          : `You MUST detect the primary language of the provided study material and output the generated questions, options, correct answers, and explanations in the EXACT same language as the study material. For example, if the material is in Tamil, generate questions in Tamil. Never translate the content unless the user explicitly requests translation.`;


  const systemPrompt = `You are an expert exam question writer. Read the provided study material carefully and produce high-quality multiple choice questions.

Rules:
- Cover the whole document; do not focus on a single section.
- Each question tests understanding, not sentence matching.
- Exactly 4 options per question.
- Exactly one correct answer per question.
- Distractors must be plausible and roughly the same length as the correct answer.
- Randomize which option is correct across the set (A, B, C, D).
- Do not repeat questions.
- Preserve technical terminology.
- Category is one of: Definition, Concept, Fact, Example, Numerical, Theory, Important Point.
- LANGUAGE RULE: ${languageInstruction}
- Output EXACTLY one JSON object per line.
- Do NOT output any markdown blocks (like \`\`\`json) or other markdown formatting.
- Each JSON object MUST be on a single line (no raw newlines inside the JSON string; escape newlines in text as \\n).
- Begin the output directly with the first question's JSON object.`;

  const prompt = `Generate exactly ${count} multiple choice questions from the material below.
${difficultyLine}

Each line of your output must be a single JSON object with this exact shape:
{"question":"...","options":["Option A","Option B","Option C","Option D"],"correctAnswer":"<one of the options, verbatim>","explanation":"...","difficulty":"Easy|Medium|Hard","category":"..."}

MATERIAL:
"""
${sourceText}
"""`;

  let url = "";
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  let body: any = {};

  const effectiveProvider = apiProvider;

  if (effectiveProvider === "gemini") {
    const key = apiKey || serverGeminiKey;
    if (!key) {
      throw new Error("No Gemini API key provided. Please configure it in Settings or .env file.");
    }
    // We can use the OpenAI compatible endpoint or standard Gemini endpoint.
    // Standard Gemini stream endpoint is highly reliable. Let's use standard Gemini streaming.
    const model = modelName || "gemini-3.1-flash-lite";
    url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${key}`;
    body = {
      contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\n${prompt}` }] }],
      generationConfig: {
        temperature: 0.7,
      },
    };
  } else if (effectiveProvider === "openai") {
    const key = apiKey || serverOpenAIKey;
    if (!key) {
      throw new Error("No OpenAI API key provided. Please configure it in Settings or .env file.");
    }
    const model = modelName || "gpt-4o-mini";
    url = "https://api.openai.com/v1/chat/completions";
    headers["Authorization"] = `Bearer ${key}`;
    body = {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      stream: true,
    };
  } else if (effectiveProvider === "lovable") {
    const key = serverLovableKey;
    if (!key) {
      throw new Error("LOVABLE_API_KEY is not configured on the server.");
    }
    url = "https://ai.gateway.lovable.dev/v1/chat/completions";
    headers["Lovable-API-Key"] = key;
    body = {
      model: "google/gemini-3.5-flash",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      stream: true,
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AI API error (${response.status}): ${errText}`);
  }

  if (!response.body) {
    throw new Error("No response body received from AI API.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  let textBuffer = "";

  function* parseTextBuffer(newText: string): Generator<MCQ, void, unknown> {
    textBuffer += newText;

    let newlineIdx;
    while ((newlineIdx = textBuffer.indexOf("\n")) !== -1) {
      const line = textBuffer.slice(0, newlineIdx).trim();
      textBuffer = textBuffer.slice(newlineIdx + 1);

      if (!line || line.startsWith("```")) {
        continue;
      }

      try {
        const parsed = JSON.parse(line);
        if (
          parsed &&
          typeof parsed.question === "string" &&
          Array.isArray(parsed.options) &&
          parsed.options.length === 4 &&
          typeof parsed.correctAnswer === "string"
        ) {
          yield {
            question: parsed.question,
            options: parsed.options,
            correctAnswer: parsed.correctAnswer,
            explanation: parsed.explanation || "",
            difficulty: parsed.difficulty || "Medium",
            category: parsed.category || "Concept",
          };
        }
      } catch (e) {
        // Ignore partial JSON parse errors
      }
    }
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const newText = decoder.decode(value, { stream: true });

      if (effectiveProvider === "gemini") {
        // Standard Gemini stream returns chunks of JSON array.
        // We will accumulate buffer and extract all candidate texts.
        buffer += newText;
        let textSegments = "";

        let searchIndex = 0;
        while (true) {
          const startCandidate = buffer.indexOf('"candidates"', searchIndex);
          if (startCandidate === -1) break;

          const startText = buffer.indexOf('"text"', startCandidate);
          if (startText === -1) {
            searchIndex = startCandidate + 12;
            continue;
          }

          const quoteStart = buffer.indexOf('"', startText + 6);
          if (quoteStart === -1) {
            searchIndex = startText + 6;
            continue;
          }

          // Find the matching unescaped ending quote
          let quoteEnd = quoteStart + 1;
          let found = false;
          while (quoteEnd < buffer.length) {
            if (buffer[quoteEnd] === '"' && buffer[quoteEnd - 1] !== "\\") {
              found = true;
              break;
            }
            quoteEnd++;
          }

          if (!found) {
            break;
          }

          const escapedText = buffer.slice(quoteStart + 1, quoteEnd);
          try {
            const unescapedText = JSON.parse(`"${escapedText}"`);
            textSegments += unescapedText;
          } catch (err) {}

          buffer = buffer.slice(quoteEnd + 1);
          searchIndex = 0;
        }

        if (textSegments) {
          yield* parseTextBuffer(textSegments);
        }
      } else {
        // OpenAI / Lovable stream using standard Server-Sent Events (SSE).
        buffer += newText;
        let lineEnd;
        while ((lineEnd = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, lineEnd).trim();
          buffer = buffer.slice(lineEnd + 1);

          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6).trim();
            if (dataStr === "[DONE]") continue;

            try {
              const dataObj = JSON.parse(dataStr);
              const content = dataObj.choices?.[0]?.delta?.content || "";
              if (content) {
                yield* parseTextBuffer(content);
              }
            } catch (e) {
              // Ignore partial JSON parse errors
            }
          }
        }
      }
    }

    // Process any remaining text in buffer
    if (buffer && effectiveProvider !== "gemini") {
      if (buffer.startsWith("data: ")) {
        const dataStr = buffer.slice(6).trim();
        if (dataStr !== "[DONE]") {
          try {
            const dataObj = JSON.parse(dataStr);
            const content = dataObj.choices?.[0]?.delta?.content || "";
            if (content) {
              yield* parseTextBuffer(content);
            }
          } catch (e) {}
        }
      }
    }

    // Process any remaining text in textBuffer
    const finalLine = textBuffer.trim();
    if (finalLine && !finalLine.startsWith("```")) {
      try {
        const parsed = JSON.parse(finalLine);
        if (
          parsed &&
          typeof parsed.question === "string" &&
          Array.isArray(parsed.options) &&
          parsed.options.length === 4 &&
          typeof parsed.correctAnswer === "string"
        ) {
          yield {
            question: parsed.question,
            options: parsed.options,
            correctAnswer: parsed.correctAnswer,
            explanation: parsed.explanation || "",
            difficulty: parsed.difficulty || "Medium",
            category: parsed.category || "Concept",
          };
        }
      } catch (e) {
        // Ignore
      }
    }
  } finally {
    reader.releaseLock();
  }
}
