import { test } from "node:test";
import assert from "node:assert/strict";
import { checkMoratorium, checkTimelines, checkWaitingPeriod, checkCrcApproval, checkReasonsGiven, checkOmbudsmanEligibility, getClause, TOOLS } from "../lib/rules/tools.js";
import { RULES, getRule } from "../lib/rules/rules.js";

test("moratorium: 59 months does not protect, 60 does", () => {
  assert.equal(checkMoratorium({ tenure_months: 59 }).favours, false);
  assert.equal(checkMoratorium({ tenure_months: 60 }).favours, true);
  assert.equal(checkMoratorium({ tenure_months: 60 }).contestable_by_insurer, false);
});

test("moratorium: fraud lifts the protection", () => {
  const r = checkMoratorium({ tenure_months: 72, alleged_ground: "fraud" });
  assert.equal(r.favours, false);
  assert.equal(r.contestable_by_insurer, true);
});

test("moratorium: unknown tenure is not guessed", () => {
  const r = checkMoratorium({ tenure_months: null });
  assert.equal(r.applicable, false);
  assert.equal(r.favours, false);
});

test("timelines: discharge authorisation beyond 3 hours is a breach", () => {
  const r = checkTimelines({ cashless: true, preauth_request_ts: "2026-10-09T08:40", preauth_decision_ts: "2026-10-09T09:25", discharge_request_ts: "2026-10-12T10:05", discharge_auth_ts: "2026-10-12T19:20", extra_charges: 6500 });
  assert.equal(r.favours, true);
  assert.deepEqual(r.breaches.map((b) => b.rule), ["R-DISCHARGE-3H"]);
  assert.equal(r.breaches[0].actual_hours, 9.3);
});

test("timelines: within limits, and not applicable to reimbursement claims", () => {
  assert.equal(checkTimelines({ cashless: true, discharge_request_ts: "2026-10-12T10:00", discharge_auth_ts: "2026-10-12T12:30" }).favours, false);
  assert.equal(checkTimelines({ cashless: false }).applicable, false);
});

test("timelines: cashless decision beyond 1 hour is a breach", () => {
  const r = checkTimelines({ cashless: true, preauth_request_ts: "2026-10-09T08:00", preauth_decision_ts: "2026-10-09T10:30" });
  assert.deepEqual(r.breaches.map((b) => b.rule), ["R-CASHLESS-1H"]);
});

test("waiting period: completed at 36 months, capped at 36 even if the policy says 48", () => {
  assert.equal(checkWaitingPeriod({ tenure_months: 35, policy_waiting_months: 36 }).favours, false);
  assert.equal(checkWaitingPeriod({ tenure_months: 36, policy_waiting_months: 36 }).favours, true);
  const capped = checkWaitingPeriod({ tenure_months: 40, policy_waiting_months: 48 });
  assert.equal(capped.favours, true);
  assert.equal(capped.effective_waiting_months, 36);
  assert.equal(checkWaitingPeriod({ tenure_months: 20, policy_waiting_months: 24 }).favours, false);
});

test("CRC approval: detected when mentioned, flagged when absent", () => {
  assert.equal(checkCrcApproval({ is_repudiation: true, letter_text: "Approved by the Claims Review Committee on 20 October." }).favours, false);
  assert.equal(checkCrcApproval({ is_repudiation: true, letter_text: "We regret our inability to admit the claim." }).favours, true);
  assert.equal(checkCrcApproval({ is_repudiation: false, letter_text: "" }).applicable, false);
});

test("reasons: a cited clause counts, a bare assertion does not", () => {
  assert.equal(checkReasonsGiven({ letter_text: "not payable under clause 3.1 of the policy" }).favours, false);
  assert.equal(checkReasonsGiven({ letter_text: "deducted on tariff benchmarking" }).favours, true);
});

test("ombudsman: Rs 50 lakh cap, one-month wait, one-year limit", () => {
  const base = { amount_in_dispute: 210000, today: "2026-11-17" };
  assert.equal(checkOmbudsmanEligibility({ ...base, grievance_sent_on: "2026-11-10" }).eligible, false); // 7 days
  assert.equal(checkOmbudsmanEligibility({ ...base, grievance_sent_on: "2026-10-10" }).eligible, true); // 38 days, no reply
  assert.equal(checkOmbudsmanEligibility({ ...base, grievance_sent_on: "2026-11-10", insurer_rejected: true, insurer_replied_on: "2026-11-14" }).eligible, true);
  assert.equal(checkOmbudsmanEligibility({ ...base, amount_in_dispute: 5000001, grievance_sent_on: "2026-10-10" }).eligible, false);
  assert.equal(checkOmbudsmanEligibility({ ...base, amount_in_dispute: 5000000, grievance_sent_on: "2026-10-10" }).eligible, true);
  assert.equal(checkOmbudsmanEligibility({ ...base, grievance_sent_on: "2024-01-01" }).eligible, false); // out of time
});

test("every rule has a source, and get_clause refuses unknown ids", () => {
  for (const id of Object.keys(RULES)) assert.ok(getRule(id).sourceTitle, id);
  assert.equal(getClause({ rule_id: "R-MORATORIUM" }).found, true);
  assert.equal(getClause({ rule_id: "R-MADE-UP" }).found, false);
  assert.equal(Object.keys(TOOLS).includes("send_email"), false); // no send tool exists at all
});

test("waiting period: unknown tenure is not guessed", () => {
  assert.equal(checkWaitingPeriod({ tenure_months: null, policy_waiting_months: 36 }).applicable, false);
});
