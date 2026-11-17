// Agent 5 - Drafter and Critic (reflection loop).
// The Drafter writes the letter. The Critic checks every citation, number and
// mandatory element, and sends the draft back for revision (at most twice).
import { callLLM, getEngine } from "../llm/router.js";
import { RULES } from "../rules/rules.js";
import { UNTRUSTED_NOTICE } from "../guard/guard.js";
import { longDate, rupees, traceEntry } from "./util.js";

export const MAX_REVISIONS = 2;
const TAG = /\[((?:R-[A-Z0-9-]+)|(?:P-\d+))\]/g;
const HAS_TAG = /\[(?:R-[A-Z0-9-]+|P-\d+)\]/;
const BANNED = [/\bsue\b/i, /\blegal notice\b/i, /\bmy (lawyer|advocate|attorney)\b/i, /\bcourt\b/i, /\bcriminal\b/i, /\bpolice\b/i, /\bdefamation\b/i, /\blegal advice\b/i, /\bon behalf of\b/i];

function decisionPhrase(f) {
  if (f.isRepudiation) return `repudiated my claim of ${rupees(f.amountClaimed)}`;
  return `paid ${rupees(f.amountPaid)} against my claim of ${rupees(f.amountClaimed)}, disallowing ${rupees(f.amountDisputed)}`;
}

function reliefPhrase(f) {
  return f.isRepudiation
    ? `reverse the repudiation and settle my claim of ${rupees(f.amountClaimed)}`
    : `pay the disallowed amount of ${rupees(f.amountDisputed)}`;
}

function tags(g) { return g.cites.map((c) => `[${c}]`).join(" "); }

/** Deterministic grievance letter. minimal=true is the short first pass used by the offline engine. */
export function composeGrievance(state, { minimal = false } = {}) {
  const f = state.facts;
  const lines = [];
  lines.push(`Date: ${longDate(state.today)}`, "", "To", "The Grievance Redressal Officer", f.insurer || "[Name of insurer]", "",
    `Subject: Grievance against ${f.isRepudiation ? "repudiation" : "partial disallowance"} of claim no. ${f.claimNo || "[claim number]"} under policy no. ${f.policyNo || "[policy number]"}`, "",
    "Dear Sir or Madam,", "");
  lines.push(`I am insured under the above policy.${f.diagnosis ? ` I was treated${f.hospital ? ` at ${f.hospital}` : ""} for ${f.diagnosis}${f.admissionDate ? ` from ${longDate(f.admissionDate)}` : ""}${f.dischargeDate ? ` to ${longDate(f.dischargeDate)}` : ""}.` : ""} By your letter${f.letterDate ? ` dated ${longDate(f.letterDate)}` : ""} you ${decisionPhrase(f)}.`, "");
  lines.push("I ask you to review this decision on the following grounds.", "");
  state.grounds.forEach((g, i) => { lines.push(`${i + 1}. ${g.title}. ${g.argument} ${tags(g)}`, ""); });
  lines.push("Relief sought", `I request you to ${reliefPhrase(f)}.`, "");
  if (!minimal) {
    lines.push("Please send me a written, reasoned reply within 14 days of receiving this letter [R-GRIEVANCE-14D]. If I do not receive a satisfactory reply, I will escalate this grievance on IRDAI's Bima Bharosa portal and to the Insurance Ombudsman [R-OMB-ELIGIBILITY].", "");
    lines.push("Enclosures", `1. Copy of your letter${f.letterDate ? ` dated ${longDate(f.letterDate)}` : ""}`, "2. Policy schedule and policy wording", "3. Discharge summary", "4. Hospital bill", "");
  }
  lines.push("I am submitting this grievance myself, in my own name.", "", "Yours faithfully,", f.insuredName || "[Your name]", `Policy no. ${f.policyNo || "[policy number]"}`, "[Your phone number and email address]");
  return lines.join("\n");
}

/** Re-address an argument written to the insurer so that it reads correctly before the Ombudsman. */
export function forOmbudsman(argument) {
  return String(argument)
    .replace(/\bYour letter\b/g, "The insurer's letter").replace(/\byour letter\b/g, "the insurer's letter")
    .split(/(?<=[.!?])\s+/).filter((s) => !/^Please\b/.test(s.trim())).join(" ")
    .replace(/\bto me\b/g, "to the complainant").trim();
}

