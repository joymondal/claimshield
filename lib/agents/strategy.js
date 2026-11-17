// Agent 4 - Strategist (Tree-of-Thought style: generate candidate grounds,
// evaluate each on legal strength and evidence, test it against the insurer's
// likely counter-argument, prune the weak ones, rank the rest).
// A ground survives only if it cites a verified rule or a retrieved policy clause.
import { callLLM, getEngine } from "../llm/router.js";
import { RULES } from "../rules/rules.js";
import { UNTRUSTED_NOTICE } from "../guard/guard.js";
import { rupees, traceEntry } from "./util.js";

const PRUNE_BELOW = 0.3;

function clauseMatching(clauses, re) {
  const c = clauses.find((x) => re.test(`${x.heading} ${x.text}`));
  return c ? [c.id] : [];
}

/** Generate candidate grounds from the rule findings (deterministic branch generation). */
export function candidateGrounds(state) {
  const f = state.facts, conf = state.confidence || {}, clauses = state.clauses || [];
  const out = [];
  const find = (tool) => state.findings.find((x) => x.tool === tool);
  const mor = find("check_moratorium");
  if (mor?.favours) {
    out.push({
      id: "moratorium_60_months", title: "The claim is protected by the 60-month moratorium",
      base: 0.92, evidence: conf.tenureMonths ?? 0.8, cites: ["R-MORATORIUM", ...clauseMatching(clauses, /moratorium/i)],
      argument: `The policy has been in force continuously for ${f.tenureMonths} months. After 60 continuous months a claim cannot be contested for non-disclosure or misrepresentation unless fraud is established, and your letter does not allege fraud.`,
      counter: "The insurer may say the non-disclosure was deliberate.",
      rebuttal: "Only established fraud lifts the moratorium, and the insurer carries the burden of proving it. The letter alleges none.",
      relief: "full",
    });
  } else if (mor?.applicable && f.fraudAlleged && f.tenureMonths >= RULES["R-MORATORIUM"].params.months) {
    out.push({
      id: "fraud_must_be_established", title: "After 60 months the insurer must establish fraud",
      base: 0.5, evidence: conf.tenureMonths ?? 0.8, cites: ["R-MORATORIUM", ...clauseMatching(clauses, /moratorium/i)],
      argument: `The policy has run for ${f.tenureMonths} continuous months. Beyond 60 months the claim can be contested only where fraud is established. Please share the evidence on which fraud is alleged.`,
      counter: "The insurer may rely on medical records that pre-date the policy.",
      rebuttal: "An earlier diagnosis shows non-disclosure at most; fraud needs proof of intent to deceive.",
      relief: "full",
    });
  }
  const wait = find("check_waiting_period");
  if (wait?.favours) {
    out.push({
      id: "waiting_period_completed", title: "The pre-existing-disease waiting period was already complete",
      base: 0.85, evidence: conf.tenureMonths ?? 0.8, cites: ["R-PED-WAIT", ...clauseMatching(clauses, /waiting/i)],
      argument: wait.explanation + " The exclusion relied on in your letter therefore no longer applied on the date of admission.",
      counter: "The insurer may count the waiting period from a later date, such as a break in cover or an increase in sum insured.",
      rebuttal: "The waiting period runs from the inception of the first policy where cover has been continuous. Check that your policy schedule shows no break in cover.",
      relief: "full",
    });
  }
  const tl = find("check_timelines");
  for (const b of tl?.breaches || []) {
    if (b.rule === "R-DISCHARGE-3H") {
      out.push({
        id: "discharge_delay_charges", title: "Charges caused by the delayed discharge authorisation are payable by the insurer",
        base: b.extra_charges ? 0.8 : 0.45, evidence: 0.9, cites: ["R-DISCHARGE-3H"],
        argument: `Final authorisation took ${b.actual_hours} hours against the 3-hour limit.` + (b.extra_charges ? ` The hospital billed ${rupees(b.extra_charges)} extra because of the delay. Any additional amount charged for a delay beyond three hours is to be borne by the insurer.` : " Please confirm that no additional charge arising from this delay has been passed on to me."),
        counter: "The insurer may say the hospital sent incomplete documents.",
        rebuttal: "Ask the hospital for its log of when the complete discharge request was sent; the insurer should produce its own time stamps if it disagrees.",
        relief: b.extra_charges ? "partial" : "none", amount: b.extra_charges || 0,
      });
    } else if (b.rule === "R-CASHLESS-1H") {
      out.push({
        id: "cashless_decision_delay", title: "The cashless decision exceeded the one-hour limit",
        base: 0.4, evidence: 0.9, cites: ["R-CASHLESS-1H"],
        argument: `The cashless decision took ${b.actual_hours} hours against the one-hour limit. Please record this breach in your review of my claim.`,
        counter: "The insurer may point to queries raised with the hospital.",
        rebuttal: "The limit runs from receipt of the request; queries do not extend it.",
        relief: "none",
      });
    }
  }
  const reasons = find("check_reasons_given");
  if (reasons?.favours) {
    if (f.rejectionCategory === "reasonable_customary") {
      const cl = clauseMatching(clauses, /reasonable|customary/i);
      const deduction = Math.max((f.amountDisputed || 0) - (tl?.breaches?.find((b) => b.rule === "R-DISCHARGE-3H")?.extra_charges || 0), 0);
      out.push({
        id: "deduction_not_explained", title: "The deduction is not justified by reference to the policy",
        base: cl.length ? 0.62 : 0.5, evidence: 0.85, cites: ["R-REASONS", ...cl],
        argument: `Your letter deducts ${rupees(deduction)} without naming the policy term relied on or showing how the amount was computed.` + (cl.length ? " The policy contains its own definition of Reasonable and Customary Charges, and that definition is the test that applies. Your letter does not compare the hospital's charges against it." : "") + " Please share the basis of the deduction or pay the amount.",
        counter: "The insurer may rely on an internal tariff benchmark.",
        rebuttal: "An internal benchmark is not a term of the policy; the policy's own definition is what applies.",
        relief: "partial", amount: deduction,
      });
    } else {
      out.push({
        id: "reasons_not_specific", title: "The decision does not refer to a specific policy term",
        base: 0.45, evidence: 0.8, cites: ["R-REASONS"],
        argument: "Your letter does not identify the specific term or condition of the policy on which the decision rests. Please state the clause relied on and how it applies to my claim.",
        counter: "The insurer may say the reason is self-explanatory.",
        rebuttal: "The requirement is to refer to the specific policy terms, so that the policyholder can respond.",
        relief: "none",
      });
    }
  }
  const crc = find("check_crc_approval");
  if (crc?.favours) {
    out.push({
      id: "crc_approval_not_shown", title: "Claims Review Committee approval is not shown",
      base: 0.35, evidence: 0.9, cites: ["R-CRC"],
      argument: "A claim may be repudiated only with the approval of the Claims Review Committee. Your letter does not say that the Committee approved this repudiation. Please confirm the date of its approval.",
      counter: "The insurer may reply that approval was given internally.",
      rebuttal: "A confirmation with the date of approval is a reasonable request and costs the insurer nothing.",
      relief: "none",
    });
  }
  return out;
}

