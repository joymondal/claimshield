"use client";
import { useState } from "react";
import { rupees } from "../lib/client.js";
import { TracePanel } from "./Trace.jsx";

const CATEGORY_LABEL = {
  non_disclosure: "Non-disclosure of a condition", pre_existing_waiting: "Pre-existing disease waiting period", reasonable_customary: "Deduction as not reasonable and customary",
  not_medically_necessary: "Treatment said to be not medically necessary", exclusion: "Policy exclusion", delay: "Delay", room_rent: "Room rent deduction", documentation: "Missing documents", other: "Other",
};
const TOOL_LABEL = {
  check_moratorium: "60-month moratorium", check_waiting_period: "Waiting period for pre-existing diseases", check_timelines: "Cashless timelines (1 hour, 3 hours)",
  check_crc_approval: "Claims Review Committee approval", check_reasons_given: "Reasons tied to a policy clause",
};
const EDITABLE = [
  ["insurer", "Insurer", "text"], ["insuredName", "Name of the insured", "text"], ["policyNo", "Policy number", "text"], ["claimNo", "Claim number", "text"],
  ["policyStart", "First policy start date", "date"], ["admissionDate", "Date of admission", "date"], ["amountClaimed", "Amount claimed (Rs)", "number"], ["amountPaid", "Amount paid (Rs)", "number"],
];

function Verdict({ view }) {
  const { status, score, band } = view;
  if (status === "needs_review") {
    return (
      <div className="verdict review">
        <p className="verdict-kicker">A person needs to check this first</p>
        <h1>Some facts could not be read reliably</h1>
        <p>{view.review_reason} Correct the facts below and run the analysis again. ClaimShield does not guess.</p>
      </div>
    );
  }
  if (status === "no_grounds") {
    return (
      <div className="verdict low">
        <div className="meter" role="img" aria-label={`Challengeability ${score} out of 100`}><span className="meter-fill" style={{ width: `${score}%` }} /><span className="meter-mark" style={{ left: `${score}%` }}>{score}</span></div>
        <h1>This rejection looks consistent with the policy</h1>
        <p>None of the rules checked gives you a ground to contest it, so ClaimShield has not drafted a letter. If you believe a fact below is wrong, correct it and run the analysis again.</p>
      </div>
    );
  }
  const text = band === "High" ? "There are strong grounds to challenge this decision" : band === "Medium" ? "There are arguable grounds to challenge this decision" : "The grounds to challenge this decision are weak";
  return (
    <div className={`verdict ${band.toLowerCase()}`}>
      <div className="meter" role="img" aria-label={`Challengeability ${score} out of 100`}><span className="meter-fill" style={{ width: `${score}%` }} /><span className="meter-mark" style={{ left: `${score}%` }}>{score}</span></div>
      <h1>{text}</h1>
      <p>Challengeability {score} out of 100 ({band}). The score reflects the strongest ground and how well the documents support it. It is not a prediction of the outcome.</p>
    </div>
  );
}

function Citation({ id, view }) {
  const [open, setOpen] = useState(false);
  let title = id, body = "", source = "";
  if (id.startsWith("R-")) {
    const rt = view.findings.flatMap((f) => f.rule_text || []).find((r) => r.id === id);
    title = rt?.title || id; body = rt?.summary || ""; source = rt?.source || "";
  } else {
    const c = view.clauses.find((x) => x.id === id);
    title = c ? `Your policy, clause ${c.clause}: ${c.heading}` : id; body = c?.text || ""; source = "Policy wording you provided";
  }
  return (
    <span className="cite">
      <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen(!open)}>{id}</button>
      {open && (
        <span className="cite-pop" role="note">
          <strong>{title}</strong>
          <span>{body}</span>
          <em>{source}{id.startsWith("R-") ? ". Plain-language summary; read the source before relying on it." : ""}</em>
        </span>
      )}
    </span>
  );
}

