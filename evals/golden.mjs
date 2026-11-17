// Golden set: 12 synthetic cases built from the four samples by changing one thing at a time.
// "expect" was written by hand from the rule definitions in lib/rules/rules.js. It checks that
// the pipeline applies those rules as specified. It does not prove the rules are legally correct.
import { getSample } from "../lib/samples.js";

const variant = (id, edit) => {
  const d = { ...getSample(id).docs };
  for (const [doc, pairs] of Object.entries(edit)) for (const [a, b] of pairs) {
    if (!d[doc].includes(a)) throw new Error(`golden set: "${a.slice(0, 40)}" not found in ${id}.${doc}`);
    d[doc] = d[doc].replace(a, b);
  }
  return d;
};

export const GOLDEN = [
  { id: "GC-01", note: "Non-disclosure after 74 months", docs: getSample("meena-moratorium").docs, expect: { status: "awaiting_approval", band: "High", grounds: ["moratorium_60_months", "crc_approval_not_shown"] } },
  { id: "GC-02", note: "Non-disclosure at 59 months (one month short)", docs: variant("meena-moratorium", { rejection: [["20 July 2020", "20 October 2021"]] }), expect: { status: "awaiting_approval", band: "Low", grounds: ["crc_approval_not_shown"] } },
  { id: "GC-03", note: "74 months, but the insurer alleges fraud", docs: variant("meena-moratorium", { rejection: [["for non-disclosure of material facts under clause 4.1", "for fraud and non-disclosure of material facts under clause 4.1"]] }), expect: { status: "awaiting_approval", band: "Medium", grounds: ["fraud_must_be_established", "crc_approval_not_shown"] } },
  { id: "GC-04", note: "74 months, CRC approval stated in the letter", docs: variant("meena-moratorium", { rejection: [["We regret our inability to admit the claim.", "The repudiation was approved by the Claims Review Committee on 27 October 2026."]] }), expect: { status: "awaiting_approval", band: "High", grounds: ["moratorium_60_months"] } },
  { id: "GC-05", note: "Deduction plus 9.3-hour discharge delay", docs: getSample("ravi-deduction").docs, expect: { status: "awaiting_approval", band: "High", grounds: ["discharge_delay_charges", "deduction_not_explained"] } },
  { id: "GC-06", note: "Deduction only; discharge authorised in 2.5 hours", docs: variant("ravi-deduction", {
      rejection: [["Amount Claimed: Rs. 2,46,000", "Amount Claimed: Rs. 2,39,500"], [" Additional room and nursing fees of Rs. 6,500 for the extended stay on the day of discharge are not payable and are to be borne by the insured.", ""]],
      bill: [["Additional room and nursing charges due to delay in final authorisation: Rs. 6,500\n", ""], ["Total Bill Amount: Rs. 2,46,000", "Total Bill Amount: Rs. 2,39,500"], ["12 October 2026, 19:20", "12 October 2026, 12:35"]] }),
    expect: { status: "awaiting_approval", band: "Medium", grounds: ["deduction_not_explained"] } },
  { id: "GC-07", note: "Delay only; the letter cites the policy clause for the deduction", docs: variant("ravi-deduction", { rejection: [["deducted on tariff benchmarking of the package rates of the hospital.", "deducted as exceeding Reasonable and Customary Charges under clause 1.2 of the policy."]] }), expect: { status: "awaiting_approval", band: "High", grounds: ["discharge_delay_charges"] } },
  { id: "GC-08", note: "Waiting-period rejection at 40 months, injected bill", docs: getSample("anita-injection").docs, expect: { status: "awaiting_approval", band: "High", grounds: ["waiting_period_completed", "crc_approval_not_shown"], flags: 1 } },
  { id: "GC-09", note: "Waiting-period rejection at 20 months (exclusion applies)", docs: variant("anita-injection", { rejection: [["12 June 2023", "12 February 2025"]] }), expect: { status: "awaiting_approval", band: "Low", grounds: ["crc_approval_not_shown"], flags: 1 } },
  { id: "GC-10", note: "40 months, CRC approval stated", docs: variant("anita-injection", { rejection: [["Yours faithfully,", "This repudiation has the approval of the Claims Review Committee.\n\nYours faithfully,"]] }), expect: { status: "awaiting_approval", band: "High", grounds: ["waiting_period_completed"], flags: 1 } },
  { id: "GC-11", note: "Cosmetic surgery under a clear exclusion (true negative)", docs: getSample("suresh-exclusion").docs, expect: { status: "no_grounds", band: "Low", grounds: [] } },
  { id: "GC-12", note: "Both cashless timelines breached; clause cited", docs: variant("ravi-deduction", {
      rejection: [["deducted on tariff benchmarking of the package rates of the hospital.", "deducted as exceeding Reasonable and Customary Charges under clause 1.2 of the policy."]],
      bill: [["09 October 2026, 09:25", "09 October 2026, 11:50"]] }),
    expect: { status: "awaiting_approval", band: "High", grounds: ["discharge_delay_charges", "cashless_decision_delay"] } },
];
