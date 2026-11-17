// Agent 3 - Regulation agent (ReAct style: plan -> act with tools -> observe).
// It may call ONLY the deterministic rule tools on the allow-list. Arguments are
// always built from the extracted facts in code, so a model can choose WHICH tool
// to call but can never invent the inputs or the legal text.
import { TOOLS } from "../rules/tools.js";
import { getRule } from "../rules/rules.js";
import { callLLM, getEngine } from "../llm/router.js";
import { traceEntry } from "./util.js";

const ALLOWED = ["check_moratorium", "check_waiting_period", "check_timelines", "check_crc_approval", "check_reasons_given"];

function argsFor(tool, state) {
  const f = state.facts;
  switch (tool) {
    case "check_moratorium":
      return { tenure_months: f.tenureMonths, alleged_ground: f.fraudAlleged ? "fraud" : "non_disclosure" };
    case "check_waiting_period":
      return { tenure_months: f.tenureMonths, policy_waiting_months: f.policyWaitingMonths };
    case "check_timelines":
      return { cashless: !!f.cashless, preauth_request_ts: f.preauthRequestTs, preauth_decision_ts: f.preauthDecisionTs, discharge_request_ts: f.dischargeRequestTs, discharge_auth_ts: f.dischargeAuthTs, extra_charges: f.extraCharges || 0 };
    case "check_crc_approval":
      return { is_repudiation: !!f.isRepudiation, letter_text: state.docs.rejection || "" };
    case "check_reasons_given":
      return { letter_text: state.docs.rejection || "" };
    default:
      return {};
  }
}

/** The plan a careful human reviewer would follow for this rejection category. */
export function baselinePlan(facts) {
  const plan = ["check_reasons_given"];
  if (facts.isRepudiation) plan.push("check_crc_approval");
  if (facts.rejectionCategory === "non_disclosure") plan.push("check_moratorium");
  if (facts.rejectionCategory === "pre_existing_waiting") plan.push("check_waiting_period");
  if (facts.cashless) plan.push("check_timelines");
  return plan;
}

const PLANNER_SYSTEM = `You are the Regulation agent of ClaimShield. You decide which rule checks to run for a rejected health-insurance claim.
Available tools (names only; the system fills in the arguments from verified case facts):
- check_moratorium: was the claim contested for non-disclosure after 60 months of continuous cover?
- check_waiting_period: had the pre-existing-disease waiting period already been completed?
- check_timelines: were the 1-hour cashless and 3-hour discharge timelines met?
- check_crc_approval: does the rejection letter show Claims Review Committee approval?
- check_reasons_given: does the letter tie its reasons to a specific policy clause?
Return ONLY JSON: {"calls":[{"tool":"<name>","why":"<max 15 words>"}]}. Choose only tools that matter for this case.`;

export async function regCheck(state) {
  const started = Date.now();
  const engine = getEngine(state.mode);
  const f = state.facts;
  const plan = baselinePlan(f);
  const why = Object.fromEntries(plan.map((t) => [t, "baseline plan for this rejection category"]));
  let used = "offline", note = "";
  const usage = [];
  if (engine.provider !== "offline") {
    try {
      const user = `Rejection category: ${f.rejectionCategory}\nInsurer's reason: ${f.rejectionReasonText}\nRepudiated in full: ${f.isRepudiation}\nCashless: ${f.cashless}\nContinuous cover (months): ${f.tenureMonths}\nFraud alleged: ${f.fraudAlleged}`;
      const r = await callLLM(engine, { tier: "cheap", system: PLANNER_SYSTEM, user, json: true, maxTokens: 400, node: "reg_check" });
      usage.push(r.usage);
      for (const c of r.json?.calls || []) {
        if (!ALLOWED.includes(c.tool)) continue; // allow-list: anything else is ignored
        if (!plan.includes(c.tool)) plan.push(c.tool);
        why[c.tool] = String(c.why || "chosen by the model").slice(0, 120);
      }
      used = `${engine.provider}:${r.usage.model}`;
    } catch (e) {
      note = ` Live planner unavailable (${e.message}); ran the baseline plan.`;
    }
  }

  const findings = [];
  for (const tool of plan) {
    const args = argsFor(tool, state);
    const result = TOOLS[tool](args);
    const rules = result.breaches?.length ? result.breaches.map((b) => b.rule) : result.rule ? [result.rule] : [];
    const shownArgs = { ...args };
    if (shownArgs.letter_text) shownArgs.letter_text = `(${shownArgs.letter_text.length} characters of the rejection letter)`;
    findings.push({
      tool, args: shownArgs, why: why[tool], rules,
      applicable: !!result.applicable, favours: !!result.favours, explanation: result.explanation,
      breaches: result.breaches || [],
      rule_text: rules.map((id) => { const r = getRule(id); return r ? { id, title: r.title, summary: r.summary, source: `${r.sourceTitle}, ${r.sourceRef}` } : null; }).filter(Boolean),
    });
  }
  const helpful = findings.filter((x) => x.favours).length;
  return {
    findings, usage,
    trace: [traceEntry("reg_check", "Regulation agent", "ReAct: plan, call rule tools, observe", started, used,
      `Ran ${findings.length} rule check(s); ${helpful} support the policyholder.${note}`,
      { tool_calls: findings.map((x) => ({ tool: x.tool, args: x.args, favours: x.favours, rules: x.rules })), allow_list: ALLOWED })],
  };
}