export default function Findings({ view, busy, onReview, onRerun, onRestart }) {
  const f = view.facts || {};
  const [edit, setEdit] = useState(view.status === "needs_review");
  const [form, setForm] = useState(() => Object.fromEntries(EDITABLE.map(([k]) => [k, f[k] ?? ""])));
  const [category, setCategory] = useState(f.rejectionCategory || "other");
  const low = (k) => (view.confidence?.[k] ?? 1) < 0.7 || (view.missing || []).includes(k);

  function rerun(e) {
    e.preventDefault();
    const o = { rejectionCategory: category };
    for (const [k, , type] of EDITABLE) {
      const v = form[k];
      if (v === "" || v === null || v === undefined) continue;
      if (String(v) !== String(f[k] ?? "")) o[k] = type === "number" ? Number(v) : v;
    }
    onRerun(o);
  }

  return (
    <section>
      <Verdict view={view} />

      {view.flags?.length > 0 && (
        <div className="security" role="alert">
          <h2>Instructions hidden in a document were removed</h2>
          <p>ClaimShield treats documents as evidence, never as instructions. {view.flags.length} line{view.flags.length > 1 ? "s" : ""} that tried to give orders to the AI {view.flags.length > 1 ? "were" : "was"} removed before any agent read the document.</p>
          <ul>{view.flags.map((x, i) => <li key={i}><span className="tag">{x.doc.replace(/_/g, " ")}</span> &ldquo;{x.excerpt}&rdquo;</li>)}</ul>
        </div>
      )}

      {view.status === "rejected" && (
        <div className="alert"><strong>You rejected the draft.</strong> Nothing was prepared for sending. You can review it again or start over.</div>
      )}

      {view.grounds?.length > 0 && (
        <section className="panel">
          <h2>Grounds, strongest first</h2>
          <ol className="grounds">
            {view.grounds.map((g) => (
              <li key={g.id}>
                <div className="ground-head">
                  <h3>{g.title}</h3>
                  <span className="strength" title="Legal strength multiplied by how well the documents support it"><span style={{ width: `${Math.round(g.strength * 100)}%` }} />{Math.round(g.strength * 100)}</span>
                </div>
                <p>{g.argument}</p>
                <p className="cites">Based on {g.cites.map((c) => <Citation key={c} id={c} view={view} />)}</p>
                {g.counter && <p className="counter"><strong>What the insurer may say:</strong> {g.counter} <strong>Your answer:</strong> {g.rebuttal}</p>}
              </li>
            ))}
          </ol>
          <div className="actions">
            <button className="primary" onClick={onReview} disabled={busy}>Review the draft letter</button>
            <span className="hint">Nothing is final until you approve it.</span>
          </div>
        </section>
      )}

      {view.findings?.length > 0 && (
        <section className="panel">
          <h2>Rule checks</h2>
          <table className="checks">
            <thead><tr><th>Check</th><th>Result</th><th>What was found</th></tr></thead>
            <tbody>
              {view.findings.map((x, i) => (
                <tr key={i}>
                  <td>{TOOL_LABEL[x.tool] || x.tool}</td>
                  <td><span className={`result ${!x.applicable ? "na" : x.favours ? "for" : "against"}`}>{!x.applicable ? "Not applicable" : x.favours ? "Supports you" : "Does not help"}</span></td>
                  <td>{x.explanation}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel">
        <div className="panel-head">
          <h2>Facts read from the documents</h2>
          {!edit && <button className="link" onClick={() => setEdit(true)}>Correct a fact</button>}
        </div>
        {!edit ? (
          <dl className="facts">
            <div><dt>Insurer</dt><dd>{f.insurer || "-"}</dd></div>
            <div><dt>Insured</dt><dd>{f.insuredName || "-"}</dd></div>
            <div><dt>Policy number</dt><dd>{f.policyNo || "-"}</dd></div>
            <div><dt>Claim number</dt><dd>{f.claimNo || "-"}</dd></div>
            <div><dt>Continuous cover</dt><dd>{f.tenureMonths !== null && f.tenureMonths !== undefined ? `${f.tenureMonths} months (since ${f.policyStart})` : "-"}</dd></div>
            <div><dt>Hospital stay</dt><dd>{f.admissionDate || "-"} to {f.dischargeDate || "-"}</dd></div>
            <div><dt>Diagnosis</dt><dd>{f.diagnosis || "-"}</dd></div>
            <div><dt>Claimed and paid</dt><dd>{rupees(f.amountClaimed)} claimed, {rupees(f.amountPaid)} paid, {rupees(f.amountDisputed)} in dispute</dd></div>
            <div><dt>Type of rejection</dt><dd>{CATEGORY_LABEL[f.rejectionCategory] || f.rejectionCategory}</dd></div>
            <div className="wide"><dt>Insurer&rsquo;s reason</dt><dd>{f.rejectionReasonText || "-"}</dd></div>
            <div className="wide"><dt>Privacy</dt><dd>{view.pii_count ? `${view.pii_count} personal identifier(s) were masked before analysis.` : "No PAN, Aadhaar, phone number or email address was found in the documents."} Reading confidence {Math.round((view.overall_confidence ?? 0) * 100)}%.</dd></div>
          </dl>
        ) : (
          <form className="facts-form" onSubmit={rerun}>
            {EDITABLE.map(([k, label, type]) => (
              <label key={k} className={low(k) ? "needs" : ""}>
                <span>{label}{low(k) ? " (check this)" : ""}</span>
                <input type={type} value={form[k] ?? ""} onChange={(e) => setForm((x) => ({ ...x, [k]: e.target.value }))} />
              </label>
            ))}
            <label>
              <span>Type of rejection</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <div className="actions">
              <button className="primary" type="submit" disabled={busy}>Run the analysis again</button>
              {view.status !== "needs_review" && <button type="button" className="link" onClick={() => setEdit(false)}>Cancel</button>}
            </div>
          </form>
        )}
      </section>

      {view.clauses?.length > 0 && (
        <section className="panel">
          <h2>Policy clauses the search kept</h2>
          {view.clauses.map((c) => (
            <details key={c.id} className="clause">
              <summary><span className="chip static">{c.id}</span> Clause {c.clause}: {c.heading}</summary>
              <p>{c.text}</p>
            </details>
          ))}
        </section>
      )}

      <TracePanel trace={view.trace} cost={view.cost} engine={view.engine} />

      {(view.status === "no_grounds" || view.status === "rejected") && (
        <div className="actions">
          {view.status === "rejected" && <button className="primary" onClick={onReview}>Review the draft again</button>}
          <button className={view.status === "rejected" ? "secondary" : "primary"} onClick={onRestart}>Start a new case</button>
        </div>
      )}
    </section>
  );
}
