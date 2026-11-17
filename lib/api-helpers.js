// Shared helpers for the API routes.
import { sealState } from "./state-token.js";
import { publicView } from "./agents/graph.js";
import { rateLimit } from "./guard/guard.js";

/** Keep the token small: the documents are not needed after the analysis. */
export function tokenFor(values) {
  const { chunks, retrieved, docs, ...keep } = values;
  return sealState(keep);
}

export function clientIp(req) {
  return (req.headers.get("x-forwarded-for") || "local").split(",")[0].trim();
}

export function allow(req, bucket, max) {
  return rateLimit(`${bucket}:${clientIp(req)}`, max);
}

/** Flush LangSmith traces before a serverless function returns (no-op when tracing is off). */
export async function flushTraces() {
  if (process.env.LANGSMITH_TRACING !== "true" && process.env.LANGCHAIN_TRACING_V2 !== "true") return;
  try {
    const { awaitAllCallbacks } = await import("@langchain/core/callbacks/promises");
    await awaitAllCallbacks();
  } catch { /* tracing must never break the app */ }
}

/** Run a graph function and stream its progress as newline-delimited JSON. */
export function ndjsonStream(run) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      try {
        const out = await run(send);
        const payload = { type: "result", status: out.status, view: publicView(out.values, out.status) };
        if (out.eligibility) payload.eligibility = out.eligibility;
        if (out.status !== "not_eligible") payload.token = tokenFor(out.values);
        send(payload);
      } catch (e) {
        send({ type: "error", message: e?.message || "Something went wrong while analysing the case." });
      } finally {
        await flushTraces();
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
