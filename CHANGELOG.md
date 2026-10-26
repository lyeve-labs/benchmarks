# Changelog

All notable changes to the LyEve Performance Benchmarks are documented here, newest
first. The repo follows [Keep a Changelog](https://keepachangelog.com) and
[Semantic Versioning](https://semver.org).

Each release adds one self-hosted competitor to the head-to-head, measured through
the same rig: Directus first, then Strapi, then Payload. The full table with every
value and its provenance badge lives in [`results/RESULTS.md`](./results/RESULTS.md).

## [Unreleased]

### Added
- Re-measured every figure on the v0.56.0 engine image: the head-to-head, the application profiles and the micro-benchmarks.

- Small-server campaigns. `make small-sweep` runs every self-hosted target on
  every read scenario in rounds against one server, which reboots before each
  run and starts it only once quiet, with its timers masked and snap refreshes
  held until the sweep ends. A stopped sweep resumes where it left off.
  `make small-report` writes `results/SMALL.md` and `results/small.json`, each
  figure the median of a campaign's runs with its range, newest campaign first.
- Each small-server step records the busy and steal shares of the server's
  and the load generator's CPU, the server's I/O wait, k6's dropped iterations
  and peak virtual users, and the bytes received per second, so a step that
  falls short shows which machine ran out, and whether the server ran out of
  CPU or sat waiting on its disk.
- Each small-server run records the harness commit, the image ID the server
  ran, and both machines' load when it started. A run during which the load
  generator's address changed is void: it enters no figure, and the report
  counts it.
- The small-server report shows each step's I/O wait and CPU steal on the
  server, the load every run started at, the runs in which a target did not
  boot, did not take the seed, or was killed for memory or restarted, and the
  void runs set aside. A CPU figure measured in fewer runs than its step shows
  its own run count. With an even number of runs, the highest rate
  kept up is the lower of the two middle ones, so it is always a rate that was
  offered.
- The first small-server campaign, `2026-10-25-aws-t2-micro`: LyEve, Strapi,
  Directus and Payload on S01, S02 and S04, three rounds each, on an AWS
  t2.micro in Singapore driven by a second t2.micro on its private network.
  `results/SMALL.md` holds the figures and `results/raw/small/` every run.
- The second small-server campaign, `2026-10-25-aws-t2-micro-0.56`: the same
  targets, scenarios and rounds on two new t2.micro instances with the same
  processor, with LyEve on its 0.56.0-rc.6 release candidate and every other
  image unchanged.
- The third small-server campaign, `2026-10-26-aws-t2-micro`: the same
  targets, scenarios and rounds on a new t2.micro with the same processor,
  with LyEve on its stable 0.56.0 release and PostgreSQL on the current
  `postgres:16-alpine`. The other targets run the same images. The load
  generator is a t3.micro in another zone of the same region, 0.985 ms away by
  TCP connect time, against 0.405 ms in the second campaign.

### Changed

- The website's benchmarks page leads with one small-server campaign from
  `results/small.json` and shows the head-to-head from `results/results.json`
  after it. The README and METHODOLOGY §8 named `results.json` as its only
  input, and now name both.
- `make small` leaves an image the server already holds in place when it holds
  the same bytes as this machine's copy, or when this machine has none, so a
  load generator without the images can drive a server prepared by the machine
  that has them (`harness/small-sweep.sh --prepare`). An image whose bytes
  differ from this machine's is replaced.

### Fixed

- A small-server run whose server does not answer SSH for a minute is void,
  instead of reading as a target that stopped or failed to start.
- A small-server run removes the containers, volumes and firewall rules an
  earlier run could not tear down before it starts, so it never measures a
  leftover stack or the data that stack seeded. The sweep removes those
  containers before it reboots the server, and again once Docker runs after the
  reboot, because a stack with a restart policy starts again at boot and would
  load the server through the quiet wait.
- A small-server step keeps up only when k6's own request rate reaches 90% of
  the offered rate. The rate was rounded to a whole request per second first,
  so a step that served 449.6 of 500 req/s counted as 90% and the next rate
  ran. Served shares are stored with four decimals and printed with one, both
  rounded down, so a share under the floor never reads as 90%.
- A small-server run whose server did not answer after its steps read as
  ending cleanly, with nothing killed or restarted. Its end state now reads
  unknown unless the kernel's lines show a kill, and the report says so beside
  the highest rate kept up. Before the next run the sweep waits up to 30
  minutes for the server to answer again, instead of three tries over 30
  seconds, and only then says to restart it from the provider's console and
  run the same command.

## [0.9.1] - 2026-10-22

### Changed

- Installing on a Node older than 26 fails instead of printing a warning, so the minimum Node version holds for every install.

## [0.9.0] - 2026-10-22

### Added

- A small-server mode, `make small`, that runs one target alone on a remote
  1 vCPU / 1 GB server over SSH and drives it from this machine. It records
  whether the target boots within a limit and why it did not, idle memory for
  the whole server and each container, and a read scenario at stepped rates.
  `METHODOLOGY.md` section 13 describes the rig.

### Changed

- The rig, its CI and the Strapi and Payload images run on Node 26.12.1, and
  the repository installs with pnpm only. Strapi declares Node 22 at most and
  still builds and starts on 26. The published results keep the images they
  were measured on until the next sweep.

## [0.8.0] - 2026-10-20

### Changed

- Re-measured every figure on the v0.55.0 engine image: the head-to-head, the
  application profiles and the micro-benchmarks. `results/ERRATA.md` section 14
  says what moved and why.
- Each free profile result says how much of its traffic mix needs a license and
  was left out, and `results.json` marks every traffic entry `paid` or not.

### Fixed

- The report read no profile run whose id holds a hyphen, so the photo library,
  the search-heavy knowledge base and the operations dashboard read as pending
  although they were measured.

## [0.7.0] - 2026-10-20

### Added

- Seven application profiles, so they cover 17 of the example apps: a GraphQL
  storefront, a photo library, a search-heavy knowledge base, appointment
  booking, a support helpdesk, a subscription publication and an operations
  dashboard over the engine's own telemetry.

### Changed

- A traffic entry that depends on a plugin says whether that plugin needs a
  paid license (`paid`), and the profiles file moves to format 0.5.0. A free
  run now drives every entry that is not paid, so traffic on free plugins (the
  comments preset, localization, analytics, usage) is measured on the free
  engine instead of waiting for a licensed run. A licensed run asks the license
  only for the paid plugins. A profile whose every entry is paid, the GraphQL
  storefront, is recorded `pending` with the reason `paid-only` on a free run.
- The seeder checks the mark against `GET /api/admin/plugins/status` before
  it seeds: a plugin an entry relies on that is not running on the engine
  being measured stops the run and names the entry.
- `harness/compose/lyeve.yml` raises `PUBLIC_RATE_LIMIT_GLOBAL`, the per-address
  cap every public route without a limit of its own shares, above any offered
  rate, as `RATE_LIMIT_RPS` already was. The free i18n run on 0.54.1 still
  fails about 12% of its requests, on the localization resolve route's own
  limit of 30 a second.

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

- The create scenario (S03) built each slug from a per-user iteration count
  and a random suffix. About thirty virtual users shared each count, so two
  creates picked the same slug about once in ten runs, and every target
  declares the slug unique: one create in 6,000 failed with a conflict on
  LyEve, Strapi, Directus and Payload alike. Slugs now come from the
  test-wide iteration number, prefixed with the time the script loaded, and
  never collide.
- The forum profile's thread read found nothing, so a licensed forum run
  failed 21.6% of its requests. The replies live in the comments type the
  schema plugin's preset creates, and the profile neither applied the preset
  nor seeded any replies. The profile now names the preset and seeds 2400
  replies under the topics, and the seeder applies `presets` before it creates
  the types and fixes a field for every seeded row through `seedValues`.
  Measured on 0.54.1 with a license, the forum run fails none of 12,003
  requests.
- `harness/gen-license.sh` could not be parsed: an apostrophe inside a
  parameter default opened a quote bash never found closed. Every `FULL=1`
  profile run therefore started without a license and its paid traffic was
  refused. It parses and prints the license again, and a FULL run without a
  license now stops with the script's own error instead of measuring refusals.
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
