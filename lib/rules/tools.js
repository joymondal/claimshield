// Deterministic rule tools. Pure functions, no network, no model.
// The Regulation agent calls these; the MCP server exposes the same functions.
import { RULES, getRule } from "./rules.js";

const round1 = (n) => Math.round(n * 10) / 10;

/** Moratorium check. favours = true means the finding supports the policyholder. */
export function checkMoratorium({ tenure_months, alleged_ground = "non_disclosure" }) {
  const limit = RULES["R-MORATORIUM"].params.months;
  const t = tenure_months === null || tenure_months === undefined || tenure_months === "" ? NaN : Number(tenure_months);
  if (!Number.isFinite(t) || t < 0) {
    return { tool: "check_moratorium", rule: "R-MORATORIUM", applicable: false, favours: false,
      explanation: "Continuous coverage period is unknown, so the moratorium could not be checked." };
  }
  const fraud = alleged_ground === "fraud";
  const barred = t >= limit && !fraud;
  return {
    tool: "check_moratorium", rule: "R-MORATORIUM", applicable: true, favours: barred,
    contestable_by_insurer: !barred,
    explanation: barred
      ? `The policy has run for ${t} continuous months, which is at or beyond the ${limit}-month moratorium. The insurer has not alleged fraud, so the claim cannot be contested for non-disclosure or misrepresentation.`
      : fraud
        ? `The policy has run for ${t} months, but the insurer alleges fraud. The moratorium does not protect a claim where fraud is established, so the insurer must prove it.`
        : `The policy has run for ${t} continuous months, which is short of the ${limit}-month moratorium. The moratorium does not apply yet.`,
  };
}