export function scoreGrounds(candidates) {
  const evaluated = candidates.map((g) => ({ ...g, strength: Math.round(g.base * g.evidence * 100) / 100 }));
  const kept = evaluated.filter((g) => g.strength >= PRUNE_BELOW && g.cites.length > 0).sort((a, b) => b.strength - a.strength).slice(0, 4);
  const pruned = evaluated.filter((g) => !kept.includes(g));
  let score = 12;
  if (kept.length) {
    const max = kept[0].strength;
    const rest = kept.slice(1);
    const avgRest = rest.length ? rest.reduce((a, g) => a + g.strength, 0) / rest.length : 0;
    score = Math.round(100 * (max + (1 - max) * 0.5 * avgRest));
  }
  const band = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";
  return { kept, pruned, score, band };
}

const SYSTEM = `You are the Strategist of ClaimShield. You improve the wording of grounds of appeal for a policyholder contesting a health-insurance claim decision.
${UNTRUSTED_NOTICE}
Rules:
- You may only use the facts, rule summaries and policy clauses given to you. Do not add any law, regulation, case or number that is not in the input.
- Keep each ground's "id" and "cites" exactly as given.
- For each ground write "argument" (max 70 words, first person, firm and polite), "counter" (the insurer's likely reply, max 25 words) and "rebuttal" (max 30 words).
- You may add at most one extra ground under "extra", only if a policy clause in the input directly supports it. It must cite that clause id (for example "P-4").
Return ONLY JSON: {"grounds":[{"id":"...","argument":"...","counter":"...","rebuttal":"..."}],"extra":[{"title":"...","argument":"...","cites":["P-4"]}]}`;

