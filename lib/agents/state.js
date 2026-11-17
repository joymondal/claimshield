// Shared state for the LangGraph graph. Each agent reads the state and returns a partial update.
import { Annotation } from "@langchain/langgraph";

const last = (dflt) => ({ reducer: (_a, b) => b, default: () => dflt });
const append = { reducer: (a, b) => a.concat(b ?? []), default: () => [] };

export const CaseState = Annotation.Root({
  case_id: Annotation(last("")),
  stage: Annotation(last("grievance")), // "grievance" | "ombudsman"
  mode: Annotation(last("auto")), // "auto" | "offline"
  today: Annotation(last("")),
  docs: Annotation(last({})), // { rejection, policy, discharge, bill } after screening + redaction
  facts_override: Annotation(last(null)),
  facts: Annotation(last(null)),
  confidence: Annotation(last({})),
  overall_confidence: Annotation(last(1)),
  missing: Annotation(last([])),
  flags: Annotation(last([])), // prompt-injection findings
  pii_map: Annotation(last({})),
  pii_count: Annotation(last(0)),
  chunks: Annotation(last([])),
  query: Annotation(last("")),
  rag_attempts: Annotation(last(0)),
  retrieved: Annotation(last([])),
  clauses: Annotation(last([])), // policy chunks graded relevant
  findings: Annotation(last([])), // results of rule tools
  grounds: Annotation(last([])), // ranked grounds of appeal
  score: Annotation(last(0)),
  band: Annotation(last("Low")),
  draft_text: Annotation(last("")),
  review: Annotation(last(null)),
  revision: Annotation(last(0)),
  approval_status: Annotation(last("pending")), // pending | approved | rejected
  outcome: Annotation(last("")), // awaiting_approval | needs_review | no_grounds | approved | rejected
  review_reason: Annotation(last("")),
  final: Annotation(last(null)),
  escalation: Annotation(last(null)), // info supplied for the Ombudsman stage
  trace: Annotation(append),
  usage: Annotation(append),
});
