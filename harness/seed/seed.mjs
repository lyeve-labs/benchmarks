// seed.mjs: the ONE generic seeder, driven by targets.json.
//
// It logs in with the admin creds, ensures the `article` content model exists
// (per-target bootstrap where the type is API-creatable, baked-in for Strapi/
// Payload), then creates categories + articles from the shared dataset using a
// fixed seed so two runs seed byte-identical data.
//
// Invoked by run.sh:  BASE_URL=... TARGET=... node seed.mjs
// A non-zero exit tells run.sh to record the scenario as `pending` rather than
// publish a number against an unseeded target.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const targets = JSON.parse(readFileSync(join(HERE, '../../targets/targets.json'), 'utf8'));
const dataset = JSON.parse(readFileSync(join(HERE, 'dataset.json'), 'utf8'));

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const TARGET_ID = process.env.TARGET || 'lyeve';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@lyeve.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'benchmark-Passw0rd!';
// The engine's LYEVE_SETUP_TOKEN. Setup refuses a caller without it (401).
const SETUP_TOKEN = process.env.LYEVE_SETUP_TOKEN || '';

const target = targets.targets.find((t) => t.id === TARGET_ID);
if (!target) fail(`unknown target ${TARGET_ID}`);
if (target.kind === 'hosted') fail(`${TARGET_ID} is hosted; not seedable through this rig`);

function fail(msg) { console.error(`seed: ${msg}`); process.exit(1); }
function dget(o, p) { return p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o); }

// deterministic RNG so runs are reproducible (methodology §3)
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(dataset.seed);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

async function api(method, path, { token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return res;
}

async function login() {
  const a = target.auth?.login;
  if (!a) return null;
  // LyEve: bootstrap the first super_admin via /api/admin/setup when required.
  if (TARGET_ID === 'lyeve') {
    const s = await api('GET', '/api/admin/setup');
    const st = s.ok ? await s.json().catch(() => ({})) : {};
    if (st.setup_required) {
      if (!SETUP_TOKEN) fail('the engine needs its first admin; set LYEVE_SETUP_TOKEN to the token the engine was started with');
      const r = await api('POST', '/api/admin/setup', { body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, setup_token: SETUP_TOKEN } });
      if (r.ok) return dget(await r.json(), 'token');
      if (r.status === 401) fail('setup refused the setup token (401); LYEVE_SETUP_TOKEN differs from the engine\'s');
    }
  }
  const body = {};
  for (const [k, v] of Object.entries(a.body || {})) body[k] = String(v).replace('{email}', ADMIN_EMAIL).replace('{password}', ADMIN_PASSWORD);
  const res = await api('POST', a.path, { body });
  if (!res.ok) fail(`login failed (${res.status}): ensure the admin user is bootstrapped (compose/README.md)`);
  return dget(await res.json(), a.tokenPath);
}

// ── per-target content-model bootstrap ───────────────────────────────────────
async function ensureModel(token) {
  const artDef = dataset.types.find((t) => t.name === 'article');
  switch (TARGET_ID) {
    case 'directus':   return ensureModelDirectus(token, artDef);
    case 'lyeve':      return ensureModelLyeve(token, artDef);
    case 'strapi':
    case 'payload':    return; // types are baked into the built app (compose/README.md)
    default:           fail(`no content-model bootstrap implemented for ${TARGET_ID}`);
  }
}

async function ensureModelDirectus(token, art) {
  // idempotent: 200 if the collection already exists
  const exists = await api('GET', '/collections/category', { token });
  if (!exists.ok) {
    await api('POST', '/collections', { token, body: { collection: 'category', schema: {}, meta: {} } });
    await api('POST', '/fields/category', { token, body: { field: 'name', type: 'string' } });
    await api('POST', '/fields/category', { token, body: { field: 'slug', type: 'string', schema: { is_unique: true } } });
    await api('POST', '/collections', { token, body: { collection: 'article', schema: {}, meta: {} } });
    for (const f of art.fields) {
      const type = { string: 'string', text: 'text', integer: 'integer', boolean: 'boolean', json: 'json' }[f.type] || 'string';
      await api('POST', '/fields/article', { token, body: { field: f.name, type, schema: f.unique ? { is_unique: true } : {} } });
    }
    // indexed M2O relation to category (this is the index S04 relies on)
    await api('POST', '/fields/article', { token, body: { field: 'category', type: 'integer' } });
    await api('POST', '/relations', { token, body: { collection: 'article', field: 'category', related_collection: 'category' } });
  }
}

