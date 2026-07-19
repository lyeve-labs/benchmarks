// scenario.js: one portable k6 script that runs any (target, scenario) pair.
//
// It reads targets.json + scenarios.json at init time, resolves the endpoint the
// given TARGET maps the given SCENARIO to, and drives it with a constant-arrival
// -rate executor (so a slow target can't lower its own offered load).
//
// Invoked by harness/run.sh, one scenario per process:
//   k6 run -e TARGET=lyeve -e SCENARIO=S01 -e BASE_URL=http://localhost:8080 scenario.js
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// ── load registries (init context) ──────────────────────────────────────────
const targets = JSON.parse(open('../../targets/targets.json'));
const scenarios = JSON.parse(open('../../scenarios/scenarios.json'));

const TARGET_ID = __ENV.TARGET || 'lyeve';
const SCENARIO_ID = __ENV.SCENARIO || 'S01';
const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@lyeve.com';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'benchmark-Passw0rd!';

const target = targets.targets.find((t) => t.id === TARGET_ID);
if (!target) throw new Error(`unknown target ${TARGET_ID}`);
const scenarioDef = scenarios.scenarios.find((s) => s.id === SCENARIO_ID);
if (!scenarioDef) throw new Error(`unknown scenario ${SCENARIO_ID}`);
const endpoint = target.endpoints[SCENARIO_ID];
if (!endpoint) throw new Error(`target ${TARGET_ID} has no endpoint for ${SCENARIO_ID}`);

const latency = new Trend('scenario_latency', true);
const okRate = new Rate('scenario_ok');

