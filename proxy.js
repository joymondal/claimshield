// Runs before every page and API request (Next.js 16 "proxy", formerly middleware).
// When sign-in is on, anyone without a valid session is sent to /login, and API calls get 401.
// The API routes check the session again themselves, so a gap here does not open them.
// Returning nothing lets the request continue.
import { authEnabled, sessionFromRequest } from "./lib/auth.js";

const PUBLIC = new Set(["/login", "/api/login", "/api/logout", "/icon.svg"]);

export async function proxy(request) {
  if (!authEnabled()) return;
  const { pathname, search } = new URL(request.url);
  if (PUBLIC.has(pathname)) return;
  if (await sessionFromRequest(request)) return;
  if (pathname.startsWith("/api/")) return Response.json({ error: "Sign in to use ClaimShield." }, { status: 401, headers: { "cache-control": "no-store" } });
  const url = new URL("/login", request.url);
  if (pathname !== "/") url.searchParams.set("next", pathname + search);
  return Response.redirect(url, 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
