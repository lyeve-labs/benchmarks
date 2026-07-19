// generate-report.mjs: assemble the canonical report from all inputs.
//
//   inputs:  targets/targets.json         (vendor registry + reference host)
//            scenarios/scenarios.json      (workload catalog)
//            results/baseline.lyeve.json   (LyEve measured internals + targets)
//            results/measured.json          (ad-hoc real measurements, e.g. image sizes)
//            results/rig.json               (machine, engine build and method of the latest sweep)
//            results/raw/<run-id>/          (full sweep output, if any)
//   outputs: results/results.json           (machine-readable - the website reads this)
//            results/RESULTS.md             (human-readable report)
//
// Governing rule (METHODOLOGY §1): a competitor cell is only ever a real value or
// `pending`. This script never invents one.
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { collectSummary } from './collect.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const read = (p) => JSON.parse(readFileSync(join(REPO, p), 'utf8'));

const targetsDoc = read('targets/targets.json');
const scenariosDoc = read('scenarios/scenarios.json');
const baseline = read('results/baseline.lyeve.json');
const measured = existsSync(join(REPO, 'results/measured.json')) ? read('results/measured.json') : { entries: [] };
const profilesDoc = read('profiles/profiles.json');
const rig = existsSync(join(REPO, 'results/rig.json')) ? read('results/rig.json') : null;

const GENERATED_AT = process.env.BENCH_DATE || new Date().toISOString().slice(0, 10);
const COMPARISON_SET = targetsDoc.reference.comparisonSet;

// The headline comparison metrics and how each is sourced from a sweep.
const COMPARISON_METRICS = [
  { id: 'M-image',    label: 'Container image size', unit: 'MB', lowerIsBetter: true, note: 'Uncompressed image: the sum of its layers from `docker history` (amd64). A compiled Go binary against a Node runtime plus node_modules.', source: { kind: 'static', file: 'M-image' } },
  { id: 'M-mem-idle', label: 'Idle memory',          unit: 'MB', lowerIsBetter: true, note: 'Container memory from `docker stats` at rest after a restart, empty database, default config: the median of five samples taken after 45 seconds of settling. LyEve runs the free engine: every plugin compiled in, the free baseline started, no license.', source: { kind: 'static', file: 'M-mem-idle' } },
  { id: 'S01-p99',    label: 'p99 read-by-id',       unit: 'ms', lowerIsBetter: true, note: 'One record by id at 500 req/s (scenario S01).', source: { kind: 'scenario', scenario: 'S01', field: 'p99_ms' } },
  { id: 'S02-p99',    label: 'p99 list-50',          unit: 'ms', lowerIsBetter: true, note: 'First page of 50 at 300 req/s (scenario S02).', source: { kind: 'scenario', scenario: 'S02', field: 'p99_ms' } },
  { id: 'S03-p99',    label: 'p99 create',           unit: 'ms', lowerIsBetter: true, note: 'Create one record at 100 req/s (scenario S03).', source: { kind: 'scenario', scenario: 'S03', field: 'p99_ms' } },
  { id: 'S04-p99',    label: 'p99 filter',           unit: 'ms', lowerIsBetter: true, note: 'Filter by an indexed field, 25 rows, at 200 req/s (scenario S04). Each run first proves the filter applies: a value no record holds must return no rows, and a real value must return only matching rows.', source: { kind: 'scenario', scenario: 'S04', field: 'p99_ms' } },
  { id: 'S05-p99',    label: 'p99 login',            unit: 'ms', lowerIsBetter: true, note: 'Token issuance at 20 req/s, where slower is expected (password hash). A target whose stock config rate-limits authentication refuses the burst and reads pending here rather than posting a number for refused logins. Scenario S05.', source: { kind: 'scenario', scenario: 'S05', field: 'p99_ms' } },
  { id: 'M-cold',     label: 'Cold start',           unit: 'ms', lowerIsBetter: true, note: 'From `docker start` of a stopped container to the first request the application serves (includes DB connect and migration check), polled every 50 ms.', source: { kind: 'static', file: 'M-cold' } },
];

const PROVENANCE_LEGEND = {
  measured: 'We ran it on the rig described in this report and kept the raw output.',
  target: 'A number we engineer against and gate regressions on, not an end-to-end measurement.',
  'vendor-published': "A competitor's own published figure, cited, not independently reproduced by us.",
  pending: 'The harness supports it. We have not run it yet. Shown as a dash, never a guess.',
};

