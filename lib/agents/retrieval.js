// Agent 2 - Policy-RAG with Corrective RAG (CRAG).
// policy_rag retrieves clauses from the user's own policy wording.
// grade judges each clause; if nothing relevant came back it rewrites the query
// and sends the graph back to policy_rag (at most two retries).
import { chunkPolicy, bm25Search, gradeChunk, rewriteQuery } from "../rag/rag.js";
import { callLLM, getEngine } from "../llm/router.js";
import { UNTRUSTED_NOTICE } from "../guard/guard.js";
import { traceEntry } from "./util.js";

export const MAX_RAG_ATTEMPTS = 3; // first try + two rewrites

export async function policyRag(state) {
  const started = Date.now();
  const chunks = state.chunks?.length ? state.chunks : chunkPolicy(state.docs.policy || "");
  const attempt = (state.rag_attempts || 0) + 1;
  const query = state.query || state.facts?.rejectionReasonText || state.facts?.rejectionCategory || "";
  const retrieved = bm25Search(chunks, query, 5);
  return {
    chunks, query, rag_attempts: attempt, retrieved,
    trace: [traceEntry("policy_rag", "Policy-RAG agent: retrieve", "Agentic RAG: BM25 retrieval over the policy wording", started, "offline",
      `Attempt ${attempt}: searched ${chunks.length} policy clauses, got ${retrieved.length} candidates.`,
      { attempt, query: query.slice(0, 220), candidates: retrieved.map((c) => ({ id: c.id, clause: c.clause, heading: c.heading, score: c.score })) })],
  };
}

const GRADER_SYSTEM = `You are the relevance grader of ClaimShield (Corrective RAG).
${UNTRUSTED_NOTICE}
You get an insurer's rejection reason and candidate clauses from the policy wording.
For each clause decide whether it helps to assess whether the rejection is correct.
Return ONLY JSON: {"grades":[{"id":"P-1","grade":"relevant"|"partial"|"irrelevant"}]}`;

export async function grade(state) {
  const started = Date.now();
  const engine = getEngine(state.mode);
  const category = state.facts?.rejectionCategory || "other";
  const reason = state.facts?.rejectionReasonText || "";
  let grades = state.retrieved.map((c) => gradeChunk(c, category, reason));
  let used = "offline", note = "";
  const usage = [];
  if (engine.provider !== "offline" && state.retrieved.length) {
    try {
      const user = `Rejection reason: ${reason}\nCategory: ${category}\n\n` +
        state.retrieved.map((c) => `<document name="${c.id}">\n${c.heading}\n${c.text.slice(0, 600)}\n</document>`).join("\n");
      const r = await callLLM(engine, { tier: "cheap", system: GRADER_SYSTEM, user, json: true, maxTokens: 500, node: "grade" });
      usage.push(r.usage);
      const ids = new Set(state.retrieved.map((c) => c.id));
      const live = (r.json?.grades || []).filter((g) => ids.has(g.id) && ["relevant", "partial", "irrelevant"].includes(g.grade));
      if (!live.length) throw new Error("grader returned no usable grades");
      // keep the stricter of the two graders so a model cannot wave everything through
      const byId = Object.fromEntries(live.map((g) => [g.id, g.grade]));
      const rank = { irrelevant: 0, partial: 1, relevant: 2 };
      grades = grades.map((g) => {
        const lg = byId[g.id] ?? g.grade;
        const pick = rank[lg] >= 2 && rank[g.grade] === 0 ? "partial" : lg;
        return { ...g, grade: pick, live: lg };
      });
      used = `${engine.provider}:${r.usage.model}`;
    } catch (e) {
      note = ` Live grader unavailable (${e.message}); used the keyword grader.`;
    }
  }
  const relevantIds = new Set(grades.filter((g) => g.grade === "relevant").map((g) => g.id));
  const clauses = state.retrieved.filter((c) => relevantIds.has(c.id)).slice(0, 3);
  const needRetry = clauses.length === 0 && state.rag_attempts < MAX_RAG_ATTEMPTS;
  const update = {
    clauses,
    usage,
    trace: [traceEntry("grade", "Policy-RAG agent: grade", "Corrective RAG: grade, then rewrite the query if needed", started, used,
      clauses.length
        ? `Kept ${clauses.length} relevant clause(s): ${clauses.map((c) => `${c.id} ${c.heading}`).join("; ")}.${note}`
        : needRetry
          ? `No retrieved clause was relevant. Rewriting the query and searching again.${note}`
          : `No relevant clause found after ${state.rag_attempts} attempts. Continuing without policy clauses.${note}`,
      { grades, retry: needRetry })],
  };
  if (needRetry) update.query = rewriteQuery(category, state.rag_attempts === 1 ? reason : "");
  return update;
}

export function routeAfterGrade(state) {
  return state.clauses.length === 0 && state.rag_attempts < MAX_RAG_ATTEMPTS ? "policy_rag" : "reg_check";
}
