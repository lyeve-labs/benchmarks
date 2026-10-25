// small-summary.mjs: fold one small-server run directory into small.json.
//
// harness/small.sh writes raw text from the server (rig.txt, boot*.txt,
// idle.txt, load-samples.txt, end*.txt), and per offered rate one k6 summary
// and the CPU counters of both machines around it. This turns them into one
// document and the M-*.json files every run carries.
//
//   node tools/small-summary.mjs results/raw/small/<run-id>
//   node tools/small-summary.mjs --check <step.summary.json> <offered rate> <error budget>
//
// --check exits 0 when the step stayed within the error budget and served at
// least 90% of the offered rate, and 1 otherwise, so the harness stops stepping.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { collectSummary } from './collect.mjs';

// The share of the offered rate a step must serve to count as keeping up. The
// report generator flags a head-to-head cell below the same line.
const SERVED_FLOOR = 0.9;

const text = (dir, f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), 'utf8') : '');
const lines = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean);

function keyValues(s) {
  const out = {};
  for (const l of lines(s)) {
    const i = l.indexOf('=');
    if (i > 0) out[l.slice(0, i)] = l.slice(i + 1);
  }
  return out;
}

function mb(s) {
  const m = String(s || '').match(/([\d.]+)\s*([KMGT]i?B|B)/i);
  if (!m) return null;
  const f = { B: 1 / 1048576, KIB: 1 / 1024, KB: 1 / 1024, MIB: 1, MB: 1, GIB: 1024, GB: 1024, TIB: 1048576, TB: 1048576 }[m[2].toUpperCase()] ?? 1;
  return Math.round(parseFloat(m[1]) * f * 10) / 10;
}

const median = (xs) => {
  const a = xs.slice().sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null;
};

// Samples are blocks of "sample <epoch>", "vm <total> <used> <available>" and
// "ctr <name> <usage> / <limit> <cpu>" lines.
function parseSamples(s) {
  const vm = [];
  const ctr = {};
  for (const l of lines(s)) {
    const p = l.split(/\s+/);
    if (p[0] === 'vm' && p.length >= 4) vm.push({ total: +p[1], used: +p[2], available: +p[3] });
    if (p[0] === 'ctr' && p.length >= 3) {
      const v = mb(p[2]);
      if (v != null) (ctr[p[1]] ||= []).push(v);
    }
  }
  return { vm, ctr };
}

function state(dir, name) {
  const kv = keyValues(text(dir, `${name}.txt`));
  if (!kv.status) return null;
  return {
    status: kv.status,
    exitCode: kv.exit_code != null ? Number(kv.exit_code) : null,
    oomKilled: kv.oom_killed === 'true',
    restarts: kv.restarts != null ? Number(kv.restarts) : null,
    oomKernelLines: lines(text(dir, `${name}-dmesg.txt`)),
  };
}

// The busy and stolen shares of one machine's CPU between two reads of the
// first line of /proc/stat: cpu user nice system idle iowait irq softirq steal.
function cpuShare(before, after) {
  const a = String(before || '').trim().split(/\s+/).slice(1, 9).map(Number);
  const b = String(after || '').trim().split(/\s+/).slice(1, 9).map(Number);
  if (a.length < 8 || b.length < 8 || [...a, ...b].some(Number.isNaN)) return null;
  const d = b.map((v, i) => v - a[i]);
  const total = d.reduce((sum, v) => sum + v, 0);
  if (total <= 0) return null;
  const pct = (x) => Math.round((x / total) * 1000) / 10;
  return { busy: pct(total - d[3] - d[4] - d[7]), steal: pct(d[7]) };
}

