// Clause-aware chunking and BM25 retrieval over the user's own policy wording.
// The MVP keeps everything in memory for the request; no database, no embeddings.

const STOP = new Set("a an and are as at be been but by for from has have he her his i if in into is it its may no not of on or our shall she such than that the their them then there these they this to was we were which who will with you your any all per under upon within also other".split(" "));

export function tokenize(s) {
  return (String(s).toLowerCase().match(/[a-z][a-z0-9&-]{1,}/g) || [])
    .map((t) => t.replace(/(ies)$/, "y").replace(/(?<=[a-z]{3})(s|ed|ing)$/, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

const HEADING = /^\s*(?:(?:clause|section|article|part)\s+)?((?:[A-Z]\.)?\d{1,2}(?:\.\d{1,2}){0,3}|[A-Z]\.\d{1,2}(?:\.\d{1,2})*)[.)]?\s+(.{3,110})$/i;

/** Split policy wording on its own clause numbering; never inside a clause. */
export function chunkPolicy(text, maxChars = 1100) {
  const lines = String(text || "").split(/\r?\n/);
  const chunks = [];
  let cur = null;
  const push = () => { if (cur && cur.text.trim().length > (cur.heading || "").length + 45) chunks.push(cur); };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = line.match(HEADING);
    const looksHeading = m && line.length < 130 && !/[,;]$/.test(m[2].trim()) && m[2].trim().split(/\s+/).length <= 14;
    if (m && looksHeading) {
      push();
      cur = { clause: m[1], heading: m[2].trim().replace(/[:.]$/, ""), text: line.trim() };
    } else if (!line.trim()) {
      if (cur) cur.text += "\n";
    } else {
      if (!cur) cur = { clause: "", heading: "Preamble", text: "" };
      cur.text += (cur.text ? "\n" : "") + line.trim();
    }
  }
  push();
  // split oversize chunks on paragraph boundaries
  const out = [];
  for (const c of chunks) {
    if (c.text.length <= maxChars) { out.push(c); continue; }
    const paras = c.text.split(/\n{2,}/);
    let buf = "";
    for (const p of paras) {
      if ((buf + "\n\n" + p).length > maxChars && buf) { out.push({ ...c, text: buf }); buf = p; }
      else buf = buf ? buf + "\n\n" + p : p;
    }
    if (buf) out.push({ ...c, text: buf });
  }
  return out.map((c, i) => ({ id: `P-${i + 1}`, clause: c.clause, heading: c.heading, text: c.text.replace(/\n{3,}/g, "\n\n").trim() }));
}

/** BM25 over chunks. Returns the top k with scores. */
export function bm25Search(chunks, query, k = 6) {
  const docs = chunks.map((c) => tokenize(`${c.heading} ${c.heading} ${c.text}`));
  const N = docs.length || 1;
  const avg = docs.reduce((a, d) => a + d.length, 0) / N || 1;
  const df = new Map();
  docs.forEach((d) => new Set(d).forEach((t) => df.set(t, (df.get(t) || 0) + 1)));
  const q = [...new Set(tokenize(query))];
  const k1 = 1.4, b = 0.75;
  const scored = docs.map((d, i) => {
    const tf = new Map();
    d.forEach((t) => tf.set(t, (tf.get(t) || 0) + 1));
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.length / avg)));
    }
    return { ...chunks[i], score: Math.round(s * 100) / 100 };
  });
  return scored.filter((c) => c.score > 0).sort((a, b2) => b2.score - a.score).slice(0, k);
}

// Vocabulary used by the grader and the query rewriter, per rejection category.
export const CATEGORY_TERMS = {
  non_disclosure: ["moratorium", "disclosure", "non-disclosure", "misrepresentation", "material", "fraud", "contestable", "sixty", "proposal"],
  pre_existing_waiting: ["pre-existing", "preexisting", "waiting", "period", "ped", "continuous", "coverage", "months", "exclusion"],
  reasonable_customary: ["reasonable", "customary", "prevailing", "geographical", "charges", "standard", "provider", "deduction"],
  not_medically_necessary: ["medically", "necessary", "necessity", "treatment", "hospitalisation", "hospitalization", "inpatient", "prescribed"],
  exclusion: ["exclusion", "excluded", "cosmetic", "plastic", "surgery", "not", "covered", "permanent"],
  delay: ["cashless", "authorisation", "authorization", "discharge", "hours", "turnaround", "delay"],
  room_rent: ["room", "rent", "proportionate", "deduction", "eligibility", "category", "associated", "medical", "expenses"],
  documentation: ["documents", "submission", "claim", "form", "records", "intimation"],
  other: ["claim", "exclusion", "condition"],
};

/** Deterministic relevance grade used offline and as the fallback grader. */
export function gradeChunk(chunk, category, reasonText = "") {
  const terms = new Set([...(CATEGORY_TERMS[category] || CATEGORY_TERMS.other)].map((t) => tokenize(t)[0]).filter(Boolean));
  const toks = new Set(tokenize(`${chunk.heading} ${chunk.text}`));
  let hit = 0;
  terms.forEach((t) => { if (toks.has(t)) hit++; });
  const headHit = tokenize(chunk.heading).some((t) => terms.has(t));
  const ratio = hit / Math.max(terms.size, 1);
  const grade = ratio >= 0.45 || (headHit && ratio >= 0.3) ? "relevant" : ratio >= 0.25 ? "partial" : "irrelevant";
  return { id: chunk.id, grade, overlap: Math.round(ratio * 100) / 100 };
}

export function rewriteQuery(category, previous) {
  const extra = (CATEGORY_TERMS[category] || CATEGORY_TERMS.other).join(" ");
  return `${extra} ${previous}`.trim();
}