// ── index whatever real runs exist under results/raw ─────────────────────────
// A target is run several times, each on a fresh stack. Only the runs from the
// newest day that has any are aggregated, so an older sweep kept as evidence
// never mixes into a new one. Each figure is the median of those runs, with the
// lowest and highest beside it.
function median(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
function spread(xs) {
  const r1 = (x) => Math.round(x * 10) / 10;
  return { value: r1(median(xs)), min: r1(Math.min(...xs)), max: r1(Math.max(...xs)), runs: xs.length };
}

function listRuns(match) {
  const rawDir = join(REPO, 'results/raw');
  if (!existsSync(rawDir)) return [];
  return readdirSync(rawDir)
    .filter((name) => /^\d{8}-\d{6}-/.test(name) && statSync(join(rawDir, name)).isDirectory())
    .map((name) => ({ name, dir: join(rawDir, name), date: name.slice(0, 8), key: match(name) }))
    .filter((r) => r.key);
}

function newestDay(runs) {
  const byKey = {};
  for (const r of runs) {
    const cur = byKey[r.key];
    if (!cur || r.date > cur.date) byKey[r.key] = { date: r.date, runs: [] };
  }
  for (const r of runs) if (byKey[r.key].date === r.date) byKey[r.key].runs.push(r);
  return byKey;
}

function indexRaw() {
  const idx = {}; // target -> { static:{metricId:spread}, scenarios:{Sxx:{p99_ms:spread,...}}, date }
  const runs = listRuns((name) => (name.includes('-profile-') ? null : COMPARISON_SET.find((t) => name.includes(`-${t}-`) || name.endsWith(`-${t}`))));
  for (const [target, day] of Object.entries(newestDay(runs))) {
    const statics = {};
    const scen = {};
    for (const run of day.runs) {
      for (const f of readdirSync(run.dir)) {
        const full = join(run.dir, f);
        if (f.startsWith('M-') && f.endsWith('.json')) {
          try {
            const d = JSON.parse(readFileSync(full, 'utf8'));
            const v = d.value_mb ?? d.value_ms ?? d.value;
            if (typeof v === 'number') (statics[d.metric] ||= []).push(v);
          } catch (_) { /* skip */ }
        } else if (f.endsWith('.summary.json')) {
          const row = collectSummary(full);
          if (row) (scen[f.replace('.summary.json', '')] ||= []).push(row);
        }
      }
    }
    const entry = { static: {}, scenarios: {}, date: day.date, runs: day.runs.length };
    for (const [m, xs] of Object.entries(statics)) entry.static[m] = spread(xs);
    for (const [sid, rows] of Object.entries(scen)) {
      const out = { runs: rows.length, error_rates: rows.map((r) => r.error_rate) };
      for (const field of ['p50_ms', 'p95_ms', 'p99_ms', 'throughput_rps']) {
        const xs = rows.map((r) => r[field]).filter((x) => typeof x === 'number');
        if (xs.length) out[field] = spread(xs);
      }
      entry.scenarios[sid] = out;
    }
    idx[target] = entry;
  }
  return idx;
}
const raw = indexRaw();

// ── index real-world profile runs under results/raw ──────────────────────────
function indexProfileRuns() {
  const idx = {};
  const runs = listRuns((name) => {
    const m = name.match(/-profile-([a-z0-9]+)(-full)?$/);
    return m ? `${m[1]}${m[2] || ''}` : null;
  });
  for (const [key, day] of Object.entries(newestDay(runs))) {
    const full = key.endsWith('-full');
    const pid = key.replace(/-full$/, '');
    const rows = [];
    let pending = null;
    for (const run of day.runs) {
      const sum = join(run.dir, 'profile.summary.json');
      const row = existsSync(sum) ? collectSummary(sum) : null;
      if (row) { rows.push(row); continue; }
      const pend = readdirSync(run.dir).find((f) => f.endsWith('.pending.json'));
      if (pend) { try { pending = JSON.parse(readFileSync(join(run.dir, pend), 'utf8')); } catch (_) { /* skip */ } }
    }
    if (idx[pid] && idx[pid].provenance === 'measured') continue;
    if (rows.length) {
      const agg = { mode: full ? 'full' : 'core', provenance: 'measured', runs: rows.length, date: fmtDate(day.date) };
      for (const field of ['throughput_rps', 'p50_ms', 'p95_ms', 'p99_ms']) {
        const xs = rows.map((r) => r[field]).filter((x) => typeof x === 'number');
        if (xs.length) { const sp = spread(xs); agg[field] = sp.value; agg[`${field}_range`] = [sp.min, sp.max]; }
      }
      agg.error_rate = Math.max(...rows.map((r) => r.error_rate ?? 0));
      idx[pid] = agg;
    } else if (pending) {
      idx[pid] = { mode: pending.mode || (full ? 'full' : 'core'), provenance: 'pending', reason: pending.reason };
    }
  }
  return idx;
}
const profileRuns = indexProfileRuns();

function buildProfiles() {
  return profilesDoc.profiles.map((p) => {
    const run = profileRuns[p.id];
    // A run over the error budget is INVALID, not a slow measurement: never publish it.
    const overBudget = run && run.provenance === 'measured' && run.error_rate != null && run.error_rate > Math.max(0.02, (p.thresholds.error_rate || 0.01) * 3);
    let result;
    if (run && run.provenance === 'measured' && !overBudget) {
      result = { mode: run.mode, provenance: 'measured', runs: run.runs, throughput_rps: run.throughput_rps, p50_ms: run.p50_ms, p95_ms: run.p95_ms, p99_ms: run.p99_ms, p95_ms_range: run.p95_ms_range, p99_ms_range: run.p99_ms_range, error_rate: run.error_rate, asOf: run.date };
    } else if (overBudget) {
      result = { mode: run.mode, provenance: 'pending', reason: 'over-error-budget (invalid run)' };
    } else if (run) {
      result = { mode: run.mode, provenance: 'pending', reason: run.reason };
    } else {
      result = { provenance: 'pending' };
    }
    return {
      id: p.id, name: p.name, tagline: p.tagline, realWorld: p.realWorld,
      rate: p.rate, threshold: `p95 < ${p.thresholds.p95_ms} ms`,
      schemas: p.schemas.map((s) => ({ name: s.name, fields: s.fields.length + (s.relations || []).length })),
      plugins: (p.plugins || []).map((x) => x.name),
      seed: p.seed,
      traffic: p.traffic.map((t) => ({ id: t.id, weight: t.weight, desc: t.desc, needs: t.needs })),
      result,
    };
  });
}

// ── resolve one (metric, target) cell with strict precedence ─────────────────
function resolveCell(metric, targetId) {
  // 1. a real sweep wins
  const r = raw[targetId];
  if (r) {
    const asOf = fmtDate(r.date);
    if (metric.source.kind === 'static' && r.static[metric.source.file]) {
      const sp = r.static[metric.source.file];
      return { value: sp.value, min: sp.min, max: sp.max, runs: sp.runs, provenance: 'measured', detail: `median of ${sp.runs} runs, each on a fresh stack`, asOf };
    }
    if (metric.source.kind === 'scenario') {
      const sc = r.scenarios[metric.source.scenario];
      if (sc && sc[metric.source.field]) {
        // A scenario that blew the error budget in any run is an invalid
        // result, not a slow one: gate it to pending rather than publishing the
        // latency of failures.
        const bad = sc.error_rates.filter((e) => e != null && e > 0.03).length;
        if (bad) {
          const why = targetsDoc.targets.find((t) => t.id === targetId)?.pendingNotes?.[metric.source.scenario];
          return { provenance: 'pending', reason: `over the error budget in ${bad} of ${sc.runs} runs${why ? `: ${why}` : ''}`, asOf };
        }
        const sp = sc[metric.source.field];
        const out = { value: sp.value, min: sp.min, max: sp.max, runs: sp.runs, provenance: 'measured', detail: `median of ${sp.runs} runs, each on a fresh stack`, asOf };
        // A target that cannot keep up serves less than the offered rate, and
        // its latency is then capped by the load generator's VU limit rather
        // than measured at that rate. Say so beside the number.
        const offered = scenariosDoc.scenarios.find((x) => x.id === metric.source.scenario)?.k6?.rate;
        const served = sc.throughput_rps?.value;
        if (offered && served != null && served < offered * 0.9) out.served = { rps: served, offered };
        return out;
      }
    }
  }
  // 2. LyEve's curated baseline
  if (targetId === 'lyeve' && baseline.comparisonValues[metric.id]) {
    return { ...baseline.comparisonValues[metric.id] };
  }
  // 3. ad-hoc real measurement (e.g. an image pulled + measured)
  const mj = measured.entries.find((e) => e.target === targetId && e.metricId === metric.id);
  if (mj) return { value: mj.value, provenance: mj.provenance, detail: mj.detail, asOf: mj.asOf };
  // 4. honest pending
  return { provenance: 'pending' };
}

function fmtDate(yyyymmdd) {
  return /^\d{8}$/.test(yyyymmdd || '') ? `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}` : GENERATED_AT;
}

// ── build the comparison ─────────────────────────────────────────────────────
const comparison = COMPARISON_METRICS.map((metric) => {
  const values = {};
  for (const t of COMPARISON_SET) values[t] = resolveCell(metric, t);
  // LyEve lead is only CLAIMED when LyEve's own cell is `measured`: never off a
  // `target`. A directional gap vs a target is visible in the cells (each shows
  // its provenance badge). We just don't stamp "N× better" until we've measured
  // our own side too.
  const lyeveCell = values.lyeve;
  const lyeve = lyeveCell?.value;
  const competitorVals = COMPARISON_SET.filter((t) => t !== 'lyeve').map((t) => values[t]?.value).filter((v) => typeof v === 'number');
  let lyeveLead = null;
  if (typeof lyeve === 'number' && lyeveCell.provenance === 'measured' && lyeve > 0 && metric.lowerIsBetter && competitorVals.length) {
    // Compare against the STRONGEST competitor (the best/lowest value), not the
    // worst, so the lead is a conservative floor that holds against the best
    // alternative, never a number inflated by a saturating outlier.
    const best = Math.min(...competitorVals);
    lyeveLead = Math.round((best / lyeve) * 10) / 10;
  }
  return { id: metric.id, label: metric.label, unit: metric.unit, lowerIsBetter: metric.lowerIsBetter, note: metric.note, values, lyeveLead };
});

const targetMeta = [...COMPARISON_SET, ...targetsDoc.reference.contextOnly].map((id) => {
  const t = targetsDoc.targets.find((x) => x.id === id);
  return { id: t.id, name: t.name, runtime: t.runtime, runtimeDetail: t.runtimeDetail, kind: t.kind, site: t.site, versionPin: t.versionPin };
});

const scenarioSummary = scenariosDoc.scenarios.map((s) => ({
  id: s.id, title: s.title, category: s.category, intent: s.intent,
  rate: `${s.k6.rate}/s`, threshold: `p95 < ${s.thresholds.p95_ms} ms`,
}));

const results = {
  schemaVersion: '1.0',
  generatedAt: GENERATED_AT,
  sourceRepo: 'LyEve-Labs/benchmarks',
  reference: targetsDoc.reference,
  provenanceLegend: PROVENANCE_LEGEND,
  targets: targetMeta,
  comparison,
  internals: baseline.internals,
  lyeveTargets: baseline.restTargets,
  coldStartPhases: baseline.coldStartPhases,
  scenarios: scenarioSummary,
  profiles: buildProfiles(),
  rig,
};

writeFileSync(join(REPO, 'results/results.json'), JSON.stringify(results, null, 2) + '\n');
writeFileSync(join(REPO, 'results/RESULTS.md'), renderMarkdown(results));

const cells = comparison.flatMap((m) => Object.values(m.values));
const nMeasured = cells.filter((c) => c.provenance === 'measured').length;
const nPending = cells.filter((c) => c.provenance === 'pending').length;
console.log(`report: wrote results/results.json + results/RESULTS.md`);
console.log(`        ${comparison.length} metrics × ${COMPARISON_SET.length} targets: ${nMeasured} measured, ${nPending} pending`);

// ── markdown renderer ────────────────────────────────────────────────────────
function badge(p) {
  // Words, not emoji: this repo ships no emoji, and a reader of a dense
  // table should not have to learn a glyph to know where a number came from.
  return { measured: '(measured)', target: '(target)', 'vendor-published': '(vendor)', pending: '(pending)' }[p] || '';
}
function cell(c, unit) {
  if (c.provenance === 'pending' || c.value == null) return '_pending_';
  const range = c.runs > 1 ? `<br><sub>${fmtNum(c.min)} to ${fmtNum(c.max)}, n=${c.runs}</sub>` : '';
  const sat = c.served ? `<br><sub>served ${c.served.rps} of ${c.served.offered} req/s</sub>` : '';
  return `${fmtNum(c.value)} ${unit} ${badge(c.provenance)}${range}${sat}`;
}
function fmtNum(n) {
  return n >= 1000 ? n.toLocaleString('en-US') : String(n);
}

function renderRig(rg) {
  let md = `## How this run was made\n\n`;
  md += `| | |\n|---|---|\n`;
  md += `| Date | ${rg.date} |\n`;
  md += `| Machine | ${rg.machine.cpu}, ${rg.machine.memory}, ${rg.machine.disk}, ${rg.machine.os} |\n`;
  md += `| Container runtime | ${rg.machine.docker} |\n`;
  md += `| Load generator | ${rg.loadGenerator} |\n`;
  md += `| LyEve engine | ${rg.engine.description} |\n`;
  for (const c of rg.competitors) md += `| ${c.name} | ${c.version} |\n`;
  md += `| Repetitions | ${rg.repetitions} |\n`;
  md += `\n${rg.method.map((x) => `- ${x}`).join('\n')}\n\n`;
  return md;
}

function renderMarkdown(r) {
  const names = Object.fromEntries(r.targets.map((t) => [t.id, t.name]));
  const set = r.reference.comparisonSet;
  let md = '';
  md += `# LyEve Benchmark Results\n\n`;
  md += `> Generated ${r.generatedAt} from the [benchmark harness](../README.md). `;
  md += `Every value is tagged with its provenance. We never publish a number we did not measure ([methodology §1](../METHODOLOGY.md#1-the-one-rule)).\n\n`;
  md += `**Rig:** ${r.reference.hostSpec} · ${r.reference.database}\n\n`;
  if (r.reference.staticHost) md += `${r.reference.staticHost}\n\n`;
  if (r.rig) md += renderRig(r.rig);

  md += `## Provenance\n\n`;
  md += `| Marker | State | Meaning |\n|:---:|---|---|\n`;
  for (const [k, v] of Object.entries(r.provenanceLegend)) md += `| ${badge(k)} | \`${k}\` | ${v} |\n`;
  md += `\n`;

  md += `## Head-to-head\n\n`;
  md += `Runtimes: ${set.map((id) => `**${names[id]}** (${r.targets.find((t) => t.id === id).runtime})`).join(' · ')}.\n\n`;
  md += `Each cell is the median of the runs, with the lowest and highest run beneath it.\n\n`;
  md += `| Metric | ${set.map((id) => names[id]).join(' | ')} | LyEve lead* |\n`;
  md += `|---|${set.map(() => '---').join('|')}|---|\n`;
  for (const m of r.comparison) {
    const cols = set.map((id) => cell(m.values[id], m.unit)).join(' | ');
    const lead = !m.lyeveLead ? 'n/a' : (m.lyeveLead < 0.95 ? `${m.lyeveLead}× (behind)` : (m.lyeveLead <= 1.05 ? 'on par' : `${m.lyeveLead}× better`));
    md += `| ${m.label} | ${cols} | ${lead} |\n`;
  }
  md += `\n*Lead is LyEve's median against the **strongest** competitor's median on each metric (the best, lowest value), so it is a conservative floor: LyEve is at least this much better than the best alternative, not the worst. A lead below 1 means a competitor is ahead. Every competitor's own value is in its column.\n\n`;
  for (const m of r.comparison) md += `- **${m.label}:** ${m.note}\n`;
  if (r.comparison.some((m) => set.some((id) => m.values[id].served))) md += `\nA cell marked "served N of M req/s" belongs to a target that could not keep up with the offered rate. Its latency is bounded by the load generator's limit on concurrent requests, so it understates how slow that target is at the full rate.\n`;
  const pendingWhy = r.comparison.flatMap((m) => set.filter((id) => m.values[id].provenance === 'pending' && m.values[id].reason).map((id) => `- ${m.label}, ${names[id]}: ${m.values[id].reason}.`));
  if (pendingWhy.length) md += `\nWhy a cell is pending:\n\n${pendingWhy.join('\n')}\n`;
  md += `\n> A cell reads \`pending\` until that platform is measured through the identical harness, or when a run blew the error budget (an invalid result, not a slow one). That is by design, not an omission.\n\n`;

  // Hosted (SaaS) platforms can't run on our host, so they're named here for
  // context rather than dropped into a "measured on the same rig" column.
  const hosted = r.targets.filter((t) => (r.reference.contextOnly || []).includes(t.id));
  if (hosted.length) {
    md += `**Hosted platforms (context only).** ${hosted.map((t) => t.name).join(', ')} `;
    md += `${hosted.length === 1 ? 'is' : 'are'} SaaS: the vendor runs the servers, so ${hosted.length === 1 ? 'it' : 'they'} can't be placed on our host beside the self-hosted engines. `;
    md += `Any figure would reflect the vendor's own infrastructure and CDN, not this rig, so we keep ${hosted.length === 1 ? 'it' : 'them'} out of the head-to-head and only ever cite a vendor-published number with its source. See [methodology §10](../METHODOLOGY.md#10-competitor-notes--caveats).\n\n`;
  }

  md += `## Under the hood: LyEve micro-benchmarks (measured)\n\n`;
  md += `_${r.internals.source}; ${r.internals.machine}, Go ${r.internals.goVersion}, ${r.internals.measuredOn}._\n\n`;
  for (const g of r.internals.groups) {
    md += `**${g.title}**\n\n| Operation | Cost |\n|---|---|\n`;
    for (const row of g.rows) md += `| ${row.name} | \`${row.display}\` |\n`;
    md += `\n`;
  }

  md += `## LyEve REST targets (targets, not measurements)\n\n`;
  md += `| Endpoint | Sustained RPS | p50 | p99 |\n|---|---:|---:|---:|\n`;
  for (const t of r.lyeveTargets) md += `| \`${t.endpoint}\` | ${t.rps.toLocaleString()} | ${t.p50} | ${t.p99} |\n`;
  md += `\n`;

  md += `## What we test: scenarios\n\n`;
  md += `| ID | Scenario | Type | Offered load | Threshold |\n|---|---|---|---|---|\n`;
  for (const s of r.scenarios) md += `| ${s.id} | ${s.title} | ${s.category} | ${s.rate} | ${s.threshold} |\n`;
  md += `\nSee [\`scenarios/\`](../scenarios/) for each scenario, and the worked example [S01](../scenarios/S01-content-read-by-id.md).\n\n`;

  md += `## Real-world profiles\n\n`;
  md += `Complete applications: schema plus realistic traffic, on the free engine. See [\`profiles/\`](../profiles/).\n\n`;
  for (const p of r.profiles) {
    md += `### ${p.name}: ${p.tagline}\n\n`;
    md += `- **Schema:** ${p.schemas.map((s) => `${s.name} (${s.fields}f)`).join(' · ')}\n`;
    if (p.plugins.length) md += `- **Plugins:** ${p.plugins.join(', ')}\n`;
    md += `- **Seed:** ${Object.entries(p.seed).map(([k, v]) => `${v.toLocaleString()} ${k}`).join(', ')}\n`;
    md += `- **Traffic** (${p.rate} req/s, ${p.threshold}): ${p.traffic.map((t) => `${t.weight}% \`${t.id}\`${t.needs ? ` \`[${t.needs}]\`` : ''}`).join(' · ')}\n`;
    const res = p.result;
    if (res.provenance === 'measured') {
      const n = res.runs > 1 ? `, median of ${res.runs} runs` : '';
      const r95 = res.p95_ms_range && res.runs > 1 ? ` (${res.p95_ms_range[0]} to ${res.p95_ms_range[1]})` : '';
      const r99 = res.p99_ms_range && res.runs > 1 ? ` (${res.p99_ms_range[0]} to ${res.p99_ms_range[1]})` : '';
      md += `- **Result** (${res.mode}${n}, ${res.asOf}): **${fmtNum(res.throughput_rps)} req/s**, p95 ${res.p95_ms} ms${r95}, p99 ${res.p99_ms} ms${r99}, ${(res.error_rate * 100).toFixed(2)}% err at worst (measured)\n`;
    } else {
      md += `- **Result:** pending${res.reason ? ` (${res.reason})` : ''}\n`;
    }
    md += `\n`;
  }

  md += `## Reproduce\n\n\`\`\`bash\nmake doctor\nmake run TARGET=lyeve SCENARIO=S01\nmake sweep      # every self-hostable target\nmake report     # regenerate this file\n\`\`\`\n`;
  md += `\n*Disagree with a number? Re-run it and open an issue with your host spec and raw k6 output.*\n`;
  return md;
}
