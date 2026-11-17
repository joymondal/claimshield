# Privacy note (course deployment)

**Who runs this:** the ClaimShield project team, PGPEM, IIM Bangalore. Contact: add a team email address here.

**What is processed:** the documents a user chooses to analyse, which may include health information.

**Purpose:** only to analyse that claim and draft the user's letter. No model is trained on it.

**Storage:** none on the server. The app has no database. The case state lives in the user's browser tab and is discarded when the tab closes. If the team enables LangSmith tracing, run traces (with identifiers masked) are stored in the team's LangSmith workspace for evaluation.

**Sharing:** with the offline engine, nothing leaves the server. With live AI, document text is sent to the configured model provider after PAN, Aadhaar, phone numbers and email addresses are masked.

**Consent:** an itemised notice and an explicit tick box before any document is processed.

**Your choices:** close the tab to discard the case. Do not upload real documents to this course deployment.

**Design reference:** India's Digital Personal Data Protection Act, 2023 and the DPDP Rules, 2025 (notice, purpose limitation, data minimisation, security safeguards, erasure, grievance contact). A commercial launch would need a full compliance review, a named grievance officer, a retention schedule and a breach-response runbook.
