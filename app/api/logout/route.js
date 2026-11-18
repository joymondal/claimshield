// POST /api/logout - ends the session.
import { sessionCookie, redirectTo } from "../../../lib/auth.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req) {
  return redirectTo(req, "/login?signed_out=1", sessionCookie("", req));
}
