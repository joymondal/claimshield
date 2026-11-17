// Small shared helpers: dates, money, trace entries.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };
const pad = (n) => String(n).padStart(2, "0");

/** Parse common Indian date formats. Returns "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" or null. */
export function parseDate(s) {
  if (!s) return null;
  const str = String(s).trim();
  let d, m, y, hh = null, mm = null;
  const time = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (time) {
    hh = Number(time[1]); mm = Number(time[2]);
    if (time[3]) { const pm = time[3].toLowerCase() === "pm"; if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; }
  }
  let r = str.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (r) { y = +r[1]; m = +r[2] - 1; d = +r[3]; }
  if (y === undefined) {
    r = str.match(/(\d{1,2})(?:st|nd|rd|th)?[\s.-]+([A-Za-z]{3,9})\.?,?[\s.-]+(\d{4})/);
    if (r && MONTHS[r[2].slice(0, 3).toLowerCase()] !== undefined) { d = +r[1]; m = MONTHS[r[2].slice(0, 3).toLowerCase()]; y = +r[3]; }
  }
  if (y === undefined) {
    r = str.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/);
    if (r) { d = +r[1]; m = +r[2] - 1; y = +r[3]; }
  }
  if (y === undefined || m < 0 || m > 11 || d < 1 || d > 31) return null;
  const base = `${y}-${pad(m + 1)}-${pad(d)}`;
  return hh !== null ? `${base}T${pad(hh)}:${pad(mm)}` : base;
}

export function monthsBetween(a, b) {
  const x = parseDate(a), y = parseDate(b);
  if (!x || !y) return null;
  const [ay, am, ad] = x.slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = y.slice(0, 10).split("-").map(Number);
  let months = (by - ay) * 12 + (bm - am);
  if (bd < ad) months -= 1;
  return months;
}

const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function longDate(iso) {
  const p = parseDate(iso);
  if (!p) return iso || "";
  const [y, m, d] = p.slice(0, 10).split("-").map(Number);
  return `${d} ${MON[m - 1]} ${y}`;
}

export function addDays(iso, days) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Today's date in India (IST), as YYYY-MM-DD. */
export function todayIST(now = new Date()) {
  const t = new Date(now.getTime() + 5.5 * 3600 * 1000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function parseAmount(s) {
  if (s === null || s === undefined) return null;
  const n = Number(String(s).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && String(s).match(/\d/) ? n : null;
}

export function rupees(n) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return "Rs -";
  return `Rs ${Number(n).toLocaleString("en-IN")}`;
}

/** Build one trace entry for the agent trace shown in the UI. */
export function traceEntry(node, title, pattern, started, engine, summary, details = {}) {
  return { node, title, pattern, ms: Date.now() - started, engine, summary, details, at: new Date().toISOString() };
}