function hoursBetween(a, b) {
  const x = Date.parse(a), y = Date.parse(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return null;
  return (y - x) / 36e5;
}

/** Cashless (1 hour) and discharge (3 hours) timeline checks. */
export function checkTimelines({ cashless, preauth_request_ts, preauth_decision_ts, discharge_request_ts, discharge_auth_ts, extra_charges = 0 }) {
  const breaches = [];
  if (!cashless) {
    return { tool: "check_timelines", rule: null, applicable: false, favours: false, breaches,
      explanation: "This was not a cashless claim, so the cashless timelines do not apply." };
  }
  const h1 = hoursBetween(preauth_request_ts, preauth_decision_ts);
  if (h1 !== null && h1 > RULES["R-CASHLESS-1H"].params.hours) {
    breaches.push({ rule: "R-CASHLESS-1H", limit_hours: 1, actual_hours: round1(h1) });
  }
  const h2 = hoursBetween(discharge_request_ts, discharge_auth_ts);
  if (h2 !== null && h2 > RULES["R-DISCHARGE-3H"].params.hours) {
    breaches.push({ rule: "R-DISCHARGE-3H", limit_hours: 3, actual_hours: round1(h2), extra_charges: Number(extra_charges) || 0 });
  }
  const known = h1 !== null || h2 !== null;
  return {
    tool: "check_timelines", rule: breaches[0]?.rule ?? null, applicable: known, favours: breaches.length > 0, breaches,
    explanation: !known
      ? "The documents do not give the request and decision times, so the timelines could not be checked."
      : breaches.length
        ? breaches.map((b) => b.rule === "R-DISCHARGE-3H"
            ? `Final discharge authorisation took ${b.actual_hours} hours against the 3-hour limit${b.extra_charges ? `; the hospital billed Rs ${b.extra_charges.toLocaleString("en-IN")} extra for the delay, which the insurer must bear` : ""}.`
            : `The cashless decision took ${b.actual_hours} hours against the 1-hour limit.`).join(" ")
        : "Both cashless timelines were met.",
  };
}

/** Pre-existing-disease waiting period check. */
export function checkWaitingPeriod({ tenure_months, policy_waiting_months }) {
  const cap = RULES["R-PED-WAIT"].params.maxMonths;
  const t = tenure_months === null || tenure_months === undefined || tenure_months === "" ? NaN : Number(tenure_months);
  if (!Number.isFinite(t) || t < 0) {
    return { tool: "check_waiting_period", rule: "R-PED-WAIT", applicable: false, favours: false,
      explanation: "Continuous coverage period is unknown, so the waiting period could not be checked." };
  }
  const stated = Number.isFinite(Number(policy_waiting_months)) && Number(policy_waiting_months) > 0 ? Number(policy_waiting_months) : null;
  const effective = stated === null ? cap : Math.min(stated, cap);
  const completed = t >= effective;
  return {
    tool: "check_waiting_period", rule: "R-PED-WAIT", applicable: true, favours: completed, effective_waiting_months: effective,
    explanation: completed
      ? `The policy has run for ${t} continuous months. The waiting period for pre-existing diseases is ${effective} months${stated && stated > cap ? ` (the policy says ${stated}, but the cap is ${cap})` : ""}, so it had already been completed when the claim arose.`
      : `The policy has run for ${t} months, which is short of the ${effective}-month waiting period for pre-existing diseases. The exclusion appears to apply.`,
  };
}

/** Does the rejection letter show Claims Review Committee approval? */
export function checkCrcApproval({ is_repudiation, letter_text = "" }) {
  if (!is_repudiation) {
    return { tool: "check_crc_approval", rule: "R-CRC", applicable: false, favours: false,
      explanation: "The claim was not fully repudiated, so committee approval of a repudiation is not in question." };
  }
  const mentioned = /claims?\s+review\s+committee|\bCRC\b|product\s+management\s+committee/i.test(letter_text);
  return {
    tool: "check_crc_approval", rule: "R-CRC", applicable: true, favours: !mentioned, mentioned,
    explanation: mentioned
      ? "The rejection letter states that the Claims Review Committee approved the repudiation."
      : "The rejection letter does not say that the Claims Review Committee approved the repudiation. The insurer can be asked to confirm that it did.",
  };
}

/** Does the letter tie its reasons to a specific policy clause? */
export function checkReasonsGiven({ letter_text = "" }) {
  const cites = /\b(clause|section|condition|exclusion|article)\s*(no\.?|number)?\s*[A-Z]?\d+(\.\d+)*/i.test(letter_text) || /\bExcl\s?\d{2}\b/i.test(letter_text);
  return {
    tool: "check_reasons_given", rule: "R-REASONS", applicable: true, favours: !cites, cites_clause: cites,
    explanation: cites
      ? "The letter refers to a specific policy clause for its decision."
      : "The letter does not refer to any specific term or condition of the policy to justify the decision.",
  };
}

/** Ombudsman eligibility: Rs 50 lakh cap, one-month wait, one-year limit. */
export function checkOmbudsmanEligibility({ amount_in_dispute, grievance_sent_on, insurer_replied_on = null, insurer_rejected = false, today = null }) {
  const cap = RULES["R-OMB-CAP"].params.capRupees;
  const { waitDays, limitDays } = RULES["R-OMB-ELIGIBILITY"].params;
  const reasons = [];
  const amt = Number(amount_in_dispute);
  const withinCap = Number.isFinite(amt) && amt <= cap;
  reasons.push(withinCap ? `The amount in dispute is within the Rs 50 lakh limit.` : `The amount in dispute is above the Rs 50 lakh limit or unknown.`);
  const now = today ? Date.parse(today) : Date.now();
  const sent = Date.parse(grievance_sent_on);
  let ripe = false, inTime = true;
  if (Number.isNaN(sent)) {
    reasons.push("A written representation to the insurer is needed first; no date for one was given.");
  } else {
    const days = Math.floor((now - sent) / 864e5);
    if (insurer_rejected || insurer_replied_on) {
      ripe = true;
      const from = insurer_replied_on ? Date.parse(insurer_replied_on) : sent;
      inTime = (now - from) / 864e5 <= limitDays;
      reasons.push("The insurer has replied, so the complaint can be made now if the reply is a rejection or is unsatisfactory.");
    } else if (days >= waitDays) {
      ripe = true;
      inTime = days <= waitDays + limitDays;
      reasons.push(`More than one month (${days} days) has passed with no reply from the insurer.`);
    } else {
      reasons.push(`Only ${days} days have passed since the representation. Wait until one month has passed without a reply, unless the insurer rejects it sooner.`);
    }
    if (!inTime) reasons.push("The one-year limit for approaching the Ombudsman appears to have passed; the Ombudsman may condone delay in some cases.");
  }
  const eligible = withinCap && ripe && inTime;
  return { tool: "check_ombudsman_eligibility", rule: "R-OMB-ELIGIBILITY", applicable: true, favours: eligible, eligible, reasons,
    explanation: reasons.join(" ") };
}

export function getClause({ rule_id }) {
  const r = getRule(rule_id);
  if (!r) return { tool: "get_clause", found: false, explanation: `Unknown rule id ${rule_id}.` };
  return { tool: "get_clause", found: true, id: r.id, title: r.title, summary: r.summary, source: `${r.sourceTitle}, ${r.sourceRef}`, where: r.sourceWhere };
}

// Allow-list used by the Regulation agent. Nothing outside this map can be called.
export const TOOLS = {
  check_moratorium: checkMoratorium,
  check_timelines: checkTimelines,
  check_waiting_period: checkWaitingPeriod,
  check_crc_approval: checkCrcApproval,
  check_reasons_given: checkReasonsGiven,
  check_ombudsman_eligibility: checkOmbudsmanEligibility,
  get_clause: getClause,
};
