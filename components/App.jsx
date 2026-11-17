"use client";
// The whole ClaimShield flow on one page: documents -> analysis -> findings -> approval -> send and track.
import { useEffect, useRef, useState } from "react";
import { postStream, postJson } from "../lib/client.js";
import StartStep from "./StartStep.jsx";
import Findings from "./Findings.jsx";
import Approval from "./Approval.jsx";
import Final from "./Final.jsx";
import { TraceLive } from "./Trace.jsx";

const STEPS = [
  { key: "documents", label: "Documents" },
  { key: "analysis", label: "Analysis" },
  { key: "findings", label: "Findings" },
  { key: "approval", label: "Your approval" },
  { key: "send", label: "Send and track" },
];

export default function ClaimShieldApp() {
  const [status, setStatus] = useState(null); // /api/status
  const [step, setStep] = useState("documents");
  const [request, setRequest] = useState(null); // last analyse request, for re-runs
  const [events, setEvents] = useState([]);
  const [view, setView] = useState(null);
  const [token, setToken] = useState(null);
  const [grievance, setGrievance] = useState(null); // { view, token } once the grievance letter is approved
  const [eligibility, setEligibility] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const top = useRef(null);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setStatus).catch(() => setStatus({ engine: { provider: "offline", label: "Offline demo engine (no AI key)" }, samples: [] }));
  }, []);

  const go = (s) => { setStep(s); setError(""); requestAnimationFrame(() => top.current?.scrollIntoView({ block: "start" })); };

  async function analyse(req) {
    setRequest(req); setEvents([]); setView(null); setToken(null); setGrievance(null); setEligibility(null); setBusy(true);
    go("analysis");
    try {
      const result = await postStream("/api/analyze", req, (ev) => setEvents((x) => [...x, ev]));
      setView(result.view); setToken(result.token);
      go("findings");
    } catch (e) {
      setError(e.message); setStep("documents");
    } finally { setBusy(false); }
  }

  async function decide(action, editedDraft, declaration) {
    setBusy(true); setError("");
    try {
      const out = await postJson("/api/resume", { token, action, editedDraft, declaration });
      setView(out.view); setToken(out.token);
      if (out.status === "approved") {
        if (out.view.stage === "grievance") setGrievance({ view: out.view, token: out.token });
        go("send");
      } else if (out.view.stage === "ombudsman" && grievance) {
        setView(grievance.view); setToken(grievance.token); go("send"); // complaint draft rejected: back to the approved letter
      } else {
        go("findings");
      }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  async function escalate(escalation) {
    setBusy(true); setError(""); setEligibility(null); setEvents([]);
    try {
      const result = await postStream("/api/escalate", { token: grievance.token, escalation }, (ev) => setEvents((x) => [...x, ev]));
      setEligibility(result.eligibility || null);
      if (result.status === "awaiting_approval") { setView(result.view); setToken(result.token); go("approval"); }
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }

  const reset = () => { setView(null); setToken(null); setGrievance(null); setEvents([]); setEligibility(null); go("documents"); };
  const idx = STEPS.findIndex((s) => s.key === step);
  const engine = view?.engine || status?.engine;

  return (
    <div className="shell" ref={top}>
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">CS</span>
          <div>
            <p className="brand-name">ClaimShield</p>
            <p className="brand-line">Your claim, argued by the rulebook</p>
          </div>
        </div>
        <div className="mast-right">
          {engine && <span className={`engine ${engine.provider === "offline" ? "is-offline" : "is-live"}`} title={engine.models ? `Models: ${engine.models.cheap} / ${engine.models.strong}` : "No AI key is set on the server"}>{engine.label}</span>}
        </div>
      </header>
      <p className="disclosure" role="note">
        You are using an AI system. It reads documents and drafts a letter; you decide what is sent, and you send it yourself.
        This is a course project that works on synthetic documents only. It is not legal advice.
      </p>

      <div className="frame">
        <nav className="rail" aria-label="Progress">
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.key} className={i === idx ? "current" : i < idx ? "done" : ""} aria-current={i === idx ? "step" : undefined}>
                <span className="n">{i + 1}</span><span>{s.label}</span>
              </li>
            ))}
          </ol>
          {view && step !== "documents" && <button className="link" onClick={reset}>Start a new case</button>}
        </nav>

        <main className="stage">
          {error && <div className="alert" role="alert"><strong>That did not work.</strong> {error}</div>}

          {step === "documents" && <StartStep status={status} onAnalyse={analyse} busy={busy} initial={request} />}

          {step === "analysis" && (
            <section>
              <h1>Reading the documents and checking the rules</h1>
              <p className="lede">Each line below is one agent finishing its part of the work. Loops show up as repeated lines.</p>
              <TraceLive events={events} busy={busy} />
            </section>
          )}

          {step === "findings" && view && (
            <Findings view={view} busy={busy} onReview={() => go("approval")} onRerun={(factsOverride) => analyse({ ...request, factsOverride })} onRestart={reset} />
          )}

          {step === "approval" && view && (
            <Approval view={view} busy={busy} onDecide={decide} onBack={() => {
              if (view.stage === "ombudsman" && grievance) { setView(grievance.view); setToken(grievance.token); go("send"); } else go("findings");
            }} />
          )}

          {step === "send" && view && (
            <Final view={view} grievance={grievance} busy={busy} eligibility={eligibility} events={events} onEscalate={escalate} onRestart={reset}
              onShowGrievance={() => { if (grievance) { setView(grievance.view); setToken(grievance.token); setEligibility(null); } }} />
          )}
        </main>
      </div>

      <footer className="foot">
        <p>ClaimShield is a student project for the Agentic AI course, PGPEM, IIM Bangalore. The insurer, hospitals and people in the sample cases are invented.</p>
        <p>It gives information and drafting help. It does not give legal advice, does not represent you, and never sends anything on your behalf.</p>
      </footer>
    </div>
  );
}
