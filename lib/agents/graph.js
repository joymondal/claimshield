// The ClaimShield graph (LangGraph.js). A supervisor graph with specialist agents,
// two loops (Corrective RAG and Critic revision) and one human-approval interrupt.
//
//   START -> intake -> policy_rag <-> grade -> reg_check -> strategise -> draft <-> critique
//                 \-> human_review                                   \-> END (no grounds)
//   critique -> human_approval [interrupt] -> finalize -> END
//
import { StateGraph, START, END, MemorySaver, Command } from "@langchain/langgraph";
import { CaseState } from "./state.js";
import { intake, routeAfterIntake } from "./intake.js";
import { policyRag, grade, routeAfterGrade } from "./retrieval.js";
import { regCheck } from "./regulation.js";
import { strategise, routeAfterStrategise } from "./strategy.js";
import { draft, critique, routeAfterCritique } from "./drafting.js";
import { humanApproval, routeAfterApproval, finalize, toReviewQueue } from "./approval.js";
import { getEngine, totalCost } from "../llm/router.js";
import { todayIST } from "./util.js";
import { checkOmbudsmanEligibility } from "../rules/tools.js";

export const NODE_ORDER = ["intake", "policy_rag", "grade", "reg_check", "strategise", "draft", "critique", "human_approval", "finalize"];

export function buildGraph(checkpointer = new MemorySaver()) {
  const g = new StateGraph(CaseState)
    .addNode("intake", intake)
    .addNode("policy_rag", policyRag)
    .addNode("grade", grade)
    .addNode("reg_check", regCheck)
    .addNode("strategise", strategise)
    .addNode("draft", draft)
    .addNode("critique", critique)
    .addNode("human_approval", humanApproval)
    .addNode("finalize", finalize)
    .addNode("human_review", toReviewQueue)
    .addEdge(START, "intake")
    .addConditionalEdges("intake", routeAfterIntake, ["human_review", "policy_rag"])
    .addEdge("policy_rag", "grade")
    .addConditionalEdges("grade", routeAfterGrade, ["policy_rag", "reg_check"])
    .addEdge("reg_check", "strategise")
    .addConditionalEdges("strategise", routeAfterStrategise, ["draft", END])
    .addEdge("draft", "critique")
    .addConditionalEdges("critique", routeAfterCritique, ["draft", "human_approval", "human_review"])
    .addConditionalEdges("human_approval", routeAfterApproval, ["finalize", END])
    .addEdge("finalize", END)
    .addEdge("human_review", END);
  return g.compile({ checkpointer });
}

function newId() {
  return `case-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const cfg = (threadId) => ({ configurable: { thread_id: threadId }, recursionLimit: 40, runName: "claimshield", tags: ["claimshield"] });

/** What the browser is allowed to see. */
export function publicView(values, status) {
  const engine = getEngine(values.mode);
  return {
    status, case_id: values.case_id, stage: values.stage,
    engine: { provider: engine.provider, label: engine.label, models: engine.models || null },
    facts: values.facts, confidence: values.confidence, overall_confidence: values.overall_confidence, missing: values.missing,
    flags: values.flags, pii_count: values.pii_count,
    clauses: values.clauses, findings: values.findings, grounds: values.grounds, score: values.score, band: values.band,
    draft: values.draft_text, critique: values.review, revision: values.revision, rag_attempts: values.rag_attempts,
    review_reason: values.review_reason, final: values.final, trace: values.trace, cost: totalCost(values.usage), usage: values.usage,
  };
}

function statusOf(snapshot) {
  const v = snapshot.values;
  if (snapshot.next?.includes("human_approval")) return "awaiting_approval";
  if (v.outcome === "needs_review") return "needs_review";
  if (v.outcome === "no_grounds") return "no_grounds";
  if (v.outcome === "approved") return "approved";
  if (v.outcome === "rejected") return "rejected";
  return "ended";
}

async function streamRun(graph, input, config, onEvent) {
  const stream = await graph.stream(input, { ...config, streamMode: "updates" });
  for await (const chunk of stream) {
    for (const [node, update] of Object.entries(chunk)) {
      if (node === "__interrupt__") { onEvent?.({ type: "interrupt" }); continue; }
      const t = update?.trace?.[update.trace.length - 1];
      if (t) onEvent?.({ type: "node", node, trace: t });
    }
  }
  return graph.getState(config);
}

/** First stage: run from the documents up to the approval interrupt (or an early end). */
export async function runAnalysis({ docs, mode = "auto", factsOverride = null, today = todayIST() }, onEvent) {
  const graph = buildGraph();
  const case_id = newId();
  const snapshot = await streamRun(graph, { case_id, docs, mode, facts_override: factsOverride, today, stage: "grievance" }, cfg(case_id), onEvent);
  return { status: statusOf(snapshot), values: snapshot.values };
}

/**
 * Serverless-friendly resume. Vercel functions do not share memory, so the
 * checkpoint travels with the browser as a signed token (see state-token.js).
 * Here we load it into a fresh checkpointer as if `critique` had just finished,
 * let the graph reach the interrupt again, then resume it with the decision.
 */
export async function resumeWithDecision(savedValues, decision, onEvent) {
  if (!savedValues?.review?.pass) throw new Error("This case is not waiting for approval.");
  const graph = buildGraph();
  const config = cfg(savedValues.case_id || newId());
  const { trace, usage, ...rest } = savedValues;
  await graph.updateState(config, { ...rest, trace, usage, approval_status: "pending", outcome: "" }, "critique");
  await graph.invoke(null, config); // runs into human_approval and pauses at interrupt()
  const paused = await graph.getState(config);
  if (!paused.next?.includes("human_approval")) throw new Error("Graph did not pause for approval.");
  const snapshot = await streamRun(graph, new Command({ resume: decision }), config, onEvent);
  return { status: statusOf(snapshot), values: snapshot.values };
}

/** Second stage: draft the Ombudsman complaint from an approved grievance case. */
export async function runEscalation(savedValues, escalation, onEvent, today = todayIST()) {
  if (!savedValues?.grounds?.length) throw new Error("No grounds to escalate.");
  const f = savedValues.facts || {};
  const eligibility = checkOmbudsmanEligibility({
    amount_in_dispute: f.isRepudiation ? f.amountClaimed : f.amountDisputed,
    grievance_sent_on: escalation?.grievance_sent_on, insurer_replied_on: escalation?.insurer_replied_on || null,
    insurer_rejected: escalation?.insurer_reply === "rejected" || escalation?.insurer_reply === "unsatisfactory", today,
  });
  if (!eligibility.eligible) return { status: "not_eligible", eligibility, values: savedValues };
  const graph = buildGraph();
  const config = cfg(`${savedValues.case_id || newId()}-omb`);
  const { trace: _t, usage: _u, ...rest } = savedValues;
  await graph.updateState(config, {
    ...rest, stage: "ombudsman", escalation, today, draft_text: "", review: null, revision: 0,
    approval_status: "pending", outcome: "", final: null, trace: [], usage: [],
  }, "strategise");
  const snapshot = await streamRun(graph, null, config, onEvent);
  return { status: statusOf(snapshot), eligibility, values: snapshot.values };
}
