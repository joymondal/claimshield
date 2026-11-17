// Offline extraction: pattern-based reading of the four documents into CaseFacts.
// Used when no AI key is set, and as the baseline that the live model must agree with.
import { parseDate, parseAmount, monthsBetween } from "./util.js";

export const CATEGORIES = ["non_disclosure", "pre_existing_waiting", "reasonable_customary", "not_medically_necessary", "exclusion", "delay", "room_rent", "documentation", "other"];

export const FACT_FIELDS = [
  "insurer", "insuredName", "policyNo", "claimNo", "policyStart", "admissionDate", "dischargeDate", "hospital",
  "diagnosis", "amountClaimed", "amountPaid", "letterDate", "rejectionReasonText", "rejectionCategory",
  "cashless", "fraudAlleged", "preauthRequestTs", "preauthDecisionTs", "dischargeRequestTs", "dischargeAuthTs", "extraCharges",
];

const DATE = "(\\d{1,2}(?:st|nd|rd|th)?[\\s.-]+[A-Za-z]{3,9}\\.?,?[\\s.-]+\\d{4}|\\d{1,2}[\\/.-]\\d{1,2}[\\/.-]\\d{4}|\\d{4}-\\d{1,2}-\\d{1,2})";
const DATETIME = `${DATE}(?:,?\\s*(?:at\\s*)?(\\d{1,2}:\\d{2}\\s*(?:am|pm)?))?`;

function grab(text, re, group = 1) {
  const m = String(text || "").match(re);
  return m ? (m[group] || "").trim() : null;
}

export function categorise(reason) {
  const t = String(reason || "").toLowerCase();
  if (/non[- ]?disclos|not disclosed|suppress|misrepresent|conceal/.test(t)) return "non_disclosure";
  if (/pre[- ]?existing|\bped\b|waiting period/.test(t)) return "pre_existing_waiting";
  if (/reasonable|customary|tariff|benchmark|package rate|in excess of/.test(t)) return "reasonable_customary";
  if (/room rent|proportionate/.test(t)) return "room_rent";
  if (/medically necessary|medical necessity|not warrant|opd basis|could have been (managed|treated)/.test(t)) return "not_medically_necessary";
  if (/cosmetic|plastic|excluded|exclusion|not covered|not payable under/.test(t)) return "exclusion";
  if (/document|not submitted|deficien/.test(t)) return "documentation";
  if (/delay/.test(t)) return "delay";
  return "other";
}

