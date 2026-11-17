// Starts the MCP server as a child process and talks to it with the official MCP client.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("irdai-rules MCP server lists its tools and answers a moratorium check", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["mcp/irdai-rules-server.mjs"] });
  const client = new Client({ name: "claimshield-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["check_moratorium", "check_ombudsman_eligibility", "check_timelines", "check_waiting_period", "get_clause"]);
    const res = await client.callTool({ name: "check_moratorium", arguments: { tenure_months: 74, alleged_ground: "non_disclosure" } });
    const out = JSON.parse(res.content[0].text);
    assert.equal(out.contestable_by_insurer, false);
    assert.equal(out.rule, "R-MORATORIUM");
    const { resources } = await client.listResources();
    assert.ok(resources.some((r) => r.uri === "irdai://rules/R-OMB-CAP"));
    const bad = await client.callTool({ name: "get_clause", arguments: { rule_id: "R-MADE-UP" } });
    assert.equal(bad.isError, true, "an unknown rule id is rejected by the schema");
  } finally {
    await client.close();
  }
});
