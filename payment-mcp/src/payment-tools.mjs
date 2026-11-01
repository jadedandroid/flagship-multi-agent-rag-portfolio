import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const PROVIDERS = Object.freeze({
  stripe: {
    label: "Stripe",
    env: { serverKey: "STRIPE_SECRET_KEY", publicKey: "STRIPE_PUBLISHABLE_KEY", webhookSecret: "STRIPE_WEBHOOK_SECRET" },
    docs: ["https://docs.stripe.com/payments/accept-a-payment", "https://docs.stripe.com/keys", "https://docs.stripe.com/webhooks"]
  },
  coinbase_commerce: {
    label: "Coinbase Commerce",
    env: { serverKey: "COINBASE_COMMERCE_API_KEY", webhookSecret: "COINBASE_COMMERCE_WEBHOOK_SECRET" },
    docs: ["https://docs.cdp.coinbase.com/" ]
  }
});

const ISO_COUNTRIES = /^[A-Z]{2}$/;
const ISO_CURRENCIES = /^[A-Z]{3}$/;
const CREDENTIAL_PATTERN = /(?:sk_(?:live|test)_|rk_(?:live|test)_|pk_(?:live|test)_|whsec_|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|api[_-]?key\s*[:=])/i;

function providerConfig(provider) {
  return PROVIDERS[provider];
}

export function checkPaymentCompatibility(input) {
  const provider = providerConfig(input.provider);
  const findings = [];
  if (!ISO_COUNTRIES.test(input.businessCountry)) findings.push({ severity: "error", code: "invalid_country_code", message: "Business country must be a two-letter ISO country code." });
  else findings.push({ severity: "warning", code: "country_requires_provider_confirmation", message: `Confirm that ${provider.label} currently supports merchants in ${input.businessCountry}; this assistant does not determine regional eligibility.` });
  if (!ISO_CURRENCIES.test(input.settlementCurrency)) findings.push({ severity: "error", code: "invalid_currency_code", message: "Settlement currency must be a three-letter ISO 4217 code." });
  if (input.provider === "coinbase_commerce" && input.recurringPayments) findings.push({ severity: "error", code: "recurring_crypto_not_supported_by_plan", message: "This initial Coinbase Commerce scaffold is one-time checkout only; recurring billing is not included." });
  if (input.provider === "coinbase_commerce" && input.checkoutMode === "embedded") findings.push({ severity: "warning", code: "verify_current_checkout_product", message: "Confirm the current Coinbase Commerce product supports your required embedded flow; this scaffold does not assume parity with Stripe Elements." });
  if (!input.webhookEndpoint) findings.push({ severity: "error", code: "webhook_required", message: "A server-side webhook endpoint is required to verify payment state before fulfilling orders." });
  if (!input.serverRuntime) findings.push({ severity: "error", code: "server_runtime_required", message: "A server runtime is required to create payments and verify signed webhooks. Never put provider secrets in browser code." });
  if (input.provider === "stripe" && input.checkoutMode === "embedded" && !input.serverRuntime) findings.push({ severity: "error", code: "stripe_secret_server_boundary", message: "Stripe embedded checkout requires a trusted server component for secret-key operations." });
  const blocked = findings.some((finding) => finding.severity === "error");
  return {
    provider: input.provider,
    providerName: provider.label,
    status: blocked ? "incompatible_until_resolved" : findings.some((finding) => finding.severity === "warning") ? "compatible_with_review" : "compatible_for_scaffold",
    scope: "Static compatibility only. Provider account eligibility and current product support must be verified with the provider.",
    findings,
    nextSteps: ["Use provider sandbox/test mode first", "Keep secret credentials in a server-side secret manager or protected environment", "Verify webhook signatures using the raw request body", "Make payment creation idempotent", "Verify provider-side payment state before fulfilling an order"],
    documentation: provider.docs
  };
}

function inspectCredential(value, expected) {
  if (!value) return { present: false, format: "missing", mode: "unknown" };
  let format = "unrecognized";
  let mode = "unknown";
  if (/^(?:sk|rk|pk)_test_/.test(value)) { format = "recognized_prefix"; mode = "test"; }
  else if (/^(?:sk|rk|pk)_live_/.test(value)) { format = "recognized_prefix"; mode = "live"; }
  else if (/^whsec_/.test(value)) { format = "recognized_prefix"; mode = "not_applicable"; }
  else if (expected === "coinbase") { format = "present_prefix_not_validated"; mode = "not_verifiable_offline"; }
  return { present: true, format, mode };
}