// ── options built from the scenario definition ──────────────────────────────
const k6def = scenarioDef.k6;
export const options = {
  scenarios: {
    [scenarioDef.slug]: {
      executor: k6def.executor,
      rate: k6def.rate,
      timeUnit: k6def.timeUnit,
      duration: __ENV.DURATION || k6def.duration,
      preAllocatedVUs: k6def.preAllocatedVUs,
      maxVUs: k6def.maxVUs || k6def.preAllocatedVUs * 4,
    },
  },
  thresholds: {
    scenario_latency: [`p(95)<${scenarioDef.thresholds.p95_ms}`],
    scenario_ok: [`rate>${1 - scenarioDef.thresholds.error_rate}`],
    http_req_failed: [`rate<${scenarioDef.thresholds.error_rate}`],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
  // Tag every sample so tools/collect.mjs can attribute it.
  tags: { target: TARGET_ID, scenario: SCENARIO_ID },
};

// ── helpers ─────────────────────────────────────────────────────────────────
function dget(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function login() {
  const auth = target.auth;
  if (!auth || !auth.login) return null;
  const body = {};
  for (const [k, v] of Object.entries(auth.login.body || {})) {
    body[k] = String(v).replace('{email}', ADMIN_EMAIL).replace('{password}', ADMIN_PASSWORD);
  }
  const res = http.post(`${BASE_URL}${auth.login.path}`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
  if (res.status !== 200) return null;
  try {
    return dget(res.json(), auth.login.tokenPath) || null;
  } catch (_) {
    return null;
  }
}

function articleBody(i) {
  const b = {
    title: `Benchmark article ${i}`,
    slug: `bench-article-${i}-${Math.floor(Math.random() * 1e6)}`,
    body: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(6),
    views: i,
    published: true,
  };
  return (endpoint.envelope === 'data' || TARGET_ID === 'lyeve') ? { data: b } : b;
}

// ── setup: token + a pool of real ids/slugs to sample ───────────────────────
export function setup() {
  // run.sh passes the seeder's token. Logging in again per scenario spends a
  // login allowance that some targets cap at a handful per address.
  const token = __ENV.TOKEN || login();
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let ids = [];
  let slugs = [];
  if (target.listProbe) {
    const res = http.get(`${BASE_URL}${target.listProbe.path}`, { headers });
    if (res.status === 200) {
      try {
        const payload = res.json();
        const ip = target.listProbe.itemsPath;
        const raw = ip ? dget(payload, ip) : payload;
        const items = Array.isArray(raw) ? raw : (Array.isArray(payload) ? payload : []);
        ids = items.map((it) => dget(it, target.listProbe.idField)).filter((x) => x != null);
        slugs = [...new Set(items.map((it) => dget(it, target.listProbe.slugField)).filter(Boolean))];
      } catch (_) { /* leave pools empty. Default function guards */ }
    }
  }
  const filterCheck = endpoint.path.includes('{slug}') ? assertFilterApplies(headers, slugs) : undefined;
  // setup() data is written into the summary export, which is committed as
  // evidence. A token passed in by run.sh stays out of it.
  return { token: __ENV.TOKEN ? null : token, ids, slugs, filterCheck };
}

// A filter parameter the target does not understand is usually ignored rather
// than refused, and the request then measures an unfiltered list while reading
// as a filter. That happened to this harness once. Ask for a value no record
// holds: a filter that applies returns no rows or refuses the value. One that
// is ignored returns rows, and the run stops instead of publishing them.
function assertFilterApplies(headers, slugs) {
  const ip = target.listProbe && target.listProbe.itemsPath;
  const rows = (res) => {
    if (res.status >= 400) return null;
    let payload = null;
    try { payload = res.json(); } catch (_) { return null; }
    const raw = ip ? dget(payload, ip) : payload;
    return Array.isArray(raw) ? raw : [];
  };
  const miss = `no-such-value-${Date.now()}`;
  const missRes = http.get(`${BASE_URL}${endpoint.path.replace('{slug}', miss)}`, { headers });
  const missRows = rows(missRes);
  if (missRows && missRows.length > 0) {
    throw new Error(`${TARGET_ID} ${SCENARIO_ID}: a filter on a value no record holds returned ${missRows.length} rows, so the filter is not applied`);
  }
  // Where the rows carry the filtered field, every one must hold the value.
  const check = { missStatus: missRes.status, missRows: missRows ? missRows.length : null };
  if (slugs.length) {
    const value = slugs[0];
    const hitRows = rows(http.get(`${BASE_URL}${endpoint.path.replace('{slug}', encodeURIComponent(value))}`, { headers })) || [];
    const field = target.listProbe.slugField;
    const seen = hitRows.map((it) => dget(it, field));
    check.hitRows = hitRows.length;
    if (seen.length && seen.every((v) => v !== undefined)) {
      check.allMatch = seen.every((v) => String(v) === String(value));
      if (!check.allMatch) throw new Error(`${TARGET_ID} ${SCENARIO_ID}: a filtered request returned rows that do not hold the value`);
    }
  }
  return check;
}

// ── the workload ────────────────────────────────────────────────────────────
export default function (data) {
  const headers = { 'Content-Type': 'application/json' };
  const token = __ENV.TOKEN || data.token;
  if (token) headers.Authorization = `Bearer ${token}`;

  let path = endpoint.path;
  if (path.includes('{id}')) {
    if (!data.ids.length) return; // nothing to read, so don't fabricate a 404 as a read
    path = path.replace('{id}', data.ids[Math.floor(Math.random() * data.ids.length)]);
  }
  if (path.includes('{slug}')) {
    if (!data.slugs.length) return; // no real filter values collected: don't fabricate one and measure the miss path
    const slug = data.slugs[Math.floor(Math.random() * data.slugs.length)];
    path = path.replace('{slug}', encodeURIComponent(slug));
  }

  const url = `${BASE_URL}${path}`;
  let res;
  if (endpoint.method === 'POST') {
    const body = endpoint.body === 'login'
      ? { [target.auth?.login?.body ? Object.keys(target.auth.login.body)[0] : 'email']: ADMIN_EMAIL, password: ADMIN_PASSWORD }
      : articleBody(__ITER);
    res = http.post(url, JSON.stringify(body), { headers });
  } else {
    res = http.get(url, { headers });
  }

  latency.add(res.timings.duration);
  const good = res.status >= 200 && res.status < 400;
  okRate.add(good);
  check(res, { [`${SCENARIO_ID} ${endpoint.method} ok`]: () => good });
}
