import { test } from "node:test";
import assert from "node:assert/strict";
import { runAnalysis, resumeWithDecision, runEscalation } from "../lib/agents/graph.js";
import { finalize } from "../lib/agents/approval.js";
import { reviewDraft } from "../lib/agents/drafting.js";
import { chunkPolicy, bm25Search } from "../lib/rag/rag.js";
import { extractOffline } from "../lib/agents/extract.js";
import { SAMPLES, getSample, POLICY_WORDING } from "../lib/samples.js";

const TODAY = "2026-11-17";
const run = (id, extra = {}) => runAnalysis({ docs: getSample(id).docs, mode: "offline", today: TODAY, ...extra });
const nodes = (v) => v.trace.map((t) => t.node);
const clone = (x) => JSON.parse(JSON.stringify(x));

test("chunker splits on clause numbers and BM25 finds the moratorium clause", () => {
  const chunks = chunkPolicy(POLICY_WORDING);
  assert.ok(chunks.length >= 14);
  assert.ok(chunks.every((c) => c.text.length > 40));
  const top = bm25Search(chunks, "non-disclosure of material facts moratorium", 3);
  assert.ok(top.some((c) => /Moratorium/.test(c.heading)));
});

test("offline extraction reads the sample letter correctly", () => {
  const { facts } = extractOffline(getSample("meena-moratorium").docs);
  assert.equal(facts.policyNo, "NHI/FHS/2020/004518");
  assert.equal(facts.claimNo, "CLM/2026/118204");
  assert.equal(facts.tenureMonths, 74);
  assert.equal(facts.amountClaimed, 210000);
  assert.equal(facts.rejectionCategory, "non_disclosure");
  assert.equal(facts.fraudAlleged, false);
});

test("Meena: moratorium ground, High band, Critic loop, pauses for approval", async () => {
  const { status, values: v } = await run("meena-moratorium");
  assert.equal(status, "awaiting_approval");
  assert.equal(v.band, "High");
  assert.equal(v.grounds[0].id, "moratorium_60_months");
  assert.ok(v.grounds[0].cites.includes("R-MORATORIUM"));
  assert.equal(v.revision, 1, "the Critic should send the first pass back once");
  assert.equal(v.review.pass, true);
  assert.equal(v.final, null, "nothing final exists before approval");
  assert.ok(!nodes(v).includes("finalize"));
});

test("Ravi: Corrective RAG rewrites the query, discharge-delay ground found", async () => {
  const { status, values: v } = await run("ravi-deduction");
  assert.equal(status, "awaiting_approval");
  assert.equal(v.rag_attempts, 2, "first search should fail and trigger one rewrite");
  assert.ok(v.clauses.some((c) => /Reasonable and Customary/.test(c.heading)));
  assert.deepEqual(v.grounds.map((g) => g.id), ["discharge_delay_charges", "deduction_not_explained"]);
  assert.equal(v.grounds[0].amount, 6500);
  assert.equal(v.grounds[1].amount, 38000);
});

test("Anita: the hidden instruction is removed and nothing obeys it", async () => {
  const { status, values: v } = await run("anita-injection");
  assert.equal(status, "awaiting_approval");
  assert.equal(v.flags.length, 1);
  assert.equal(v.flags[0].doc, "hospital_bill");
  assert.ok(!v.docs.bill.includes("audit-desk"));
  assert.ok(!/pre-granted|audit-desk|claims auditor/i.test(v.draft_text));
  assert.equal(v.grounds[0].id, "waiting_period_completed");
  assert.equal(v.approval_status, "pending");
});

test("Suresh: a correct rejection gets a Low score and no letter", async () => {
  const { status, values: v } = await run("suresh-exclusion");
  assert.equal(status, "no_grounds");
  assert.equal(v.band, "Low");
  assert.equal(v.grounds.length, 0);
  assert.equal(v.draft_text, "");
  assert.ok(!nodes(v).includes("draft"));
});

test("unreadable documents go to human review, and corrected facts unblock the case", async () => {
  const docs = { rejection: "We are sorry to inform you that your recent request cannot be processed at this time by our office.", policy: "", discharge: "", bill: "" };
  const r1 = await runAnalysis({ docs, mode: "offline", today: TODAY });
  assert.equal(r1.status, "needs_review");
  assert.ok(r1.values.missing.length > 0);
  assert.ok(!nodes(r1.values).includes("draft"));
  const meena = getSample("meena-moratorium").docs;
  const r2 = await runAnalysis({ docs: { ...meena, rejection: meena.rejection.replace("First Policy Inception Date: 20 July 2020\n", "") }, mode: "offline", today: TODAY });
  assert.equal(r2.status, "needs_review", "without the inception date the moratorium cannot be checked");
  const r3 = await runAnalysis({ docs: { ...meena, rejection: meena.rejection.replace("First Policy Inception Date: 20 July 2020\n", "") }, mode: "offline", today: TODAY, factsOverride: { policyStart: "2020-07-20" } });
  assert.equal(r3.status, "awaiting_approval");
  assert.equal(r3.values.facts.tenureMonths, 74);
});