export function inspectPaymentEnvironment(providerName, env = process.env) {
  const provider = providerConfig(providerName);
  if (!provider) throw new Error("Unsupported payment provider.");
  const serverKey = env[provider.env.serverKey];
  const publicKey = provider.env.publicKey ? env[provider.env.publicKey] : undefined;
  const webhookSecret = env[provider.env.webhookSecret];
  const serverStatus = inspectCredential(serverKey, providerName === "coinbase_commerce" ? "coinbase" : "stripe");
  const publicStatus = publicKey ? inspectCredential(publicKey, "stripe") : null;
  const webhookStatus = inspectCredential(webhookSecret, "stripe");
  const modes = [serverStatus.mode, publicStatus?.mode].filter((mode) => mode === "test" || mode === "live");
  const modeMismatch = modes.length > 1 && new Set(modes).size > 1;
  return {
    provider: providerName,
    variables: {
      [provider.env.serverKey]: serverStatus,
      ...(provider.env.publicKey ? { [provider.env.publicKey]: publicStatus ?? { present: false, format: "missing", mode: "unknown" } } : {}),
      [provider.env.webhookSecret]: webhookStatus
    },
    modeMismatch,
    credentialValuesReturned: false,
    checks: [
      { code: "server_key_present", passed: serverStatus.present },
      ...(provider.env.publicKey ? [{ code: "publishable_key_present", passed: Boolean(publicKey) }] : []),
      { code: "webhook_secret_present", passed: webhookStatus.present },
      { code: "test_live_mode_consistent", passed: !modeMismatch }
    ],
    limitation: "This offline inspection checks only environment-variable presence and recognizable prefixes. It does not authenticate with the provider or verify account status."
  };
}

const DIAGNOSTICS = {
  invalid_currency: ["Check that the currency is an ISO 4217 code supported by the merchant account and payment method."],
  webhook_signature_failure: ["Use the raw request body for signature verification.", "Confirm the signing secret belongs to this exact endpoint and environment.", "Do not verify a parsed and re-serialized JSON body."],
  missing_environment_variable: ["Set the provider's required environment variable in the server secret manager.", "Restart or redeploy the server process after updating configuration."],
  test_live_mode_mismatch: ["Use keys and webhook signing secrets from the same provider mode.", "Keep test and live environment configurations separate."],
  provider_account_not_supported: ["Confirm merchant country, business type, settlement currency, and product availability in the provider dashboard or with provider support."],
  checkout_session_failure: ["Validate amount and currency server-side.", "Check required return URLs and idempotency behavior.", "Inspect provider request logs without sharing credentials."],
  coinbase_commerce_api_error: ["Check current Coinbase Commerce product documentation and account access.", "Verify API version and webhook signing requirements for your account.", "Do not assume legacy Coinbase Commerce endpoints are available for a new account."],
  unknown: ["Record the provider's sanitized error code and request ID, but never include keys, cardholder data, or full payment payloads."]
};

export function troubleshootPaymentSetup(input) {
  const raw = JSON.stringify(input);
  if (CREDENTIAL_PATTERN.test(raw)) {
    return { accepted: false, reason: "Possible credential or private key detected. Remove secrets and submit only a known diagnostic code.", echoedInput: false };
  }
  return {
    accepted: true,
    provider: input.provider,
    issue: input.issue,
    diagnosticSteps: DIAGNOSTICS[input.issue],
    echoedInput: false,
    securityNote: "Do not submit card numbers, CVVs, API keys, webhook secrets, access tokens, or customer payment data."
  };
}

function stripeNodeScaffold() {
  return `import Stripe from "stripe";

function stripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new Error("STRIPE_SECRET_KEY is not configured in the server environment.");
  if (!/^(sk|rk)_(test|live)_/.test(secretKey)) throw new Error("STRIPE_SECRET_KEY has an unrecognized secret-key prefix.");
  return new Stripe(secretKey);
}

function validateReturnUrl(value) {
  const url = new URL(value);
  const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error("Return URLs must use HTTPS outside localhost development.");
  return url.toString();
}

export async function createCheckoutSession({ orderId, amountMinor, currency, successUrl, cancelUrl }) {
  if (typeof orderId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(orderId)) throw new Error("orderId must be a non-empty application order identifier.");
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) throw new Error("amountMinor must be a positive integer in the currency's minor unit.");
  if (typeof currency !== "string" || !/^[A-Za-z]{3}$/.test(currency)) throw new Error("currency must be an ISO 4217 alphabetic code.");
  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{ price_data: { currency: currency.toLowerCase(), unit_amount: amountMinor, product_data: { name: "Order " + orderId } }, quantity: 1 }],
    client_reference_id: orderId,
    metadata: { orderId },
    success_url: validateReturnUrl(successUrl),
    cancel_url: validateReturnUrl(cancelUrl)
  }, { idempotencyKey: "checkout-" + orderId });
  if (!session.url) throw new Error("Stripe did not return a hosted Checkout URL.");
  return { checkoutUrl: session.url, providerReference: session.id };
}

export function verifyStripeWebhook(rawBody, signature) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError("Pass the original raw HTTP request body as a Buffer.");
  if (typeof signature !== "string" || !signature) throw new Error("Stripe-Signature header is required.");
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signingSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured in the server environment.");
  return stripeClient().webhooks.constructEvent(rawBody, signature, signingSecret);
}

export function isPaidCheckoutCompletion(event) {
  return event?.type === "checkout.session.completed" && event.data?.object?.payment_status === "paid";
}
`;
}