/** Returns { facts, confidence } with a 0..1 confidence per field. */
export function extractOffline(docs) {
  const rej = docs.rejection || "", pol = docs.policy || "", dis = docs.discharge || "", bill = docs.bill || "";
  const all = [rej, pol, dis, bill].join("\n");
  const facts = {}, confidence = {};
  const set = (k, v, c) => { facts[k] = v ?? null; confidence[k] = v === null || v === undefined || v === "" ? 0 : c; };

  set("insurer", grab(rej, /^\s*([A-Z][A-Za-z&.' -]{2,60}?(?:Insurance|Assurance)[A-Za-z.' ]{0,30}?(?:Ltd\.?|Limited))/m) || grab(pol, /^\s*([A-Z][A-Za-z&.' -]{2,60}?(?:Insurance|Assurance)[A-Za-z.' ]{0,30}?(?:Ltd\.?|Limited))/mi), 0.9);
  if (facts.insurer && facts.insurer === facts.insurer.toUpperCase()) {
    facts.insurer = facts.insurer.toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase());
  }
  set("insuredName", grab(all, /(?:Name of (?:the )?(?:Insured|Patient)|Insured(?: Person)?|Patient(?: Name)?|Policyholder)\s*[:\-]\s*([A-Za-z][A-Za-z .']{2,50})/i), 0.9);
  set("policyNo", grab(all, /Policy\s*(?:No\.?|Number)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/-]{4,30})/i), 0.95);
  set("claimNo", grab(all, /Claim\s*(?:No\.?|Number|Ref(?:erence)?\.?(?: No\.?)?)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\/-]{4,30})/i), 0.95);
  set("policyStart", parseDate(grab(all, new RegExp(`(?:First Policy Inception(?: Date)?|Policy (?:Inception|Start|Commencement) Date|Date of (?:First )?Inception|In force since|Continuous coverage since)\\s*[:\\-]?\\s*${DATE}`, "i"))), 0.9);
  set("admissionDate", parseDate(grab(all, new RegExp(`(?:Date of Admission|Admission Date|Admitted on)\\s*[:\\-]?\\s*${DATE}`, "i"))), 0.9);
  set("dischargeDate", parseDate(grab(all, new RegExp(`(?:Date of Discharge|Discharge Date|Discharged on)\\s*[:\\-]?\\s*${DATE}`, "i"))), 0.9);
  let hospital = grab(all, /^\s*(?:Name of (?:the )?)?(?:Treating )?Hospital(?: Name)?\s*[:\-]\s*([A-Za-z][A-Za-z0-9 .,'&-]{2,70})/im);
  if (!hospital) {
    const h = (dis || bill).match(/^\s*([A-Z][A-Z .&'-]*(?:HOSPITAL|CENTRE|CENTER|CLINIC|NURSING HOME)[A-Z ,.&'-]*)/m);
    if (h) hospital = h[1].trim().replace(/[ ,]+$/, "").toLowerCase().replace(/\b[a-z]/g, (ch) => ch.toUpperCase()).replace(/\bAnd\b/g, "and");
  }
  set("hospital", hospital, 0.85);
  set("diagnosis", grab(all, /(?:Final |Primary |Provisional )?Diagnosis\s*[:\-]\s*(.{3,160})/i), 0.85);
  set("amountClaimed", parseAmount(grab(all, /(?:Amount Claimed|Claimed Amount|Total Bill Amount|Total Amount Claimed|Net Bill Amount)\s*[:\-]?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d+)?)/i)), 0.9);
  const paid = parseAmount(grab(all, /(?:Amount (?:Approved|Paid|Settled|Sanctioned|Payable)|Approved Amount|Settled Amount)\s*[:\-]?\s*(?:Rs\.?|INR|₹)?\s*([\d,]+(?:\.\d+)?)/i));
  const repudiated = /\b(repudiat|rejected|reject the claim|unable to (?:admit|accept|pay)|claim (?:is|stands) (?:denied|not payable|inadmissible))/i.test(rej);
  set("amountPaid", paid !== null ? paid : repudiated ? 0 : null, paid !== null ? 0.9 : 0.7);
  set("letterDate", parseDate(grab(rej, new RegExp(`^\\s*(?:Date|Dated)\\s*[:\\-]?\\s*${DATE}`, "im"))), 0.9);

  let reason = grab(rej, /Reasons?(?: for (?:Rejection|Repudiation|Deduction|Disallowance|Denial|Partial Settlement))?\s*[:\-]\s*([\s\S]{10,700}?)(?:\n\s*\n|\n\s*(?:We regret|Yours|Thanking|Regards|For any|Kindly note)|$)/i);
  if (!reason) {
    const sent = rej.match(/[^.\n]*(repudiat|reject|disallow|deduct|not payable|inadmissible)[^.\n]*\./i);
    reason = sent ? sent[0].trim() : null;
  }
  set("rejectionReasonText", reason ? reason.replace(/\s+/g, " ").trim() : null, 0.85);
  const cat = categorise(reason || rej);
  set("rejectionCategory", cat, cat === "other" ? 0.4 : 0.85);

  facts.cashless = /Mode\s*:\s*Cashless|cashless (?:claim|log|request|hospitali[sz]ation)|pre-?authori[sz]ation request/i.test(`${rej}\n${bill}\n${dis}`); confidence.cashless = 0.8;
  const negatedFraud = /\b(no|not|without|nor)\b[^.\n]{0,40}\bfraud/i.test(rej);
  facts.fraudAlleged = /\bfraud/i.test(rej) && !negatedFraud; confidence.fraudAlleged = 0.8;
  facts.isRepudiation = repudiated && (facts.amountPaid === 0 || facts.amountPaid === null); confidence.isRepudiation = 0.85;

  const ts = (label) => {
    const m = all.match(new RegExp(`${label}\\s*[:\\-]?\\s*${DATETIME}`, "i"));
    return m ? parseDate(`${m[1]} ${m[2] || ""}`) : null;
  };
  set("preauthRequestTs", ts("(?:Pre-?authori[sz]ation|Cashless) request (?:sent|received|raised|submitted)[^:\\n]{0,30}"), 0.85);
  set("preauthDecisionTs", ts("(?:Pre-?authori[sz]ation|Cashless) (?:decision|approval|approved|response)[^:\\n]{0,30}"), 0.85);
  set("dischargeRequestTs", ts("Discharge (?:authori[sz]ation )?request (?:sent|received|raised|submitted)[^:\\n]{0,30}"), 0.85);
  set("dischargeAuthTs", ts("Final (?:discharge )?authori[sz]ation (?:received|given|granted|issued)[^:\\n]{0,30}"), 0.85);
  set("extraCharges", parseAmount(grab(all, /(?:Additional|Extra)[^\n:]{0,60}(?:delay|late|waiting)[^\n:]{0,40}[:\-]?\s*(?:Rs\.?|INR|₹)\s*([\d,]+)/i)), 0.8);

  facts.tenureMonths = monthsBetween(facts.policyStart, facts.admissionDate);
  confidence.tenureMonths = facts.tenureMonths === null ? 0 : Math.min(confidence.policyStart, confidence.admissionDate);
  const wait = pol.match(/Pre-?Existing Disease[\s\S]{0,400}?(\d{2})\s*months of continuous/i);
  facts.policyWaitingMonths = wait ? Number(wait[1]) : null;
  confidence.policyWaitingMonths = wait ? 0.85 : 0;
  facts.amountDisputed = facts.amountClaimed !== null && facts.amountPaid !== null ? Math.max(facts.amountClaimed - facts.amountPaid, 0) : facts.amountClaimed;
  return { facts, confidence };
}

