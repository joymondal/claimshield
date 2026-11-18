// Sign-in for the whole app: one username and password, set as environment variables.
// Off unless both APP_USERNAME and APP_PASSWORD are set, so local runs and tests are unchanged.
// Uses Web Crypto only, so the same code runs in proxy.js and in the route handlers.

export const SESSION_COOKIE = "cs_session";
export const SESSION_HOURS = 8;

export function authEnabled() {
  return Boolean(process.env.APP_USERNAME && process.env.APP_PASSWORD);
}

// Sessions are signed with STATE_SECRET. There is deliberately no default: a default
// would be public in the repository and anyone could forge a session with it.
const secret = () => process.env.STATE_SECRET || "";
export const sessionSecretReady = () => secret().length >= 16;

const enc = new TextEncoder();
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

async function sign(data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`claimshield-session:${secret()}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}

function sameString(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Compare digests, not the raw strings, so the time taken does not reveal the length.
async function sameSecret(given, expected) {
  const [a, b] = await Promise.all([given, expected].map(async (s) => b64url(await crypto.subtle.digest("SHA-256", enc.encode(String(s ?? ""))))));
  return sameString(a, b);
}

export async function checkCredentials(username, password) {
  if (!authEnabled()) return false;
  const [u, p] = await Promise.all([sameSecret(username, process.env.APP_USERNAME), sameSecret(password, process.env.APP_PASSWORD)]);
  return u && p; // both comparisons always run
}

export async function createSession(username, now = Date.now()) {
  if (!sessionSecretReady()) throw new Error("STATE_SECRET must be set (16 characters or more) before sign-in can be used.");
  const payload = b64url(enc.encode(JSON.stringify({ u: String(username), exp: now + SESSION_HOURS * 3600 * 1000 })));
  return `${payload}.${await sign(payload)}`;
}

/** Returns { u } for a valid, unexpired session cookie, otherwise null. Never throws. */
export async function readSession(value, now = Date.now()) {
  try {
    if (!value || !sessionSecretReady()) return null;
    const [payload, mac] = String(value).split(".");
    if (!payload || !mac || !sameString(mac, await sign(payload))) return null;
    const data = JSON.parse(fromB64url(payload));
    if (typeof data?.exp !== "number" || data.exp <= now) return null;
    return { u: String(data.u) };
  } catch {
    return null;
  }
}

/** Set-Cookie header value for a new session (or for clearing it, with an empty value). */
export function sessionCookie(value, req) {
  const https = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const maxAge = value ? SESSION_HOURS * 3600 : 0;
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${https ? "; Secure" : ""}`;
}

/** A 303 redirect to a path on this site, optionally setting a cookie. */
export function redirectTo(req, path, cookie = null) {
  const headers = new Headers({ location: new URL(path, req.url).toString(), "cache-control": "no-store" });
  if (cookie) headers.append("set-cookie", cookie);
  return new Response(null, { status: 303, headers });
}

/** Only allow redirects to a path on this site, never to another site. */
export function safeNext(next) {
  const s = typeof next === "string" ? next : "";
  if (!s.startsWith("/") || s.startsWith("//") || s.startsWith("/\\") || /[\r\n]/.test(s) || s.startsWith("/login") || s.startsWith("/api/")) return "/";
  return s;
}

/** The session in a request's Cookie header: { u } or null. */
export function sessionFromRequest(req) {
  const cookie = (req.headers.get("cookie") || "").split(/;\s*/).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  let value = null;
  try { value = cookie ? decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) : null; } catch { /* malformed */ }
  return readSession(value);
}

/** For route handlers: the signed-in user, or null. Always a user when sign-in is off. */
export async function currentUser(req) {
  if (!authEnabled()) return { u: null };
  return sessionFromRequest(req);
}