async function ensureModelLyeve(token, art) {
  // Schema field key is `field_type` (text|number|boolean|json). `/api/v1/content`
  // is permission-gated per (role, schema), so grant super_admin after each create.
  const ft = { string: 'text', text: 'text', integer: 'number', decimal: 'number', boolean: 'boolean', json: 'json', timestamp: 'text', media: 'text' };
  const grant = (name) => api('POST', '/api/admin/permissions', { token, body: { role: 'super_admin', schema_name: name, actions: ['create', 'read', 'update', 'delete'] } });

  await api('POST', '/api/admin/schemas', { token, body: { name: 'category', fields: [{ name: 'name', field_type: 'text' }, { name: 'slug', field_type: 'text', unique: true, indexed: true }] } });
  await grant('category');

  const fields = art.fields.map((f) => ({ name: f.name, field_type: ft[f.type] || 'text', required: !!f.required, unique: !!f.unique, indexed: !!f.indexed }));
  fields.push({ name: 'category', field_type: 'text', indexed: true }); // denormalized category slug (S04 filter)
  const res = await api('POST', '/api/admin/schemas', { token, body: { name: 'article', fields } });
  if (!res.ok && res.status !== 409) fail(`LyEve schema create failed (${res.status}): ${(await res.text()).slice(0, 150)}`);
  await grant('article');
}

// ── row creation ─────────────────────────────────────────────────────────────
const WORDS = ['edge', 'atlas', 'nova', 'pulse', 'quartz', 'delta', 'ember', 'lumen', 'onyx', 'zephyr'];
const slug = (p, i) => `${p}-${i}-${WORDS[i % WORDS.length]}`;

async function seedCategories(token) {
  const n = dataset.types.find((t) => t.name === 'category').count;
  const ids = [];
  for (let i = 0; i < n; i++) {
    const body = wrap({ name: `Category ${i}`, slug: slug('cat', i) });
    const res = await api('POST', categoryPath(), { token, body });
    if (res.ok) { try { const j = await res.json(); const id = j.id ?? j.data?.id ?? j.doc?.id; if (id != null) ids.push(id); } catch (_) { /* skip */ } }
  }
  return ids.filter((x) => x != null);
}

async function seedArticles(token, categoryIds) {
  const n = dataset.types.find((t) => t.name === 'article').count;
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const body = wrap({
      title: `Benchmark article ${i}`,
      slug: slug('art', i),
      body: 'Lorem ipsum dolor sit amet. '.repeat(8),
      views: Math.floor(rnd() * 10000),
      published: rnd() > 0.2,
      meta: { tag: pick(WORDS) },
      category: categoryIds.length ? pick(categoryIds) : undefined,
    });
    const res = await api('POST', target.endpoints.S03.path, { token, body });
    if (res.ok) ok++;
    if (i % 500 === 0) process.stdout.write(`\r  seeded ${i}/${n} articles`);
  }
  process.stdout.write(`\r  seeded ${ok}/${n} articles\n`);
  if (ok === 0) fail('no articles created: check the create endpoint / envelope for this target');
}

function wrap(obj) { return (target.endpoints.S03?.envelope === 'data' || TARGET_ID === 'lyeve') ? { data: obj } : obj; }
function categoryPath() {
  // Where categories are created. Each platform names the collection differently,
  // so this is explicit rather than derived by string-swapping the article path.
  return {
    lyeve: '/api/v1/content/category',
    directus: '/items/category',
    strapi: '/api/categories',
    payload: '/api/categories',
  }[TARGET_ID] || target.endpoints.S03.path;
}
function idFieldFromProbe() { return target.listProbe?.idField || 'id'; }

// ── main ─────────────────────────────────────────────────────────────────────
const token = await login();
// The load scripts reuse this token rather than logging in again. LyEve's free
// tier allows five logins per fifteen minutes per address and a license is
// needed to change that, so a run that logged in once per scenario ran out
// before the last one and measured 401s.
if (process.env.TOKEN_FILE && token) writeFileSync(process.env.TOKEN_FILE, String(token));
await ensureModel(token);
const categoryIds = await seedCategories(token);
await seedArticles(token, categoryIds);
console.log(`seed: ${TARGET_ID} ready`);