/** Which fields must be known before the analysis can be trusted. */
export function criticalFields(category) {
  const base = ["insurer", "policyNo", "rejectionReasonText", "rejectionCategory", "amountClaimed"];
  if (category === "non_disclosure" || category === "pre_existing_waiting") base.push("tenureMonths");
  return base;
}

export function overallConfidence(facts, confidence) {
  const fields = criticalFields(facts.rejectionCategory);
  const vals = fields.map((f) => confidence[f] ?? 0);
  const missing = fields.filter((f) => facts[f] === null || facts[f] === undefined || facts[f] === "");
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  return { score: Math.round((missing.length ? Math.min(mean, 0.5) : mean) * 100) / 100, missing };
}

/** Recompute derived fields after a merge or a manual correction. */
export function deriveFacts(f) {
  const facts = { ...f };
  const givenTenure = f.tenureMonths === null || f.tenureMonths === undefined || f.tenureMonths === "" ? NaN : Number(f.tenureMonths);
  facts.tenureMonths = monthsBetween(facts.policyStart, facts.admissionDate) ?? (Number.isFinite(givenTenure) && givenTenure >= 0 ? givenTenure : null);
  const claimed = parseAmount(facts.amountClaimed), paid = parseAmount(facts.amountPaid);
  facts.amountClaimed = claimed; facts.amountPaid = paid;
  facts.amountDisputed = claimed !== null && paid !== null ? Math.max(claimed - paid, 0) : claimed;
  facts.isRepudiation = paid === 0 || paid === null ? Boolean(f.isRepudiation ?? true) : false;
  if (!CATEGORIES.includes(facts.rejectionCategory)) facts.rejectionCategory = categorise(facts.rejectionReasonText);
  return facts;
}
