// Time budget: a live run must always finish, whatever the provider does.
import test from "node:test";
import assert from "node:assert/strict";
import { runAnalysis } from "../lib/agents/graph.js";
import { getEngine, callLLM, withBudget } from "../lib/llm/router.js";
import { getSample } from "../lib/samples.js";

const realFetch = globalThis.fetch;
const KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LLM_PROVIDER", "MODEL_CHEAP", "MODEL_STRONG", "RUN_BUDGET_MS"];
test.beforeEach(() => { for (const k of KEYS) delete process.env[k]; process.env.GROQ_API_KEY = "test-key"; });
test.afterEach(() => { globalThis.fetch = realFetch; for (const k of KEYS) delete process.env[k]; });
const docs = () => getSample("meena-moratorium").docs;
const limited = (retryAfter) => new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), { status: 429, headers: { "retry-after": String(retryAfter) } });

test("budget: with no time left, no model call is made and every node falls back", async () => {
  process.env.RUN_BUDGET_MS = "1";
  let calls = 0;
  globalThis.fetch = async () => { calls++; return limited(1); };
  const r = await runAnalysis({ docs: docs(), mode: "auto", today: "2026-11-18" });
  assert.equal(calls, 0, "the budget reaches the nodes inside the graph");
  assert.equal(r.status, "awaiting_approval");
  assert.equal(r.values.band, "High");
  assert.ok(r.values.trace.some((t) => /time budget/.test(t.summary)), "the trace says why the node fell back");
});

test("budget: a retry-after longer than a minute falls back at once instead of waiting", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return limited(90); };
  const started = Date.now();
  const r = await runAnalysis({ docs: docs(), mode: "auto", today: "2026-11-18" });
  assert.equal(r.status, "awaiting_approval");
  assert.ok(Date.now() - started < 3000, "no time is spent sleeping on a limit that cannot clear");
  assert.ok(calls >= 5 && calls <= 12, `one attempt per model-assisted step, got ${calls}`);
});

test("budget: a slow provider is cut off by the remaining time, not by the fixed 28 s timeout", async () => {
  globalThis.fetch = (_u, init) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
  const started = Date.now();
  await assert.rejects(() => withBudget(() => callLLM(getEngine(), { system: "s", user: "u" }), 6000), /timed out|time budget/);
  assert.ok(Date.now() - started < 7000);
});

test("budget: a short rate limit is waited out, reported to the browser, and the model result is used", async () => {
  let calls = 0;
  globalThis.fetch = async () => (++calls === 1 ? limited(1) : new Response(JSON.stringify({ choices: [{ message: { content: "live answer" } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }), { status: 200 }));
  const events = [];
  const r = await withBudget(() => callLLM(getEngine(), { system: "s", user: "u", node: "draft" }), 20000, (e) => events.push(e));
  assert.equal(r.text, "live answer");
  assert.equal(calls, 2);
  assert.deepEqual(events, [{ type: "wait", node: "draft", provider: "Groq", seconds: 2 }]);
});

test("budget: no wait is started when it would run past the budget", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return limited(30); };
  const started = Date.now();
  await assert.rejects(() => withBudget(() => callLLM(getEngine(), { system: "s", user: "u" }), 20000), /429/);
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 2000);
});