function step(summaryPath, rate, budget) {
  const row = collectSummary(summaryPath);
  if (!row) return { rate, provenance: 'pending', reason: 'no k6 summary' };
  const share = row.throughput_rps != null ? Math.round((row.throughput_rps / rate) * 1000) / 1000 : null;
  const withinBudget = row.error_rate != null && row.error_rate <= budget;
  const keptUp = share != null && share >= SERVED_FLOOR;
  // What can hold a step under its offered rate besides the target: k6 out of
  // virtual users (dropped iterations), the network (bytes received) and the
  // CPU of either machine, read over the whole k6 process.
  const m = JSON.parse(readFileSync(summaryPath, 'utf8')).metrics || {};
  const cpu = keyValues(text(dirname(summaryPath), basename(summaryPath).replace(/\.summary\.json$/, '.cpu.txt')));
  const server = cpuShare(cpu.server_before, cpu.server_after);
  const loadgen = cpuShare(cpu.loadgen_before, cpu.loadgen_after);
  return {
    rate,
    provenance: withinBudget ? 'measured' : 'pending',
    served_rps: row.throughput_rps,
    served_share: share,
    p50_ms: row.p50_ms,
    p95_ms: row.p95_ms,
    p99_ms: row.p99_ms,
    error_rate: row.error_rate,
    within_budget: withinBudget,
    kept_up: keptUp,
    dropped_iterations: m.dropped_iterations?.count ?? 0,
    vus_peak: m.vus?.max ?? null,
    received_mb_s: m.data_received?.rate != null ? Math.round(m.data_received.rate / 10000) / 100 : null,
    server_busy_pct: server?.busy ?? null,
    server_steal_pct: server?.steal ?? null,
    loadgen_busy_pct: loadgen?.busy ?? null,
    loadgen_steal_pct: loadgen?.steal ?? null,
  };
}

function describe(s) {
  const pct = (x) => (x == null ? '?' : `${Math.round(x * 1000) / 10}%`);
  const cpu = s.server_busy_pct != null && s.loadgen_busy_pct != null
    ? `, CPU busy ${Math.round(s.server_busy_pct)}% on the server and ${Math.round(s.loadgen_busy_pct)}% here`
    : '';
  return `served ${pct(s.served_share)} of ${s.rate} req/s, ${s.error_rate == null ? '?' : (s.error_rate * 100).toFixed(2)}% errors, p99 ${s.p99_ms ?? '?'} ms${cpu}`;
}

function check(path, rate, budget) {
  const s = step(path, Number(rate), Number(budget));
  if (s.provenance === 'pending' && s.reason) { console.log(s.reason); process.exit(1); }
  console.log(describe(s));
  process.exit(s.within_budget && s.kept_up ? 0 : 1);
}

