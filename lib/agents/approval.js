// Human-in-the-loop gate and the final action.
// human_approval pauses the graph with interrupt(). Nothing after it can run
// until a person approves. finalize refuses to run without that approval.
import { interrupt } from "@langchain/langgraph";
import { rehydrate, LIMITS } from "../guard/guard.js";
import { getRule } from "../rules/rules.js";
import { addDays, longDate, traceEntry } from "./util.js";
import { reviewDraft } from "./drafting.js";

export async function humanApproval(state) {
  // No side effects before interrupt(): this node runs again from the top on resume.
  const decision = interrupt({
    type: "approve_letter", stage: state.stage, draft: state.draft_text, score: state.score, band: state.band,
    grounds: state.grounds.map((g) => ({ title: g.title, strength: g.strength })),
  });
  const started = Date.now();
  const action = decision?.action;
  if (action !== "approve" || decision?.declaration !== true) {
    return {
      approval_status: "rejected", outcome: "rejected",
      trace: [traceEntry("human_approval", "Human approval", "Human-in-the-loop: interrupt and resume", started, "human",
        action === "approve" ? "Approval refused: the self-filing declaration was not ticked." : "The policyholder rejected the draft. Nothing was produced for sending.", { action: action || "none" })],
    };
  }
  const edited = typeof decision.editedDraft === "string" && decision.editedDraft.trim().length > 50 && decision.editedDraft.trim() !== state.draft_text.trim();
  const text = edited ? decision.editedDraft.slice(0, LIMITS.maxDraftChars) : state.draft_text;
  return {
    approval_status: "approved", draft_text: text,
    trace: [traceEntry("human_approval", "Human approval", "Human-in-the-loop: interrupt and resume", started, "human",
      edited ? "The policyholder edited the draft and approved it." : "The policyholder approved the draft as written.", { action: "approve", edited })],
  };
}

export function routeAfterApproval(state) {
  return state.approval_status === "approved" ? "finalize" : "__end__";
}

/** Turn [R-...] and [P-n] tags into numbered references with a reference list. */
export function renderReferences(text, clauses) {
  const order = [];
  const body = text.replace(/\s*\[((?:R-[A-Z0-9-]+)|(?:P-\d+))\]/g, (_m, id) => {
    if (!order.includes(id)) order.push(id);
    return ` [${order.indexOf(id) + 1}]`;
  }).replace(/(\[\d+\])(?: \1)+/g, "$1");
  const refs = order.map((id, i) => {
    if (id.startsWith("R-")) {
      const r = getRule(id);
      return { n: i + 1, id, text: r ? `${r.sourceTitle}, ${r.sourceRef}. ${r.title}.` : id };
    }
    const c = (clauses || []).find((x) => x.id === id);
    return { n: i + 1, id, text: c ? `Policy wording${c.clause ? `, clause ${c.clause}` : ""}: ${c.heading}.` : `Policy wording (${id}).` };
  });
  return { body, refs };
}

export function buildDeadlines(today, stage) {
  if (stage === "ombudsman") {
    return [
      { key: "file", label: "File the complaint yourself with the Insurance Ombudsman (online on the Council for Insurance Ombudsmen portal, or by post). There is no fee.", due: today },
      { key: "award", label: "The Ombudsman passes an award within three months of receiving all requirements; the insurer must comply within 30 days of the award.", due: addDays(today, 90) },
    ];
  }
  return [
    { key: "send", label: "Send the letter from your own email or by registered post, and keep proof of sending.", due: today },
    { key: "insurer_14", label: "Insurer's reply is due (14 days). If there is none, escalate on IRDAI's Bima Bharosa portal.", due: addDays(today, 14) },
    { key: "ombudsman_30", label: "If the insurer has still not replied after one month, or has rejected the grievance, you can complain to the Insurance Ombudsman.", due: addDays(today, 30) },
    { key: "ombudsman_last", label: "Last date to approach the Ombudsman if the insurer never replies (one year after the one-month wait).", due: addDays(today, 30 + 365) },
  ];
}

export function buildIcs(deadlines, title) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ev = deadlines.map((d, i) => [
    "BEGIN:VEVENT", `UID:claimshield-${d.key}-${stamp}-${i}@claimshield`, `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${d.due.replace(/-/g, "")}`, `SUMMARY:ClaimShield: ${title} - ${d.key.replace(/_/g, " ")}`,
    `DESCRIPTION:${d.label.replace(/[,;]/g, (m) => "\\" + m)}`, "END:VEVENT",
  ].join("\r\n"));
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ClaimShield//Course project//EN", ...ev, "END:VCALENDAR"].join("\r\n");
}

export async function finalize(state) {
  const started = Date.now();
  // Hard invariant: this node must never produce a letter that was not approved.
  if (state.approval_status !== "approved") throw new Error("Invariant violated: finalize reached without approval");
  const { body, refs } = renderReferences(state.draft_text, state.clauses);
  const letter = rehydrate(body, state.pii_map);
  const refBlock = refs.length ? `\n\nReferences\n${refs.map((r) => `[${r.n}] ${r.text}`).join("\n")}` : "";
  const footer = "\n\nPrepared with ClaimShield, an AI-assisted drafting tool. Reviewed and approved by the sender. ClaimShield does not give legal advice and does not represent the sender.";
  const deadlines = buildDeadlines(state.today, state.stage).map((d) => ({ ...d, due_text: longDate(d.due) }));
  const warnings = reviewDraft(state, state.draft_text).issues;
  const f = state.facts;
  const subject = (state.draft_text.match(/^Subject:\s*(.+)$/m) || [])[1] || "Grievance regarding my health insurance claim";
  const final = {
    stage: state.stage, letter: letter + refBlock + footer, subject, references: refs, deadlines,
    ics: buildIcs(deadlines, `${f.insurer || "insurer"} claim ${f.claimNo || ""}`.trim()),
    warnings,
    audit: { approved_at: new Date().toISOString(), approved_by: "policyholder (self)", sent_by_claimshield: false, note: "ClaimShield never sends anything. The policyholder sends the letter personally." },
  };
  return {
    final, outcome: "approved",
    trace: [traceEntry("finalize", "Action agent", "Runs only after approval: final letter + deadlines", started, "offline",
      `Prepared the approved ${state.stage === "ombudsman" ? "complaint" : "letter"} with ${refs.length} reference(s) and ${deadlines.length} deadline(s). Nothing was sent by ClaimShield.`,
      { references: refs.length, deadlines: deadlines.map((d) => ({ key: d.key, due: d.due })), warnings: warnings.length })],
  };
}

export async function toReviewQueue(state) {
  const started = Date.now();
  const reason = state.review_reason || (state.missing?.length
    ? `Some facts could not be read reliably: ${state.missing.join(", ")}.`
    : "The documents could not be read with enough confidence.");
  return {
    outcome: "needs_review", review_reason: reason,
    trace: [traceEntry("human_review", "Human review", "Escalation: low confidence goes to a person", started, "offline", `${reason} Waiting for a person to check the facts.`, { missing: state.missing })],
  };
}