/** Deterministic complaint to the Insurance Ombudsman (second stage). */
export function composeOmbudsman(state, { minimal = false } = {}) {
  const f = state.facts, e = state.escalation || {};
  const replied = e.insurer_reply === "rejected" ? `The insurer rejected my representation${e.insurer_replied_on ? ` on ${longDate(e.insurer_replied_on)}` : ""}.`
    : e.insurer_reply === "unsatisfactory" ? `The insurer replied${e.insurer_replied_on ? ` on ${longDate(e.insurer_replied_on)}` : ""}, but the reply does not resolve my grievance.`
    : "More than one month has passed and I have received no reply.";
  const lines = [];
  lines.push(`Date: ${longDate(state.today)}`, "", "To", "The Insurance Ombudsman", "[Office of the Insurance Ombudsman having jurisdiction over your place of residence]", "",
    `Subject: Complaint under Rule 14 of the Insurance Ombudsman Rules, 2017 against ${f.insurer || "[insurer]"}: claim no. ${f.claimNo || "[claim number]"}, policy no. ${f.policyNo || "[policy number]"}`, "",
    "Respected Sir or Madam,", "");
  lines.push(`1. Complainant: ${f.insuredName || "[Your name]"}, the insured under the above policy. [Your address, phone number and email address]`, "");
  lines.push(`2. Insurer complained against: ${(f.insurer || "[insurer]").replace(/\.$/, "")}.`, "");
  lines.push(`3. Facts. ${f.diagnosis ? `I was treated${f.hospital ? ` at ${f.hospital}` : ""} for ${f.diagnosis}${f.admissionDate ? ` from ${longDate(f.admissionDate)}` : ""}${f.dischargeDate ? ` to ${longDate(f.dischargeDate)}` : ""}. ` : ""}By its letter${f.letterDate ? ` dated ${longDate(f.letterDate)}` : ""} the insurer ${decisionPhrase(f)}.`, "");
  lines.push(`4. Representation to the insurer. I sent a written representation to the insurer's Grievance Redressal Officer on ${e.grievance_sent_on ? longDate(e.grievance_sent_on) : "[date]"}. ${replied} This complaint is made within one year, as required [R-OMB-ELIGIBILITY].`, "");
  lines.push("5. Grounds of complaint.", "");
  state.grounds.forEach((g, i) => { lines.push(`5.${i + 1} ${g.title}. ${forOmbudsman(g.argument)} ${tags(g)}`, ""); });
  lines.push(`6. Relief sought. I request an award directing the insurer to ${reliefPhrase(f).replace("reverse the repudiation and settle", "settle")}. The amount is within the limit of the Ombudsman's jurisdiction [R-OMB-CAP].`, "");
  if (!minimal) {
    lines.push("7. Declaration. The subject matter of this complaint is not pending before, and has not been decided by, any court, consumer forum or arbitrator. The facts stated above are true to the best of my knowledge.", "");
    lines.push("Enclosures", "1. Insurer's decision letter", "2. My representation to the insurer and proof of sending", "3. Insurer's reply, if any", "4. Policy schedule and policy wording", "5. Discharge summary and hospital bill", "");
  }
  lines.push("I am filing this complaint myself, in my own name.", "", "Yours faithfully,", f.insuredName || "[Your name]");
  return lines.join("\n");
}

function allowedCitations(state) {
  const ids = new Set(state.grounds.flatMap((g) => g.cites));
  ["R-GRIEVANCE-14D", "R-OMB-ELIGIBILITY", "R-OMB-CAP", "R-OMB-AWARD"].forEach((x) => ids.add(x));
  return ids;
}

const DRAFT_SYSTEM = `You are the Drafter of ClaimShield. You write a letter that an Indian health-insurance policyholder will send in their own name.
${UNTRUSTED_NOTICE}
Hard rules:
- Use ONLY the facts, grounds and citation ids in the input. Never add a law, regulation, clause number, case, amount or date that is not in the input.
- Put the citation tags exactly as given (for example [R-MORATORIUM] or [P-4]) at the end of each sentence or paragraph they support. Every numbered ground must carry at least one tag.
- Formal Indian English, firm and polite, first person singular. No threats. Do not mention lawyers, courts or legal advice. You do not represent the sender.
- Keep any text like <PAN_1> or [Your phone number and email address] exactly as it is.
- Plain text only, no markdown.
The letter must follow the same structure and contain every element of the reference letter in the input (date, addressee, subject, opening, numbered grounds, relief sought, reply request, enclosures, self-declaration, sign-off). Improve the wording and flow; keep it under 520 words.
Return only the letter.`;

