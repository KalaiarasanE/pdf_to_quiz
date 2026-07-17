export interface DetectResult {
  isMultilingual: boolean;
  primaryLanguage: string;
  languages: string[];
  fontEncoding:
    "Unicode" | "Bamini" | "TAB" | "TAM" | "TSCII" | "Shree-Lipi" | "other-legacy" | "None";
  hasLegacyTamil: boolean;
}

export async function detectLanguage(text: string, env: any): Promise<DetectResult> {
  // 1. Run local regex validation for legacy Tamil fonts
  const words = text.split(/\s+/);
  let legacyWordCount = 0;
  // Common legacy patterns:
  // - Semicolons inside/end of word: d;, y;, w;, f;, u;, n;, k;, t; (represent ன், ல், ற், க், ர், ண், த், ட் etc. in Bamini/others)
  // - Specific substrings: thz, Fw;, ghj;, xypia, Kjd;
  const legacyRegex = /([a-zA-Z]+;[a-zA-Z]*)|(thz|Fw;|ghj;|xypia|Kjd;|Kjypy;|xyp|tpah|ghu;)/;
  for (const word of words) {
    if (legacyRegex.test(word)) {
      legacyWordCount++;
    }
  }
  const legacyPercentage = words.length > 0 ? (legacyWordCount / words.length) * 100 : 0;
  const hasLegacyTamil = legacyPercentage > 5;

  if (hasLegacyTamil) {
    // If it contains more than 5% legacy Tamil patterns, we know it's legacy Tamil!
    let fontEncoding: DetectResult["fontEncoding"] = "other-legacy";

    // Simple heuristics for specific legacy fonts
    if (text.includes("d;") || text.includes("y;") || text.includes("thz")) {
      fontEncoding = "Bamini";
    } else if (text.includes("shree") || text.includes("Shree")) {
      fontEncoding = "Shree-Lipi";
    }

    return {
      isMultilingual: false,
      primaryLanguage: "Tamil",
      languages: ["Tamil"],
      fontEncoding,
      hasLegacyTamil: true,
    };
  }

  // 2. Otherwise, check standard Tamil Unicode presence
  const hasTamilUnicode = /[\u0B80-\u0BFF]/.test(text);

  const apiKey =
    (env && typeof env === "object" && (env as any).GEMINI_API_KEY) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // Default fallback if no key is configured
    if (hasTamilUnicode) {
      return {
        isMultilingual: false,
        primaryLanguage: "Tamil",
        languages: ["Tamil"],
        fontEncoding: "Unicode",
        hasLegacyTamil: false,
      };
    }
    return {
      isMultilingual: false,
      primaryLanguage: "English",
      languages: ["English"],
      fontEncoding: "None",
      hasLegacyTamil: false,
    };
  }

  const model = "gemini-3.1-flash-lite"; // Use the fastest model for low-latency detection
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const systemPrompt = `You are a language detection expert. Analyze the input text snippet and detect the languages present.
Return ONLY a valid JSON object matching the schema below. Do not wrap the JSON in markdown blocks (like \`\`\`json) or output any other text:
{
  "isMultilingual": true|false,
  "primaryLanguage": "Language Name (e.g. English, Tamil, Hindi, Telugu, Kannada, Malayalam, etc.)",
  "languages": ["Language 1", "Language 2", ...]
}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\nTEXT TO ANALYZE:\n${text}` }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: "application/json",
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (responseText) {
      let cleanText = responseText.trim();
      if (cleanText.startsWith("```")) {
        cleanText = cleanText
          .replace(/^```(?:json)?/, "")
          .replace(/```$/, "")
          .trim();
      }
      const parsed = JSON.parse(cleanText);
      const primLang = parsed.primaryLanguage || "English";
      return {
        isMultilingual: !!parsed.isMultilingual,
        primaryLanguage: primLang,
        languages: Array.isArray(parsed.languages) ? parsed.languages : [primLang],
        fontEncoding: primLang === "Tamil" && hasTamilUnicode ? "Unicode" : "None",
        hasLegacyTamil: false,
      };
    }
  } catch (error) {
    console.error("Language detection model call failed:", error);
  }

  // Fallbacks
  const hasHindi = /[\u0900-\u097F]/.test(text);
  const hasTelugu = /[\u0C00-\u0C7F]/.test(text);
  const hasKannada = /[\u0C80-\u0CFF]/.test(text);
  const hasMalayalam = /[\u0D00-\u0D7F]/.test(text);

  const foundLangs: string[] = [];
  if (hasTamilUnicode) foundLangs.push("Tamil");
  if (hasHindi) foundLangs.push("Hindi");
  if (hasTelugu) foundLangs.push("Telugu");
  if (hasKannada) foundLangs.push("Kannada");
  if (hasMalayalam) foundLangs.push("Malayalam");

  const hasLatin = /[a-zA-Z]{5,}/.test(text);
  if (hasLatin) foundLangs.push("English");

  const primary = foundLangs[0] || "English";

  return {
    isMultilingual: foundLangs.length > 1,
    primaryLanguage: primary,
    languages: foundLangs.length > 0 ? foundLangs : ["English"],
    fontEncoding: primary === "Tamil" ? "Unicode" : "None",
    hasLegacyTamil: false,
  };
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  retries = 3,
  delay = 1500,
): Promise<Response> {
  try {
    const res = await fetch(url, options);
    if ((res.status === 429 || res.status >= 500) && retries > 0) {
      const retryAfter = res.headers.get("retry-after");
      const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
      console.warn(
        `API returned status ${res.status}. Retrying in ${waitTime}ms... (${retries} retries left)`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    return res;
  } catch (err) {
    if (retries > 0) {
      console.warn(
        `Fetch connection error: ${err}. Retrying in ${delay}ms... (${retries} retries left)`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      return fetchWithRetry(url, options, retries - 1, delay * 2);
    }
    throw err;
  }
}

export async function convertLegacyTamil(text: string, env: any): Promise<string> {
  const apiKey =
    (env && typeof env === "object" && (env as any).GEMINI_API_KEY) || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("No Gemini API key configured for legacy font conversion.");
  }

  // Split text into chunks to avoid token limits
  const chunks = [];
  const chunkSize = 20000;
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }

  const systemPrompt = `You are a professional Tamil font conversion utility. Your task is to convert legacy Tamil font encoded text (such as Bamini, TAB, TAM, TSCII, Shree-Lipi, etc.) into clean standard Unicode Tamil.
You MUST output ONLY the converted Unicode Tamil text. Do not add any introduction, explanations, notes, or markdown formatting. Preserve formatting such as newlines and spacing.

IMPORTANT: If the input text contains highly repetitive characters or gibberish patterns, convert them cleanly and do NOT enter a repetition loop. Stop generating once the input content is fully converted.

Examples of mappings to help you:
- "thzpjhrd;" -> "பாரதிதாசன்"
- "Fw;wpaYfu" -> "குற்றியலுகர"
- "xypia" -> "ஒலியை"
- "Kjd;" -> "முதன்"
- "Kjypy;" -> "முதலில்"
- "thz" -> "பாரதி"
- "Fw;" -> "குற்ற"
- "ghj;" -> "பாத்"
- "xypia" -> "ஒலியை"
- "Kjd;" -> "முதன்"`;

  const promises = chunks.map(async (chunk, index) => {
    const models = ["gemini-3.5-flash", "gemini-3.1-flash-lite"];
    let lastError: any = null;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const body = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${systemPrompt}\n\nConvert this legacy Tamil font text chunk to Unicode Tamil:\n${chunk}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      };

      try {
        console.log(`Converting legacy Tamil chunk ${index + 1} using model ${model}...`);
        const retries = i === models.length - 1 ? 3 : 0;
        const response = await fetchWithRetry(
          url,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
          retries,
        );

        if (!response.ok) {
          const errText = await response.text().catch(() => "");
          throw new Error(`API error (${response.status}): ${errText}`);
        }

        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (responseText) {
          return responseText.trim();
        } else {
          throw new Error("Empty response from model");
        }
      } catch (error) {
        console.warn(`Model ${model} failed for chunk ${index + 1}:`, error);
        lastError = error;
        // Continue to next model in loop
      }
    }

    throw lastError || new Error("Failed to convert legacy Tamil chunk with all available models.");
  });

  const convertedChunks = await Promise.all(promises);
  return convertedChunks.join("\n\n");
}
