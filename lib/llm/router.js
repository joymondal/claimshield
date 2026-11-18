// Model router: picks a provider from environment variables, routes cheap vs strong
// tasks to different models, retries on rate limits, and reports token usage and cost.
// With no API key set, the app runs on its built-in offline engine (see nodes/*.js).

import { AsyncLocalStorage } from "node:async_hooks";

// Time budget for one run. A Vercel function is stopped at maxDuration (300 s on the
// analyze and escalate routes), which would end the stream with no result. Model calls
// stop once the budget is used up and the calling node falls back to the built-in
// engine, so a run always completes. Within the budget the router waits out rate limits
// (Groq's free tier allows 8,000 tokens a minute per model), and tells the browser so.
const budget = new AsyncLocalStorage();
export const runBudgetMs = () => Number(process.env.RUN_BUDGET_MS) || 270000;
export const MAX_WAIT_MS = 65000;
export function withBudget(fn, ms = runBudgetMs(), onEvent = null) { return budget.run({ deadline: Date.now() + ms, onEvent }, fn); }
const timeLeft = () => { const b = budget.getStore(); return b ? b.deadline - Date.now() : Infinity; };
const notify = (ev) => { try { budget.getStore()?.onEvent?.(ev); } catch { /* progress only */ } };

const PROVIDERS = {
  groq: {
    label: "Groq",
    keyEnv: ["GROQ_API_KEY"],
    models: { cheap: "openai/gpt-oss-20b", strong: "openai/gpt-oss-120b" },
    price: { "openai/gpt-oss-20b": [0.075, 0.3], "openai/gpt-oss-120b": [0.15, 0.6] },
  },
  gemini: {
    label: "Google Gemini",
    keyEnv: ["GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
    models: { cheap: "gemini-3.5-flash-lite", strong: "gemini-3.5-flash-lite" },
    price: { "gemini-3.5-flash-lite": [0.3, 2.5] },
  },
  anthropic: {
    label: "Anthropic Claude",
    keyEnv: ["ANTHROPIC_API_KEY"],
    models: { cheap: "claude-haiku-5-5", strong: "claude-sonnet-5-5" },
    price: { "claude-haiku-5-5": [0.1, 0.5], "claude-sonnet-5-5": [2, 10] },
  },
  openai: {
    label: "OpenAI",
    keyEnv: ["OPENAI_API_KEY"],
    models: { cheap: "gpt-6-luna", strong: "gpt-6.1-terra" },
    price: { "gpt-6-luna": [0.1, 0.5], "gpt-6.1-terra": [1, 5], "gpt-6.1-sol": [2, 10] },
  },
};
// Prices are US$ per million tokens (input, output), read from provider pages in
// November 2026. They change: treat the cost meter as an estimate.
export const PRICES_VERIFIED_ON = "2026-11-18";

function keyFor(p) {
  for (const k of PROVIDERS[p].keyEnv) if (process.env[k]) return process.env[k];
  return null;
}

/** Which engine will this request use? mode "offline" forces the offline engine. */
export function getEngine(mode = "auto") {
  if (mode === "offline") return { provider: "offline", label: "Offline demo engine (no AI key)" };
  const forced = (process.env.LLM_PROVIDER || "").toLowerCase();
  const order = forced && PROVIDERS[forced] ? [forced] : ["groq", "gemini", "anthropic", "openai"];
  for (const p of order) {
    if (keyFor(p)) {
      const models = {
        cheap: process.env.MODEL_CHEAP || PROVIDERS[p].models.cheap,
        strong: process.env.MODEL_STRONG || PROVIDERS[p].models.strong,
      };
      return { provider: p, label: `${PROVIDERS[p].label} (live AI)`, models };
    }
  }
  return { provider: "offline", label: "Offline demo engine (no AI key)" };
}

function costUsd(provider, model, inTok, outTok) {
  const pr = PROVIDERS[provider]?.price?.[model];
  if (!pr) return null;
  return (inTok * pr[0] + outTok * pr[1]) / 1e6;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function post(url, headers, body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: ctrl.signal });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* keep raw text */ }
    return { ok: res.ok, status: res.status, data, text, retryAfter: Number(res.headers.get("retry-after")) || null };
  } finally {
    clearTimeout(timer);
  }
}

async function callGroq({ key, model, system, user, json, maxTokens, timeoutMs }, lean) {
  const body = { model, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  if (!lean) {
    body.max_completion_tokens = maxTokens;
    if (json) body.response_format = { type: "json_object" };
    if (/gpt-oss/.test(model)) body.reasoning_effort = "low";
  }
  const r = await post("https://api.groq.com/openai/v1/chat/completions", { authorization: `Bearer ${key}` }, body, timeoutMs);
  if (!r.ok) return r;
  return { ok: true, text: r.data?.choices?.[0]?.message?.content ?? "", inTok: r.data?.usage?.prompt_tokens ?? 0, outTok: r.data?.usage?.completion_tokens ?? 0 };
}

async function callGemini({ key, model, system, user, json, maxTokens, timeoutMs }, lean) {
  const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], generationConfig: { temperature: 0.2 } };
  if (!lean) {
    body.generationConfig.maxOutputTokens = maxTokens;
    if (json) body.generationConfig.responseMimeType = "application/json";
  }
  const r = await post(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key }, body, timeoutMs);
  if (!r.ok) return r;
  const parts = r.data?.candidates?.[0]?.content?.parts || [];
  return { ok: true, text: parts.map((p) => p.text || "").join(""), inTok: r.data?.usageMetadata?.promptTokenCount ?? 0, outTok: r.data?.usageMetadata?.candidatesTokenCount ?? 0 };
}

