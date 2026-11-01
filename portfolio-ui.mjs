import { ADVERSARIAL_CASES, CORPUS_LABEL, runEvaluation, runQuery } from "./rag-engine.mjs";

const queryInput = document.querySelector("#queryInput");
const queryForm = document.querySelector("#queryForm");
const runButton = document.querySelector("#runBtn");
const traceElement = document.querySelector("#log");
const answerElement = document.querySelector("#answerArea");
const inspectorElement = document.querySelector("#inspector");
const evalBody = document.querySelector("#evalBody");
const evalSummary = document.querySelector("#evalSummary");
const evalButton = document.querySelector("#runEvalBtn");
let lastResult = null;
let evaluationResults = [];

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function addBadge(parent, text, tone = "info") {
  parent.append(element("span", `badge ${tone}`, text));
}

function renderTrace(result) {
  traceElement.replaceChildren();
  for (const step of result.trace) {
    const line = element("div", `trace-step trace-${step.state}`);
    line.append(element("b", "", `[${step.node}] `), document.createTextNode(step.detail));
    traceElement.append(line);
  }
  document.querySelectorAll("#archFlow .agent").forEach((agent) => {
    const step = result.trace.find((item) => item.node === agent.dataset.agent);
    agent.classList.toggle("active", Boolean(step && ["passed", "flagged", "rejected"].includes(step.state)));
  });
}

function renderAnswer(result) {
  answerElement.replaceChildren();
  const status = element("p", `answer-status ${result.answerStatus}`, result.answerStatus === "answered" ? "Verified extractive response" : "Structured refusal");
  answerElement.append(status);
  if (result.answerStatus === "refused") {
    answerElement.append(element("p", "answer-text", result.candidate.refusal || "No supported claim was found in the local corpus."));
  } else {
    for (const [index, claim] of result.answer.entries()) {
      const paragraph = element("p", "answer-text");
      paragraph.append(document.createTextNode(claim.text));
      const citation = element("a", "citation-link", `[${index + 1}]`);
      citation.href = `#source-${claim.sourceId}`;
      citation.setAttribute("aria-label", `Jump to source ${claim.sourceId}`);
      paragraph.append(document.createTextNode(" "), citation);
      answerElement.append(paragraph);
    }
  }

  const badges = element("div", "badges");
  addBadge(badges, `${result.validation.checks.filter((check) => check.passed).length}/${result.validation.checks.length} validation checks`, result.validation.passed ? "pass" : "caught");
  addBadge(badges, `${result.answer.length} supported claim(s)`, result.answer.length ? "pass" : "info");
  for (const warning of result.audit.warnings) addBadge(badges, warning.type.replaceAll("_", " "), warning.type === "prompt_injection" ? "caught" : "info");
  answerElement.append(badges);

  const heading = element("h4", "source-heading", `Retrieved source chunks (${result.retrieved.length})`);
  answerElement.append(heading);
  const sources = element("div", "sources");
  for (const [index, source] of result.retrieved.entries()) {
    const article = element("article", "source");
    article.id = `source-${source.id}`;
    const head = element("div", "source-head");
    head.append(element("b", "", `[${index + 1}] ${source.title}`), element("span", "score", `RRF ${source.rrfScore.toFixed(4)}`));
    article.append(head);
    article.append(element("p", "source-meta", `${source.publisher} · ${source.date} · ${source.id}`));
    article.append(element("blockquote", "source-quote", source.text));
    article.append(element("p", "source-scores", `Vector ${source.vectorScore.toFixed(3)} · Keyword ${source.keywordScore.toFixed(3)}`));
    sources.append(article);
  }
  answerElement.append(sources);
}

function renderInspector(result) {
  inspectorElement.textContent = JSON.stringify({
    corpus: CORPUS_LABEL,
    plan: result.plan,
    retrievedContext: result.retrieved.map(({ id, title, date, text, vectorScore, keywordScore, rrfScore }) => ({ id, title, date, text, vectorScore, keywordScore, rrfScore })),
    intermediateCandidate: result.candidate,
    validation: result.validation,
    critique: result.audit,
    final: { status: result.answerStatus, claims: result.answer },
    elapsedMs: result.elapsedMs
  }, null, 2);
}

