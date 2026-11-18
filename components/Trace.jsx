"use client";
// Agent trace: what each agent did, in order, with timings and the engine used.

const LABEL = {
  intake: "Intake agent", policy_rag: "Policy-RAG agent: retrieve", grade: "Policy-RAG agent: grade", reg_check: "Regulation agent",
  strategise: "Strategist", draft: "Drafter", critique: "Critic", human_approval: "Human approval", finalize: "Action agent", human_review: "Human review",
};

function Row({ t, i }) {
  return (
    <li className={`trace-row node-${t.node}`}>
      <span className="trace-n">{i + 1}</span>
      <div className="trace-body">
        <p className="trace-title">{t.title || LABEL[t.node] || t.node} <span className="trace-pattern">{t.pattern}</span></p>
        <p className="trace-summary">{t.summary}</p>
        <p className="trace-meta">{t.engine === "offline" ? "built-in engine" : t.engine === "human" ? "decision by a person" : t.engine}, {t.ms} ms</p>
        {t.details && Object.keys(t.details).length > 0 && (
          <details>
            <summary>Details</summary>
            <pre>{JSON.stringify(t.details, null, 2)}</pre>
          </details>
        )}
      </div>
    </li>
  );
}

export function TraceLive({ events, busy }) {
  const rows = events.filter((e) => e.type === "node");
  const last = events[events.length - 1];
  const waiting = busy && last?.type === "wait" ? last : null;
  return (
    <ol className="trace" aria-live="polite">
      {rows.map((e, i) => <Row key={i} t={e.trace} i={i} />)}
      {busy && <li className="trace-row working"><span className="trace-n">{rows.length + 1}</span><div className="trace-body"><p className="trace-title">Working</p>
        {waiting && <p className="trace-summary">{waiting.provider} asked us to slow down. Waiting about {waiting.seconds} seconds, then continuing. Free AI keys allow only a few thousand words a minute.</p>}
      </div></li>}
    </ol>
  );
}

export function TracePanel({ trace = [], cost, engine }) {
  const loops = {
    rag: trace.filter((t) => t.node === "policy_rag").length,
    drafts: trace.filter((t) => t.node === "draft").length,
  };
  return (
    <section className="panel">
      <h2>How the agents got here</h2>
      <p className="hint">
        {trace.length} steps. Policy search ran {loops.rag} time{loops.rag === 1 ? "" : "s"}{loops.rag > 1 ? " (the first search found nothing relevant, so the query was rewritten)" : ""};
        the letter was drafted {loops.drafts} time{loops.drafts === 1 ? "" : "s"}{loops.drafts > 1 ? " (the Critic sent it back)" : ""}.
      </p>
      <ol className="trace">{trace.map((t, i) => <Row key={i} t={t} i={i} />)}</ol>
      <p className="cost">
        {engine?.provider === "offline"
          ? "Model cost for this case: Rs 0 (built-in engine, no model calls)."
          : `Model cost for this case: about Rs ${cost?.inr ?? 0} (${cost?.calls ?? 0} model calls, ${cost?.input_tokens ?? 0} tokens in, ${cost?.output_tokens ?? 0} out; estimate from list prices).`}
      </p>
    </section>
  );
}
