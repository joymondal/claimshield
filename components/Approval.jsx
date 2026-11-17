"use client";
// The human-in-the-loop gate. The graph is paused here; only this screen can resume it.
import { useState } from "react";

export default function Approval({ view, busy, onDecide, onBack }) {
  const [text, setText] = useState(view.draft || "");
  const [declared, setDeclared] = useState(false);
  const edited = text.trim() !== (view.draft || "").trim();
  const omb = view.stage === "ombudsman";
  const tags = [...new Set([...(view.draft || "").matchAll(/\[((?:R-[A-Z0-9-]+)|(?:P-\d+))\]/g)].map((m) => m[1]))];
  const describe = (id) => {
    if (id.startsWith("P-")) { const c = view.clauses.find((x) => x.id === id); return c ? `Your policy, clause ${c.clause}: ${c.heading}` : "Your policy wording"; }
    const r = view.findings.flatMap((f) => f.rule_text || []).find((x) => x.id === id);
    if (r) return r.title;
    return { "R-GRIEVANCE-14D": "Insurer to resolve a grievance within 14 days", "R-OMB-ELIGIBILITY": "When a complaint can go to the Insurance Ombudsman", "R-OMB-CAP": "Ombudsman award is capped at Rs 50 lakh" }[id] || id;
  };

  return (
    <section>
      <h1>{omb ? "Your complaint to the Insurance Ombudsman" : "Your grievance letter"}</h1>
      <p className="lede">
        The agents have stopped and are waiting for you. Read the draft, change anything you like, then approve or reject it.
        {omb ? " You file the complaint yourself; ClaimShield only prepares the text." : " ClaimShield never sends it for you."}
      </p>

      <div className="desk">
        <div className="sheet">
          <span className="stamp pending" aria-hidden="true">Awaiting your approval</span>
          <label className="sr" htmlFor="draft">Draft letter</label>
          <textarea id="draft" value={text} onChange={(e) => setText(e.target.value)} spellCheck="true" rows={Math.min(Math.max(text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 62)), 0) + 2, 24), 90)} />
        </div>

        <aside className="margin">
          <h2>The Critic&rsquo;s checks</h2>
          <ul className="ticks">
            {(view.critique?.checks || []).map((c, i) => <li key={i} className={c.ok ? "ok" : "bad"}>{c.label}</li>)}
          </ul>
          <p className="hint">
            Faithfulness {view.critique?.faithfulness}, completeness {view.critique?.completeness}, after {view.revision} revision{view.revision === 1 ? "" : "s"}.
            {edited ? " You have edited the draft, so these checks describe the version before your changes." : ""}
          </p>
          <h2>Citation tags in the draft</h2>
          <dl className="taglist">{tags.map((t) => <div key={t}><dt>[{t}]</dt><dd>{describe(t)}</dd></div>)}</dl>
          <p className="hint">Tags turn into numbered references with their sources when you approve.</p>
        </aside>
      </div>

      <div className="approve">
        <label className="check">
          <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
          <span>I have read this {omb ? "complaint" : "letter"} and I am {omb ? "filing" : "sending"} it in my own name.</span>
        </label>
        <div className="actions">
          <button className="primary" disabled={!declared || busy} onClick={() => onDecide("approve", edited ? text : undefined, declared)}>
            {busy ? "Working" : edited ? "Save my edits and approve" : `Approve this ${omb ? "complaint" : "letter"}`}
          </button>
          <button className="danger" disabled={busy} onClick={() => onDecide("reject", undefined, false)}>Reject the draft</button>
          <button className="link" type="button" onClick={onBack} disabled={busy}>{omb ? "Back" : "Back to the findings"}</button>
        </div>
      </div>
    </section>
  );
}
