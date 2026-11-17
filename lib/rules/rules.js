// Verified-rules file used by the Regulation agent and the MCP server.
//
// IMPORTANT: every "summary" below is a plain-language PARAPHRASE written for this
// course project. It is not the official text and it is not legal advice.
// Before relying on any entry, read the primary source named in "source".
// The agents may cite ONLY the ids defined here ("cite or abstain").

export const SOURCES = {
  IRDAI_MC_HEALTH_2024: {
    title: "IRDAI Master Circular on Health Insurance Business",
    ref: "Ref. IRDAI/HLT/CIR/PRO/84/5/2024, dated 29 May 2024",
    where: "irdai.gov.in > Document Detail > Master Circular on IRDAI (Insurance Products) Regulations 2024 - Health Insurance",
  },
  IRDAI_MC_PPHI_2024: {
    title: "IRDAI Master Circular on Protection of Policyholders' Interests, 2024",
    ref: "issued September 2024",
    where: "irdai.gov.in > Document Detail",
  },
  OMBUDSMAN_RULES_2017: {
    title: "Insurance Ombudsman Rules, 2017 (as amended up to 9 November 2023)",
    ref: "Rules 13, 14 and 17",
    where: "cioins.co.in > Insurance Ombudsman Rules",
  },
};

export const RULES = {
  "R-MORATORIUM": {
    id: "R-MORATORIUM",
    title: "Moratorium: 60 months of continuous cover",
    source: "IRDAI_MC_HEALTH_2024",
    summary:
      "After sixty continuous months of coverage (the moratorium period), a health policy or claim cannot be contested on grounds of non-disclosure or misrepresentation, except where fraud is established.",
    params: { months: 60 },
  },
  "R-CRC": {
    id: "R-CRC",
    title: "Claims Review Committee must approve a repudiation",
    source: "IRDAI_MC_HEALTH_2024",
    summary:
      "No claim may be repudiated without the approval of the insurer's Product Management Committee or its three-member sub-group, the Claims Review Committee.",
  },
  "R-REASONS": {
    id: "R-REASONS",
    title: "Reasons must refer to specific policy terms",
    source: "IRDAI_MC_HEALTH_2024",
    summary:
      "When a claim is repudiated or partly disallowed, the insurer must communicate the details to the claimant with reference to the specific terms and conditions of the policy document relied on.",
  },
  "R-CASHLESS-1H": {
    id: "R-CASHLESS-1H",
    title: "Cashless authorisation decision within one hour",
    source: "IRDAI_MC_HEALTH_2024",
    summary:
      "The insurer must decide on a cashless authorisation request immediately, and in any case within one hour of receiving the request.",
    params: { hours: 1 },
  },
  "R-DISCHARGE-3H": {
    id: "R-DISCHARGE-3H",
    title: "Final discharge authorisation within three hours",
    source: "IRDAI_MC_HEALTH_2024",
    summary:
      "The insurer must give final authorisation within three hours of receiving the discharge authorisation request from the hospital. If it takes longer, any additional amount charged by the hospital because of the delay is borne by the insurer, not the policyholder.",
    params: { hours: 3 },
  },
  "R-PED-WAIT": {
    id: "R-PED-WAIT",
    title: "Waiting period for pre-existing diseases is capped",
    source: "IRDAI_MC_HEALTH_2024",
    summary:
      "The waiting period a policy may impose for pre-existing diseases is capped at 36 months of continuous coverage (IRDAI (Insurance Products) Regulations, 2024). Once the waiting period stated in the policy has been completed, a claim cannot be refused on the waiting-period exclusion.",
    params: { maxMonths: 36 },
  },
  "R-GRIEVANCE-14D": {
    id: "R-GRIEVANCE-14D",
    title: "Insurer to resolve a grievance within 14 days",
    source: "IRDAI_MC_PPHI_2024",
    summary:
      "An insurer is expected to act on and resolve a policyholder's grievance within 14 days of receiving it. An unresolved grievance can be escalated on IRDAI's Bima Bharosa portal.",
    params: { days: 14 },
  },
  "R-OMB-ELIGIBILITY": {
    id: "R-OMB-ELIGIBILITY",
    title: "When a complaint can go to the Insurance Ombudsman",
    source: "OMBUDSMAN_RULES_2017",
    summary:
      "A complaint lies to the Insurance Ombudsman only after a written representation to the insurer that was rejected, was not answered within one month, or was answered unsatisfactorily. The complaint must be made within one year, and the same matter must not be pending before a court, consumer forum or arbitrator (Rule 14(3)-(5)). It may be made by the policyholder personally or through a legal heir, nominee or assignee (Rule 14(1)).",
    params: { waitDays: 30, limitDays: 365 },
  },
  "R-OMB-CAP": {
    id: "R-OMB-CAP",
    title: "Ombudsman award is capped at Rs 50 lakh",
    source: "OMBUDSMAN_RULES_2017",
    summary:
      "The Ombudsman cannot award compensation above Rs 50 lakh, or above the loss suffered as a direct consequence of the cause of action (Rule 17(3)).",
    params: { capRupees: 5000000 },
  },
  "R-OMB-AWARD": {
    id: "R-OMB-AWARD",
    title: "Ombudsman award: timing and effect",
    source: "OMBUDSMAN_RULES_2017",
    summary:
      "The Ombudsman passes an award within three months of receiving all requirements from the complainant (Rule 17(4)). The insurer must comply within thirty days (Rule 17(6)) and the award is binding on the insurer (Rule 17(8)). There is no fee for filing a complaint.",
  },
};

export function getRule(id) {
  const r = RULES[id];
  if (!r) return null;
  const s = SOURCES[r.source];
  return { ...r, sourceTitle: s.title, sourceRef: s.ref, sourceWhere: s.where };
}

export function citationLabel(id) {
  const r = getRule(id);
  if (!r) return null;
  return `${r.sourceTitle} (${r.sourceRef}) - ${r.title.toLowerCase()}`;
}

export const RULE_IDS = Object.keys(RULES);
