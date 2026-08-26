/**
 * Tamil Content Pipeline Utilities:
 * - Unicode NFC Normalization
 * - Grapheme cluster preservation
 * - PDF text layout-aware reconstruction without word splitting
 * - Symbol cleaner (removes unwanted '+' and '::' while preserving math/grammar rules)
 * - Temporary diagnostic logging for Pipeline Stages A -> F
 */

export interface TamilPipelineDiagnostic {
  stage: "A" | "B" | "C" | "D" | "E" | "F";
  stageName: string;
  charCount: number;
  hasTamilUnicode: boolean;
  hasUnwantedPlus: boolean;
  hasUnwantedDoubleColon: boolean;
  preview: string;
}

/**
 * Checks if a character code belongs to Tamil combining marks:
 * - Virama / Pulli: U+0BCD (்)
 * - Vowel signs: U+0BBE to U+0BCC (ா, ி, ீ, ு, ூ, ெ, ே, ை, ொ, ோ, ௌ)
 * - Length mark: U+0BD7 (ௗ)
 */
export function isTamilCombiningCode(code: number): boolean {
  return (
    (code >= 0x0bbe && code <= 0x0bcd) ||
    code === 0x0bd7 ||
    code === 0x0b82 // Anusvara
  );
}

/**
 * Checks if a string contains any Tamil Unicode characters (\u0B80-\u0BFF).
 */
export function isTamilText(text: string): boolean {
  if (!text) return false;
  return /[\u0B80-\u0BFF]/.test(text);
}

/**
 * Normalizes Tamil Unicode:
 * - Converts to Unicode NFC (canonical composition) so combining vowel signs join base characters
 * - Strips non-printable control characters (\u0000-\u0008, \u000B, \u000C, \u000E-\u001F, \u007F-\u009F, \uFEFF)
 * - Preserves newlines (\n), tabs (\t), and standard punctuation
 * - Preserves all valid Tamil combining marks and grapheme clusters
 */
export function normalizeTamilUnicode(text: string): string {
  if (!text) return "";

  // 1. NFC normalization
  let normalized = text.normalize("NFC");

  // 2. Remove invisible control characters without breaking Tamil combining marks
  normalized = normalized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\uFEFF\uFFF0-\uFFFF]/g, "");

  // 3. Remove orphaned combining marks at string/line start (e.g. virama or vowel sign without base)
  normalized = normalized.replace(/(?:^|\n)[\u0BBE-\u0BCD\u0BD7]+/g, "");

  return normalized;
}

/**
 * Cleans unwanted '+' and '::' characters from Tamil text:
 * - Does NOT blindly delete all '+' characters
 * - Preserves mathematical formulas (e.g., "2 + 2 = 4", "a + b = c")
 * - Preserves intentional grammatical Sandhi / புணர்ச்சி rules where '=' indicates a derivation (e.g., "மண் + குடம் = மட்குடம்")
 * - Fixes unwanted '+' between Tamil words (e.g., "தமிழ்நாடு + புவியியல்" -> "தமிழ்நாடு - புவியியல்")
 * - Fixes '+' used as a bullet point (e.g., "+ தமிழ்நாடு..." -> "• தமிழ்நாடு...")
 * - Fixes OCR noise double colons "::" -> single colon ":"
 */
export function cleanUnwantedTamilSymbols(text: string): string {
  if (!text) return "";
  const normalized = normalizeTamilUnicode(text);

  // Replace double colons '::' or ':::' with standard ':'
  let result = normalized.replace(/:{2,}/g, ": ");

  // Process line-by-line to preserve intentional mathematical or grammar equations
  const lines = result.split("\n");
  const cleanedLines = lines.map((line) => {
    // If the line contains an equals sign '=' with content on both sides,
    // it is a legitimate math equation or grammar sandhi derivation rule.
    const isEquationOrGrammarRule = /=\s*[\w\u0B80-\u0BFF]/.test(line) && /[\w\u0B80-\u0BFF]\s*\+/.test(line);
    if (isEquationOrGrammarRule) {
      return line;
    }

    // Fix '+' used as a bullet point at line start
    let l = line.replace(/^\s*\+\s*([\u0B80-\u0BFF]+)/g, (_m, g1) => `• ${g1}`);

    // Fix unwanted '+' between Tamil words (e.g., 'தமிழ்நாடு + புவியியல்' -> 'தமிழ்நாடு - புவியியல்')
    l = l.replace(/([\u0B80-\u0BFF]+)\s*\+\s*([\u0B80-\u0BFF]+)/g, (_m, g1, g2) => `${g1} - ${g2}`);

    // Fix trailing '+' at end of word or line
    l = l.replace(/([\u0B80-\u0BFF]+)\s*\+\s*$/g, (_m, g1) => g1);

    return l;
  });

  return cleanedLines.join("\n");
}

