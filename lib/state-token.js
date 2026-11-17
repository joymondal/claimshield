// Signed case token. The case state is kept by the browser between the analysis
// and the approval, so the app needs no database. The HMAC signature means the
// server only accepts a state it produced itself (a user cannot hand-craft an
// "approved" state or swap in different grounds).
import { createHmac, timingSafeEqual } from "node:crypto";

const secret = () => process.env.STATE_SECRET || "claimshield-demo-secret-change-me";
const sign = (payload) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function sealState(values) {
  const payload = Buffer.from(JSON.stringify(values), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function openState(token) {
  if (typeof token !== "string" || !token.includes(".")) throw new Error("Missing or malformed case token.");
  const [payload, mac] = token.split(".");
  const expected = sign(payload);
  const a = Buffer.from(mac || ""), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error("Case token failed verification.");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}
