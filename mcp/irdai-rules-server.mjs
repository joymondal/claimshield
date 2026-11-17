#!/usr/bin/env node
// irdai-rules: a Model Context Protocol (MCP) server that exposes ClaimShield's
// verified rule file and rule checks to any MCP client (Claude Desktop, Claude Code, ...).
// It is read-only, has no network access and no database: least privilege by construction.
//
// Run:   npm run mcp        (speaks MCP over stdio)
// Add to Claude Code:   claude mcp add irdai-rules -- node mcp/irdai-rules-server.mjs
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RULES, RULE_IDS, getRule } from "../lib/rules/rules.js";
import { checkMoratorium, checkTimelines, checkWaitingPeriod, checkOmbudsmanEligibility, getClause } from "../lib/rules/tools.js";

const server = new McpServer({ name: "irdai-rules", version: "1.0.0" });
const reply = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });

server.registerTool("get_clause", {
  title: "Get a rule",
  description: "Return the plain-language summary and source of one rule in the verified rule file. Summaries are paraphrases, not official text.",
  inputSchema: { rule_id: z.enum(RULE_IDS).describe("Rule id, for example R-MORATORIUM") },
}, async (args) => reply(getClause(args)));

server.registerTool("check_moratorium", {
  title: "Check the 60-month moratorium",
  description: "Can the insurer still contest a claim for non-disclosure, given the months of continuous cover?",
  inputSchema: { tenure_months: z.number().int().min(0), alleged_ground: z.enum(["non_disclosure", "misrepresentation", "fraud"]).default("non_disclosure") },
}, async (args) => reply(checkMoratorium(args)));

server.registerTool("check_waiting_period", {
  title: "Check the pre-existing-disease waiting period",
  description: "Had the waiting period for pre-existing diseases been completed when the claim arose?",
  inputSchema: { tenure_months: z.number().int().min(0), policy_waiting_months: z.number().int().min(0).optional() },
}, async (args) => reply(checkWaitingPeriod(args)));

server.registerTool("check_timelines", {
  title: "Check cashless timelines",
  description: "Were the 1-hour cashless decision and 3-hour discharge authorisation limits met? Timestamps as YYYY-MM-DDTHH:MM.",
  inputSchema: {
    cashless: z.boolean(), preauth_request_ts: z.string().optional(), preauth_decision_ts: z.string().optional(),
    discharge_request_ts: z.string().optional(), discharge_auth_ts: z.string().optional(), extra_charges: z.number().min(0).optional(),
  },
}, async (args) => reply(checkTimelines(args)));

server.registerTool("check_ombudsman_eligibility", {
  title: "Check Insurance Ombudsman eligibility",
  description: "Rs 50 lakh cap, one-month wait after the representation to the insurer, one-year limit. Dates as YYYY-MM-DD.",
  inputSchema: { amount_in_dispute: z.number().min(0), grievance_sent_on: z.string(), insurer_replied_on: z.string().optional(), insurer_rejected: z.boolean().optional(), today: z.string().optional() },
}, async (args) => reply(checkOmbudsmanEligibility(args)));

for (const id of RULE_IDS) {
  server.registerResource(id, `irdai://rules/${id}`, { title: RULES[id].title, description: RULES[id].summary.slice(0, 120), mimeType: "application/json" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(getRule(id), null, 2) }] }));
}

await server.connect(new StdioServerTransport());
