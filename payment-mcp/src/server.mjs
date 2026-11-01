import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";
import {
  checkPaymentCompatibility,
  inspectPaymentEnvironment,
  preparePaymentIntegration,
  troubleshootPaymentSetup,
  writePaymentIntegration
} from "./payment-tools.mjs";

const server = new McpServer({ name: "business-payment-setup", version: "0.1.0" });

const paymentSetupSchema = z.object({
  provider: z.enum(["stripe", "coinbase_commerce"]),
  businessCountry: z.string().length(2).transform((value) => value.toUpperCase()),
  settlementCurrency: z.string().length(3).transform((value) => value.toUpperCase()),
  checkoutMode: z.enum(["hosted", "embedded"]),
  recurringPayments: z.boolean(),
  serverRuntime: z.enum(["node", "nextjs", "python", "django", "other"]),
  webhookEndpoint: z.string().min(1).max(200).regex(/^\/[a-zA-Z0-9/_-]+$/),
  clientFramework: z.enum(["react", "nextjs", "html", "other"])
}).strict();

server.registerTool(
  "check_payment_compatibility",
  {
    description: "Check payment-integration requirements and configuration compatibility for Stripe card payments or Coinbase Commerce crypto checkout. Does not verify merchant eligibility or call a provider API.",
    inputSchema: paymentSetupSchema
  },
  async (input) => ({ content: [{ type: "text", text: JSON.stringify(checkPaymentCompatibility(input), null, 2) }] })
);

server.registerTool(
  "inspect_payment_environment",
  {
    description: "Inspect server-process environment configuration for required payment key presence, recognizable key prefixes, and Stripe test/live mismatch. Never accepts or returns credential values and makes no network calls.",
    inputSchema: z.object({ provider: z.enum(["stripe", "coinbase_commerce"]) }).strict()
  },
  async ({ provider }) => ({ content: [{ type: "text", text: JSON.stringify(inspectPaymentEnvironment(provider), null, 2) }] })
);

server.registerTool(
  "troubleshoot_payment_setup",
  {
    description: "Return safe diagnostic steps for a known payment setup failure code. Do not send free-form logs, credentials, card data, or customer data.",
    inputSchema: z.object({
      provider: z.enum(["stripe", "coinbase_commerce"]),
      issue: z.enum(["invalid_currency", "webhook_signature_failure", "missing_environment_variable", "test_live_mode_mismatch", "provider_account_not_supported", "checkout_session_failure", "coinbase_commerce_api_error", "unknown"])
    }).strict()
  },
  async (input) => {
    const result = troubleshootPaymentSetup(input);
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.accepted };
  }
);

server.registerTool(
  "prepare_payment_integration",
  {
    description: "Return generated payment integration artifacts. Stripe produces runnable one-time hosted Checkout and signed-webhook modules for Node/Next.js or Python/Django; Coinbase Commerce returns an environment template and an API-contract review gate until its current official endpoints can be verified. No credentials are consumed and nothing is written, deployed, or activated.",
    inputSchema: paymentSetupSchema
  },
  async (input) => ({ content: [{ type: "text", text: JSON.stringify(preparePaymentIntegration(input), null, 2) }] })
);

server.registerTool(
  "write_payment_scaffold",
  {
    description: "Write generated payment setup files into a new payment-integration folder beneath the MCP server's PAYMENT_PROJECT_ROOT. Requires explicit confirmWrite=true, never overwrites existing files, and never uses credentials or performs provider API calls.",
    inputSchema: paymentSetupSchema.extend({ confirmWrite: z.literal(true) }).strict()
  },
  async ({ confirmWrite, ...input }) => {
    const result = await writePaymentIntegration(input, { confirmWrite });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: !result.written };
  }
);

await serveStdio(() => server);
