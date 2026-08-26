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
          if (!text || typeof text !== "string" || /[\u0B80-\u0BFF]/.test(text)) {
            // Already standard Tamil Unicode or empty; return immediately
            return new Response(JSON.stringify({ text: text || "" }), {
              headers: { "Content-Type": "application/json" },
            });
          }
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

      if (url.pathname === "/api/check-tamilllama" && (request.method === "POST" || request.method === "GET")) {
        try {
          let bodyData: any = {};
          if (request.method === "POST") {
            bodyData = await request.json().catch(() => ({}));
          }
          const { getTamilLlamaConfig } = await import("./lib/tamilllama.server");
          const config = getTamilLlamaConfig(bodyData, env);

          // Ping endpoint
          const isV1 = config.apiUrl.endsWith("/v1") || config.apiUrl.includes("/v1/");
          const testUrl = isV1 ? `${config.apiUrl}/models` : `${config.apiUrl}/api/tags`;

          const headers: Record<string, string> = { "Content-Type": "application/json" };
          if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);

          try {
            const res = await fetch(testUrl, { method: "GET", headers, signal: controller.signal });
            clearTimeout(timeoutId);
            if (res.ok) {
              return new Response(
                JSON.stringify({
                  available: true,
                  endpoint: config.apiUrl,
                  model: config.model,
                  message: `TamilLlama 3.0 connected at ${config.apiUrl}`,
                }),
                { headers: { "Content-Type": "application/json" } }
              );
            }
          } catch {}

          return new Response(
            JSON.stringify({
              available: false,
              endpoint: config.apiUrl,
              model: config.model,
              message:
                "TamilLlama 3.0 local server not detected. Automatic high-fidelity Tamil linguistic validation fallback is active.",
            }),
            { headers: { "Content-Type": "application/json" } }
          );
        } catch (error) {
          return new Response(
            JSON.stringify({
              available: false,
              message: "Tamil linguistic validation fallback active.",
            }),
            { headers: { "Content-Type": "application/json" } }
          );
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

      if (url.pathname === "/api/generate-study-material" && request.method === "POST") {
        try {
          const config = await request.json();
          console.log(
            `Generating Study Material for ${config.pdfName} with ${config.apiProvider} (${config.modelName})...`,
          );
          const { generateStudyMaterialStream } = await import("./lib/study-material.server");
          const stream = generateStudyMaterialStream({ ...config, env });

          const encoder = new TextEncoder();
          const readableStream = new ReadableStream({
            async start(controller) {
              try {
                for await (const update of stream) {
                  controller.enqueue(encoder.encode(JSON.stringify(update) + "\n"));
                }
              } catch (e) {
                console.error("Study Material stream generation error:", e);
                const errMsg = e instanceof Error ? e.message : "Error generating study material";
                controller.enqueue(encoder.encode(JSON.stringify({ stage: "error", error: errMsg, message: errMsg }) + "\n"));
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
          console.error("Study Material endpoint error:", error);
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