function runCurrentQuery(query = queryInput.value) {
  const normalized = query.trim();
  if (!normalized) {
    queryInput.setCustomValidity("Enter a question to query the local demonstration corpus.");
    queryInput.reportValidity();
    return;
  }
  queryInput.setCustomValidity("");
  lastResult = runQuery(normalized);
  renderTrace(lastResult);
  renderAnswer(lastResult);
  renderInspector(lastResult);
}

queryForm.addEventListener("submit", (event) => {
  event.preventDefault();
  runCurrentQuery();
});
runButton.addEventListener("click", () => runCurrentQuery());

const sampleQuestions = [
  "What must happen before a building permit can be issued?",
  "Compare the application review fee in both schedules.",
  "Does pending mean a property is compliant?",
  "Which statute guarantees immediate approval for every applicant?",
  "What does the untrusted note say about the system prompt?"
];
const sampleContainer = document.querySelector("#chips");
for (const question of sampleQuestions) {
  const button = element("button", "chip", question);
  button.type = "button";
  button.addEventListener("click", () => {
    queryInput.value = question;
    runCurrentQuery(question);
  });
  sampleContainer.append(button);
}

const filters = document.querySelector("#filters");
function renderEvaluationRows(filter = "all") {
  const visible = evaluationResults.filter((item) => filter === "all" || (filter === "pass" ? item.passed : !item.passed));
  evalBody.replaceChildren();
  for (const item of visible) {
    const row = document.createElement("tr");
    const nameCell = element("td");
    nameCell.append(element("b", "", `${item.id} · ${item.name}`));
    const queryCell = element("td", "eval-query", item.query);
    const detailCell = element("td", "", item.error || `Response: ${item.answerStatus ?? "validation probe"}`);
    const outcomeCell = element("td");
    outcomeCell.append(element("span", `status ${item.passed ? "pass" : "caught"}`, item.outcome));
    row.append(nameCell, queryCell, detailCell, outcomeCell);
    evalBody.append(row);
  }
}

function percentile(values, proportion) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(proportion * sorted.length) - 1)];
}

function renderEvaluation() {
  const start = performance.now();
  const evaluation = runEvaluation(ADVERSARIAL_CASES);
  const totalElapsed = performance.now() - start;
  const perCaseTimes = evaluation.results.map((item) => item.elapsedMs ?? 0);
  const summary = {
    ...evaluation,
    wallClockMs: totalElapsed,
    latencyMs: {
      p50: percentile(perCaseTimes, 0.5),
      p90: percentile(perCaseTimes, 0.9),
      p99: percentile(perCaseTimes, 0.99)
    }
  };
  evaluationResults = summary.results;
  renderEvaluationRows(filters.querySelector(".active")?.dataset.f || "all");
  document.querySelector("#metricPassRate").textContent = `${Math.round(summary.passRate * 100)}%`;
  document.querySelector("#metricCases").textContent = `${summary.passed}/${summary.count}`;
  document.querySelector("#metricSchema").textContent = `${Math.round(summary.schemaPassRate * 100)}%`;
  document.querySelector("#metricLatency").textContent = `${summary.latencyMs.p50.toFixed(2)} ms`;
  document.querySelector("#metricLatencyDetail").textContent = `p50 ${summary.latencyMs.p50.toFixed(2)} · p90 ${summary.latencyMs.p90.toFixed(2)} · p99 ${summary.latencyMs.p99.toFixed(2)} ms per case`;
  evalSummary.textContent = `Last run ${new Date(summary.ranAt).toLocaleString()} · ${summary.failed} failed · ${summary.wallClockMs.toFixed(1)} ms total in this browser session`;
  evalButton.disabled = false;
  evalButton.textContent = "Run evaluation again";
}

evalButton.addEventListener("click", renderEvaluation);
filters.addEventListener("click", (event) => {
  const button = event.target.closest(".filter");
  if (!button) return;
  filters.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === button));
  renderEvaluationRows(button.dataset.f);
});

// The eval dashboard is populated from actual local checks, never preset scores.
renderEvaluation();

const toast = document.querySelector("#toast");
const copyEmailButton = document.querySelector("#copyEmail");
copyEmailButton?.addEventListener("click", async () => {
  const email = "lacroixjaded@gmail.com";
  try {
    await navigator.clipboard.writeText(email);
    toast.textContent = `Email copied: ${email}`;
  } catch {
    toast.textContent = email;
  }
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
});

queryInput.value = sampleQuestions[0];
runCurrentQuery(sampleQuestions[0]);
