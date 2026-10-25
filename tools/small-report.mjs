// small-report.mjs: fold every small-server campaign into results/small.json
// and results/SMALL.md.
//
// harness/small-sweep.sh runs every self-hosted target on every read scenario,
// in rounds, on one server, and tags each run with the campaign's name. This
// groups the runs by that name and gives each figure as the median of the
// campaign's runs, with the lowest and highest beside it. A void run, or one
// that belongs to no campaign, is left out.
//
//   node tools/small-report.mjs
//   node tools/small-report.mjs --count <campaign> <target> <scenario>
//
// --count prints how many runs the campaign holds for that target and
// scenario, which is how the sweep knows where to resume.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const RAW = join(REPO, 'results/raw/small');
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const targetsDoc = read(join(REPO, 'targets/targets.json'));
const scenariosDoc = read(join(REPO, 'scenarios/scenarios.json'));

// Every run a report reads: one that carries a campaign and is not void.
function campaignRuns() {
  if (!existsSync(RAW)) return [];
  return readdirSync(RAW)
    .filter((id) => existsSync(join(RAW, id, 'small.json')))
    .sort()
    .map((id) => ({ id, ...read(join(RAW, id, 'small.json')) }))
    .filter((r) => r.campaign && !r.void);
}

function median(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

// The lower of the two middle values when the count is even, so a figure that
// has to be one of the offered rates stays one, and at least half the runs
// reached it.
function lowerMedian(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  return a[Math.floor((a.length - 1) / 2)];
}

// The median of the numbers given, with the lowest, the highest and how many.
function spread(xs, middle = median) {
  const v = xs.filter((x) => typeof x === 'number' && Number.isFinite(x));
  if (!v.length) return null;
  return { median: middle(v), min: Math.min(...v), max: Math.max(...v), n: v.length };
}

// Each distinct value with the number of runs that carried it, most common first.
function tally(values) {
  const m = new Map();
  for (const v of values) if (v != null && v !== '') m.set(v, (m.get(v) || 0) + 1);
  return [...m]
    .sort((a, b) => b[1] - a[1] || (String(a[0]) < String(b[0]) ? -1 : 1))
    .map(([value, runs]) => ({ value, runs }));
}

const highest = (xs) => {
  const v = xs.filter((x) => typeof x === 'number');
  return v.length ? Math.max(...v) : null;
};

// Compose names a container <project>-<service>-<n>. The report keys it by service.
const service = (name) => (name.match(/-([A-Za-z0-9]+)-\d+$/) || [])[1] || name;

function services(list) {
  const by = {};
  for (const containers of list) {
    for (const [name, mb] of Object.entries(containers || {})) (by[service(name)] ||= []).push(mb);
  }
  return Object.fromEntries(Object.entries(by).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, spread(v)]));
}

const STEP_FIELDS = [
  'served_rps', 'served_share', 'p50_ms', 'p95_ms', 'p99_ms', 'error_rate', 'dropped_iterations', 'vus_peak',
  'received_mb_s', 'server_busy_pct', 'server_iowait_pct', 'server_steal_pct', 'loadgen_busy_pct', 'loadgen_steal_pct',
];

function scenarioResult(id, runs) {
  const booted = runs.filter((r) => r.boot?.status === 'ok' && r.load);
  const measured = booted.filter((r) => r.load.reason !== 'seed-failed');
  const rates = [...new Set(measured.flatMap((r) => r.load.steps.map((s) => s.rate)))].sort((a, b) => a - b);
  return {
    id,
    runs: runs.length,
    bootFailed: runs.length - booted.length,
    seedFailed: booted.length - measured.length,
    unanswered: runs.filter((r) => r.end?.status === 'unanswered').length,
    offeredRates: tally(measured.map((r) => r.load.offeredRates.join(' '))).map((x) => x.value),
    // A run that kept up at no rate counts as 0.
    highestRateKeptUp: spread(measured.map((r) => r.load.highestRateKeptUp ?? 0), lowerMedian),
    peak: {
      vmUsedMB: spread(measured.map((r) => r.peak?.vmUsedMB)),
      containersMB: services(measured.map((r) => r.peak?.containersMB)),
    },
    steps: rates.map((rate) => {
      const steps = measured.map((r) => r.load.steps.find((s) => s.rate === rate && !s.reason)).filter(Boolean);
      return { rate, runs: steps.length, ...Object.fromEntries(STEP_FIELDS.map((f) => [f, spread(steps.map((s) => s[f]))])) };
    }),
  };
}

