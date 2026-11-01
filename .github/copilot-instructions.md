# Payment Setup MCP

The `payment-mcp/` server uses the official MCP TypeScript SDK (`@modelcontextprotocol/server`) over stdio. SDK references: [TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/), [first server tutorial](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/get-started/first-server.md), and [MCP tools](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools/).

Use Node.js 20 or later. Keep stdio stdout reserved for MCP protocol messages; diagnostics belong on stderr. Payment credentials must never be accepted as tool arguments, echoed, committed, or shown to the model. Only `write_payment_scaffold` may write files, and only after explicit `confirmWrite: true`, under `PAYMENT_PROJECT_ROOT/payment-integration`; it creates a fresh folder and refuses overwrites. Other tools perform compatibility checks, environment presence/prefix inspection, fixed-code troubleshooting, or prepare generated artifacts. No tool may create provider resources, process cardholder data, move funds, or enable live processing.

Stripe and Coinbase Commerce support must remain clearly distinguished. Do not claim merchant-country or product availability without verifying current provider documentation/account status. Treat webhook verification and server-side secret storage as required design boundaries.
