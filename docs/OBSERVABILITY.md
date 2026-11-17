# Observability with LangSmith (optional)

The app shows its own agent trace and cost meter on every result, so LangSmith is not needed for the demo. To add it:

1. Create a free account at smith.langchain.com and an API key (Settings > API Keys).
2. In Vercel, open the project > Settings > Environment Variables and add:
   - `LANGSMITH_TRACING` = `true`
   - `LANGSMITH_API_KEY` = your key
   - `LANGSMITH_PROJECT` = `claimshield`
   - `LANGSMITH_TRACING_BACKGROUND` = `false` (so traces are flushed before a serverless function ends)
3. Redeploy (Deployments > the latest one > Redeploy).
4. Run a case. In LangSmith, open the `claimshield` project: each run shows the graph, one child run per node, with inputs, outputs and timings.

Notes
- LangGraph traces every node automatically once the variables are set. The API routes call `awaitAllCallbacks()` before returning.
- The free Developer plan has a monthly trace allowance and short retention; check the current limits.
- The consent notice in the app changes automatically to tell users that traces are recorded.
- This path was not exercised by the authors against a live LangSmith workspace. If traces do not appear, check the key and project name first.
