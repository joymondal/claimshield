# ClaimShield

**Your claim, argued by the rulebook.** A multi-agent assistant that helps an Indian health-insurance policyholder contest a rejected, short-paid or delayed claim.

You give it the insurer's letter, the policy wording, the discharge summary and the bill. A team of agents reads them, checks the rejection against the policy and IRDAI's rules, scores how challengeable it is, drafts a grievance letter, and then **stops and waits for the policyholder to approve**. Nothing is ever sent by the app.

> Course project for *Decision Sciences: Agentic AI* (PGPEM, IIM Bangalore). It runs on **synthetic documents only**. It is not legal advice and it does not represent anyone.

## Deploy it in about ten minutes (no coding)

1. Create a free GitHub account and a new repository. Upload every file in this folder to it.
2. Create a free Vercel account with "Continue with GitHub". Click **Add New > Project**, pick the repository, click **Deploy**.
3. Open the link Vercel gives you. The app works straight away on its built-in engine.
4. Optional: add a free `GROQ_API_KEY` under **Settings > Environment Variables** and redeploy to switch on live AI.

The step-by-step guide that ships with this project walks through each click.

## What it does

| Step | Agent | Pattern from the course | What happens |
|---|---|---|---|
| 1 | Intake | Perception, guardrails, structured output | Removes hidden instructions from the documents, masks PAN/Aadhaar/phone/email, extracts typed case facts with a confidence per field. Has no tools. |
| 2 | Policy-RAG | Agentic RAG, Corrective RAG | Splits the policy on its clause numbers, retrieves with BM25, grades each clause, rewrites the query and searches again if nothing relevant came back. |
| 3 | Regulation | ReAct, tool use, MCP | Plans which rule checks to run and calls deterministic tools (moratorium, waiting period, cashless timelines, Claims Review Committee, reasons given). The same tools are exposed as an MCP server. |
| 4 | Strategist | Tree-of-Thought | Generates candidate grounds, scores each on legal strength and evidence, prunes the weak ones, ranks the rest. A ground with no citation is dropped. |
| 5 | Drafter + Critic | Reflection, Self-RAG style check | Drafts the letter; the Critic checks every citation, amount and mandatory element and sends it back (at most twice). |
| 6 | Human approval | Human-in-the-loop, `interrupt()` | The graph pauses. Only the policyholder's approval, with a self-filing declaration, lets it continue. |
| 7 | Action | Least privilege | Produces the final letter with numbered references, the deadlines and a calendar file. It cannot send anything. |

Second stage: if the insurer rejects the grievance or stays silent, the app checks eligibility for the Insurance Ombudsman (Rs 50 lakh cap, one-month wait, one-year limit) and drafts the complaint, again for approval.

## Two engines

- **Offline demo engine (default).** No API key, no cost, no data leaves the server. Extraction, grading and drafting are deterministic. It always works, so the deployed link cannot run out of quota during a demo. Its first draft is deliberately short so that the Critic's review loop is visible.
- **Live AI.** Set one key (`GROQ_API_KEY`, `GEMINI_API_KEY` or `ANTHROPIC_API_KEY`). A cheap model handles extraction, grading and planning; a stronger model handles strategy, drafting and critique. The rule checks stay deterministic in both modes, and the model can only cite rule ids that exist in `lib/rules/rules.js`. If a model call fails or is rate-limited, that agent falls back to the offline engine and the trace says so.

## Project layout

```
app/                 Next.js pages and API routes (analyze, resume, escalate, extract, status)
components/          The five-step interface
lib/agents/          LangGraph graph, state and the agents
lib/rules/           Verified rule file and deterministic rule tools
lib/guard/           Prompt-injection screening, PII masking, spotlighting, rate limit
lib/rag/             Clause-aware chunking, BM25 search, relevance grading
lib/llm/             Model router, fallback, cost meter
lib/samples.js       Four synthetic cases
mcp/                 irdai-rules MCP server (stdio)
tests/               40 automated tests
evals/               12-case golden set and red-team set, with a pass/fail gate
docs/                Architecture, model card, privacy note, test plan
```

## Run it on your own computer (optional)

Needs Node.js 20.9 or later.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 40 tests
npm run eval       # golden set + red-team scorecard
npm run mcp        # start the irdai-rules MCP server on stdio
```

For live AI locally, copy `env.example.txt` to `.env.local` and add a key.

## Safety design in one paragraph

Documents are untrusted data: lines that look like instructions are removed before any agent sees them, and document text is wrapped in `<document>` tags in every prompt. Personal identifiers are masked before any model call and restored only in the final letter. The Intake agent has no tools; the Regulation agent can call only an allow-list of read-only rule checks, with arguments built in code. There is no send tool anywhere in the codebase. The approval gate is enforced three ways: the graph interrupt, a signed case token the server verifies, and a `finalize` step that throws if approval is missing.

## Honest limits

- The rule summaries in `lib/rules/rules.js` are plain-language paraphrases written for this project. Read the primary sources before relying on them.
- The evaluation set is synthetic and was labelled by the authors from the rule definitions. It shows the pipeline applies the rules as specified. It does not measure accuracy on real claims.
- The live-AI path is covered by automated tests with a fake transport. Run `npm run eval -- --live` with your own key to measure a real model.
- Scanned PDFs without a text layer are not read. Paste the text instead.
- English only.

## Licence

MIT for the code. The sample documents are invented. IRDAI circulars and the Insurance Ombudsman Rules belong to their publishers.