export async function strategise(state) {
  const started = Date.now();
  const engine = getEngine(state.mode);
  let candidates = candidateGrounds(state);
  let used = "offline", note = "";
  const usage = [];
  if (engine.provider !== "offline" && candidates.length) {
    try {
      const f = state.facts;
      const user = JSON.stringify({
        facts: { rejectionReason: f.rejectionReasonText, category: f.rejectionCategory, tenureMonths: f.tenureMonths, amountClaimed: f.amountClaimed, amountPaid: f.amountPaid, fraudAlleged: f.fraudAlleged },
        rules: [...new Set(candidates.flatMap((g) => g.cites.filter((c) => c.startsWith("R-"))))].map((id) => ({ id, summary: RULES[id].summary })),
        policy_clauses: state.clauses.map((c) => ({ id: c.id, heading: c.heading, text: c.text.slice(0, 700) })),
        grounds: candidates.map((g) => ({ id: g.id, title: g.title, cites: g.cites, draft_argument: g.argument })),
      });
      const r = await callLLM(engine, { tier: "strong", system: SYSTEM, user, json: true, maxTokens: 1400, node: "strategise" });
      usage.push(r.usage);
      const byId = Object.fromEntries((r.json?.grounds || []).map((g) => [g.id, g]));
      candidates = candidates.map((g) => {
        const l = byId[g.id];
        if (!l || typeof l.argument !== "string" || l.argument.length < 30) return g;
        return { ...g, argument: l.argument.trim(), counter: (l.counter || g.counter).trim(), rebuttal: (l.rebuttal || g.rebuttal).trim(), reworded: true };
      });
      const clauseIds = new Set(state.clauses.map((c) => c.id));
      for (const x of (r.json?.extra || []).slice(0, 1)) {
        const cites = (x.cites || []).filter((c) => clauseIds.has(c));
        if (!cites.length || !x.title || !x.argument) continue; // cite or drop
        candidates.push({ id: `policy_clause_${cites[0]}`, title: String(x.title).slice(0, 110), base: 0.4, evidence: 0.8, cites, argument: String(x.argument).slice(0, 600), counter: "", rebuttal: "", relief: "none", proposed_by_model: true });
      }
      used = `${engine.provider}:${r.usage.model}`;
    } catch (e) {
      note = ` Live strategist unavailable (${e.message}); used the built-in arguments.`;
    }
  }
  const { kept, pruned, score, band } = scoreGrounds(candidates);
  return {
    grounds: kept, score, band, usage,
    outcome: kept.length ? "" : "no_grounds",
    trace: [traceEntry("strategise", "Strategist", "Tree-of-Thought: generate, evaluate, prune, rank", started, used,
      kept.length
        ? `Generated ${candidates.length} candidate ground(s), kept ${kept.length}. Challengeability ${score}/100 (${band}).${note}`
        : `No ground survived: the rejection appears consistent with the policy and the rules checked. Challengeability ${score}/100 (Low).${note}`,
      { candidates: candidates.map((g) => ({ id: g.id, base: g.base, evidence: g.evidence, cites: g.cites })), kept: kept.map((g) => ({ id: g.id, strength: g.strength })), pruned: pruned.map((g) => ({ id: g.id, strength: g.strength })) })],
  };
}

export function routeAfterStrategise(state) {
  return state.grounds.length ? "draft" : "__end__";
}