function summarize(dir) {
  const rig = keyValues(text(dir, 'rig.txt'));
  // image=<ref> <repository digest, or a dash for a built image> <image ID on the server>
  const images = lines(text(dir, 'rig.txt')).filter((l) => l.startsWith('image=')).map((l) => {
    const [ref, digest, id] = l.slice(6).split(' ');
    return { ref, digest: digest && digest !== '-' ? digest : null, id: id || null };
  });
  delete rig.image;
  const target = rig.target;
  const scenarios = JSON.parse(readFileSync(new URL('../scenarios/scenarios.json', import.meta.url), 'utf8'));
  const scenario = scenarios.scenarios.find((s) => s.id === rig.scenario);
  const budget = scenario?.thresholds?.error_rate ?? 0.01;

  const bootKv = keyValues(text(dir, 'boot-result.txt'));
  const boot = {
    status: bootKv.status,
    provenance: 'measured',
    value_ms: bootKv.status === 'ok' ? Number(bootKv.boot_ms) : null,
    elapsed_ms: Number(bootKv.boot_ms),
    timeout_s: Number(bootKv.timeout_s),
    readyPath: bootKv.ready_path,
    reason: bootKv.reason || null,
    container: state(dir, 'boot'),
  };
  if (bootKv.status !== 'ok') boot.logTail = lines(text(dir, 'boot-logs.txt'));
  const voided = keyValues(text(dir, 'void.txt'));

  const out = {
    mode: 'small-server',
    target,
    date: (rig.date || '').slice(0, 10),
    campaign: rig.campaign || null,
    scenario: rig.scenario || null,
    rig: {
      harness: rig.harness || null,
      provider: rig.provider || null,
      plan: rig.plan || null,
      cpu: rig.server_cpu || null,
      nproc: rig.server_nproc ? Number(rig.server_nproc) : null,
      memoryTotalMB: rig.server_mem_total_mb ? Number(rig.server_mem_total_mb) : null,
      swapTotalMB: rig.server_swap_total_mb ? Number(rig.server_swap_total_mb) : null,
      cgroupMemoryMax: rig.server_cgroup_mem_max || null,
      os: rig.server_os || null,
      kernel: rig.server_kernel || null,
      arch: rig.server_arch || null,
      docker: rig.server_docker || null,
      dockerInstalledByRun: rig.docker_installed_by_run === 'yes',
      loadAtStart: rig.server_load || null,
      uptimeAtStartS: rig.server_uptime_s ? Number(rig.server_uptime_s) : null,
      loadGenerator: {
        cpu: rig.loadgen_cpu || null,
        nproc: rig.loadgen_nproc ? Number(rig.loadgen_nproc) : null,
        memoryTotalMB: rig.loadgen_mem_total_mb ? Number(rig.loadgen_mem_total_mb) : null,
        loadAtStart: rig.loadgen_load || null,
        k6: rig.loadgen_k6 || null,
        where: 'a separate machine, over the network',
      },
      networkRttMs: rig.rtt_ms ? Number(rig.rtt_ms) : null,
      images,
    },
    boot,
  };
  // A void run is kept for the record and never enters a report.
  if (voided.reason) out.void = { reason: voided.reason };

  const idle = parseSamples(text(dir, 'idle.txt'));
  if (idle.vm.length) {
    out.idle = {
      provenance: 'measured',
      samples: idle.vm.length,
      vm: {
        totalMB: median(idle.vm.map((v) => v.total)),
        usedMB: median(idle.vm.map((v) => v.used)),
        availableMB: median(idle.vm.map((v) => v.available)),
      },
      containersMB: Object.fromEntries(Object.entries(idle.ctr).map(([k, v]) => [k, median(v)])),
    };
  }

  const load = keyValues(text(dir, 'load.txt'));
  if (boot.status === 'ok') {
    const files = readdirSync(dir).filter((f) => /-r\d+\.summary\.json$/.test(f));
    const steps = files
      .map((f) => step(join(dir, f), Number(f.match(/-r(\d+)\.summary\.json$/)[1]), budget))
      .sort((a, b) => a.rate - b.rate);
    out.load = {
      scenario: rig.scenario,
      offeredRates: (rig.rates || '').split(/\s+/).filter(Boolean).map(Number),
      warmup: '10s, discarded',
      window: scenario?.k6?.duration || '60s',
      errorBudget: budget,
      servedFloor: SERVED_FLOOR,
      steps,
      stopped: load.stopped || null,
    };
    if (load.seed === 'failed') Object.assign(out.load, { provenance: 'pending', reason: 'seed-failed' });
    const highest = steps.filter((s) => s.within_budget && s.kept_up).pop();
    out.load.highestRateKeptUp = highest ? highest.rate : null;

    const peak = parseSamples(text(dir, 'load-samples.txt'));
    if (peak.vm.length) {
      out.peak = {
        provenance: 'measured',
        samples: peak.vm.length,
        vmUsedMB: Math.max(...peak.vm.map((v) => v.used)),
        vmMinAvailableMB: Math.min(...peak.vm.map((v) => v.available)),
        containersMB: Object.fromEntries(Object.entries(peak.ctr).map(([k, v]) => [k, Math.max(...v)])),
      };
    }
    out.end = state(dir, 'end');
  }

  writeFileSync(join(dir, 'small.json'), JSON.stringify(out, null, 2) + '\n');

  // The per-metric files in the shape every run directory carries.
  const app = (o) => Object.entries(o || {}).find(([k]) => /-app-\d+$/.test(k))?.[1];
  const put = (name, row) => writeFileSync(join(dir, `${name}.json`), JSON.stringify({ metric: name, target, ...row }) + '\n');
  if (boot.value_ms != null) put('M-boot', { value_ms: boot.value_ms });
  if (app(out.idle?.containersMB) != null) put('M-mem-idle', { value_mb: app(out.idle.containersMB) });
  if (app(out.peak?.containersMB) != null) put('M-mem-peak', { value_mb: app(out.peak.containersMB) });

  const steps = out.load?.steps || [];
  if (out.void) console.log(`small: ${target} run is void (${out.void.reason}), so no report reads it`);
  console.log(`small: ${target} boot ${boot.status}${boot.value_ms != null ? ` in ${boot.value_ms} ms` : ` (${boot.reason})`}` +
    (out.idle ? `, idle VM ${out.idle.vm.usedMB} MB used of ${out.idle.vm.totalMB}` : '') +
    (steps.length ? `, ${steps.length} steps, highest kept up: ${out.load.highestRateKeptUp ?? 'none'} req/s` : ''));
  for (const s of steps) console.log(`       ${describe(s)}`);
}

if (process.argv[2] === '--check') check(process.argv[3], process.argv[4], process.argv[5]);
else if (process.argv[2]) summarize(process.argv[2]);
else {
  console.error('usage: node tools/small-summary.mjs <run-dir> | --check <summary.json> <rate> <error budget>');
  process.exit(1);
}
