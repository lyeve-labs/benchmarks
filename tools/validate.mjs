// validate.mjs: cheap shape checks so a broken registry fails loudly, not silently.
//   node tools/validate.mjs   (also: make validate)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => JSON.parse(readFileSync(join(REPO, p), 'utf8'));
const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

const targets = read('targets/targets.json');
const scenarios = read('scenarios/scenarios.json');

// scenarios well-formed
for (const s of scenarios.scenarios) {
  check(s.id && s.slug && s.k6 && s.thresholds, `scenario ${s.id || '?'} missing id/slug/k6/thresholds`);
  check(typeof s.thresholds.p95_ms === 'number', `scenario ${s.id} missing numeric thresholds.p95_ms`);
}

// every comparison-set target exists and can run every scenario
for (const id of targets.reference.comparisonSet) {
  const t = targets.targets.find((x) => x.id === id);
  check(t, `comparisonSet target '${id}' not found in targets[]`);
  if (!t) continue;
  check(t.compose, `target '${id}' has no compose file`);
  for (const s of scenarios.scenarios) {
    check(t.endpoints && t.endpoints[s.id], `target '${id}' has no endpoint for scenario ${s.id}`);
  }
}

// hosted targets must not claim a compose file (they can't be run here)
for (const t of targets.targets) {
  if (t.kind === 'hosted') check(!t.compose, `hosted target '${t.id}' should not declare a compose file`);
}

// if results.json exists, no competitor cell may carry a bare fabricated number
if (existsSync(join(REPO, 'results/results.json'))) {
  const results = read('results/results.json');
  const valid = new Set(['measured', 'target', 'vendor-published', 'pending']);
  for (const m of results.comparison) {
    for (const [tid, cell] of Object.entries(m.values)) {
      check(valid.has(cell.provenance), `results ${m.id}/${tid}: invalid provenance '${cell.provenance}'`);
      if (cell.provenance === 'pending') check(cell.value == null, `results ${m.id}/${tid}: pending cell must not carry a value`);
      if (cell.value != null) check(cell.provenance !== 'pending', `results ${m.id}/${tid}: value present but provenance pending`);
    }
  }
}

if (errors.length) {
  console.error(`validate: ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log('validate: ok, registries and results are well-formed');