/**
 * Reconstructs lines of text from pdfjs getTextContent items in a layout-aware manner.
 * Prevents Tamil words from being split with erroneous spaces.
 */
export function reconstructPdfText(textContent: any): string {
  if (!textContent || !textContent.items || textContent.items.length === 0) {
    return "";
  }

  const items = textContent.items.filter((it: any) => typeof it.str === "string");
  if (items.length === 0) return "";

  const lines: { y: number; items: any[] }[] = [];
  const yTolerance = 4; // points tolerance for items on the same baseline

  // Sort top-to-bottom (Y descending), then left-to-right (X ascending)
  const sortedItems = [...items].sort((a, b) => {
    const yA = a.transform?.[5] ?? 0;
    const yB = b.transform?.[5] ?? 0;
    if (Math.abs(yA - yB) > yTolerance) {
      return yB - yA;
    }
    const xA = a.transform?.[4] ?? 0;
    const xB = b.transform?.[4] ?? 0;
    return xA - xB;
  });

  for (const item of sortedItems) {
    const y = item.transform?.[5] ?? 0;
    const line = lines.find((l) => Math.abs(l.y - y) <= yTolerance);
    if (line) {
      line.items.push(item);
    } else {
      lines.push({ y, items: [item] });
    }
  }

  const lineStrings: string[] = [];

  for (const line of lines) {
    line.items.sort((a, b) => (a.transform?.[4] ?? 0) - (b.transform?.[4] ?? 0));

    let lineText = "";
    let prevItem: any = null;

    for (const item of line.items) {
      const str = item.str || "";
      if (!str) continue;

      if (!prevItem) {
        lineText += str;
      } else {
        const prevX = prevItem.transform?.[4] ?? 0;
        const prevW = prevItem.width ?? 0;
        const curX = item.transform?.[4] ?? 0;
        const gap = curX - (prevX + prevW);

        const avgCharW = prevW > 0 && prevItem.str.length > 0 ? prevW / prevItem.str.length : 5;

        // Check if the current chunk starts with a Tamil combining vowel or virama
        const firstCode = str.charCodeAt(0);
        const isCombiningStart = isTamilCombiningCode(firstCode);

        // Only insert space if there is an actual visual gap between distinct words
        const needsSpace =
          gap > Math.max(2, avgCharW * 0.35) &&
          !lineText.endsWith(" ") &&
          !str.startsWith(" ") &&
          !isCombiningStart;

        if (needsSpace) {
          lineText += " " + str;
        } else {
          lineText += str;
        }
      }
      prevItem = item;
    }

    if (lineText.trim().length > 0) {
      lineStrings.push(lineText.trim());
    }
  }

  return cleanUnwantedTamilSymbols(lineStrings.join("\n"));
}

/**
 * Diagnostic logger for Tamil Content Pipeline stages A -> F.
 * Logs status, character counts, and flags unwanted '+' or '::' occurrences.
 */
export function logTamilStage(
  stage: "A" | "B" | "C" | "D" | "E" | "F",
  stageName: string,
  sampleText: string,
): TamilPipelineDiagnostic {
  const text = sampleText || "";
  const hasTamil = isTamilText(text);

  // Check for unwanted '+' between Tamil words
  const hasUnwantedPlus = /[\u0B80-\u0BFF]+\s*\+\s*[\u0B80-\u0BFF]+/.test(text) && !/=\s*[\w\u0B80-\u0BFF]/.test(text);
  const hasUnwantedDoubleColon = /:{2,}/.test(text);

  const previewSnippet = text.slice(0, 180).replace(/\s+/g, " ").trim();

  console.log(
    `%c[STAGE ${stage} - ${stageName.toUpperCase()}]%c Length: ${text.length} chars | Tamil: ${hasTamil ? "YES" : "NO"} | Unwanted '+': ${hasUnwantedPlus ? "⚠️ FOUND" : "None"} | '::': ${hasUnwantedDoubleColon ? "⚠️ FOUND" : "None"}`,
    "background: #4338ca; color: white; padding: 2px 6px; border-radius: 4px; font-weight: bold;",
    "color: inherit;",
  );
  if (previewSnippet) {
    console.log(`   Sample: "${previewSnippet}${text.length > 180 ? "..." : ""}"`);
  }

  return {
    stage,
    stageName,
    charCount: text.length,
    hasTamilUnicode: hasTamil,
    hasUnwantedPlus,
    hasUnwantedDoubleColon,
    preview: previewSnippet,
  };
}