function stripePythonScaffold() {
  return `import os
import re
from urllib.parse import urlparse

import stripe


def _stripe_client():
    secret_key = os.environ.get("STRIPE_SECRET_KEY", "")
    if not secret_key:
        raise RuntimeError("STRIPE_SECRET_KEY is not configured in the server environment.")
    if not re.match(r"^(sk|rk)_(test|live)_", secret_key):
        raise RuntimeError("STRIPE_SECRET_KEY has an unrecognized secret-key prefix.")
    return stripe.StripeClient(secret_key)


def _validate_return_url(value):
    parsed = urlparse(value)
    local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    if parsed.scheme != "https" and not local_http:
        raise ValueError("Return URLs must use HTTPS outside localhost development.")
    return value


def create_checkout_session(order_id, amount_minor, currency, success_url, cancel_url):
    if not isinstance(order_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", order_id):
        raise ValueError("order_id must be a non-empty application order identifier.")
    if not isinstance(amount_minor, int) or isinstance(amount_minor, bool) or amount_minor <= 0:
        raise ValueError("amount_minor must be a positive integer in the currency's minor unit.")
    if not isinstance(currency, str) or not re.fullmatch(r"[A-Za-z]{3}", currency):
        raise ValueError("currency must be an ISO 4217 alphabetic code.")
    params = {
        "mode": "payment",
        "line_items": [{"price_data": {"currency": currency.lower(), "unit_amount": amount_minor,
                         "product_data": {"name": "Order " + order_id}}, "quantity": 1}],
        "client_reference_id": order_id,
        "metadata": {"orderId": order_id},
        "success_url": _validate_return_url(success_url),
        "cancel_url": _validate_return_url(cancel_url),
    }
    session = _stripe_client().v1.checkout.sessions.create(params, options={"idempotency_key": "checkout-" + order_id})
    if not session.url:
        raise RuntimeError("Stripe did not return a hosted Checkout URL.")
    return {"checkout_url": session.url, "provider_reference": session.id}


def verify_stripe_webhook(raw_body, signature):
    if not isinstance(raw_body, bytes):
        raise TypeError("Pass the original raw HTTP request body as bytes.")
    if not isinstance(signature, str) or not signature:
        raise ValueError("Stripe-Signature header is required.")
    signing_secret = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
    if not signing_secret:
        raise RuntimeError("STRIPE_WEBHOOK_SECRET is not configured in the server environment.")
    return stripe.Webhook.construct_event(raw_body, signature, signing_secret)


def is_paid_checkout_completion(event):
    return (event.get("type") == "checkout.session.completed"
            and event.get("data", {}).get("object", {}).get("payment_status") == "paid")
`;
}

function generatedEnvironmentExample(provider) {
  return [
    `# ${provider.label}; populate locally through a secret manager, never commit this file.`,
    ...Object.entries(provider.env).map(([role, name]) => `# ${role}\n${name}=`)
  ].join("\n");
}

