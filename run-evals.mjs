import { runEvaluation } from "./rag-engine.mjs";

const evaluation = runEvaluation();
const summary = {
  ranAt: evaluation.ranAt,
  passed: evaluation.passed,
  failed: evaluation.failed,
  total: evaluation.count,
  schemaPassRate: evaluation.schemaPassRate
};

console.log(JSON.stringify(summary, null, 2));
if (evaluation.failed) {
  console.error(JSON.stringify(evaluation.results.filter((result) => !result.passed), null, 2));
  process.exitCode = 1;
}
