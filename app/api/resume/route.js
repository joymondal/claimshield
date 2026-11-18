// POST /api/resume - resumes the paused graph with the policyholder's decision.
import { resumeWithDecision, publicView } from "../../../lib/agents/graph.js";
import { openState } from "../../../lib/state-token.js";
import { LIMITS } from "../../../lib/guard/guard.js";
import { json, tokenFor, flushTraces, allow, requireUser } from "../../../lib/api-helpers.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req) {
  const denied = await requireUser(req); // checked here as well as in proxy.js
  if (denied) return denied;
  let body;
  try { body = await req.json(); } catch { return json({ error: "Send a JSON body." }, 400); }
  if (!allow(req, "resume", 80)) return json({ error: "Too many requests. Try again later." }, 429);
  let saved;
  try { saved = openState(body?.token); } catch (e) { return json({ error: e.message }, 400); }
  const action = body.action === "approve" ? "approve" : "reject";
  if (action === "approve" && body.declaration !== true) {
    return json({ error: "Tick the box confirming that you have read the letter and are sending it in your own name." }, 400);
  }
  const editedDraft = typeof body.editedDraft === "string" ? body.editedDraft.slice(0, LIMITS.maxDraftChars) : undefined;
  try {
    const out = await resumeWithDecision(saved, { action, declaration: body.declaration === true, editedDraft });
    return json({ status: out.status, view: publicView(out.values, out.status), token: tokenFor(out.values) });
  } catch (e) {
    return json({ error: e.message || "Could not resume the case." }, 500);
  } finally {
    await flushTraces();
  }
}