function targetResult(id, runs, scenarioIds) {
  const def = targetsDoc.targets.find((t) => t.id === id);
  const failed = runs.filter((r) => r.boot?.status !== 'ok');
  const trouble = (r) => r.boot?.container?.oomKilled || r.end?.oomKilled || r.end?.restarts > 0
    || r.boot?.container?.oomKernelLines?.length > 0 || r.end?.oomKernelLines?.length > 0;
  return {
    id,
    name: def?.name || id,
    // Compose lists a stack's images in no fixed order, so each run's set is sorted.
    images: tally(runs.map((r) => (r.rig?.images || []).map((i) => `${i.ref} ${i.id || i.digest || 'unknown'}`).sort().join(', '))),
    boot: {
      runs: runs.length,
      failed: failed.length,
      reasons: tally(failed.map((r) => r.boot?.reason)),
      ms: spread(runs.map((r) => r.boot?.value_ms)),
    },
    idle: {
      vmUsedMB: spread(runs.map((r) => r.idle?.vm?.usedMB)),
      containersMB: services(runs.map((r) => r.idle?.containersMB)),
    },
    oomKilledOrRestarted: runs.filter(trouble).length,
    // A run whose kernel lines show a kill already counts above.
    endUnanswered: runs.filter((r) => r.end?.status === 'unanswered' && !trouble(r)).length,
    scenarios: scenarioIds.map((s) => scenarioResult(s, runs.filter((r) => r.scenario === s))),
  };
}

function campaignResult(name, runs) {
  const rig = (f) => tally(runs.map((r) => f(r.rig || {})));
  const steps = runs.flatMap((r) => r.load?.steps || []);
  const targetIds = targetsDoc.targets.map((t) => t.id).filter((id) => runs.some((r) => r.target === id));
  const scenarioIds = scenariosDoc.scenarios.map((s) => s.id).filter((id) => runs.some((r) => r.scenario === id));
  return {
    name,
    runs: runs.length,
    firstRun: runs[0].date,
    lastRun: runs.at(-1).date,
    provider: rig((g) => g.provider),
    plan: rig((g) => g.plan),
    harness: rig((g) => g.harness),
    server: {
      cpu: rig((g) => g.cpu),
      nproc: rig((g) => g.nproc),
      memoryTotalMB: rig((g) => g.memoryTotalMB),
      swapTotalMB: rig((g) => g.swapTotalMB),
      os: rig((g) => g.os),
      kernel: rig((g) => g.kernel),
      docker: rig((g) => g.docker),
      uptimeAtStartS: spread(runs.map((r) => r.rig?.uptimeAtStartS)),
      // The one-minute load average when the run started.
      loadAtStart: spread(runs.map((r) => parseFloat(r.rig?.loadAtStart))),
    },
    loadGenerator: {
      cpu: rig((g) => g.loadGenerator?.cpu),
      nproc: rig((g) => g.loadGenerator?.nproc),
      memoryTotalMB: rig((g) => g.loadGenerator?.memoryTotalMB),
      k6: rig((g) => g.loadGenerator?.k6),
      loadAtStart: spread(runs.map((r) => parseFloat(r.rig?.loadGenerator?.loadAtStart))),
    },
    networkRttMs: spread(runs.map((r) => r.rig?.networkRttMs)),
    // The highest figure any measured step reached, so one line says whether
    // either machine ran short of CPU anywhere in the campaign.
    worstStep: {
      serverStealPct: highest(steps.map((s) => s.server_steal_pct)),
      loadGeneratorBusyPct: highest(steps.map((s) => s.loadgen_busy_pct)),
      loadGeneratorStealPct: highest(steps.map((s) => s.loadgen_steal_pct)),
    },
    targets: targetIds.map((id) => targetResult(id, runs.filter((r) => r.target === id), scenarioIds)),
  };
}

