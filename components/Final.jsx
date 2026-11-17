"use client";
import { useState } from "react";
import { download } from "../lib/client.js";
import { TracePanel, TraceLive } from "./Trace.jsx";

function today() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export default function Final({ view, grievance, busy, eligibility, events, onEscalate, onRestart, onShowGrievance }) {
  const final = view.final;
  const omb = view.stage === "ombudsman";
  const [copied, setCopied] = useState(false);
  const [sent, setSent] = useState("");
  const [reply, setReply] = useState("none");
  const [repliedOn, setRepliedOn] = useState("");
  if (!final) return null;

  const slug = (view.facts?.claimNo || "claim").replace(/[^A-Za-z0-9]+/g, "-");
  const mailto = `mailto:?subject=${encodeURIComponent(final.subject)}&body=${encodeURIComponent(final.letter.slice(0, 1700) + (final.letter.length > 1700 ? "\n\n[Letter continues: paste the full text copied from ClaimShield]" : ""))}`;

  async function copy() {
    try { await navigator.clipboard.writeText(final.letter); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { setCopied(false); }
  }

  return (
    <section>
      <h1>{omb ? "Your complaint is ready to file" : "Your letter is ready to send"}</h1>
      <p className="lede">
        {omb
          ? "File it yourself with the Insurance Ombudsman for your region. There is no fee. Add your address and contact details where the brackets are."
          : "Send it from your own email address or by registered post to the insurer's Grievance Redressal Officer, and keep proof of sending. Add your contact details where the brackets are."}
      </p>

      <div className="desk">
        <div className="sheet final">
          <span className="stamp approved" aria-hidden="true">Approved by you</span>
          <pre className="letter">{final.letter}</pre>
        </div>
        <aside className="margin">
          <h2>{omb ? "File it" : "Send it"}</h2>
          <div className="stack">
            <button className="primary" onClick={copy}>{copied ? "Copied" : "Copy the text"}</button>
            <button className="secondary" onClick={() => download(`claimshield-${omb ? "ombudsman-complaint" : "grievance"}-${slug}.txt`, final.letter)}>Download as a text file</button>
            {!omb && <a className="secondary" href={mailto}>Open in my email app</a>}
            <button className="secondary" onClick={() => download(`claimshield-deadlines-${slug}.ics`, final.ics, "text/calendar")}>Add the dates to my calendar</button>
          </div>
          <p className="hint">ClaimShield has not sent anything and cannot. {!omb && "Long letters can be cut short by some email apps; if so, paste the copied text."}</p>
          {final.warnings?.length > 0 && (
            <div className="alert small"><strong>Check before sending.</strong> Your edited version no longer passes these checks: {final.warnings.join(" ")}</div>
          )}
        </aside>
      </div>

      <section className="panel">
        <h2>What happens next</h2>
        <ol className="timeline">
          {final.deadlines.map((d) => (
            <li key={d.key}><time dateTime={d.due}>{d.due_text}</time><span>{d.label}</span></li>
          ))}
        </ol>
      </section>

      {!omb && (
        <section className="panel">
          <h2>If the insurer rejects the grievance or stays silent</h2>
          <p>You can take the dispute to the Insurance Ombudsman once the insurer has rejected your grievance, answered it unsatisfactorily, or not answered within one month. ClaimShield checks whether you are eligible, then drafts the complaint for your approval.</p>
          <form className="facts-form" onSubmit={(e) => { e.preventDefault(); onEscalate({ grievance_sent_on: sent, insurer_reply: reply, insurer_replied_on: repliedOn }); }}>
            <label><span>Date you sent the grievance</span><input type="date" required max={today()} value={sent} onChange={(e) => setSent(e.target.value)} /></label>
            <label><span>What did the insurer do?</span>
              <select value={reply} onChange={(e) => setReply(e.target.value)}>
                <option value="none">No reply so far</option>
                <option value="rejected">Rejected my grievance</option>
                <option value="unsatisfactory">Replied, but did not resolve it</option>
              </select>
            </label>
            {reply !== "none" && <label><span>Date of the insurer&rsquo;s reply</span><input type="date" max={today()} value={repliedOn} onChange={(e) => setRepliedOn(e.target.value)} /></label>}
            <div className="actions"><button className="primary" type="submit" disabled={busy || !sent}>{busy ? "Checking" : "Check eligibility and draft the complaint"}</button></div>
          </form>
          {busy && events.length > 0 && <TraceLive events={events} busy={busy} />}
          {eligibility && !eligibility.eligible && (
            <div className="alert" role="status"><strong>Not yet.</strong> {eligibility.explanation}</div>
          )}
        </section>
      )}

      {omb && grievance && (
        <div className="actions"><button className="secondary" onClick={onShowGrievance}>Back to my grievance letter</button></div>
      )}

      <TracePanel trace={view.trace} cost={view.cost} engine={view.engine} />
      <div className="actions"><button className="secondary" onClick={onRestart}>Start a new case</button></div>
    </section>
  );
}
