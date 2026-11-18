// Browser-side helpers for calling the API routes.

/** The session ended (or sign-in was switched on): go to the sign-in page. */
function signedOut(res) {
  if (res.status !== 401) return;
  window.location.assign(`/login?next=${encodeURIComponent(window.location.pathname)}`);
  throw new Error("Your session has ended. Sign in again.");
}

/** POST JSON and read a newline-delimited JSON stream, calling onEvent per line. */
export async function postStream(url, body, onEvent) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  signedOut(res);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("ndjson")) {
    let data = {};
    try { data = await res.json(); } catch { /* ignore */ }
    throw new Error(data.error || `Request failed (${res.status}).`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", result = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === "error") throw new Error(ev.message);
      if (ev.type === "result") result = ev; else onEvent?.(ev);
    }
    if (done) break;
  }
  if (!result) throw new Error("The analysis ended without a result. Try again.");
  return result;
}

export async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  signedOut(res);
  let data = {};
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

export function download(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const rupees = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? "-" : `Rs ${Number(n).toLocaleString("en-IN")}`);
