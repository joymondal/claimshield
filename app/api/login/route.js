// POST /api/login - checks the username and password from the sign-in form and sets a session cookie.
import { authEnabled, sessionSecretReady, checkCredentials, createSession, sessionCookie, safeNext, redirectTo } from "../../../lib/auth.js";
import { rateLimit } from "../../../lib/guard/guard.js";
import { clientIp } from "../../../lib/api-helpers.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const back = (req, params) => redirectTo(req, `/login?${new URLSearchParams(params)}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function POST(req) {
  if (!authEnabled()) return redirectTo(req, "/");
  let form;
  try { form = await req.formData(); } catch { return back(req, { error: "1" }); }
  const next = safeNext(form.get("next"));
  const keep = next === "/" ? {} : { next };
  if (!sessionSecretReady()) return back(req, { error: "config", ...keep });
  if (!rateLimit(`login:${clientIp(req)}`, 10, 15 * 60 * 1000)) return back(req, { error: "locked", ...keep });
  const username = String(form.get("username") || "");
  if (!(await checkCredentials(username, String(form.get("password") || "")))) {
    await sleep(400); // slows down guessing
    return back(req, { error: "1", ...keep });
  }
  return redirectTo(req, next, sessionCookie(await createSession(username), req));
}
