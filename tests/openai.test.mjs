// OpenAI provider: request shape, reply parsing, cost and engine selection, with a fake transport.
import test from "node:test";
import assert from "node:assert/strict";
import { getEngine, callLLM } from "../lib/llm/router.js";

const realFetch = globalThis.fetch;
const KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "LLM_PROVIDER", "MODEL_CHEAP", "MODEL_STRONG"];
test.beforeEach(() => { for (const k of KEYS) delete process.env[k]; });
test.afterEach(() => { globalThis.fetch = realFetch; for (const k of KEYS) delete process.env[k]; });

const reply = (content, status = 200) => new Response(
  JSON.stringify(status === 200 ? { choices: [{ message: { content } }], usage: { prompt_tokens: 1000, completion_tokens: 200 } } : { error: { message: content } }),
  { status, headers: { "content-type": "application/json" } });

test("OpenAI: request shape, reply parsing and cost", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const engine = getEngine();
  assert.equal(engine.provider, "openai");
  assert.deepEqual(engine.models, { cheap: "gpt-6-luna", strong: "gpt-6.1-terra" });
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return reply('{"a":1}'); };
  const r = await callLLM(engine, { tier: "strong", system: "sys", user: "usr", json: true, maxTokens: 900 });
  assert.equal(seen.url, "https://api.openai.com/v1/chat/completions");
  assert.equal(seen.headers.authorization, "Bearer test-key");
  assert.equal(seen.body.model, "gpt-6.1-terra");
  assert.equal(seen.body.max_completion_tokens, 1900, "headroom for reasoning tokens");
  assert.equal(seen.body.reasoning_effort, "low");
  assert.deepEqual(seen.body.response_format, { type: "json_object" });
  assert.ok(!("temperature" in seen.body), "no sampling parameter is sent");
  assert.deepEqual(seen.body.messages.map((m) => m.role), ["system", "user"]);
  assert.deepEqual(r.json, { a: 1 });
  assert.equal(r.usage.cost_usd, (1000 * 1 + 200 * 5) / 1e6);
});

test("OpenAI: a 400 is retried once without optional parameters; the key never appears in errors", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const bodies = [];
  globalThis.fetch = async (_u, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? reply("unsupported parameter", 400) : reply("ok"); };
  assert.equal((await callLLM(getEngine(), { system: "s", user: "u", json: true })).text, "ok");
  assert.ok(!("reasoning_effort" in bodies[1]) && !("response_format" in bodies[1]) && !("max_completion_tokens" in bodies[1]));
  globalThis.fetch = async () => reply("Incorrect API key provided", 401);
  await assert.rejects(() => callLLM(getEngine(), { system: "s", user: "u" }), (e) => /401/.test(e.message) && !e.message.includes("test-key"));
});

test("OpenAI: other providers keep priority unless LLM_PROVIDER=openai", () => {
  process.env.OPENAI_API_KEY = "o"; process.env.GROQ_API_KEY = "g";
  assert.equal(getEngine().provider, "groq");
  process.env.LLM_PROVIDER = "openai";
  assert.equal(getEngine().provider, "openai");
  assert.equal(getEngine("offline").provider, "offline");
});
