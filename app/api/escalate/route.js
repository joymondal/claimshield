// POST /api/escalate - second stage: draft the complaint to the Insurance Ombudsman.
import { runEscalation } from "../../../lib/agents/graph.js";
import { openState } from "../../../lib/state-token.js";
import { parseDate } from "../../../lib/agents/util.js";
import { ndjsonStream, json, allow, requireUser } from "../../../lib/api-helpers.js";

export const runtime = "nodejs";
export const maxDuration = 300; // live runs may wait out free-tier rate limits (Vercel Hobby with Fluid compute allows 300 s)
export const dynamic = "force-dynamic";

export async function POST(req) {
  const denied = await requireUser(req); // checked here as well as in proxy.js
  if (denied) return denied;
  let body;
  try { body = await req.json(); } catch { return json({ error: "Send a JSON body." }, 400); }
  if (!allow(req, "escalate", 40)) return json({ error: "Too many requests. Try again later." }, 429);
  let saved;
  try { saved = openState(body?.token); } catch (e) { return json({ error: e.message }, 400); }
  if (saved.approval_status !== "approved" || saved.stage !== "grievance") {
    return json({ error: "Approve the grievance letter first. The Ombudsman complaint builds on it." }, 400);
  }
  const e = body.escalation || {};
  const sent = parseDate(e.grievance_sent_on);
  if (!sent) return json({ error: "Enter the date on which you sent the grievance to the insurer." }, 400);
  const reply = ["none", "rejected", "unsatisfactory"].includes(e.insurer_reply) ? e.insurer_reply : "none";
  const escalation = { grievance_sent_on: sent, insurer_reply: reply, insurer_replied_on: reply === "none" ? null : parseDate(e.insurer_replied_on) };
  return ndjsonStream((send) => runEscalation(saved, escalation, send));
}
