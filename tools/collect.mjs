// collect.mjs: parse one k6 summary-export file into a normalized metric row.
//
// k6's --summary-export writes aggregated metrics at end-of-test. We read the
// custom `scenario_latency` trend (falling back to http_req_duration) plus the
// served request rate and error rate. Exported as a function so generate-report
// can call it, and runnable directly for debugging:
//
//   node tools/collect.mjs results/raw/<run-id>/S01.summary.json
import { readFileSync } from 'node:fs';

export function collectSummary(path) {
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, 'utf8'));
  } catch (_) {
    return null;
  }
  const m = doc.metrics || {};
  const lat = m.scenario_latency || m.http_req_duration || {};
  const reqs = m.http_reqs || {};
  const failed = m.http_req_failed || {};
  const ok = m.scenario_ok || {};

  const val = (o, ...keys) => {
    for (const k of keys) if (o && typeof o[k] === 'number') return o[k];
    return null;
  };

  const errorRate = val(failed, 'value', 'rate');
  return {
    throughput_rps: val(reqs, 'rate') != null ? Math.round(val(reqs, 'rate')) : null,
    p50_ms: round(val(lat, 'med', 'p(50)')),
    p95_ms: round(val(lat, 'p(95)')),
    p99_ms: round(val(lat, 'p(99)')),
    error_rate: errorRate != null ? errorRate : (val(ok, 'value') != null ? 1 - val(ok, 'value') : null),
  };
}

function round(x) {
  return typeof x === 'number' ? Math.round(x * 10) / 10 : null;
}

// CLI mode
if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.error('usage: node tools/collect.mjs <summary.json>');
    process.exit(1);
  }
  console.log(JSON.stringify(collectSummary(path), null, 2));
}
