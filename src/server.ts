import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/detect-language" && request.method === "POST") {
        try {
          const { text } = await request.json();
          const sample = text.slice(0, 3000);
          const { detectLanguage } = await import("./lib/language.server");
          const result = await detectLanguage(sample, env);
          return new Response(JSON.stringify(result), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Detect language error:", error);
          const errMsg = error instanceof Error ? error.message : "Internal Server Error";
          return new Response(JSON.stringify({ error: errMsg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      if (url.pathname === "/api/convert-legacy-tamil" && request.method === "POST") {
        try {
          const { text } = await request.json();
          const { convertLegacyTamil } = await import("./lib/language.server");
          const unicodeText = await convertLegacyTamil(text, env);
          return new Response(JSON.stringify({ text: unicodeText }), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (error) {
          console.error("Convert legacy Tamil error:", error);
          const errMsg = error instanceof Error ? error.message : "Internal Server Error";
          return new Response(JSON.stringify({ error: errMsg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      if (url.pathname === "/api/generate" && request.method === "POST") {
        try {
          const config = await request.json();
          console.log(
            `Generating ${config.count} MCQs with ${config.apiProvider} (${config.modelName})...`,
          );
          const { generateMCQStream } = await import("./lib/ai-stream.server");
          const stream = generateMCQStream({ ...config, env });

          const encoder = new TextEncoder();
          const readableStream = new ReadableStream({
            async start(controller) {
              try {
                for await (const mcq of stream) {
                  controller.enqueue(encoder.encode(JSON.stringify(mcq) + "\n"));
                }
              } catch (e) {
                console.error("Stream generation error:", e);
                const errMsg = e instanceof Error ? e.message : "Error generating MCQs";
                controller.enqueue(encoder.encode(JSON.stringify({ error: errMsg }) + "\n"));
              } finally {
                controller.close();
              }
            },
          });

          return new Response(readableStream, {
            headers: {
              "Content-Type": "application/x-ndjson; charset=utf-8",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          });
        } catch (error) {
          console.error("Endpoint error:", error);
          const errMsg = error instanceof Error ? error.message : "Internal Server Error";
          return new Response(JSON.stringify({ error: errMsg }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
