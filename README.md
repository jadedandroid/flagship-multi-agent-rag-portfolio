# Flagship Multi-Agent RAG Portfolio

## Multi-page Portfolio

The home page is a project directory. Detailed case studies use normal document navigation:

- `projects/flagship-rag.html` — queryable local RAG demo and adversarial evaluation.
- `projects/cloud-remediation.html` — human-gated cloud remediation simulation design.
- `projects/payment-mcp.html` — payment setup MCP design and safety boundary.

Shared presentation styles live in `site.css`.

## Hosting

`.github/workflows/pages.yml` publishes the static site to GitHub Pages on pushes to `main`. The expected URL is `https://jadedandroid.github.io/flagship-multi-agent-rag-portfolio/` after Pages is enabled and the first Actions deployment succeeds.

## Local RAG Demonstration

The portfolio query panel executes a deterministic, browser-local extractive RAG pipeline. It plans bounded subqueries, ranks local documents with TF-IDF cosine similarity and BM25-style keyword scoring, combines rankings with reciprocal-rank fusion, validates exact quote/source membership, and critiques retrieved source metadata for conflicts, archived editions, and instruction-like text.

Serve this directory over HTTP using a static server that returns `.mjs` files with a JavaScript MIME type. Native ES modules do not run from `file://`. The site has no paid API or external service dependency.

Run the same adversarial checks from the command line:

```sh
node run-evals.mjs
```

The suite contains 27 executable cases. A nonzero process exit indicates a failed case.

## Scope And Limitations

- `rag-engine.mjs` contains the corpus, planner, hybrid retrieval, extractive candidate generation, schema/span validation, critique, and evaluation cases.
- `portfolio-ui.mjs` runs queries, renders traces and citations, exposes the JSON boundary inspector, and reports current-run evaluation results.
- The corpus is authored demonstration data, not official NYC records or legal guidance.
- This implementation has no LLM, dense embedding model, LangGraph runtime, external vector database, or network retrieval. Its checks establish behavior only for the included deterministic fixtures; they are not production faithfulness or semantic accuracy measurements.
- Browser latency figures measure local JavaScript execution in the current browser session, not a hosted service.

## Payment Setup MCP

The stdio MCP server is in `payment-mcp/` and is configured for VS Code in `.vscode/mcp.json`. It targets Node.js 20+ and the official `@modelcontextprotocol/server` TypeScript SDK. The VS Code launcher selects Node 24 or 20 through NVM when the shell's default Node is too old; set `PAYMENT_MCP_NODE` to an explicit supported binary when needed.

```sh
cd payment-mcp
npm install
npm test
npm start
```

Available tools check Stripe/Coinbase Commerce compatibility, inspect expected environment variables without returning values, troubleshoot an allowlisted diagnostic code, and generate integration artifacts. Stripe produces runnable hosted Checkout and signed-webhook modules for Node/Next.js or Python/Django, plus dependency and environment templates; a static check ensures required safety hooks are present and no credentials are embedded. Coinbase Commerce emits only configuration and a review gate until its current official endpoint and webhook contract can be verified. `write_payment_scaffold` writes reviewed artifacts under `PAYMENT_PROJECT_ROOT/payment-integration` only when called with `confirmWrite: true`; it creates a fresh folder and refuses overwrites. It does not authenticate with providers, mutate merchant settings, process card data, or initiate/settle payments. Credentials belong in the MCP process's protected local environment or secret manager, never in chat/tool arguments. Node.js 14 in older shells is unsupported; use Node.js 20 or later.
