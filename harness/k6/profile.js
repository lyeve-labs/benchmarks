// profile.js: drive a real-world application profile's weighted traffic mix.
//
// Reads profiles/profiles.json, resolves the chosen PROFILE, and runs its
// traffic mix at the profile's arrival rate. On the free engine (FULL != 1) it
// runs only content-core entries (needs == null) and renormalizes weights; with
// FULL=1 it runs the plugin-dependent entries too.
//
//   k6 run -e PROFILE=blog -e BASE_URL=http://localhost:8080 profile.js
//
// Path templates are explicit about what they sample, because the engine cannot
// join and the driver must not guess:
//
//   {id:blog_posts}     a random id of that content type
//   {slug:blog_posts}   a random slug of that content type
//   {term}              a random search word
//
// A template naming a type the profile did not seed resolves to nothing and the
// iteration is skipped rather than measuring a 404.
import http from 'k6/http';
import { check } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const profiles = JSON.parse(open('../../profiles/profiles.json'));
const PROFILE_ID = __ENV.PROFILE || 'blog';
const BASE_URL = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const FULL = __ENV.FULL === '1';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@lyeve.com';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'benchmark-Passw0rd!';

const profile = profiles.profiles.find((p) => p.id === PROFILE_ID);
if (!profile) throw new Error(`unknown profile ${PROFILE_ID}`);

const active = profile.traffic.filter((t) => FULL || t.needs == null);
const totalW = active.reduce((s, t) => s + t.weight, 0);
const latency = new Trend('profile_latency', true);
const okRate = new Rate('profile_ok');
const WORDS = ['edge', 'atlas', 'nova', 'pulse', 'quartz', 'delta', 'ember', 'lumen', 'onyx', 'zephyr'];

export const options = {
  scenarios: {
    [`profile_${PROFILE_ID}`]: {
      executor: 'constant-arrival-rate',
      rate: profile.rate,
      timeUnit: '1s',
      duration: __ENV.DURATION || '60s',
      preAllocatedVUs: Math.max(20, Math.ceil(profile.rate / 4)),
      maxVUs: profile.rate * 2,
    },
  },
  thresholds: {
    profile_latency: [`p(95)<${profile.thresholds.p95_ms}`],
    profile_ok: [`rate>${1 - profile.thresholds.error_rate}`],
    http_req_failed: [`rate<${profile.thresholds.error_rate}`],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
  tags: { profile: PROFILE_ID, mode: FULL ? 'full' : 'core' },
};

function dget(o, p) { return p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o); }

export function setup() {
  // One login for the whole run. The engine allows five per fifteen minutes per
  // address, enforced by a rule the documented setting does not reach, so a
  // driver that authenticated per VU would lock itself out.
  let token = '';
  const r = http.post(`${BASE_URL}/api/admin/auth/login`, JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }), { headers: { 'Content-Type': 'application/json' } });
  if (r.status === 200) { try { token = dget(r.json(), 'token') || ''; } catch (_) {} }
  if (!token) throw new Error(`login failed (${r.status}); the run would measure 401s`);
  const headers = { Authorization: `Bearer ${token}` };

  // Build id and slug pools per content type. A list response is a bare JSON
  // array whose user fields live under `data`, so the slug is at data.slug and
  // never at the top level. Pooling it from the wrong place is silent: the pool
  // is empty, every templated entry is skipped, and the run still reports pass.
  const pools = {};
  for (const sc of profile.schemas) {
    // limit is clamped to 25..200, so 200 is the largest page available.
    const res = http.get(`${BASE_URL}/api/v1/content/${sc.name}?limit=200`, { headers });
    let ids = [];
    let slugs = [];
    if (res.status === 200) {
      try {
        const items = res.json();
        if (Array.isArray(items)) {
          ids = items.map((it) => it.id).filter(Boolean);
          slugs = [...new Set(items.map((it) => dget(it, 'data.slug')).filter(Boolean))];
        }
      } catch (_) { /* leave the pool empty. The default function skips */ }
    }
    pools[sc.name] = { ids, slugs };
    if (!ids.length) console.warn(`profile ${PROFILE_ID}: no rows for ${sc.name}; its traffic will be skipped`);
  }
  return { token, pools };
}

// A write body for the admin content route, which is the path a real
// application uses: it records the entry where search and the admin UI can see
// it. The public v1 write reaches the generated table only, so content created
// that way is never found by search. `title` is required at the top level and
// again inside `body`, because `body` is validated against the schema.
function writeBody(entry, pools) {
  const w = WORDS[Math.floor(Math.random() * WORDS.length)];
  const n = Math.floor(Math.random() * 1e9);
  const slug = `${entry.body}-${n}`;
  const title = `${entry.body} ${w} ${n}`;
  const body = { title, slug };

  for (const [field, type] of Object.entries(entry.relations || {})) {
    const ids = pools[type]?.ids || [];
    if (!ids.length) return null; // cannot satisfy the relation. Skip the iteration
    body[field] = ids[Math.floor(Math.random() * ids.length)];
  }
  for (const [field, value] of Object.entries(entry.fields || {})) {
    body[field] = value === '{word}' ? w : value;
  }
  return { schema: entry.schema, slug, title, body, status: 'published' };
}

function resolvePath(path, pools) {
  // {id:type} and {slug:type} name the type they sample, so nothing is inferred.
  const templates = path.match(/\{(id|slug):([a-z0-9_]+)\}/g) || [];
  for (const tpl of templates) {
    const [, kind, type] = tpl.match(/\{(id|slug):([a-z0-9_]+)\}/);
    const pool = pools[type];
    const values = kind === 'id' ? pool?.ids : pool?.slugs;
    if (!values || !values.length) return null;
    const value = values[Math.floor(Math.random() * values.length)];
    path = path.replace(tpl, encodeURIComponent(value));
  }
  if (path.includes('{term}')) path = path.replace('{term}', WORDS[Math.floor(Math.random() * WORDS.length)]);
  return path;
}

export default function (data) {
  let r = Math.random() * totalW;
  let entry = active[0];
  for (const t of active) { r -= t.weight; if (r <= 0) { entry = t; break; } }

  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${data.token}` };

  let res;
  if (entry.method === 'POST') {
    // A traffic entry can post a body of its own instead of a content write.
    // Without this the only POST this driver could express was an admin content
    // create, which meant a transport whose every request is a POST with a
    // fixed document, GraphQL, could not be driven at all.
    const body = entry.postBody ?? writeBody(entry, data.pools);
    if (body == null) return;
    res = http.post(`${BASE_URL}${entry.path}`, JSON.stringify(body), { headers });
  } else {
    const path = resolvePath(entry.path, data.pools);
    if (path == null) return; // no data to sample. Skip rather than 404-spam
    res = http.get(`${BASE_URL}${path}`, { headers });
  }

  latency.add(res.timings.duration);
  const good = res.status >= 200 && res.status < 400;
  okRate.add(good);
  check(res, { [`${PROFILE_ID}:${entry.id}`]: () => good });
}
