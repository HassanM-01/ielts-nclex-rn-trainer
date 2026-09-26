// POST /api/examiner (SPEC 8): Part 3 examiner decisions, streamed as plain
// text. Thin: check the token, validate input, call EXAMINER_MODEL, stream.
// Also the "Reintentar" comparison on the results screen (kind "compare").

import Anthropic from "@anthropic-ai/sdk";
import {
  buildCompareMessage,
  buildExaminerMessage,
  compareSystemPrompt,
  examinerSystemPrompt,
  parseExaminerRequest,
} from "./_lib/examiner-prompt.js";
import { error, readJson } from "./_lib/http.js";
import { bearer, verifyToken } from "./_lib/token.js";

// Module scope: warm instances reuse the connection to the API (SPEC 3.7).
// Retries are off: the browser has a 1.2 s deadline and a scripted fallback.
const client = new Anthropic({ maxRetries: 0, timeout: 10_000 });

/** SPEC 4: the fastest model, no thinking, max_tokens 80. */
const MAX_TOKENS = 80;
/** Two lines of Spanish. */
const COMPARE_MAX_TOKENS = 300;

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  const model = process.env.EXAMINER_MODEL;
  if (!secret || !model) return error("not-configured", 500);
  if (!verifyToken(bearer(request), secret)) return error("unauthorized", 401);

  const body = parseExaminerRequest(await readJson(request));
  if (!body) return error("bad-request", 400);
  if (body.kind === "ping") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });

  const compare = body.kind === "compare";
  const stream = client.messages.stream(
    {
      model,
      max_tokens: compare ? COMPARE_MAX_TOKENS : MAX_TOKENS,
      system: compare ? compareSystemPrompt() : examinerSystemPrompt(),
      messages: [{ role: "user", content: compare ? buildCompareMessage(body) : buildExaminerMessage(body) }],
    },
    // The browser aborts speculative requests when Julio keeps talking; stop
    // the model call too, so aborted requests don't cost tokens.
    { signal: request.signal },
  );

  const encoder = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        controller.close();
      } catch (err) {
        // An error mid-stream leaves an incomplete reply; the browser treats
        // anything it can't validate as "use the scripted next question".
        controller.error(err);
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(out, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