export function preparePaymentIntegration(input) {
  const compatibility = checkPaymentCompatibility(input);
  const provider = providerConfig(input.provider);
  if (compatibility.status === "incompatible_until_resolved") {
    return {
      provider: input.provider,
      compatibility,
      generatedArtifacts: [],
      staticValidation: { passed: false, checks: [{ name: "compatibility_gate", passed: false }] },
      requiresManualReview: true,
      liveIntegrationPerformed: false,
      credentialsUsed: false,
      note: "Resolve compatibility errors before generating integration artifacts."
    };
  }

  const generatedArtifacts = [{ path: ".env.example", content: generatedEnvironmentExample(provider) }];
  let providerImplementation;
  if (input.provider === "stripe" && ["node", "nextjs"].includes(input.serverRuntime)) {
    generatedArtifacts.push(
      { path: "src/payments/stripe-provider.mjs", content: stripeNodeScaffold() },
      { path: "package.payment.json", content: JSON.stringify({ type: "module", dependencies: { stripe: "^23.0.0" } }, null, 2) }
    );
    providerImplementation = "Runnable Node.js module for hosted one-time Checkout Sessions and raw-body signed webhook verification.";
  } else if (input.provider === "stripe" && ["python", "django"].includes(input.serverRuntime)) {
    generatedArtifacts.push(
      { path: "src/payments/stripe_provider.py", content: stripePythonScaffold() },
      { path: "requirements.payment.txt", content: "stripe>=16.1,<17\n" }
    );
    providerImplementation = "Runnable Python module for hosted one-time Checkout Sessions and signed webhook verification.";
  } else {
    generatedArtifacts.push({
      path: "PAYMENT_PROVIDER_REVIEW.md",
      content: `${provider.label} scaffold is gated. Confirm the current provider API, merchant eligibility, checkout creation contract, and webhook signature algorithm from official provider documentation before implementing provider calls. No endpoint or signing behavior has been guessed.\n`
    });
    providerImplementation = "Provider-specific executable code was withheld because current API and webhook contracts could not be verified from official documentation.";
  }

  const noCredentialLiterals = generatedArtifacts.every((artifact) => !/(?:sk_(?:test|live)_)[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/.test(artifact.content));
  const requiredBoundaries = input.provider !== "stripe" || !["node", "nextjs"].includes(input.serverRuntime)
    || (generatedArtifacts.some((artifact) => artifact.content.includes("idempotencyKey"))
      && generatedArtifacts.some((artifact) => artifact.content.includes("constructEvent"))
      && generatedArtifacts.some((artifact) => artifact.content.includes("raw HTTP request body")));
  const staticValidation = {
    passed: noCredentialLiterals && requiredBoundaries,
    checks: [
      { name: "no_embedded_provider_credentials", passed: noCredentialLiterals },
      { name: "provider_safety_contracts_present", passed: requiredBoundaries },
      { name: "compatibility_gate", passed: true }
    ]
  };

  return {
    provider: input.provider,
    compatibility,
    generatedArtifacts,
    providerImplementation,
    staticValidation,
    requiresManualReview: true,
    liveIntegrationPerformed: false,
    credentialsUsed: false,
    note: "Artifacts are returned for review; this tool does not write into a project, authenticate with a provider, deploy code, or mutate live account settings. Webhook consumers must persist processed event IDs before fulfilling orders."
  };
}

export async function writePaymentIntegration(input, { projectRoot = process.env.PAYMENT_PROJECT_ROOT, confirmWrite = false } = {}) {
  if (confirmWrite !== true) return { written: false, reason: "Explicit confirmWrite=true is required." };
  if (!projectRoot || !path.isAbsolute(projectRoot)) {
    return { written: false, reason: "Set PAYMENT_PROJECT_ROOT to an existing absolute project directory in the MCP server environment." };
  }
  const scaffold = preparePaymentIntegration(input);
  if (!scaffold.staticValidation.passed) return { written: false, reason: "Generated artifact checks did not pass; no files were written." };

  let root;
  try {
    root = await realpath(projectRoot);
  } catch {
    return { written: false, reason: "PAYMENT_PROJECT_ROOT must exist and be accessible to the MCP process." };
  }
  const outputDirectory = path.join(root, "payment-integration");
  try {
    await mkdir(outputDirectory, { mode: 0o700 });
  } catch (error) {
    return {
      written: false,
      reason: error.code === "EEXIST" ? "payment-integration already exists; refusing to overwrite it." : "Could not create the scaffold directory.",
      errorCode: error.code
    };
  }

  const writtenFiles = [];
  try {
    for (const artifact of scaffold.generatedArtifacts) {
      if (path.isAbsolute(artifact.path) || artifact.path.split(/[\\/]/).includes("..")) throw new Error("Unsafe generated artifact path.");
      const target = path.resolve(outputDirectory, artifact.path);
      if (!target.startsWith(`${outputDirectory}${path.sep}`)) throw new Error("Generated artifact escaped scaffold directory.");
      const parent = path.dirname(target);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const parentReal = await realpath(parent);
      if (parentReal !== outputDirectory && !parentReal.startsWith(`${outputDirectory}${path.sep}`)) throw new Error("Generated artifact parent escaped scaffold directory.");
      await writeFile(target, artifact.content, { encoding: "utf8", flag: "wx", mode: 0o600 });
      writtenFiles.push(path.relative(root, target).split(path.sep).join("/"));
    }
  } catch (error) {
    return {
      written: false,
      partial: writtenFiles.length > 0,
      directory: path.relative(root, outputDirectory).split(path.sep).join("/"),
      writtenFiles,
      reason: "Scaffold writing stopped safely. Inspect the listed files before retrying; existing files are never overwritten.",
      errorCode: error.code ?? "UNSAFE_PATH"
    };
  }
  return {
    written: true,
    directory: path.relative(root, outputDirectory).split(path.sep).join("/"),
    writtenFiles,
    provider: input.provider,
    executableProviderCodeGenerated: scaffold.generatedArtifacts.some((artifact) => /stripe-provider\.(mjs|py)$/.test(artifact.path)),
    liveIntegrationPerformed: false,
    credentialsUsed: false
  };
}

export const PAYMENT_PROVIDER_NAMES = Object.freeze(Object.keys(PROVIDERS));
