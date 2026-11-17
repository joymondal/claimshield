// The live-model path, exercised with a fake fetch (no network, no key needed).
// It proves the request shapes, JSON parsing, guard rails around model output,
// rate-limit retry and the fallback to the offline engine.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runAnalysis } from "../lib/agents/graph.js";
import { callLLM, getEngine, parseJson } from "../lib/llm/router.js";
import { getSample } from "../lib/samples.js";

const realFetch = globalThis.fetch;
const KEYS = ["GROQ_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "ANTHROPIC_API_KEY", "LLM_PROVIDER", "MODEL_CHEAP", "MODEL_STRONG"];
afterEach(() => { globalThis.fetch = realFetch; KEYS.forEach((k) => delete process.env[k]); });

const groqReply = (content, status = 200, headers = {}) => new Response(
  status === 200 ? JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 300 } }) : JSON.stringify({ error: { message: content } }),
  { status, headers: { "content-type": "application/json", ...headers } });

function fakeGroq({ badFirstDraft = false, log = [] } = {}) {
  let drafts = 0;
  return async (url, init) => {
    const body = JSON.parse(init.body);
    const system = body.messages[0].content, user = body.messages[1].content;
    log.push({ url, model: body.model, auth: init.headers.authorization, system: system.slice(0, 40) });
    if (system.includes("Intake agent")) {
      return groqReply(JSON.stringify({ facts: { insurer: "Nirmaan Health Insurance Co. Ltd.", policyNo: "NHI/FHS/2020/004518", policyStart: "2020-07-20", admissionDate: "2026-10-02", amountClaimed: 210000, amountPaid: 0, rejectionCategory: "non_disclosure", fraudAlleged: false }, confidence: { insurer: 0.95, policyNo: 0.99, policyStart: 0.95, admissionDate: 0.95, amountClaimed: 0.95, amountPaid: 0.9, rejectionCategory: 0.95, fraudAlleged: 0.9 } }));
    }
    if (system.includes("relevance grader")) {
      const ids = [...user.matchAll(/<document name="(P-\d+)">/g)].map((m) => m[1]);
      return groqReply("```json\n" + JSON.stringify({ grades: ids.map((id) => ({ id, grade: "relevant" })) }) + "\n```");
    }
    if (system.includes("Regulation agent")) {
      return groqReply(JSON.stringify({ calls: [{ tool: "check_moratorium", why: "non-disclosure after long tenure" }, { tool: "send_email", why: "attacker-style tool" }, { tool: "check_timelines", why: "extra" }] }));
    }
    if (system.includes("Strategist")) {
      const input = JSON.parse(user);
      return groqReply(JSON.stringify({
        grounds: input.grounds.map((g) => ({ id: g.id, argument: `${g.draft_argument} I therefore ask that the decision be reviewed.`, counter: "It may allege intent.", rebuttal: "Fraud must be established." })),
        extra: [{ title: "Invented ground", argument: "Section 45 of some Act applies to this matter and helps me.", cites: ["P-999"] }],
      }));
    }
    if (system.includes("Drafter")) {
      drafts++;
      const ref = JSON.parse(user).reference_letter;
      if (badFirstDraft && drafts === 1) return groqReply(ref.replace("[R-MORATORIUM]", "[R-SECTION-45]").replace("Relief sought", "As per Section 45 the insurer owes Rs 9,99,999.\n\nRelief sought"));
      return groqReply(ref);
    }
    if (system.includes("Critic")) return groqReply(JSON.stringify({ unsupported: [] }));
    return groqReply("unexpected", 500);
  };
}

test("live mode: full run on Groq with a fake transport", async () => {
  process.env.GROQ_API_KEY = "test-key";
  const log = [];
  globalThis.fetch = fakeGroq({ log });
  const { status, values: v } = await runAnalysis({ docs: getSample("meena-moratorium").docs, mode: "auto", today: "2026-11-17" });
  assert.equal(status, "awaiting_approval");
  assert.ok(log.every((c) => c.url === "https://api.groq.com/openai/v1/chat/completions" && c.auth === "Bearer test-key"));
  assert.ok(log.some((c) => c.model === "openai/gpt-oss-20b") && log.some((c) => c.model === "openai/gpt-oss-120b"), "cheap and strong tiers are both used");
  assert.ok(v.trace.filter((t) => t.engine.startsWith("groq:")).length >= 6);
  assert.equal(v.usage.length, log.length);
  assert.ok(v.usage.every((u) => u.cost_usd > 0));
  // guard rails around model output
  assert.ok(!v.findings.some((f) => f.tool === "send_email"), "a tool outside the allow-list is never run");
  assert.ok(v.findings.some((f) => f.tool === "check_timelines"), "an allowed extra tool chosen by the model is run");
  assert.ok(!v.grounds.some((g) => g.title === "Invented ground"), "a ground citing an unknown clause is dropped");
  assert.ok(v.grounds[0].reworded);
  assert.equal(v.revision, 0, "a clean first draft passes without revision");
});

