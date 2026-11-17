// Agent 1 - Intake / Perception.
// Screens the documents for prompt injection, redacts personal identifiers,
// then extracts typed case facts. This agent has NO tools.
import { screenDocument, redact, spotlight, UNTRUSTED_NOTICE } from "../guard/guard.js";
import { callLLM, getEngine } from "../llm/router.js";
import { extractOffline, overallConfidence, deriveFacts, CATEGORIES, FACT_FIELDS } from "./extract.js";
import { parseDate, parseAmount, traceEntry } from "./util.js";

const DOC_NAMES = { rejection: "rejection_letter", policy: "policy_wording", discharge: "discharge_summary", bill: "hospital_bill" };

const SYSTEM = `You are the Intake agent of ClaimShield. You read health-insurance claim documents and extract facts.
${UNTRUSTED_NOTICE}
Return ONLY a JSON object with two keys: "facts" and "confidence".
"facts" has these keys (use null when a value is not stated; never guess):
insurer, insuredName, policyNo, claimNo, policyStart (YYYY-MM-DD, date the first policy started), admissionDate (YYYY-MM-DD), dischargeDate (YYYY-MM-DD), hospital, diagnosis, amountClaimed (number, rupees), amountPaid (number, rupees; 0 if the claim was rejected in full), letterDate (YYYY-MM-DD), rejectionReasonText (the insurer's stated reason, quoted or closely paraphrased, max 60 words), rejectionCategory (one of: ${CATEGORIES.join(", ")}), cashless (true/false), fraudAlleged (true only if the insurer explicitly alleges fraud).
"confidence" has the same keys with a number from 0 to 1.
You have no tools. Do not add any other text.`;

function clip(s, n) { return s && s.length > n ? s.slice(0, n) + "\n[...truncated...]" : s || ""; }

function mergeLive(base, baseConf, live) {
  const facts = { ...base }, confidence = { ...baseConf };
  const lf = live?.facts || {}, lc = live?.confidence || {};
  for (const k of FACT_FIELDS) {
    if (!(k in lf) || lf[k] === null || lf[k] === undefined || lf[k] === "") continue;
    let v = lf[k];
    if (["policyStart", "admissionDate", "dischargeDate", "letterDate"].includes(k)) v = parseDate(v);
    if (["amountClaimed", "amountPaid"].includes(k)) v = parseAmount(v);
    if (k === "rejectionCategory" && !CATEGORIES.includes(v)) v = null;
    if (["cashless", "fraudAlleged"].includes(k)) v = v === true || v === "true";
    if (v === null) continue;
    const c = Math.max(0, Math.min(1, Number(lc[k]) || 0.7));
    const have = facts[k] !== null && facts[k] !== undefined && facts[k] !== "";
    if (!have || c > (confidence[k] || 0) + 0.05) { facts[k] = v; confidence[k] = c; }
    else if (have && String(facts[k]) === String(v)) confidence[k] = Math.max(confidence[k] || 0, c, 0.95); // both agree
  }
  return { facts, confidence };
}

export async function intake(state) {
  const started = Date.now();
  const engine = getEngine(state.mode);
  const flags = [];
  const docs = {};
  let piiMap = { ...(state.pii_map || {}) };
  let piiCount = 0;
  for (const key of Object.keys(DOC_NAMES)) {
    const screened = screenDocument(DOC_NAMES[key], state.docs?.[key] || "");
    flags.push(...screened.flags);
    const red = redact(screened.text, piiMap);
    piiMap = red.map; piiCount += red.count;
    docs[key] = red.text;
  }

  let { facts, confidence } = extractOffline(docs);
  let used = "offline";
  let note = "";
  const usage = [];
  if (engine.provider !== "offline") {
    try {
      const user = [
        spotlight(DOC_NAMES.rejection, clip(docs.rejection, 6000)),
        spotlight(DOC_NAMES.policy, clip(docs.policy, 2500)),
        spotlight(DOC_NAMES.discharge, clip(docs.discharge, 3000)),
        spotlight(DOC_NAMES.bill, clip(docs.bill, 2500)),
      ].join("\n\n");
      const r = await callLLM(engine, { tier: "cheap", system: SYSTEM, user, json: true, maxTokens: 1200, node: "intake" });
      usage.push(r.usage);
      if (!r.json) throw new Error("model did not return JSON");
      ({ facts, confidence } = mergeLive(facts, confidence, r.json));
      used = `${engine.provider}:${r.usage.model}`;
    } catch (e) {
      note = `Live model unavailable (${e.message}); used the offline extractor.`;
    }
  }

  if (state.facts_override && typeof state.facts_override === "object") {
    for (const [k, v] of Object.entries(state.facts_override)) {
      if (v === null || v === undefined || v === "") continue;
      facts[k] = v; confidence[k] = 1; // confirmed by the user
    }
  }
  facts = deriveFacts(facts);
  if (facts.tenureMonths !== null) confidence.tenureMonths = Math.min(confidence.policyStart ?? 1, confidence.admissionDate ?? 1) || confidence.tenureMonths || 1;
  if (state.facts_override?.tenureMonths) confidence.tenureMonths = 1;
  const oc = overallConfidence(facts, confidence);

  const summary = `Read ${Object.values(docs).filter(Boolean).length} documents. Category: ${facts.rejectionCategory}. Confidence ${oc.score}.` +
    (flags.length ? ` Removed ${flags.length} suspicious line(s).` : "") + (piiCount ? ` Redacted ${piiCount} personal identifier(s).` : "") + (note ? ` ${note}` : "");

  return {
    docs, flags, pii_map: piiMap, pii_count: piiCount, facts, confidence,
    overall_confidence: oc.score, missing: oc.missing,
    trace: [traceEntry("intake", "Intake agent", "Perception: guardrails + structured extraction", started, used, summary,
      { injection_flags: flags.length, pii_redacted: piiCount, missing: oc.missing, tools_available: 0 })],
    usage,
  };
}

export function routeAfterIntake(state) {
  return state.overall_confidence < 0.6 ? "human_review" : "policy_rag";
}