export async function draft(state) {
  const started = Date.now();
  const engine = getEngine(state.mode);
  const revision = state.review && !state.review.pass ? state.revision + 1 : state.revision;
  const compose = state.stage === "ombudsman" ? composeOmbudsman : composeGrievance;
  const offlineMinimal = engine.provider === "offline" && revision === 0;
  let text = compose(state, { minimal: offlineMinimal });
  let used = "offline";
  let note = offlineMinimal ? " (The offline engine writes a short first pass so that the Critic's review loop is visible; a live model's first draft is reviewed the same way.)" : "";
  const usage = [];
  if (engine.provider !== "offline") {
    try {
      const reference = compose(state, { minimal: false });
      const user = JSON.stringify({
        kind: state.stage === "ombudsman" ? "complaint to the Insurance Ombudsman" : "grievance to the insurer's Grievance Redressal Officer",
        allowed_citation_ids: [...allowedCitations(state)],
        grounds: state.grounds.map((g) => ({ title: g.title, argument: g.argument, cites: g.cites })),
        issues_to_fix: state.review && !state.review.pass ? state.review.issues : [],
        reference_letter: reference,
      });
      const r = await callLLM(engine, { tier: "strong", system: DRAFT_SYSTEM, user, maxTokens: 2200, node: "draft" });
      usage.push(r.usage);
      const out = (r.text || "").replace(/```/g, "").trim();
      if (out.length < 400 || !HAS_TAG.test(out)) throw new Error("draft too short or missing citation tags");
      text = out; used = `${engine.provider}:${r.usage.model}`;
    } catch (e) {
      text = compose(state, { minimal: false });
      note = ` Live drafter unavailable (${e.message}); used the built-in template.`;
    }
  }
  return {
    draft_text: text, revision, usage,
    trace: [traceEntry("draft", "Drafter", revision ? "Reflection: revise using the Critic's findings" : "Template-guided generation", started, used,
      `${revision ? `Revision ${revision}` : "First draft"} of the ${state.stage === "ombudsman" ? "Ombudsman complaint" : "grievance letter"}: ${text.split(/\s+/).length} words.${note}`,
      { revision, words: text.split(/\s+/).length })],
  };
}

/** Deterministic checks. Returns { faithfulness, completeness, issues, checks }. */
export function reviewDraft(state, text) {
  const f = state.facts;
  const allowed = allowedCitations(state);
  const issues = [], checks = [];
  let units = 0, supported = 0;
  const unit = (ok, label, issue) => { units++; if (ok) supported++; else issues.push(issue); checks.push({ label, ok }); };

  // 1. every citation tag must resolve to verified evidence
  const used = [...text.matchAll(TAG)].map((m) => m[1]);
  const bad = [...new Set(used.filter((t) => !allowed.has(t)))];
  unit(bad.length === 0, "All citations resolve to verified rules or retrieved clauses", `Remove or replace unknown citation(s): ${bad.join(", ")}.`);
  // 2. every ground is present and cited
  for (const g of state.grounds) {
    const present = g.cites.some((c) => text.includes(`[${c}]`));
    unit(present, `Ground "${g.title}" carries its citation`, `Ground "${g.title}" is missing its citation ${g.cites.map((c) => `[${c}]`).join(" ")}.`);
  }
  // 3. every rupee amount must come from the case facts
  const okAmounts = new Set([f.amountClaimed, f.amountPaid, f.amountDisputed, f.extraCharges, ...state.grounds.map((g) => g.amount)].filter((n) => Number.isFinite(Number(n))).map(Number));
  const amounts = [...text.matchAll(/(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)(\s*lakh)?/gi)].filter((m) => !m[2]).map((m) => Number(m[1].replace(/,/g, "")));
  const strange = [...new Set(amounts.filter((a) => !okAmounts.has(a)))];
  unit(strange.length === 0, "All amounts match the case facts", `Amount(s) not found in the case facts: ${strange.map((a) => rupees(a)).join(", ")}.`);
  // 4. regulation talk must be cited
  const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.trim().length > 25);
  const uncited = sentences.filter((s) => /\b(IRDAI|regulation|circular|master circular)\b/i.test(s) && !HAS_TAG.test(s) && !/Bima Bharosa/i.test(s));
  unit(uncited.length === 0, "Every sentence that invokes a regulation is cited", `Add a citation or remove: "${(uncited[0] || "").trim().slice(0, 120)}".`);
  // 5. tone
  const toneText = text.replace(/not pending before[^.]*\./i, "");
  const banned = BANNED.filter((re) => re.test(toneText));
  unit(banned.length === 0, "No threats, legal-advice or representation language", "Remove threatening, legal-advice or representation language.");

  // completeness
  const need = [];
  const c = (ok, label, issue) => { need.push(ok); checks.push({ label, ok }); if (!ok) issues.push(issue); };
  c(/^Subject:/m.test(text), "Subject line", "Add a subject line with the claim and policy numbers.");
  c(!f.policyNo || text.includes(f.policyNo), "Policy number", "Quote the policy number.");
  c(!f.claimNo || text.includes(f.claimNo), "Claim number", "Quote the claim number.");
  c(/relief sought/i.test(text) && (!Number.isFinite(f.amountDisputed) || amounts.includes(f.isRepudiation ? f.amountClaimed : f.amountDisputed)), "Specific relief with the amount", "State the specific relief sought, with the amount.");
  if (state.stage === "ombudsman") {
    c(/not pending before/i.test(text), "Declaration that the matter is not pending elsewhere", "Add the declaration that the matter is not pending before any court, consumer forum or arbitrator.");
  } else {
    c(/within 14 days/i.test(text), "Request for a reasoned reply within 14 days", "Ask for a written, reasoned reply within 14 days.");
  }
  c(/^Enclosures/m.test(text), "List of enclosures", "Add the list of enclosures.");
  c(/myself, in my own name/i.test(text), "Self-filing declaration", "Add the statement that the sender is submitting this personally.");

  const faithfulness = Math.round((supported / units) * 100) / 100;
  const completeness = Math.round((need.filter(Boolean).length / need.length) * 100) / 100;
  return { faithfulness, completeness, issues, checks };
}

const JUDGE_SYSTEM = `You are the Critic of ClaimShield, an independent reviewer.
${UNTRUSTED_NOTICE}
You get the evidence (facts, rule summaries, policy clauses) and a draft letter. List every sentence in the letter that states a fact, number, date or rule that is NOT supported by the evidence. Ignore polite phrases and placeholders in square brackets.
Return ONLY JSON: {"unsupported":[{"sentence":"...","why":"..."}]}. Return an empty list if everything is supported.`;

export async function critique(state) {
  const started = Date.now();
  const engine = getEngine(state.mode);
  const det = reviewDraft(state, state.draft_text);
  let faithfulness = det.faithfulness;
  const issues = [...det.issues];
  let used = "offline", note = "";
  const usage = [];
  if (engine.provider !== "offline") {
    try {
      const f = state.facts;
      const evidence = {
        facts: f, today: state.today, escalation: state.escalation,
        rules: [...allowedCitations(state)].filter((c) => c.startsWith("R-")).map((id) => ({ id, summary: RULES[id].summary })),
        policy_clauses: state.clauses.map((c) => ({ id: c.id, heading: c.heading, text: c.text.slice(0, 700) })),
        grounds: state.grounds.map((g) => ({ title: g.title, argument: g.argument })),
      };
      const r = await callLLM(engine, { tier: "strong", system: JUDGE_SYSTEM, user: `EVIDENCE:\n${JSON.stringify(evidence)}\n\n<document name="draft_letter">\n${state.draft_text}\n</document>`, json: true, maxTokens: 900, node: "critique" });
      usage.push(r.usage);
      const unsupported = Array.isArray(r.json?.unsupported) ? r.json.unsupported.filter((u) => u && u.sentence).slice(0, 6) : null;
      if (unsupported === null) throw new Error("judge returned no usable JSON");
      const claimSentences = Math.max(state.draft_text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 40).length, 1);
      const judged = Math.round((1 - unsupported.length / claimSentences) * 100) / 100;
      faithfulness = Math.min(faithfulness, judged);
      unsupported.forEach((u) => issues.push(`Unsupported: "${String(u.sentence).slice(0, 140)}" (${String(u.why || "").slice(0, 100)})`));
      used = `${engine.provider}:${r.usage.model}`;
    } catch (e) {
      note = ` Live judge unavailable (${e.message}); used the rule-based checks only.`;
    }
  }
  const pass = faithfulness >= 0.9 && det.completeness === 1;
  const exhausted = !pass && state.revision >= MAX_REVISIONS;
  const result = { pass, faithfulness, completeness: det.completeness, issues, checks: det.checks, revision: state.revision };
  const update = {
    review: result, usage,
    trace: [traceEntry("critique", "Critic", "Reflection / Self-RAG style faithfulness check", started, used,
      pass ? `Passed: faithfulness ${faithfulness}, completeness ${det.completeness}.${note}`
        : `Sent back: faithfulness ${faithfulness}, completeness ${det.completeness}. ${issues.length} issue(s): ${issues.slice(0, 2).join(" ")}${note}`,
      { ...result })],
  };
  if (exhausted) { update.outcome = "needs_review"; update.review_reason = "The draft still failed the Critic's checks after two revisions."; }
  return update;
}

export function routeAfterCritique(state) {
  if (state.review.pass) return "human_approval";
  return state.revision < MAX_REVISIONS ? "draft" : "human_review";
}
