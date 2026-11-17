// GET /api/status - tells the page which engine is active and lists the sample cases.
import { getEngine, PRICES_VERIFIED_ON } from "../../../lib/llm/router.js";
import { SAMPLE_LIST } from "../../../lib/samples.js";
import { json } from "../../../lib/api-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getEngine("auto");
  return json({
    engine: { provider: engine.provider, label: engine.label, models: engine.models || null },
    tracing: process.env.LANGSMITH_TRACING === "true",
    prices_verified_on: PRICES_VERIFIED_ON,
    samples: SAMPLE_LIST,
  });
}