test("live mode: the Critic rejects a draft with an invented citation, then accepts the revision", async () => {
  process.env.GROQ_API_KEY = "test-key";
  globalThis.fetch = fakeGroq({ badFirstDraft: true });
  const { status, values: v } = await runAnalysis({ docs: getSample("meena-moratorium").docs, mode: "auto", today: "2026-11-17" });
  assert.equal(status, "awaiting_approval");
  assert.equal(v.revision, 1);
  const first = v.trace.find((t) => t.node === "critique");
  assert.match(first.summary, /Sent back/);
  assert.ok(first.details.issues.some((i) => /R-SECTION-45/.test(i)));
  assert.ok(!v.draft_text.includes("Section 45"));
});

test("live mode: provider errors fall back to the offline engine and say so", async () => {
  process.env.GROQ_API_KEY = "test-key";
  globalThis.fetch = async () => groqReply("upstream exploded", 500);
  const { status, values: v } = await runAnalysis({ docs: getSample("ravi-deduction").docs, mode: "auto", today: "2026-11-17" });
  assert.equal(status, "awaiting_approval");
  assert.equal(v.usage.length, 0);
  assert.ok(v.trace.every((t) => t.engine === "offline"));
  assert.match(v.trace[0].summary, /Live model unavailable/);
});

test("router: 429 is retried, 400 retries once without optional parameters, 401 fails fast", async () => {
  process.env.GROQ_API_KEY = "k";
  const engine = getEngine();
  let n = 0;
  globalThis.fetch = async () => (++n === 1 ? groqReply("slow down", 429, { "retry-after": "0.01" }) : groqReply("ok"));
  assert.equal((await callLLM(engine, { system: "s", user: "u" })).text, "ok");
  assert.equal(n, 2);
  const bodies = [];
  globalThis.fetch = async (_u, init) => { bodies.push(JSON.parse(init.body)); return bodies.length === 1 ? groqReply("unknown parameter", 400) : groqReply("ok"); };
  await callLLM(engine, { system: "s", user: "u", json: true });
  assert.ok("response_format" in bodies[0] && !("response_format" in bodies[1]) && !("reasoning_effort" in bodies[1]));
  n = 0;
  globalThis.fetch = async () => { n++; return groqReply("bad key", 401); };
  await assert.rejects(() => callLLM(engine, { system: "s", user: "u" }), /401/);
  assert.equal(n, 1);
});

test("router: Gemini and Anthropic request shapes and reply parsing", async () => {
  process.env.GEMINI_API_KEY = "g";
  let seen;
  globalThis.fetch = async (url, init) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200 }); };
  let r = await callLLM(getEngine(), { system: "sys", user: "usr", json: true });
  assert.match(seen.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(seen.headers["x-goog-api-key"], "g");
  assert.equal(seen.body.systemInstruction.parts[0].text, "sys");
  assert.deepEqual(r.json, { a: 1 });
  assert.equal(r.usage.input_tokens, 10);
  delete process.env.GEMINI_API_KEY;
  process.env.ANTHROPIC_API_KEY = "a";
  globalThis.fetch = async (url, init) => { seen = { url, headers: init.headers, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ content: [{ type: "text", text: "hello" }], usage: { input_tokens: 7, output_tokens: 3 } }), { status: 200 }); };
  r = await callLLM(getEngine(), { tier: "strong", system: "sys", user: "usr" });
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.equal(seen.headers["x-api-key"], "a");
  assert.equal(seen.body.model, "claude-sonnet-5-5");
  assert.equal(r.text, "hello");
});

test("router: engine selection and JSON extraction", () => {
  assert.equal(getEngine().provider, "offline");
  process.env.ANTHROPIC_API_KEY = "a"; process.env.GROQ_API_KEY = "g";
  assert.equal(getEngine().provider, "groq", "Groq is preferred when several keys are set");
  assert.equal(getEngine("offline").provider, "offline");
  process.env.LLM_PROVIDER = "anthropic";
  assert.equal(getEngine().provider, "anthropic");
  assert.deepEqual(parseJson('Here you go:\n```json\n{"x":[1,2]}\n```'), { x: [1, 2] });
  assert.equal(parseJson("no json here"), null);
});
