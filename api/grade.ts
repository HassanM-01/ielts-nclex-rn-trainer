// POST /api/grade (SPEC 11): grades a finished session with GRADE_MODEL and
// structured outputs, streamed to the browser as newline-delimited JSON
// events (see GradeEvent in src/shared/grade.ts). Thin: check the token,
// validate input, call the model, stream.
//
// One retry, only on max_tokens, a refusal or a network error; the browser
// is told to drop the first attempt's text ("reset"). The daily cap check
// arrives with Supabase in step 6.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { GradeErrorCode, GradeEvent, GradeUsage } from "../src/shared/grade";
import { buildGradeMessage, GradeOutput, gradeSystemPrompt, parseGradeRequest, type GradeOutputType } from "./_lib/grade-prompt.js";
import { error, readJson } from "./_lib/http.js";
import { bearer, verifyToken } from "./_lib/token.js";

// Module scope: warm instances reuse the connection to the API (SPEC 3.7).
// The SDK's own retries are off: this function retries once itself.
const client = new Anthropic({ maxRetries: 0 });

/** Room for thinking plus the JSON; only what is used is billed. */
const MAX_TOKENS = 32_000;
/** Per attempt, so two attempts fit in the 300 s function limit. */
const ATTEMPT_MS = 140_000;
const MAX_ATTEMPTS = 2;

type Attempt = { ok: true; grade: GradeOutputType } | { ok: false; code: GradeErrorCode };

async function attempt(
  params: Parameters<typeof client.messages.stream>[0],
  signal: AbortSignal,
  onText: (text: string) => void,
  usage: GradeUsage,
): Promise<Attempt> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ATTEMPT_MS);
  const onAbort = () => ctrl.abort();
  signal.addEventListener("abort", onAbort);
  try {
    const stream = client.messages.stream(params, { signal: ctrl.signal });
    let text = "";
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        text += event.delta.text;
        onText(event.delta.text);
      }
    }
    const msg = await stream.finalMessage();
    usage.input += msg.usage.input_tokens + (msg.usage.cache_read_input_tokens ?? 0) + (msg.usage.cache_creation_input_tokens ?? 0);
    usage.output += msg.usage.output_tokens;
    if (msg.stop_reason === "refusal") return { ok: false, code: "refusal" };
    if (msg.stop_reason === "max_tokens") return { ok: false, code: "incomplete" };
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, code: "incomplete" };
    }
    const result = GradeOutput.safeParse(parsed);
    return result.success ? { ok: true, grade: result.data } : { ok: false, code: "incomplete" };
  } catch {
    return { ok: false, code: "upstream" };
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.SESSION_SECRET;
  const model = process.env.GRADE_MODEL;
  if (!secret || !model) return error("not-configured", 500);
  if (!verifyToken(bearer(request), secret)) return error("unauthorized", 401);

  const body = parseGradeRequest(await readJson(request, 200_000));
  if (!body) return error("bad-request", 400);

  const params = {
    model,
    max_tokens: MAX_TOKENS,
    system: gradeSystemPrompt(),
    messages: [{ role: "user" as const, content: buildGradeMessage(body) }],
    // SPEC 4: default effort (medium). If the first band misses the SPEC 3
    // budget, lower this to "low" before changing models.
    output_config: { format: zodOutputFormat(GradeOutput), effort: "medium" as const },
  };

  const encoder = new TextEncoder();
  const out = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (e: GradeEvent) => controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
      const usage: GradeUsage = { input: 0, output: 0 };
      try {
        for (let n = 1; n <= MAX_ATTEMPTS; n++) {
          if (n > 1) send({ t: "reset" });
          const r = await attempt(params, request.signal, (v) => send({ t: "delta", v }), usage);
          if (r.ok) {
            send({ t: "done", grade: r.grade, usage });
            break;
          }
          if (request.signal.aborted) break;
          if (n === MAX_ATTEMPTS) send({ t: "error", code: r.code });
        }
        controller.close();
      } catch (err) {
        // The browser went away mid-stream; nothing left to tell it.
        controller.error(err);
      }
    },
  });

  return new Response(out, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" },
  });
}
