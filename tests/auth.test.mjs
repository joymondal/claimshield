// Sign-in: sessions, credentials, redirects, the proxy and the API routes.
import test from "node:test";
import assert from "node:assert/strict";
import { authEnabled, checkCredentials, createSession, readSession, safeNext, SESSION_COOKIE, SESSION_HOURS } from "../lib/auth.js";
import { proxy } from "../proxy.js";
import { POST as login } from "../app/api/login/route.js";
import { POST as logout } from "../app/api/logout/route.js";
import { POST as analyze } from "../app/api/analyze/route.js";
import { GET as status } from "../app/api/status/route.js";

const KEYS = ["APP_USERNAME", "APP_PASSWORD", "STATE_SECRET"];
const on = () => Object.assign(process.env, { APP_USERNAME: "prof", APP_PASSWORD: "correct horse battery", STATE_SECRET: "a-long-random-test-secret-0123456789" });
test.beforeEach(() => KEYS.forEach((k) => delete process.env[k]));
test.afterEach(() => KEYS.forEach((k) => delete process.env[k]));

const req = (path, { cookie, method = "GET", form, json } = {}) => new Request(`https://claimshield.example${path}`, {
  method,
  headers: { ...(cookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}), ...(json ? { "content-type": "application/json" } : {}), "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 200)}` },
  body: form ? new URLSearchParams(form) : json ? JSON.stringify(json) : undefined,
});
const passes = (res) => res === undefined; // the proxy returns nothing to let a request through

test("auth: off by default; the proxy lets everything through", async () => {
  assert.equal(authEnabled(), false);
  assert.ok(passes(await proxy(req("/"))));
  assert.ok(passes(await proxy(req("/api/analyze", { method: "POST" }))));
  assert.equal(await checkCredentials("prof", "x"), false);
});

test("auth: credentials must match exactly", async () => {
  on();
  assert.equal(await checkCredentials("prof", "correct horse battery"), true);
  assert.equal(await checkCredentials("prof", "correct horse batter"), false);
  assert.equal(await checkCredentials("Prof", "correct horse battery"), false);
  assert.equal(await checkCredentials("", ""), false);
});

test("auth: sessions verify, expire, and cannot be forged", async () => {
  on();
  const t0 = Date.UTC(2026, 10, 18);
  const s = await createSession("prof", t0);
  assert.deepEqual(await readSession(s, t0 + 1000), { u: "prof" });
  assert.equal(await readSession(s, t0 + SESSION_HOURS * 3600 * 1000 + 1), null, "expired");
  const [payload, mac] = s.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "admin", exp: t0 + 9e12 })).toString("base64url");
  assert.equal(await readSession(`${forged}.${mac}`, t0), null, "payload changed");
  assert.equal(await readSession(`${payload}.${mac.slice(0, -1)}A`, t0), null, "signature changed");
  assert.equal(await readSession("garbage", t0), null);
  process.env.STATE_SECRET = "a-different-secret-entirely-9876";
  assert.equal(await readSession(s, t0 + 1000), null, "a session from another secret");
});

test("auth: no session can be created or accepted without STATE_SECRET", async () => {
  on();
  const s = await createSession("prof");
  delete process.env.STATE_SECRET;
  await assert.rejects(() => createSession("prof"), /STATE_SECRET/);
  assert.equal(await readSession(s), null);
});

test("auth: redirect targets stay on this site", () => {
  assert.equal(safeNext("/"), "/");
  assert.equal(safeNext("/?x=1"), "/?x=1");
  for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/login", "/api/analyze", "/x\r\nSet-Cookie: a=b", null, 42]) assert.equal(safeNext(bad), "/", String(bad));
});

test("proxy: pages redirect to sign-in, APIs return 401, a valid session passes", async () => {
  on();
  const page = await proxy(req("/"));
  assert.equal(page.status, 307);
  assert.equal(new URL(page.headers.get("location")).pathname, "/login");
  const api = await proxy(req("/api/analyze", { method: "POST" }));
  assert.equal(api.status, 401);
  assert.ok(passes(await proxy(req("/login"))));
  assert.ok(passes(await proxy(req("/api/login", { method: "POST" }))));
  const cookie = await createSession("prof");
  assert.ok(passes(await proxy(req("/", { cookie }))));
  assert.ok(passes(await proxy(req("/api/analyze", { method: "POST", cookie }))));
  assert.equal((await proxy(req("/", { cookie: cookie + "x" }))).status, 307);
});

test("login route: right password sets a secure, HttpOnly cookie; wrong password does not", async () => {
  on();
  const ok = await login(req("/api/login", { method: "POST", form: { username: "prof", password: "correct horse battery", next: "/" } }));
  assert.equal(ok.status, 303);
  assert.equal(new URL(ok.headers.get("location")).pathname, "/");
  const setCookie = ok.headers.get("set-cookie");
  assert.match(setCookie, new RegExp(`^${SESSION_COOKIE}=`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /SameSite=lax/i);
  const value = setCookie.split(";")[0].slice(SESSION_COOKIE.length + 1);
  assert.deepEqual(await readSession(decodeURIComponent(value)), { u: "prof" });

  const bad = await login(req("/api/login", { method: "POST", form: { username: "prof", password: "nope", next: "https://evil.example" } }));
  assert.equal(bad.status, 303);
  const loc = new URL(bad.headers.get("location"));
  assert.equal(loc.pathname, "/login");
  assert.equal(loc.searchParams.get("error"), "1");
  assert.equal(loc.searchParams.get("next"), null, "an off-site next is dropped");
  assert.equal(bad.headers.get("set-cookie"), null);
});

test("login route: refuses to issue sessions when STATE_SECRET is missing", async () => {
  on();
  delete process.env.STATE_SECRET;
  const res = await login(req("/api/login", { method: "POST", form: { username: "prof", password: "correct horse battery" } }));
  assert.equal(new URL(res.headers.get("location")).searchParams.get("error"), "config");
  assert.equal(res.headers.get("set-cookie"), null);
});

test("API routes check the session themselves, even if the proxy were bypassed", async () => {
  on();
  const denied = await analyze(req("/api/analyze", { method: "POST", json: { consent: true, sampleId: "meena-moratorium", mode: "offline" } }));
  assert.equal(denied.status, 401);
  const cookie = await createSession("prof");
  const allowed = await analyze(req("/api/analyze", { method: "POST", cookie, json: { consent: true, sampleId: "meena-moratorium", mode: "offline" } }));
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers.get("content-type"), /ndjson/);
  await allowed.text();
  const s = await (await status(req("/api/status", { cookie }))).json();
  assert.deepEqual(s.auth, { user: "prof" });
});

test("logout route: clears the cookie and returns to the sign-in page", async () => {
  const res = await logout(req("/api/logout", { method: "POST" }));
  assert.equal(res.status, 303);
  assert.equal(new URL(res.headers.get("location")).pathname, "/login");
  assert.match(res.headers.get("set-cookie"), new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`, "i"));
});