// ── markdown ─────────────────────────────────────────────────────────────────
const num = (x, digits = 1) => (x == null ? 'n/a' : Number(x.toFixed(digits)).toLocaleString('en-US'));
const one = (t) => (t.length ? t.map((x) => (t.length > 1 ? `${x.value} (${x.runs} runs)` : String(x.value))).join(', ') : 'n/a');

// A median with its unit and its range beneath it, the way RESULTS.md shows one.
function cell(s, f = (x) => num(x), unit = '') {
  if (!s) return 'n/a';
  return `${f(s.median)}${unit}<br><sub>${f(s.min)} to ${f(s.max)}, n=${s.n}</sub>`;
}

const ms = (x) => num(x);
const seconds = (x) => num(x / 1000);
const megabytes = (x) => num(x, 0);
// One decimal, rounded down, so a share under the 90% floor never reads as 90.
const share = (x) => num(Math.floor(x * 1000 + 1e-6) / 10, 1);
const percent = (x) => (x == null ? 'n/a' : `${num(x, 0)}%`);
// Steal sits near zero on a healthy machine, so it keeps one decimal.
const steal = (x) => (x == null ? 'n/a' : `${num(x, 1)}%`);
const range = (s, f) => (s.min === s.max ? f(s.min) : `${f(s.min)} to ${f(s.max)}`);
const errors = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(2)}%`);
const rate = (x) => (x === 0 ? 'none' : num(x, 0));
const load = (x) => num(x, 2);
const shortId = (ref) => ref.replace(/ sha256:([0-9a-f]{12})[0-9a-f]*/g, ' `$1`');
const scenarioTitle = (id) => scenariosDoc.scenarios.find((s) => s.id === id)?.title || id;

// The highest rate a scenario kept up, with the runs that measured nothing
// because the target did not boot or did not take the seed, and those after
// whose steps the server did not answer.
function keptUp(s) {
  const failed = [
    s.bootFailed && `the target did not boot in ${s.bootFailed} of ${s.runs} runs`,
    s.seedFailed && `seeding failed in ${s.seedFailed} of ${s.runs} runs`,
    s.unanswered && `the server did not answer after the steps in ${s.unanswered} of ${s.runs} runs`,
  ].filter(Boolean);
  const figure = s.highestRateKeptUp ? cell(s.highestRateKeptUp, rate) : s.runs ? 'no run measured' : 'n/a';
  return failed.length ? `${figure}<br><sub>${failed.join(', ')}</sub>` : figure;
}

function campaignMarkdown(c) {
  const memory = (t) => (t.length ? t.map((x) => `${x.value} MB${t.length > 1 ? ` (${x.runs} runs)` : ''}`).join(', ') : 'n/a');
  const swap = c.server.swapTotalMB.length === 1 && c.server.swapTotalMB[0].value === 0 ? 'no swap' : `swap ${memory(c.server.swapTotalMB)}`;
  const scenarioIds = c.targets[0]?.scenarios.map((s) => s.id) || [];
  const offered = [...new Set(c.targets.flatMap((t) => t.scenarios.flatMap((s) => s.offeredRates)))];
  let md = `## ${c.name}\n\n`;
  md += '| | |\n|---|---|\n';
  md += `| Provider and plan | ${one(c.provider)}, ${one(c.plan)} |\n`;
  md += `| Server | ${one(c.server.cpu)}, ${one(c.server.nproc)} vCPU, ${memory(c.server.memoryTotalMB)} memory, ${swap} |\n`;
  md += `| Server software | ${one(c.server.os)}, Linux ${one(c.server.kernel)}, Docker ${one(c.server.docker)} |\n`;
  md += `| Load generator | ${one(c.loadGenerator.cpu)}, ${one(c.loadGenerator.nproc)} vCPU, ${memory(c.loadGenerator.memoryTotalMB)} memory, k6 ${one(c.loadGenerator.k6)} |\n`;
  md += `| Network | TCP connect from the load generator to the server: ${c.networkRttMs ? `${num(c.networkRttMs.median, 2)} ms (${num(c.networkRttMs.min, 2)} to ${num(c.networkRttMs.max, 2)}, n=${c.networkRttMs.n})` : 'n/a'} |\n`;
  md += `| Runs | ${c.runs}, ${c.firstRun === c.lastRun ? `on ${c.firstRun}` : `from ${c.firstRun} to ${c.lastRun}`}. Each started ${c.server.uptimeAtStartS ? `${range(c.server.uptimeAtStartS, (x) => num(x, 0))} s` : 'an unrecorded time'} after the server booted |\n`;
  md += `| Load at the start of a run | one-minute load average ${c.server.loadAtStart ? range(c.server.loadAtStart, load) : 'n/a'} on the server and ${c.loadGenerator.loadAtStart ? range(c.loadGenerator.loadAtStart, load) : 'n/a'} on the load generator |\n`;
  md += `| Offered rates | ${offered.length ? offered.map((o) => `${o.split(' ').join(', ')} req/s`).join('; ') : 'n/a'} |\n`;
  md += `| Harness | ${c.harness.length ? c.harness.map((h) => `\`${h.value}\`${c.harness.length > 1 ? ` (${h.runs} runs)` : ''}`).join(', ') : 'n/a'} |\n`;
  md += `| CPU steal | at most ${steal(c.worstStep.serverStealPct)} on the server and ${steal(c.worstStep.loadGeneratorStealPct)} on the load generator in any measured step |\n`;
  md += `| Load generator CPU | at most ${percent(c.worstStep.loadGeneratorBusyPct)} busy in any measured step |\n\n`;

  md += '### Boot and idle memory\n\n';
  md += 'Boot is the time from `docker compose up`, with the images on the server and an empty database, to the first answer on the target\'s ready path. Idle memory is the median of five samples after a 45 s settle: the whole server from `free`, and each container from `docker stats`.\n\n';
  md += '| Target | Images | Boot | Server used | App | Database | Proxy | Failed boots | Killed for memory or restarted |\n';
  md += '|---|---|---|---|---|---|---|---|---|\n';
  for (const t of c.targets) {
    const images = t.images.map((i) => `${shortId(i.value).split(', ').join('<br>')}${t.images.length > 1 ? ` (${i.runs} runs)` : ''}`).join('<br>');
    const failed = t.boot.failed ? `${t.boot.failed} of ${t.boot.runs}: ${t.boot.reasons.map((r) => r.value).join(', ')}` : `0 of ${t.boot.runs}`;
    const ctr = t.idle.containersMB;
    const killed = `${t.oomKilledOrRestarted}${t.endUnanswered ? `<br><sub>unknown in ${t.endUnanswered}: the server did not answer after the steps</sub>` : ''}`;
    md += `| ${t.name} | ${images} | ${cell(t.boot.ms, seconds, ' s')} | ${cell(t.idle.vmUsedMB, megabytes, ' MB')} | ${cell(ctr.app, megabytes, ' MB')} | ${cell(ctr.db, megabytes, ' MB')} | ${ctr.proxy ? cell(ctr.proxy, megabytes, ' MB') : 'none'} | ${failed} | ${killed} |\n`;
  }

  md += '\n### Highest rate kept up\n\n';
  md += 'A step keeps up when it serves at least 90% of its offered rate within the scenario\'s error budget. A run stops at the first step that does not, so the rates above the highest one kept up never ran. With an even number of runs the figure is the lower of the two middle ones, so it is always a rate that was offered and at least half the runs reached it.\n\n';
  md += `| Target | ${scenarioIds.map((s) => `${s}: ${scenarioTitle(s)} (req/s)`).join(' | ')} |\n`;
  md += `|---|${scenarioIds.map(() => '---').join('|')}|\n`;
  for (const t of c.targets) md += `| ${t.name} | ${t.scenarios.map(keptUp).join(' | ')} |\n`;

  md += '\n### Peak memory under load\n\n';
  md += 'The highest of the samples the server took every 5 s while the steps ran: the whole server, and the application container.\n\n';
  md += `| Target | ${scenarioIds.map((s) => `${s} server used | ${s} app`).join(' | ')} |\n`;
  md += `|---|${scenarioIds.map(() => '---|---').join('|')}|\n`;
  for (const t of c.targets) md += `| ${t.name} | ${t.scenarios.map((s) => `${cell(s.peak.vmUsedMB, megabytes, ' MB')} | ${cell(s.peak.containersMB.app, megabytes, ' MB')}`).join(' | ')} |\n`;

  for (const id of scenarioIds) {
    md += `\n### ${id}: ${scenarioTitle(id)}\n\n`;
    md += 'Latencies in ms. CPU is the busy share of each machine over the whole k6 process that ran the step. I/O wait is the share the server sat waiting on its disk: on a server with no swap it climbs when memory runs out and the kernel reads back the program code it dropped from its cache. Steal is the share the hypervisor held back from the server.\n\n';
    md += '| Target | Offered (req/s) | Runs | Served | p50 | p95 | p99 | Errors | Server CPU | Server I/O wait | Server steal | Load generator CPU | Received (MB/s) |\n';
    md += '|---|---:|---:|---|---:|---:|---|---:|---:|---:|---:|---:|---:|\n';
    for (const t of c.targets) {
      const s = t.scenarios.find((x) => x.id === id);
      for (const st of s.steps) {
        md += `| ${t.name} | ${st.rate} | ${st.runs} | ${cell(st.served_share, share, '%')} | ${num(st.p50_ms?.median)} | ${num(st.p95_ms?.median)} | ${cell(st.p99_ms, ms)} | ${errors(st.error_rate?.median)} | ${percent(st.server_busy_pct?.median)} | ${percent(st.server_iowait_pct?.median)} | ${steal(st.server_steal_pct?.median)} | ${percent(st.loadgen_busy_pct?.median)} | ${num(st.received_mb_s?.median, 2)} |\n`;
      }
    }
  }
  return md;
}

