import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

const InputSchema = z.object({
  text: z.string().min(50),
  count: z.number().int().min(1).max(100),
  difficulty: z.enum(["Easy", "Medium", "Hard", "Mixed"]),
});

export type MCQ = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: "Easy" | "Medium" | "Hard";
  category: string;
};

export const generateMCQs = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => InputSchema.parse(input))
  .handler(async ({ data }): Promise<{ mcqs: MCQ[] }> => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);

    // Truncate very long documents to keep the request within model limits.
    const MAX_CHARS = 60000;
    const source = data.text.length > MAX_CHARS ? data.text.slice(0, MAX_CHARS) : data.text;

    const difficultyLine =
      data.difficulty === "Mixed"
        ? "Use a mix of Easy, Medium, and Hard difficulty levels."
        : `All questions must be ${data.difficulty} difficulty.`;

    const system = `You are an expert exam question writer. Read the provided study material carefully and produce high-quality multiple choice questions.

Rules:
- Cover the whole document; do not focus on a single section.
- Each question tests understanding, not sentence matching.
- Exactly 4 options per question.
- Exactly one correct answer per question.
- Distractors must be plausible and roughly the same length as the correct answer.
- Randomize which option is correct across the set.
- Do not repeat questions.
- Preserve technical terminology.
- Category is one of: Definition, Concept, Fact, Example, Numerical, Theory, Important Point.
- Return STRICT JSON only. No markdown, no commentary.`;

    const prompt = `Generate exactly ${data.count} multiple choice questions from the material below.
${difficultyLine}

Respond as a JSON object of shape:
{"mcqs":[{"question":"...","options":["A","B","C","D"],"correctAnswer":"<one of the options, verbatim>","explanation":"...","difficulty":"Easy|Medium|Hard","category":"..."}]}

MATERIAL:
"""
${source}
"""`;

    const { text } = await generateText({
      model: gateway("google/gemini-3.5-flash"),
      system,
      prompt,
      temperature: 0.7,
    });

    const jsonText = extractJson(text);
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      throw new Error("The AI response could not be parsed. Please try again.");
    }

    const shape = z.object({
      mcqs: z.array(
        z.object({
          question: z.string(),
          options: z.array(z.string()),
          correctAnswer: z.string(),
          explanation: z.string(),
          difficulty: z.enum(["Easy", "Medium", "Hard"]),
          category: z.string(),
        }),
      ),
    });

    const result = shape.safeParse(parsed);
    if (!result.success) throw new Error("The AI returned an unexpected format. Please try again.");

    // Keep only well-formed MCQs whose correctAnswer is one of the options.
    const mcqs = result.data.mcqs
      .filter((m) => m.options.length === 4 && m.options.includes(m.correctAnswer))
      .slice(0, data.count);

    if (mcqs.length === 0) throw new Error("No valid questions were generated. Please try again.");
    return { mcqs };
  });

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
}
