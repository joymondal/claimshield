# Test plan

| Layer | Where | What it proves | How to run |
|---|---|---|---|
| Rule tools | `tests/rules.test.mjs` | Boundaries: 59 vs 60 months, fraud exception, 36-month cap, 1-hour and 3-hour limits, Rs 50 lakh cap, one-month wait, one-year limit, unknown values are not guessed | `npm test` |
| Guardrails | `tests/guard.test.mjs` | 12 injection lines removed, 8 ordinary lines not flagged, PII masked and restored, Aadhaar checksum, spotlight cannot be closed, token tampering detected | `npm test` |
| Graph and trajectory | `tests/graph.test.mjs` | Each sample takes the expected path; Corrective RAG re-query; Critic loop; no draft for a correct rejection; low confidence goes to human review; resume, reject, edit; escalation | `npm test` |
| Live-model path | `tests/live.test.mjs` | Request shapes for three providers, JSON parsing, tool allow-list, uncited grounds dropped, invented citation caught by the Critic, 429 retry, fallback to offline | `npm test` |
| MCP | `tests/mcp.test.mjs` | The MCP server starts, lists five tools, answers a call, rejects an unknown rule id | `npm test` |
| Golden set and red team | `evals/run.mjs` | 12 cases: status, band, grounds, citations; 36 end-to-end injection runs; approval gate | `npm run eval` |
| Build | Next.js | The production build compiles | `npm run build` |

## Manual checks before a demo

| ID | Steps | Expected |
|---|---|---|
| M-01 | Open the site, pick "Meena", tick consent, Analyse | Score 86 High; two grounds; trace shows the Critic sending the first draft back |
| M-02 | Pick "Ravi" | Trace shows two policy searches (query rewritten); grounds for the discharge delay and the unexplained deduction |
| M-03 | Pick "Anita" | Red banner: one hidden instruction removed from the hospital bill |
| M-04 | Pick "Suresh" | Low score, no letter drafted |
| M-05 | On the approval screen, click Approve without ticking the box | Button is disabled |
| M-06 | Tick the box, Approve | "Approved by you" stamp, numbered references, four dated next steps |
| M-07 | Enter a grievance date 7 days ago, "No reply so far" | "Not yet" with the reason |
| M-08 | Enter a grievance date 40 days ago | Ombudsman complaint draft, waiting for approval |
| M-09 | "Use my own documents", upload a text PDF | Text appears in the box |
| M-10 | Phone-width browser window | Layout stacks; everything is reachable |