test("approval: resume produces the final letter with references and deadlines", async () => {
  const { values } = await run("meena-moratorium");
  const out = await resumeWithDecision(clone(values), { action: "approve", declaration: true });
  assert.equal(out.status, "approved");
  const f = out.values.final;
  assert.ok(f.letter.includes("References"));
  assert.ok(!/\[R-|\[P-\d/.test(f.letter), "tags must be rendered as numbered references");
  assert.deepEqual(f.deadlines.map((d) => d.due), ["2026-11-17", "2026-12-01", "2026-12-17", "2027-12-17"]);
  assert.equal(f.audit.sent_by_claimshield, false);
  assert.ok(f.ics.includes("BEGIN:VCALENDAR"));
  assert.deepEqual(nodes(out.values).slice(-2), ["human_approval", "finalize"]);
});

test("approval: reject, or approve without the declaration, produces nothing", async () => {
  const { values } = await run("meena-moratorium");
  const a = await resumeWithDecision(clone(values), { action: "reject" });
  assert.equal(a.status, "rejected");
  assert.equal(a.values.final, null);
  const b = await resumeWithDecision(clone(values), { action: "approve", declaration: false });
  assert.equal(b.status, "rejected");
  assert.equal(b.values.final, null);
});

test("approval: the user's edits are what gets finalised", async () => {
  const { values } = await run("ravi-deduction");
  const edited = values.draft_text.replace("Dear Sir or Madam,", "Dear Grievance Officer,");
  const out = await resumeWithDecision(clone(values), { action: "approve", declaration: true, editedDraft: edited });
  assert.ok(out.values.final.letter.includes("Dear Grievance Officer,"));
});

test("invariant: finalize throws if it is ever reached without approval", async () => {
  const { values } = await run("meena-moratorium");
  await assert.rejects(() => finalize({ ...values, approval_status: "pending" }), /without approval/);
});

test("resume refuses a case that never passed the Critic", async () => {
  const { values } = await run("suresh-exclusion");
  await assert.rejects(() => resumeWithDecision(clone(values), { action: "approve", declaration: true }), /not waiting for approval/);
});

test("Critic catches an invented citation, a wrong amount and a threat", async () => {
  const { values } = await run("meena-moratorium");
  const bad = values.draft_text
    .replace("[R-MORATORIUM]", "[R-SECTION-45]")
    .replace("Rs 2,10,000.", "Rs 9,99,999.")
    .replace("Yours faithfully,", "Otherwise I will sue you in court.\n\nYours faithfully,");
  const r = reviewDraft(values, bad);
  assert.ok(r.faithfulness < 0.9);
  assert.ok(r.issues.some((i) => /R-SECTION-45/.test(i)));
  assert.ok(r.issues.some((i) => /9,99,999/.test(i)));
  assert.ok(r.issues.some((i) => /threatening/i.test(i)));
});

test("escalation: eligibility is checked first, then the complaint pauses for approval", async () => {
  const { values } = await run("meena-moratorium");
  const approved = await resumeWithDecision(clone(values), { action: "approve", declaration: true });
  const early = await runEscalation(clone(approved.values), { grievance_sent_on: "2026-11-10", insurer_reply: "none" }, null, TODAY);
  assert.equal(early.status, "not_eligible");
  const ok = await runEscalation(clone(approved.values), { grievance_sent_on: "2026-10-10", insurer_reply: "none" }, null, TODAY);
  assert.equal(ok.status, "awaiting_approval");
  assert.equal(ok.values.stage, "ombudsman");
  assert.ok(/The Insurance Ombudsman/.test(ok.values.draft_text));
  assert.ok(/not pending before/.test(ok.values.draft_text));
  const done = await resumeWithDecision(clone(ok.values), { action: "approve", declaration: true });
  assert.equal(done.status, "approved");
  assert.equal(done.values.final.stage, "ombudsman");
});

test("all sample cases land in the expected band", async () => {
  for (const s of SAMPLES) {
    const { values } = await run(s.id);
    assert.equal(values.band, s.expect, s.id);
  }
});
