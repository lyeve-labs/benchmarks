// seed-profile.mjs: build + seed a real-world application profile on LyEve.
//
// Reads profiles/profiles.json, then for the chosen profile:
//   1. bootstraps the first super_admin via POST /api/admin/setup, or logs in if
//      the admin already exists;
//   2. creates each content type over POST /api/admin/schemas, with relations
//      declared as real relation fields;
//   3. seeds each type's volume in dependency order through the admin content
//      route, so the rows are visible to search and to the admin UI.
//
// Invoked by run.sh:  BASE_URL=... PROFILE=blog node seed-profile.mjs
// Writes a manifest of created ids/slugs to results/raw/<run>/manifest.json.
// Non-zero exit => run.sh records the profile pending.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '../..');
const profiles = JSON.parse(readFileSync(join(REPO, 'profiles/profiles.json'), 'utf8'));

const BASE_URL = (process.env.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const PROFILE_ID = process.env.PROFILE || 'blog';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@lyeve.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'benchmark-Passw0rd!';
const OUT = process.env.OUT_DIR; // where to write manifest.json
// The engine's LYEVE_SETUP_TOKEN. Setup refuses a caller without it (401).
const SETUP_TOKEN = process.env.LYEVE_SETUP_TOKEN || '';

const profile = profiles.profiles.find((p) => p.id === PROFILE_ID);
if (!profile) fail(`unknown profile ${PROFILE_ID}`);

function fail(m) { console.error(`seed-profile: ${m}`); process.exit(1); }
function dget(o, p) { return p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// deterministic RNG (methodology section 3)
function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry32(42);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const WORDS = ['edge', 'atlas', 'nova', 'pulse', 'quartz', 'delta', 'ember', 'lumen', 'onyx', 'zephyr', 'cobalt', 'flux'];

let token = '';
async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${BASE_URL}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

// ── 1. admin bootstrap (setup) or login ──────────────────────────────────────
//
// Exactly one login for the whole seed. The engine allows five per fifteen
// minutes per address, enforced by a rate-limit rule that the documented
// PUBLIC_RATE_LIMITS setting does not reach, so a seeder that re-authenticated
// per batch would lock itself out partway through a large profile.
async function auth() {
  const s = await api('GET', '/api/admin/setup');
  const status = s.ok ? await s.json().catch(() => ({})) : {};
  if (status.setup_required) {
    if (!SETUP_TOKEN) fail('the engine needs its first admin; set LYEVE_SETUP_TOKEN to the token the engine was started with');
    const r = await api('POST', '/api/admin/setup', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, setup_token: SETUP_TOKEN });
    if (r.status === 401) fail('setup refused the setup token (401); LYEVE_SETUP_TOKEN differs from the engine\'s');
    if (!r.ok) fail(`setup failed (${r.status})`);
    token = dget(await r.json(), 'token') || '';
  } else {
    const r = await api('POST', '/api/admin/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    if (!r.ok) fail(`login failed (${r.status}); an admin exists but the credentials differ`);
    token = dget(await r.json(), 'token') || '';
  }
  if (!token) fail('no token after auth');
}

// Map profile field types onto the engine's field_type values. The API key is
// `field_type`, never `type`, and an absent one is rejected.
const TYPE = { string: 'text', text: 'text', integer: 'number', decimal: 'number', boolean: 'boolean', json: 'json', timestamp: 'text', media: 'text' };

// ── 2. create schemas, with relations as real relation fields ────────────────
async function createSchemas() {
  for (const sc of orderSchemas()) {
    const fields = sc.fields.map((f) => ({
      name: f.name,
      field_type: TYPE[f.type] || 'text',
      required: !!f.required,
      unique: !!f.unique,
      indexed: !!f.indexed,
    }));

    for (const r of sc.relations || []) {
      fields.push({
        name: r.field,
        field_type: 'relation',
        relation_to: r.to,
        relation_type: 'belongs_to',
        // Never required. A required belongs_to emits both the relation name as
        // NOT NULL and the real foreign key, and only the second is ever
        // written, so every insert fails with a 422 that names no field.
        required: false,
        indexed: r.indexed !== false,
      });
    }

    const res = await api('POST', '/api/admin/schemas', { name: sc.name, fields });
    if (!res.ok && res.status !== 409) {
      fail(`create schema ${sc.name} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }

    // The content routes are gated per (role, schema) by sys_permissions, which
    // ships empty. Without a rule even a super_admin token reads 403.
    const perm = await api('POST', '/api/admin/permissions', { role: 'super_admin', schema_name: sc.name, actions: ['create', 'read', 'update', 'delete'] });
    if (!perm.ok && perm.status !== 409) console.error(`  warn: grant permission on ${sc.name} -> ${perm.status}`);

    await waitForSchema(sc.name);
  }
}

// A schema stays invisible to the read router for a fraction of a second after
// the apply returns, so seeding straight into it fails on a cold database and
// succeeds on a warm one.
async function waitForSchema(name, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await api('GET', '/api/v1/schemas');
    if (res.ok) {
      const list = await res.json().catch(() => []);
      if (Array.isArray(list) && list.some((s) => s.name === name)) return;
    }
    await sleep(150);
  }
  fail(`schema ${name} was applied but never became readable`);
}

// ── 3. seed rows in dependency order, capturing ids/slugs ────────────────────
const created = {}; // type -> [{id, slug}]
let createFails = 0;

// Writes go through the admin content route. The public content write reaches
// the generated table only: nothing records the entry in the content store that
// search reads, so rows created that way are never found and the search traffic
// would measure an empty index without ever erroring.
//
// The route requires `title` and `slug` at the top level, and separately
// validates `body` against the schema's own fields. A field the schema marks
// required has to appear in the body even when the route already took it as a
// top-level argument, so both are injected. Injecting only `title` left every
// create of a type with a required slug answering 422 and naming a field the
// caller had in fact supplied.
async function createRow(type, slug, title, body) {
  const res = await api('POST', '/api/admin/content', { schema: type, slug, title, body: { title, slug, ...body }, status: 'published' });
  if (!res.ok) {
    if (createFails++ < 3) console.error(`  warn: create ${type} -> ${res.status}: ${(await res.text()).slice(0, 160)}`);
    return null;
  }
  try {
    const j = await res.json();
    return j.id ?? null;
  } catch (_) { return null; }
}

function sampleRel(type) {
  const pool = created[type] || [];
  return pool.length ? pick(pool) : null;
}

async function seedType(sc, count) {
  created[sc.name] = [];
  for (let i = 0; i < count; i++) {
    const w = pick(WORDS);
    const slug = `${sc.name}-${i}-${w}`;
    const title = `${sc.name.replace(/_/g, ' ')} ${w} ${i}`;
    const body = {};

    for (const f of sc.fields) {
      if (f.name === 'title' || f.name === 'slug') continue; // set from the arguments
      body[f.name] = fieldValue(f, sc.name, i, w);
    }
    // A relation is written under the field name and read back as
    // `<field>_id`, which is also the only form a filter accepts.
    for (const r of sc.relations || []) {
      const ref = sampleRel(r.to);
      if (ref) body[r.field] = ref.id;
    }

    const id = await createRow(sc.name, slug, title, body);
    if (id) created[sc.name].push({ id, slug });
    if (i % 250 === 0) process.stdout.write(`\r  ${sc.name}: ${i}/${count}`);
  }
  process.stdout.write(`\r  ${sc.name}: ${created[sc.name].length}/${count} created\n`);
  if (!created[sc.name].length && count > 0) fail(`seeded nothing into ${sc.name}; the run would measure an empty dataset`);
}

function fieldValue(f, type, i, w) {
  switch (f.type) {
    case 'string': return f.unique ? `${type}-${i}-${w}` : `${f.name} ${w} ${i}`;
    case 'text': return `A ${w} paragraph about ${type.replace(/_/g, ' ')}, entry ${i}. `.repeat(4);
    case 'integer': return Math.floor(rnd() * 1000);
    case 'decimal': return Math.floor(rnd() * 100000);
    case 'boolean': return rnd() > 0.2;
    case 'json': return { tag: w, n: i };
    case 'timestamp': return new Date(1700000000000 + i * 3600000).toISOString();
    case 'media': return `https://cdn.example/${type}/${i}.jpg`;
    default: return w;
  }
}

// Types with no relations first, so a relation always has a target to point at
// and the foreign key it emits references a table that already exists.
function orderSchemas() {
  const noRel = profile.schemas.filter((s) => !(s.relations || []).length);
  const rel = profile.schemas.filter((s) => (s.relations || []).length);
  return [...noRel, ...rel];
}

// ── main ─────────────────────────────────────────────────────────────────────
await auth();
await createSchemas();
for (const sc of orderSchemas()) {
  const count = profile.seed[sc.name] || 0;
  if (count > 0) await seedType(sc, count);
}
const manifest = {};
for (const [type, rows] of Object.entries(created)) {
  manifest[type] = {
    ids: rows.map((r) => r.id).filter(Boolean).slice(0, 300),
    slugs: [...new Set(rows.map((r) => r.slug).filter(Boolean))].slice(0, 60),
  };
}
if (OUT) writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
console.log(`seed-profile: ${PROFILE_ID} ready (${Object.entries(profile.seed).map(([k, v]) => `${k}:${v}`).join(' ')})`);
