"use client";
import { useState } from "react";

const DOCS = [
  { key: "rejection", label: "Rejection or settlement letter", hint: "Required. The insurer's letter that rejects the claim or pays it short." },
  { key: "policy", label: "Policy wording", hint: "The clauses of your policy. ClaimShield searches these for the term the insurer relied on." },
  { key: "discharge", label: "Discharge summary", hint: "Admission and discharge dates, diagnosis." },
  { key: "bill", label: "Hospital bill", hint: "Amounts and, for cashless claims, the times of the requests." },
];

export default function StartStep({ status, onAnalyse, busy, initial }) {
  const samples = status?.samples || [];
  const [choice, setChoice] = useState(initial?.sampleId || (initial?.docs ? "own" : ""));
  const [docs, setDocs] = useState(initial?.docs || { rejection: "", policy: "", discharge: "", bill: "" });
  const [consent, setConsent] = useState(false);
  const [offline, setOffline] = useState(initial?.mode === "offline");
  const [uploading, setUploading] = useState("");
  const [note, setNote] = useState("");
  const live = status?.engine && status.engine.provider !== "offline";

  async function upload(key, file) {
    if (!file) return;
    setUploading(key); setNote("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/extract", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not read the file.");
      setDocs((d) => ({ ...d, [key]: data.text }));
    } catch (e) { setNote(e.message); } finally { setUploading(""); }
  }

  const own = choice === "own";
  const ready = consent && (own ? docs.rejection.trim().length >= 40 : Boolean(choice));

  function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    const base = { consent: true, mode: offline ? "offline" : "auto" };
    onAnalyse(own ? { ...base, docs } : { ...base, sampleId: choice });
  }

  return (
    <form onSubmit={submit}>
      <h1>A rejected health claim is not always the last word</h1>
      <p className="lede">
        ClaimShield reads the insurer&rsquo;s letter and your policy, checks them against IRDAI&rsquo;s rules, and tells you
        whether the rejection can be challenged. If it can, it drafts the grievance letter for you to approve.
      </p>

      <fieldset className="cases">
        <legend>Choose a case to analyse</legend>
        {samples.map((s) => (
          <label key={s.id} className={`case ${choice === s.id ? "picked" : ""}`}>
            <input type="radio" name="case" value={s.id} checked={choice === s.id} onChange={() => setChoice(s.id)} />
            <span className="case-title">{s.title}</span>
            <span className="case-blurb">{s.blurb}</span>
          </label>
        ))}
        <label className={`case ${own ? "picked" : ""}`}>
          <input type="radio" name="case" value="own" checked={own} onChange={() => setChoice("own")} />
          <span className="case-title">Use my own documents</span>
          <span className="case-blurb">Paste text or upload a PDF with selectable text. Use synthetic or de-identified documents only.</span>
        </label>
      </fieldset>

      {own && (
        <div className="docs">
          {DOCS.map((d) => (
            <div className="doc" key={d.key}>
              <div className="doc-head">
                <label htmlFor={`doc-${d.key}`}>{d.label}</label>
                <label className="upload">
                  {uploading === d.key ? "Reading the file" : "Upload PDF or .txt"}
                  <input type="file" accept=".pdf,.txt,text/plain,application/pdf" onChange={(e) => upload(d.key, e.target.files?.[0])} disabled={Boolean(uploading)} />
                </label>
              </div>
              <p className="hint">{d.hint}</p>
              <textarea id={`doc-${d.key}`} rows={d.key === "policy" ? 7 : 5} value={docs[d.key]} onChange={(e) => setDocs((x) => ({ ...x, [d.key]: e.target.value }))} placeholder="Paste the text here" />
            </div>
          ))}
          {note && <p className="field-error" role="alert">{note}</p>}
        </div>
      )}

      <div className="consent">
        <h2>Before you continue</h2>
        <ul>
          <li><strong>What is processed:</strong> the documents you choose above, including any health information in them.</li>
          <li><strong>Why:</strong> only to analyse this claim and draft your letter. Nothing is used to train a model.</li>
          <li><strong>Storage:</strong> the server keeps nothing after it answers. The case lives in this browser tab and disappears when you close it.{status?.tracing ? " Run traces, with identifiers masked, are also recorded in the project team's LangSmith workspace for evaluation." : ""}</li>
          <li><strong>Who else sees it:</strong> {live ? "the AI provider configured for this site receives the text, with PAN, Aadhaar, phone numbers and email addresses masked first." : "nobody. This site is running on its built-in engine, so no text leaves the server."}</li>
        </ul>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>I agree to this processing, and I confirm these are synthetic or de-identified documents.</span>
        </label>
        {live && (
          <label className="check">
            <input type="checkbox" checked={offline} onChange={(e) => setOffline(e.target.checked)} />
            <span>Use the built-in offline engine instead of live AI for this run.</span>
          </label>
        )}
      </div>

      <div className="actions">
        <button className="primary" type="submit" disabled={!ready || busy}>Analyse the rejection</button>
        {!ready && <span className="hint">{!choice ? "Choose a case first." : !consent ? "Tick the consent box to continue." : "Add the rejection letter."}</span>}
      </div>
    </form>
  );
}
