# Model card and data card

## Intended use
Helping an adult policyholder in India understand whether a health-insurance claim decision can be contested, and drafting a grievance letter or Ombudsman complaint that the policyholder reviews, approves and sends personally.

## Out of scope
Legal advice or representation; filing on anyone's behalf; life, motor or travel insurance; decisions by insurers; any use with real personal health data in this course deployment; users under 18.

## Models
- Offline engine: no model. Pattern-based extraction, BM25 retrieval, keyword grading, templates.
- Live mode (optional): Groq `openai/gpt-oss-20b` and `openai/gpt-oss-120b`, or Google `gemini-3.5-flash-lite`, or Anthropic `claude-haiku-5-5` and `claude-sonnet-5-5`. Model ids can be overridden with `MODEL_CHEAP` and `MODEL_STRONG`.

## Evaluation (run `npm run eval`)
12 synthetic golden cases and 12 injection strings, offline engine. See `evals/` and the project report for the scorecard. Labels were written by the authors from the rule definitions, so the set checks that the rules are applied as specified; it is not an independent accuracy study. Live-model quality has not been measured by the authors.

## Known failure modes
- Letters in unusual formats: the offline extractor may miss fields. The case is then routed to human review and the user is asked to correct the facts.
- Scanned PDFs: not read.
- Rejection reasons outside the built-in categories get only the generic checks.
- Rule summaries are paraphrases and may lag behind regulatory changes.
- A live model can still write a weak or awkward letter that passes the checks; the policyholder's review is the final safeguard.

## Human oversight
Low-confidence extraction stops for human correction. A draft that fails the Critic twice stops for human review. Every letter stops for the policyholder's approval and a self-filing declaration.

## Data card
All sample and evaluation documents are synthetic, written for this project. The insurer, hospitals, people, policy numbers and amounts are invented. No real patient or policyholder data was used.