function markdown(campaigns) {
  let md = '# Small-server results\n\n';
  md += '> Generated by `tools/small-report.mjs` from the runs in [`raw/small/`](raw/small/). [Methodology §13](../METHODOLOGY.md#13-the-small-server-rig) says how a campaign runs.\n\n';
  md += 'Each campaign runs every self-hosted target alone on one small server, with its own PostgreSQL beside it, the way someone renting the smallest plan would run it. The server reboots before every run. k6 runs on a second machine and offers each read scenario at rising rates. Every figure is the median of the campaign\'s runs, with the lowest and highest beneath it and the number of runs. These figures never enter the head-to-head in [RESULTS.md](RESULTS.md), which runs every target on one larger machine.\n\n';
  if (!campaigns.length) return md + 'No campaign has run yet.\n';
  md += '| Campaign | Provider | Plan | Runs | Dates |\n|---|---|---|---|---|\n';
  for (const c of campaigns) md += `| [${c.name}](#${c.name.toLowerCase().replace(/[^a-z0-9_-]/g, '')}) | ${one(c.provider)} | ${one(c.plan)} | ${c.runs} | ${c.firstRun === c.lastRun ? c.firstRun : `${c.firstRun} to ${c.lastRun}`} |\n`;
  return md + '\n' + campaigns.map(campaignMarkdown).join('\n');
}

const runs = campaignRuns();
if (process.argv[2] === '--count') {
  const [campaign, target, scenario] = process.argv.slice(3);
  console.log(runs.filter((r) => r.campaign === campaign && r.target === target && r.scenario === scenario).length);
} else {
  // Newest first: the campaign whose last run is latest leads. A run id starts
  // with its UTC start time, so the ids sort in time order.
  const latest = (n) => runs.filter((r) => r.campaign === n).at(-1).id;
  const campaigns = [...new Set(runs.map((r) => r.campaign))]
    .sort((a, b) => (latest(b) < latest(a) ? -1 : 1))
    .map((n) => campaignResult(n, runs.filter((r) => r.campaign === n)));
  writeFileSync(join(REPO, 'results/small.json'), JSON.stringify({ campaigns }, null, 2) + '\n');
  writeFileSync(join(REPO, 'results/SMALL.md'), markdown(campaigns));
  console.log(`small report: ${campaigns.length} campaigns, ${runs.length} runs → results/SMALL.md`);
}
