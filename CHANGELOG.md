# Changelog

All notable changes to the LyEve Performance Benchmarks are documented here, newest
first. The repo follows [Keep a Changelog](https://keepachangelog.com) and
[Semantic Versioning](https://semver.org).

Each release adds one self-hosted competitor to the head-to-head, measured through
the same rig: Directus first, then Strapi, then Payload. The full table with every
value and its provenance badge lives in [`results/RESULTS.md`](./results/RESULTS.md).

## [Unreleased]

### Changed

- The README and METHODOLOGY section 8 describe how results reach the website
  by what the page reads, `results/results.json` from a published release,
  instead of the site's internal layout.
- `harness/gen-license.sh` takes `LYEVE_LICENSE_KEY` and
  `LICENSE_PUBLIC_KEY_HEX` from the environment and fails with a message when
  either is unset. This repo does not issue licenses.
- Every target was re-measured on 2026-10-05, and the LyEve column now runs the
  published `ghcr.io/lyeve-labs/lyeve-core:0.51.2` image as shipped instead of
  a source build. `targets.json` and the compose file pin that tag rather than
  `latest`, and `make refresh` pulls the pinned tag. LyEve leads the strongest
  competitor on every published metric. Create and cold start rose for every
  target that evening, so those leads narrow (create 1.4 to 1.2 times, cold
  start 6.8 to 4.5 times). Every application profile is faster, and the
  micro-benchmarks are within 12 percent of 2026-09-25. `results/ERRATA.md`
  section 12 has the before and after and the load at every run.
- The blog, marketplace and company profile documents describe exactly what
  `profiles/profiles.json` runs. They listed content types, traffic and
  plugins the profiles no longer have.

### Removed

- The make target and script that bumped a website submodule. The site keeps
  its own snapshot of `results.json` and never read that submodule.

### Fixed

- The LyEve stack set no `LYEVE_CONSOLE_URL`, so in production mode the
  password reset and magic-link plugins refused to start and every figure
  was measured two plugins short of the free baseline. The stack now names a
  console URL and the whole baseline starts.
- A `FULL=1` profile run never handed its license to the engine, because the
  compose file did not pass `LYEVE_LICENSE_KEY`, so the paid traffic met the
  free tier. The run also wrote the license token into its raw output under
  `results/`. The token now reaches the engine through the compose
  environment as `BENCH_LICENSE_KEY`, which only a FULL run sets, so a
  license exported in the caller's shell never reaches a free run, and it is
  never written to disk.
- The LyEve compose file's `JWT_SECRET` contained "change-me", which v0.51.2
  refuses as a placeholder, so the engine could not boot from it.
- `FULL=1` profile runs stopped before starting, because the harness read a
  `plugins` field no profile has. The feature list now comes from the traffic
  entries' `needs`.
- The forum profile's thread entry called a route the engine does not serve. It
  now reads the comments type the schema plugin's preset creates, as the
  community-forum example does.

## [0.6.0] - 2026-10-03

### Changed

- LyEve's head-to-head column was re-measured on 2026-09-27 after changes to
  its request path, storage drivers and start. Every latency figure dropped
  (read-by-id 3.0 to 1.9 ms, list-50 5.3 to 2.7, create 5.0 to 4.0, filter
  4.1 to 2.4), the image went from 104 to 85 MB and cold start from 311 to
  266 ms. LyEve now leads the strongest competitor on every published metric,
  filter included (1.8 times, where it read on par). `results/ERRATA.md`
  section 11 has the before and after and the load at every run.

- LyEve's head-to-head column was re-measured on 2026-09-26 against an engine
  that serves as soon as it is ready. Cold start went from 2,864 ms, behind
  Strapi and Payload, to 311 ms, ahead of all three. The other medians moved
  by amounts their ranges overlap; the filter lead over Payload went from
  1.1x to on par. `results/ERRATA.md` section 10 says what the earlier figure
  measured, what changed, and the load at every run.

- Every published figure was re-measured on 2026-09-25 against an engine built
  from source, with every competitor run again on the same machine. Each figure
  is now the median of five runs on fresh stacks, with the range beside it, and
  `results/rig.json` records the machine, engine commit, competitor versions
  and method. See `results/ERRATA.md` for the figures that moved and why.
- LyEve's login figure reads pending: the free tier refuses more than five
  logins per fifteen minutes per address, the rule Strapi's cell already
  followed.

### Fixed

- The harness's audit HMAC key is 64 ones, a placeholder that reads as one.
  The random-looking key it replaced was reported as a leaked secret, and it
  keys only a stack the run throws away.
- Four scenario and phase descriptions read as plain sentences. No figure
  changed.
- The LyEve compose stack boots the current engine in its production mode.
- Cold start is timed from `docker start` to the first request the application
  serves, polled every 50 ms; it had been timed as a restart against a probe
  that answers early, with a clock some systems print wrongly.
- Image size is the sum of the image's layers. The `docker images` column it
  read adds the compressed blobs on the containerd store.
- S04 proves its filter applies before measuring.
- The Strapi app creates its upload folder, without which it could not boot
  from a fresh clone.
- The load scripts reuse one token, so a run no longer exhausts a login limit.

- The LyEve seeders create the first admin on an engine that requires a setup
  token. `harness/run.sh` generates `LYEVE_SETUP_TOKEN` when it is unset and
  exports it, the compose stack passes it to the engine, and both seeders send
  it on the setup call. Without it setup answers 401 and every LyEve run was
  recorded pending.

## [0.5.1] - 2026-09-09

### Changed

- Documentation and shipped strings no longer carry em dashes, unicode
  ellipses or unicode bullets. Where a string is an error or a log line the
  wording changed and nothing else: status codes, machine-readable error codes
  and behavior are untouched, so a client matching on a code is unaffected.
- An elision inside a code span now uses three ASCII periods, so a reader who
  copies one gets something their tool accepts.

## [0.5.0] - 2026-09-05

### Added

- Ten profiles, generated from the example applications.
- Let a POST traffic entry carry its own body.

### Changed

- Align the profiles with the runnable example apps.

### Fixed

- Drive the query syntax the engine actually has.
- Write profiles through the admin content route.
- Probe the health route that answers without a token.
- Put a required slug in the body as well as the argument.

## [0.4.0] - 2026-08-13

First tagged release. Versions 0.1.0 through 0.3.0 below were recorded in this
file but never tagged, and the commits behind them cannot be mapped to those
versions after the fact, so they are left as the written record and tagging
starts here.

### Added
- Methodology notes and a README covering how a run is set up and what each number means.

### Changed
- The harness image and CI run on node 24, pinned to an exact patch rather than a major, so a rerun measures the same runtime.
- The pnpm lockfile is tracked, so a rerun resolves the same dependency tree.

## [0.3.0] — 2026-07-19

Payload 3 joins the comparison. Like Strapi, Payload ships no runtime image — it
is a framework inside a Next.js app — so the repo now carries a minimal Payload
app and builds it.

### Added
- **Payload 3 target.** A minimal Payload app under `harness/compose/payload-app/`:
  the `articles`, `categories`, and `users` collections, access opened for the
  benchmark, and a committed database migration that runs on container start. It
  is quick on point reads (p99 in the single-digit milliseconds) and ties LyEve on
  login, where both are bounded by the password hash. Measured across all five
  scenarios plus image size, idle memory, and cold start.
- **Re-running after a core upgrade.** LyEve ships a rolling `core:latest` image,
  so `make refresh` (or `make sweep PULL=1` / `run.sh --pull`) now fetches the new
  build before measuring — a plain `up` would reuse the cached one. The LyEve
  version pin reads `latest` to match, and every result carries its run date.

### Changed
- **Write scenarios run last.** A sweep now runs the create scenario after the
  read scenarios, so newly-inserted rows never change the data a read scenario
  measures against. This fixes the filter scenario, which could otherwise sample
  rows a create run had just added.
- **The "LyEve lead" column compares against the strongest competitor, not the
  weakest.** It is now the ratio to the best (lowest) competitor value on each
  metric — a conservative floor that holds against the best alternative, rather
  than a number inflated by whichever engine happened to saturate. A tie reads
  "on par". Every competitor's own value stays visible in its column.
- **Strapi Dockerfile builds deterministically.** The fallback `npm ci || npm install`
  was replaced with a plain `npm install` — there is no committed lockfile, so `npm ci`
  would always fail and the fallback masked it, making every build resolve transitive
  deps fresh.

### Fixed
- The filter scenario no longer invents a placeholder value when its sample pool
  comes up empty; it skips instead, so a broken setup can't masquerade as a fast
  query.
- **Container leak on health-check timeout.** `run.sh` used a `trap ... RETURN` to
  tear down Docker containers. The RETURN trap does not fire on `exit`, so a
  health-check timeout would leak running containers. The traps now fire on both
  RETURN and EXIT.
- **Default email in k6 scenario script** was `admin@lyeve.local`, inconsistent with
  every other file which uses `admin@lyeve.com`. Corrected.

### Docs
- Corrected the methodology to match what the harness actually runs: a 10-second
  warm-up, a single measured window per scenario, and an honest split between the
  Hetzner reference host (for the throughput sweep) and the local same-host rig
  the current comparison was measured on.
- The worked example (`scenarios/S01`) now shows real measured numbers for all
  four engines.
- The full per-request k6 output is no longer kept in the tree — it runs to
  hundreds of megabytes and proves nothing the aggregated summary doesn't. The
  `*.summary.json` and `M-*.json` that back each published number stay.
- **Record counts corrected** in METHODOLOGY.md and dataset.json — the scenario path
  seeds 2,000 records across 2 types, not 10,000 across 5. Unused types are cataloged
  for future scenario expansion.
- Fixed broken references to the license key tool, which is not part of this
  repo. Aligned CHANGELOG and README
  nomenclature with the repo title.

## [0.2.0] — 2026-07-19

Strapi 5 joins the comparison. Strapi defines its content types in code and
publishes no canonical runtime image, so the repo now carries a minimal Strapi
app and builds it.

### Added
- **Strapi 5 target.** A minimal Strapi app under `harness/compose/strapi-app/`:
  the `article` and `category` content types, a startup step that opens those
  endpoints and creates the one login user the auth scenario needs, and a
  Dockerfile that builds it. Under the read scenarios Strapi saturates at the
  offered load LyEve barely notices — real, zero-error results, just a Node
  runtime queuing. Measured across the scenarios plus image, memory, and cold
  start.
- **Image sizing for built targets.** A target whose image is built locally now
  records the real image tag, so the runner sizes the actual container instead of
  skipping a human-readable label.

### Changed
- **One Compose project per target.** Each stack now carries its own project name
  and, for the built targets, its own image tag — so two targets that both build
  an app can never reuse each other's container or image.
- **The report holds back invalid runs.** A scenario that goes over the error
  budget is recorded as pending, not published as a fast number. Strapi's stock
  configuration rate-limits authentication and rejects a burst of logins, so its
  login result is pending rather than the latency of rejected requests.

### Fixed
- The seeder creates categories at each platform's real collection path and reads
  the new id back from whichever response shape the platform returns, so relations
  link correctly across Strapi, Directus, and Payload.

## [0.1.0] — 2026-07-18

The harness itself, LyEve measured end to end, and the first self-hosted
competitor: Directus 11, which ships an official turnkey image.

### Added
- The benchmark harness: the scenario catalog, portable k6 scripts, a Docker
  Compose stack per target, seed scripts, and the `run.sh` orchestrator that runs
  the same sequence for every target — boot, cold-start, seed, warm, measure,
  sample memory, tear down.
- A static-only mode that measures image size, idle memory, and cold start with
  no load generator and no seeding.
- Real-world application profiles under `profiles/` — a Blog, a Marketplace, and
  a Company Profile — each a complete app with its schema, the plugins it needs,
  realistic seed volumes, and a weighted traffic mix, driven by a `--profile` mode.
- `METHODOLOGY.md`: the reference environment, the dataset, the fairness rules,
  the four-state provenance model, and how to reproduce a number.
- A fully worked scenario (`scenarios/S01`) documenting one scenario end to end,
  from intent to published result.
- The vendor registry (`targets/targets.json`), the report generator, and the
  website integration, with a committed snapshot fallback so a site build can
  never break on a missing run.
- A cheap static CI gate that validates the registries and fails if the report
  drifts from its inputs.

### Measured
- LyEve across every scenario and static metric, plus its internal auth / DB /
  middleware micro-benchmarks.
- **Directus 11** as the first competitor, on the same host across the scenarios
  and static metrics. Headline: a 50 MB Go binary against a 1,210 MB Node image,
  and a point read in roughly a millisecond against Directus's hundreds.

### Pending
- The sustained-throughput sweep on the Hetzner reference host (the LyEve REST
  rows stay `target` until then).
- More competitors — Strapi and Payload land in the next two releases; WordPress
  and Ghost remain candidates.