async function callAnthropic({ key, model, system, user, maxTokens, timeoutMs }) {
  const body = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] };
  const r = await post("https://api.anthropic.com/v1/messages", { "x-api-key": key, "anthropic-version": "2023-06-01" }, body, timeoutMs);
  if (!r.ok) return r;
  const text = (r.data?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  return { ok: true, text, inTok: r.data?.usage?.input_tokens ?? 0, outTok: r.data?.usage?.output_tokens ?? 0 };
}

// OpenAI's current models are reasoning models: reasoning tokens count against
// max_completion_tokens, so the limit gets headroom, and no temperature is sent
// because support for sampling parameters varies by model.
async function callOpenAI({ key, model, system, user, json, maxTokens, timeoutMs }, lean) {
  const body = { model, messages: [{ role: "system", content: system }, { role: "user", content: user }] };
  if (!lean) {
    body.max_completion_tokens = maxTokens + 1000;
    body.reasoning_effort = "low";
    if (json) body.response_format = { type: "json_object" };
  }
  const r = await post("https://api.openai.com/v1/chat/completions", { authorization: `Bearer ${key}` }, body, timeoutMs);
  if (!r.ok) return r;
  return { ok: true, text: r.data?.choices?.[0]?.message?.content ?? "", inTok: r.data?.usage?.prompt_tokens ?? 0, outTok: r.data?.usage?.completion_tokens ?? 0 };
}

const CALLERS = { groq: callGroq, gemini: callGemini, anthropic: callAnthropic, openai: callOpenAI };

/** Pull the first JSON object out of a model reply. */
export function parseJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  try { return JSON.parse(cleaned); } catch { /* fall through */ }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

/**
 * One model call. Throws on failure so the calling node can fall back to the
 * offline engine and record why.
 */
export async function callLLM(engine, { tier = "cheap", system, user, json = false, maxTokens = 1200, node = "" }) {
  if (!engine || engine.provider === "offline") throw new Error("offline engine selected");
  const provider = engine.provider;
  const key = keyFor(provider);
  if (!key) throw new Error(`no API key for ${provider}`);
  const model = engine.models[tier];
  const started = Date.now();
  let lean = false;
  let last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const left = timeLeft();
    if (left < 4000) { last = last ? `${last}; time budget for this run used up` : "time budget for this run used up"; break; }
    const timeoutMs = Math.min(28000, left - 1000);
    let r;
    try {
      r = await CALLERS[provider]({ key, model, system, user, json, maxTokens, timeoutMs }, lean);
    } catch (e) {
      last = `${provider} request failed: ${e.name === "AbortError" ? "timed out" : e.message}`;
      continue;
    }
    if (r.ok) {
      const usage = { node, provider, model, tier, input_tokens: r.inTok, output_tokens: r.outTok, cost_usd: costUsd(provider, model, r.inTok, r.outTok), ms: Date.now() - started };
      return { text: r.text, json: json ? parseJson(r.text) : null, usage };
    }
    const msg = r.data?.error?.message || r.text?.slice(0, 200) || "";
    last = `${provider} returned ${r.status}: ${msg}`;
    if (r.status === 429 || r.status === 503 || r.status === 529) {
      // Wait only when a retry can still succeed inside the time budget. A wait longer
      // than a minute (a daily limit, not a per-minute one) means: fall back now.
      const wait = Math.max(500, (r.retryAfter || 2 + attempt * 3) * 1000 + 250);
      if (attempt === 2 || wait > MAX_WAIT_MS || wait > timeLeft() - 8000) break;
      notify({ type: "wait", node, provider: PROVIDERS[provider].label, seconds: Math.ceil(wait / 1000) });
      await sleep(wait);
      continue;
    }
    if (r.status === 400 && !lean) { lean = true; continue; } // drop optional parameters once
    break; // 401/403/404 and the like: do not retry
  }
  throw new Error(last || "model call failed");
}

export function totalCost(usage = []) {
  const rate = Number(process.env.USD_INR) || 86;
  const usd = usage.reduce((a, u) => a + (u.cost_usd || 0), 0);
  return {
    usd: Math.round(usd * 10000) / 10000,
    inr: Math.round(usd * rate * 100) / 100,
    input_tokens: usage.reduce((a, u) => a + (u.input_tokens || 0), 0),
    output_tokens: usage.reduce((a, u) => a + (u.output_tokens || 0), 0),
    calls: usage.length,
    usd_inr: rate,
  };
}
