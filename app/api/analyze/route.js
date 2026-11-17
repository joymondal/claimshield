// POST /api/analyze - runs the agent graph up to the human-approval interrupt.
import { runAnalysis } from "../../../lib/agents/graph.js";
import { getSample } from "../../../lib/samples.js";
import { LIMITS } from "../../../lib/guard/guard.js";
import { ndjsonStream, json, allow } from "../../../lib/api-helpers.js";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Send a JSON body." }, 400); }
  if (body?.consent !== true) return json({ error: "Consent is required before any document is processed." }, 400);
  if (!allow(req, "analyze", 40)) return json({ error: "Too many analyses from this address in the last hour. Try again later." }, 429);

  let docs;
  if (body.sampleId) {
    const s = getSample(body.sampleId);
    if (!s) return json({ error: "Unknown sample case." }, 400);
    docs = s.docs;
  } else {
    const d = body.docs || {};
    docs = { rejection: String(d.rejection || ""), policy: String(d.policy || ""), discharge: String(d.discharge || ""), bill: String(d.bill || "") };
    if (docs.rejection.trim().length < 40) return json({ error: "Add the insurer's rejection or settlement letter (at least a few lines of text)." }, 400);
    const total = Object.values(docs).reduce((a, t) => a + t.length, 0);
    if (total > LIMITS.maxTotalChars) return json({ error: "The documents are too long. Keep the total under about 160,000 characters." }, 413);
  }
  const mode = body.mode === "offline" ? "offline" : "auto";
  const factsOverride = body.factsOverride && typeof body.factsOverride === "object" ? body.factsOverride : null;
  return ndjsonStream((send) => runAnalysis({ docs, mode, factsOverride }, send));
}
