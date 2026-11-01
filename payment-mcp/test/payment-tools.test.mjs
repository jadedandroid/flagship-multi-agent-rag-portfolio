import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  checkPaymentCompatibility,
  inspectPaymentEnvironment,
  preparePaymentIntegration,
  troubleshootPaymentSetup,
  writePaymentIntegration
} from "../src/payment-tools.mjs";

const validSetup = {
  provider: "stripe",
  businessCountry: "US",
  settlementCurrency: "USD",
  checkoutMode: "hosted",
  recurringPayments: false,
  serverRuntime: "node",
  webhookEndpoint: "/api/payments/webhook",
  clientFramework: "react"
};

test("compatible Stripe setup includes a reviewable server-only plan", () => {
  const result = checkPaymentCompatibility(validSetup);
  assert.equal(result.status, "compatible_with_review");
  assert.ok(result.findings.some((finding) => finding.code === "country_requires_provider_confirmation"));
  assert.ok(result.nextSteps.some((step) => step.includes("webhook")));
});

test("rejects malformed ISO codes and missing webhook routes", () => {
  const result = checkPaymentCompatibility({ ...validSetup, businessCountry: "USA", settlementCurrency: "US", webhookEndpoint: "" });
  assert.equal(result.status, "incompatible_until_resolved");
  assert.ok(result.findings.some((finding) => finding.code === "invalid_country_code"));
  assert.ok(result.findings.some((finding) => finding.code === "invalid_currency_code"));
  assert.ok(result.findings.some((finding) => finding.code === "webhook_required"));
});

test("blocks recurring payments in the initial crypto checkout scaffold", () => {
  const result = checkPaymentCompatibility({ ...validSetup, provider: "coinbase_commerce", recurringPayments: true });
  assert.equal(result.status, "incompatible_until_resolved");
});

test("environment inspection never returns key values and finds mode mismatch", () => {
  const inspected = inspectPaymentEnvironment("stripe", {
    STRIPE_SECRET_KEY: "sk_test_private-value",
    STRIPE_PUBLISHABLE_KEY: "pk_live_public-value",
    STRIPE_WEBHOOK_SECRET: "whsec_sensitive-value"
  });
  const serialized = JSON.stringify(inspected);
  assert.equal(inspected.modeMismatch, true);
  assert.equal(inspected.credentialValuesReturned, false);
  assert.equal(serialized.includes("private-value"), false);
  assert.equal(serialized.includes("sensitive-value"), false);
});

test("reports missing credentials without accepting secrets as arguments", () => {
  const inspected = inspectPaymentEnvironment("coinbase_commerce", {});
  assert.equal(inspected.variables.COINBASE_COMMERCE_API_KEY.present, false);
  assert.equal(inspected.variables.COINBASE_COMMERCE_WEBHOOK_SECRET.present, false);
});

test("credential-shaped troubleshooting input is rejected without echo", () => {
  const result = troubleshootPaymentSetup({ provider: "stripe", issue: "unknown", log: "sk_live_not-a-real-key" });
  assert.equal(result.accepted, false);
  assert.equal(result.echoedInput, false);
  assert.equal(JSON.stringify(result).includes("sk_live_not-a-real-key"), false);
});

test("troubleshooting offers actionable webhook signature steps", () => {
  const result = troubleshootPaymentSetup({ provider: "stripe", issue: "webhook_signature_failure" });
  assert.equal(result.accepted, true);
  assert.ok(result.diagnosticSteps.some((step) => step.includes("raw request body")));
});

test("integration preparation emits env names and contract, not live operations", () => {
  const result = preparePaymentIntegration(validSetup);
  assert.equal(result.liveIntegrationPerformed, false);
  assert.equal(result.credentialsUsed, false);
  assert.ok(result.generatedArtifacts.some((artifact) => artifact.content.includes("STRIPE_SECRET_KEY")));
  assert.ok(result.generatedArtifacts.some((artifact) => artifact.content.includes("verifyStripeWebhook")));
  assert.ok(result.generatedArtifacts.some((artifact) => artifact.content.includes("idempotencyKey")));
  assert.equal(result.staticValidation.passed, true);
});

test("generated Stripe Node implementation passes the Node syntax checker", async () => {
  const result = preparePaymentIntegration(validSetup);
  const artifact = result.generatedArtifacts.find((item) => item.path.endsWith("stripe-provider.mjs"));
  const directory = await mkdtemp(join(tmpdir(), "payment-scaffold-"));
  const filePath = join(directory, "stripe-provider.mjs");
  try {
    await writeFile(filePath, artifact.content);
    const checked = spawnSync(process.execPath, ["--check", filePath], { encoding: "utf8" });
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Coinbase Commerce scaffold does not invent an unverified API contract", () => {
  const result = preparePaymentIntegration({ ...validSetup, provider: "coinbase_commerce" });
  assert.equal(result.liveIntegrationPerformed, false);
  assert.ok(result.generatedArtifacts.some((artifact) => artifact.path === "PAYMENT_PROVIDER_REVIEW.md"));
  assert.ok(!result.generatedArtifacts.some((artifact) => artifact.path.includes("provider.mjs")));
  assert.match(result.providerImplementation, /could not be verified/);
});

test("scaffold writer requires confirmation and refuses to overwrite an existing folder", async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), "payment-project-"));
  try {
    const denied = await writePaymentIntegration(validSetup, { projectRoot });
    assert.equal(denied.written, false);
    assert.match(denied.reason, /confirmWrite=true/);

    const written = await writePaymentIntegration(validSetup, { projectRoot, confirmWrite: true });
    assert.equal(written.written, true);
    assert.ok(written.writtenFiles.includes("payment-integration/src/payments/stripe-provider.mjs"));
    const providerSource = await readFile(join(projectRoot, "payment-integration/src/payments/stripe-provider.mjs"), "utf8");
    assert.match(providerSource, /constructEvent/);
    const repeated = await writePaymentIntegration(validSetup, { projectRoot, confirmWrite: true });
    assert.equal(repeated.written, false);
    assert.match(repeated.reason, /refusing to overwrite/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
