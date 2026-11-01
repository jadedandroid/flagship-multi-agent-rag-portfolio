import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const launcherPath = fileURLToPath(new URL("../run-server.sh", import.meta.url));

test("MCP stdio server initializes, lists tools, and handles a safe tool call", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "payment-mcp-protocol-"));
  const child = spawn("bash", [launcherPath], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, PAYMENT_PROJECT_ROOT: projectRoot }
  });
  let buffer = "";
  const pending = new Map();
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id).resolve(message);
        pending.delete(message.id);
      }
    }
  });

  let nextId = 1;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}. stderr: ${stderr.join("")}`));
    }, 5000);
    pending.set(id, { resolve: (message) => { clearTimeout(timer); resolve(message); } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
  const notify = (method, params = {}) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);

  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "payment-mcp-test", version: "1.0.0" }
    });
    assert.ok(initialized.result?.serverInfo);
    notify("notifications/initialized");
    const listed = await request("tools/list", {});
    const names = listed.result.tools.map((tool) => tool.name);
    assert.deepEqual(names.sort(), [
      "check_payment_compatibility",
      "inspect_payment_environment",
      "prepare_payment_integration",
      "troubleshoot_payment_setup",
      "write_payment_scaffold"
    ]);
    const called = await request("tools/call", { name: "inspect_payment_environment", arguments: { provider: "stripe" } });
    const text = called.result.content.find((block) => block.type === "text").text;
    assert.match(text, /credentialValuesReturned": false/);
    assert.doesNotMatch(text, /sk_(?:test|live)_/);

    const written = await request("tools/call", {
      name: "write_payment_scaffold",
      arguments: {
        provider: "stripe",
        businessCountry: "US",
        settlementCurrency: "USD",
        checkoutMode: "hosted",
        recurringPayments: false,
        serverRuntime: "node",
        webhookEndpoint: "/api/payments/webhook",
        clientFramework: "react",
        confirmWrite: true
      }
    });
    const writeResult = JSON.parse(written.result.content.find((block) => block.type === "text").text);
    assert.equal(writeResult.written, true);
    const generated = await readFile(join(projectRoot, "payment-integration/src/payments/stripe-provider.mjs"), "utf8");
    assert.match(generated, /createCheckoutSession/);
  } finally {
    child.kill("SIGTERM");
    await rm(projectRoot, { recursive: true, force: true });
  }
});
