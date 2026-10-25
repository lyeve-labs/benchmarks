# Methodology: how we benchmark

This document is the contract behind every number we publish. If you disagree
with a result, this is the page that tells you exactly how to reproduce it and
where to push back.

**Contents**
1. [The one rule](#1-the-one-rule)
2. [Reference environment](#2-reference-environment)
3. [The dataset](#3-the-dataset)
4. [What we measure](#4-what-we-measure)
5. [How a run works](#5-how-a-run-works)
6. [Fairness rules](#6-fairness-rules)
7. [Provenance: the four states](#7-provenance-the-four-states)
8. [How results reach the website](#8-how-results-reach-the-website)
9. [Reproduce it yourself](#9-reproduce-it-yourself)
10. [Competitor notes & caveats](#10-competitor-notes--caveats)
11. [Maintenance & regression gate](#11-maintenance--regression-gate)
12. [Errata](#12-errata)
13. [The small-server rig](#13-the-small-server-rig)

---

## 1. The one rule

> **We never publish a number we did not measure.**

A benchmark page is only worth the trust behind it. So the harness enforces a
single discipline: every value we render on the website carries a *provenance*
tag (§7). If we have not run a workload, its cell says **pending**, not a guess,
not a "typical," not a competitor's marketing number dressed up as ours.

This costs us some empty cells at launch. That is the point. An empty cell we
can fill honestly is worth more than a full row nobody can defend.

---

## 2. Reference environment

The rule that makes a comparison mean anything: **every target in a comparison
runs on the same host, at the same time, against the same PostgreSQL.** The only
variable left is the software. We hold that invariant on two setups:

| | Reference host (published throughput sweep) | Local rig (current comparison) |
|---|---|---|
| Instance | Hetzner CX22, 4 vCPU (shared), 8 GB RAM, NVMe | Intel Core Ultra 5 125H (18 threads), 32 GB RAM, NVMe, Docker (amd64) |
| Why this box | The cheapest tier a real production deployment uses. Fast here, fast anywhere. | Every target containerized side by side, so the A/B is honest even off the VPS. |
| OS | Ubuntu 24.04 LTS, kernel 6.8+ | Ubuntu 26.04, kernel 7.0, Docker 29.8, Compose v2 |
| Database | PostgreSQL 16, **on the same host** (worst case: CMS and DB share CPU) | PostgreSQL 16 container, one per target |
| Load generator | [k6](https://k6.io) from a **separate** box in the same region | k6 on the same workstation |

The image, memory, cold-start, and S01-S05 latency figures published today were
measured on the **local rig**, every target in the same Docker environment, so
the head-to-head is valid. Each target runs several times, interleaved with the
others and each time on a fresh stack, and the report publishes the median with
the lowest and highest run. `results/rig.json` records the machine, the date,
the engine commit and the competitor versions of the latest sweep. The **reference host** is where the sustained-throughput
sweep runs. Those rows stay `target` or `pending` until that sweep lands. Which
host produced a metric is recorded in the result JSON, and the report generator
refuses to place two metrics from different hosts in the same table.

Micro-benchmarks (Go `testing.B`, the auth/DB/middleware tables) are CPU-bound
and reported separately, on a documented developer machine (Intel Core Ultra 5
125H). They are marked with the machine and Go version in the result so they are
never confused with the shared-VPS end-to-end numbers.

> **Never compare numbers from two different hosts.** The result JSON records the
> host for every metric. The report generator keeps each metric's host in its
> output. A future CI gate will reject a comparison that mixes hosts.

---

## 3. The dataset

Every target is seeded with the **same** synthetic dataset before any scenario
runs. Seeding is idempotent and lives in [`harness/seed/`](./harness/seed/).

- **2,000 records** across **2 content types** (`article`, `category`) for the
  scenario path. The dataset description in `dataset.json` carries five types
  totaling 4,000 records. The scenario seeder exercises the two that every
  target supports. Profile runs use their own schemas and volumes.
- Field mix per type is deliberately varied (short string, long text, integer,
  boolean, timestamp, JSON blob, and **one relation**) so the query planner
  cannot cheat with a trivial single-column table.
- One indexed slug/UNIQUE column per type (every CMS creates these, and we make sure
  they exist on all of them so nobody wins on a missing index).
- A fixed random seed (`42`, from `dataset.json`) so two runs seed byte-identical data.

The dataset is described once, in machine-readable form, in
[`harness/seed/dataset.json`](./harness/seed/dataset.json). Each target's seeder
translates that description into that platform's content model.

---

## 4. What we measure

Two families of metric, kept strictly separate.

### 4.1 End-to-end (the comparative story)

Run through the HTTP surface, identical for every target. These are what the
`/benchmarks` comparison tables show.

| Metric | Unit | Lower better | Notes |
|---|---|:---:|---|
| Throughput | req/s | no | Sustained requests/sec a single replica holds under the scenario's arrival rate without breaching the error budget. |
| Latency p50 / p95 / p99 | ms | yes | Server-side request duration as reported by k6, warm cache excluded from the first 10 s. |
| Error rate | % | yes | Non-2xx/3xx over the run. Budget is < 1 %. A run over budget is **invalid**, not just "slower." |
| Idle memory | MB | yes | RSS of the target container at rest, empty DB, default config. |
| Peak memory | MB | yes | RSS at the scenario's sustained load. |
| Cold start | ms | yes | Container start → first successful request. |
| Container image size | MB | yes | Published image, uncompressed on-disk size from the `docker images` SIZE column (amd64), corroborated by the `docker history` layer sum. Cheap, exact, fully comparable. (We avoid `docker image inspect --format {{.Size}}` because it under-reports several-fold on some engine versions.) |

### 4.2 Micro (the LyEve internals story)

Go `testing.B` benchmarks of hot paths (JWT sign/verify, password hashing,
placeholder rewrite, middleware stack). LyEve-only. And competitors do not expose an
equivalent, so these never appear in a comparison table, only in the "under the
hood" section. Reported as ns/op, B/op, allocs/op.

---

## 5. How a run works

`harness/run.sh` executes the same sequence for every target so no target gets a
warm-up the others didn't:

```
1. up        docker compose up the target + its Postgres, wait for /health
2. cold      measure cold-start (kill, restart, time to first 200)
3. seed      apply the shared dataset (idempotent, fixed seed)
4. warm      10 s warm-up at the scenario rate, discarded, not recorded
5. measure   the scenario's k6 script, arrival-rate executor, fixed duration
6. sample    poll container RSS every 2 s during measure → idle & peak memory
7. collect   k6 --out json → tools/collect.mjs → normalized metric rows
8. down      tear the stack down; raw output lands in results/raw/<run-id>/
```

Rules baked into the runner:

- **Arrival-rate, not VU-rate.** k6's `constant-arrival-rate` executor pins a
  request rate and lets concurrency float, so a slow target does not quietly
  lower its own offered load (which a fixed-VU test would).
- **Warm-up is discarded.** A 10 s warm-up runs first (JIT, connection pool fill,
  cache priming) and never enters a percentile. Only the measured window that
  follows is recorded.
- **The error budget is a gate.** Over 1 % errors ⇒ the run is `invalid`. We fix
  the setup and re-run rather than publishing a fast-but-broken number. The
  report generator enforces this: a run over budget is written as `pending`, not
  a number.
- **Re-run before you trust a close result.** Where two targets land within noise
  of each other, we re-run and confirm the ordering holds before we lean on it.
  A single measured window is enough to separate a Go binary from a Node runtime
  by an order of magnitude. It is not enough to split hairs, and we don't.

---

## 6. Fairness rules

Comparative benchmarking is easy to rig. These rules exist so we can't, even by
accident:

1. **Same host, same region, same PostgreSQL, same dataset** for every target in
   a comparison. Enforced by the runner and re-checked by the report generator.
2. **Stock configuration.** Each target runs its documented production defaults:
   no LyEve-favoring tuning, and no deliberately hobbling a competitor. Any
   non-default flag is recorded in `targets.json` and shown as a footnote.
3. **Same work, not the same code.** Each scenario is defined by *behavior*
   ("read one record by id, return JSON"), and each target's k6 script hits that
   target's idiomatic endpoint for it. We do not force a competitor through a
   shape its API doesn't have.
4. **Their build, not ours.** Competitors run their **official** published image
   / install at a pinned version (recorded per run). We never rebuild a
   competitor "to be fair". Their shipped artifact is the honest thing to test.
5. **Conservative on our own claims.** Where a LyEve number is a target we ship
   *against* but haven't yet measured end-to-end on the reference host, it is
   labeled `target`, never `measured`.
6. **Publish the raw.** The k6 JSON that produced a published row is kept under
   `results/raw/<run-id>/`. If it isn't there, the number doesn't ship.

---

## 7. Provenance: the four states

Every metric value in `results.json` has a `provenance` field. The website
renders a badge for each so a reader always knows what they're looking at.

| State | Badge | Means | Example |
|---|---|---|---|
| `measured` | (measured) Measured | We ran it on the reference host and kept the raw output. | LyEve image size, auth micro-benchmarks. |
| `target` | (target) Target | A number we engineer against and gate regressions on, **not yet** promoted to an end-to-end measurement on the reference host. | Some REST p99 rows at launch. |
| `vendor-published` | (vendor) Vendor-published | A competitor's *own* published figure, cited with a source URL, clearly *not* independently reproduced by us. Used sparingly, never mixed into a "measured" column. | A vendor's stated cold-start from their docs. |
| `pending` | (pending) Pending | The harness supports it. We simply haven't run it yet. Shown as a dash, never a guess. | Competitor throughput at launch. |

The report generator will **refuse to build** a comparison table that silently
mixes `measured` LyEve values against `vendor-published` competitor values
without tagging both, so the provenance can never be laundered away.

---

## 8. How results reach the website

This repo is the source of truth. The website is a consumer.

- [`results/results.json`](./results/results.json) is the only input. The page
  at [lyeve.com/benchmarks](https://lyeve.com/benchmarks) renders a copy of it
  taken from a published release of this repo, and adds no number of its own.
- The site carries its own snapshot of that file, so a site build never depends
  on this repo being reachable. The cost is lag: the page is only as current as
  the release its snapshot came from.
- A correction lands here first, in a release with a CHANGELOG entry, and only
  then on the page. If the two disagree, this repo is right.

---

## 9. Reproduce it yourself

```bash
git clone <this repo> && cd benchmarks
make doctor                        # verifies Docker + k6 + Node

# One target, one scenario (fast: ~2 min)
make run TARGET=lyeve   SCENARIO=S01
make run TARGET=directus SCENARIO=S01

# Everything (self-hostable targets, all scenarios)
make sweep

make report                        # rebuild results.json + RESULTS.md
open results/RESULTS.md
```

The only inputs are the pinned target versions in `targets.json` and the dataset
description in `harness/seed/dataset.json`. Same inputs ⇒ same numbers, within
the noise band §5 documents.

---

## 10. Competitor notes & caveats

- **Self-host vs. hosted.** Strapi, Directus, and Payload are self-hostable and
  run on the reference host through the identical harness, a true apples-to-apples
  comparison. **Pure-SaaS platforms** run on the vendor's own
  managed infrastructure. Any number for them reflects *their* hardware and
  network, not ours, and is tagged `hosted` in `targets.json` and `vendor-published`
  in results. We keep them for context, never in the same "measured on the
  reference host" column.
- **Runtime differences are the story, not a trick.** LyEve is a single Go binary,
  Strapi/Directus/Payload are Node.js, and WordPress is PHP. Comparing a compiled
  binary to an interpreted runtime is fair *because that is the product decision a
  customer is actually making.* We state the runtime in every comparison.
- **Versions age.** Every competitor row records the exact image tag and the date
  it was run. A number from a superseded version is marked stale and re-run before
  it is re-published.
- **We do not tune against them.** No competitor is run with a knowingly bad
  config to inflate our lead. If we ever find we misconfigured a competitor, the
  correction ships in the next sweep and is noted in the CHANGELOG.

---

## 11. Maintenance & regression gate

- **Re-running after a LyEve core upgrade.** The LyEve column is measured on a
  tagged release, the published image as it ships. `targets.json` and the
  compose file name that tag, and `LYEVE_IMAGE` overrides it for one run:

  ```bash
  LYEVE_IMAGE=ghcr.io/lyeve-labs/lyeve-core:<version> make sweep
  make report       # fold the fresh runs into results.json + RESULTS.md
  ```

  Then move the tag in `targets.json` and `harness/compose/lyeve.yml`, so the
  files name the build the published figures came from. The run date is
  recorded with every result. Competitor images are pinned by tag and don't move
  between runs.
- **Re-run cadence:** the full sweep runs before every LyEve minor release and
  quarterly regardless, so numbers never drift silently.
- **Regression gate:** LyEve's own micro-benchmarks run in CI against a checked-in
  baseline. A tracked metric more than **20 % slower** than baseline blocks the
  change until it is justified or fixed.
- **Corrections are first-class.** If a published number turns out to be wrong, we
  fix it in place, note it in the CHANGELOG, and re-run. We do not quietly delete
  it.

---

## 12. Errata

Numbers we have published that measured the wrong request are recorded in
[results/ERRATA.md](./results/ERRATA.md), with the measurement that proves each
one. The rule against publishing an unmeasured number does not protect against a
harness that drives the wrong endpoint, so every query shape in the harness is
now checked against the engine's own request parsing rather than against an
assumed API. Where the two disagreed, the engine won and the disagreement is
recorded.

---

## 13. The small-server rig

The head-to-head says which engine is faster on a capable machine. The
small-server rig answers a different question: what each one does on the
smallest server people rent, one virtual CPU and 1 GB of memory. Its figures
come from a different host, so they never enter the head-to-head table (§2).

```bash
make small TARGET=lyeve HOST=root@203.0.113.10 KEY=~/.ssh/bench-vm PROVIDER=<provider> PLAN=<plan>
make small-sweep HOST=ubuntu@10.0.1.20 KEY=~/.ssh/bench.pem CAMPAIGN=<name> PROVIDER=<provider> PLAN=<plan>
```

**Same rules.** The images are the ones the local rig measures, byte for byte.
The server pulls each public image by the digest the harness machine holds, and
an image it cannot pull (one built locally, or one whose registry refuses
anonymous pulls) is copied to it over SSH. So the server has to share the
harness machine's CPU architecture. An image already on the server stays when
it holds the same bytes as the harness machine's copy, compared by the image ID
for the server's platform, which a copy keeps. When the bytes differ, as after
a rebuild or a moved tag, the harness machine's copy replaces it. A load
generator that holds no images leaves the server's as they are, which is why
the machine that holds the images prepares the server. Every run records the
image ID the server ran, so a campaign shows that each of its runs used the
same bytes. The dataset, the seed, the scenarios, the stock configuration and
the provenance tags are unchanged. Each target runs alone, with its own
PostgreSQL on the same server, the way a small-server user would run it.

**A remote load generator.** k6 runs on a separate machine and reaches the
server over the network, so the load generator never takes the server's one
core. The cost is that every latency includes the network round trip. The run
records that round trip (the median TCP connect time over eleven requests), so
a reader can subtract it. Put the load generator as close to the server as
possible, in the same region and on the same provider's network if you can. A
figure measured across a continent measures the continent.

**Which machine ran out.** A step can fall short of its rate because the server
is saturated, or because the load generator is. Each step reads the CPU
counters of both machines just before and after its k6 process and records each
machine's busy share and its steal share, the time the hypervisor held the CPU
back. Both are averages over the whole process: k6's start, its setup and its
stop add a few seconds to the measured window, in which the server mostly
waits, so a server saturated through the window reads a point or two under
100%. On a machine with more than one core the share is of all its cores
together. A step that falls short with the server near 100% busy measured the
server. One with the load generator near 100% measured the load generator, and
the report shows both shares beside every step. Steal also shows a burstable
plan that ran out of CPU credits, which throttles the machine to its baseline.
The busy share counts neither idle time nor I/O wait, the time the CPU sat idle
with a disk request outstanding, so each step records the server's I/O wait
too. It rises with synchronous writes to disk, and on a server with no swap it
rises far higher once memory runs out, because the kernel drops the cached code
of the running programs and has to read it back. A step that falls short while
the server's busy and I/O wait shares add up to nearly 100% measured the
server, whichever of the two is larger. The step records the bytes received per
second over the same process too, so a network ceiling shows as a flat line
with neither CPU saturated.

**The network between them.** The application port answers only the load
generator's address while a run lasts. A firewall rule on the server drops
every other source, and teardown removes it. That keeps strangers' scans out of
the measurement, and it keeps a stack with published benchmark credentials off
the open internet. If the load generator's address changes during a run, the
rule drops its requests from then on, and the target would read as failing.
Such a run is void: it is set aside, never reported, and run again. So is a run
whose server did not answer SSH for a minute, which would otherwise read as a
target that stopped. A target that stalls the server that long is voided on
every pass, so its campaign stays incomplete and the void records show why.

**What a run measures.**

1. **Boot.** The time from `docker compose up`, with the images already on the
   server and an empty database, to the first successful answer on the target's
   ready path, within a limit (300 s by default). This is a first boot with
   database creation and migrations, which §4.1's cold start is not: that one
   restarts a container that has already booted once.
2. **Idle memory.** After the same 45 s settle the head-to-head uses, five
   samples of the whole server (`free`) and of each container (`docker stats`),
   reported as medians.
3. **One read scenario at stepped rates.** S01 by default, offered at 25, 50,
   100, 200, 300 and 500 req/s. Each step gets the usual 10 s warm-up, which is
   discarded, and the scenario's measured window. Each step records the latency
   percentiles, the error rate and the share of the offered rate the target
   served, from k6's own request rate before any rounding. Stepping stops after
   the first step that breaks the error budget or serves less than 90% of its
   rate, because a higher rate would only measure the same collapse for longer.
   Each step also records the busy and steal shares of both machines' CPUs, the
   iterations k6 dropped, the most virtual users it held and the bytes it
   received per second. While the steps run, a sampler on the server records
   server and container memory every 5 s.

**Campaigns.** `make small-sweep` runs a campaign: every self-hosted target on
every read scenario, three rounds by default, all on one server. Before every
run the server reboots, so nothing one target left behind (memory, page cache,
a kernel log) is read as another's, and the run starts only once the server has
been up two minutes with Docker running and its one-minute load under 0.3, and
the load generator's load is under half its cores. Each wait gives up after ten
minutes, and every run records the load it started at. A stack an earlier run
could not tear down, with its firewall rule, is removed before the next run
starts. For the whole campaign the server's timers are masked and its snap
refreshes held, so no package or maintenance job shares the CPU with a step.
Both come back when the sweep ends, and `harness/small-sweep.sh --restore`
brings them back after a sweep that could not reach the server at its end. The
rounds interleave the targets (each scenario takes every target in turn before
the next round), so a slow hour at the provider spreads over all of them
instead of landing on one. Every run carries the campaign's name, and a stopped
sweep resumes where it left off. A target that leaves the server unable to
answer once its steps are over keeps its run, because every step was measured:
the report says so beside the highest rate kept up, and the run's end state
reads unknown. The sweep then stops at the next reboot, since only the provider
can restart a server that does not answer: restart it from the provider's
console, then run the same command. `make small-report` turns the campaigns
into `results/SMALL.md` and `results/small.json`: each figure is the median of
the campaign's runs, with the lowest and highest and the number of runs. The
highest rate kept up takes the lower of the two middle runs when their number
is even, so it is always a rate that was offered. Campaigns accumulate, newest
first, so a later engine release or another provider's plan reads beside the
earlier ones, and a reader compares two campaigns only where their rigs match.

**What a boot failure means.** A target that does not answer within the limit,
exits, or is killed has a result, not a missing number: in its stock
configuration it does not run on that server size. The run records the reason
the server shows: the container's state, exit code and restart count, whether
Docker saw it killed for memory, the kernel's out-of-memory lines from `dmesg`,
and the last lines of the application's log. A failure is never retried with
tuning until it passes, because a tuned target is not the one a reader would
install.

**Where results go.** Each run writes `results/raw/small/<run-id>/`: the raw
text from the server, one k6 summary and one pair of CPU readings per step, the
`M-*.json` files every run carries, and `small.json`. That file holds the rig
(provider and plan as given, the harness commit, the CPU model, core count and
memory read from the server itself, the server's load and uptime when the run
started, and the same for the load generator), the boot result, idle and peak
memory, and every step. `results/SMALL.md` reports the campaigns. The
head-to-head's report generator does not read this directory, so a
small-server figure cannot reach the head-to-head.

**Nothing secret stays on the server.** The one credential a run creates, the
engine's setup token, travels over SSH on standard input and lives only in the
container. Teardown removes the stack with its volumes, the images the run
brought, the firewall rules and the work directory. A campaign keeps the
images between its runs. When the server has no Docker, the harness installs
it with Docker's own install script and leaves it installed.

---

*Questions or a challenge to a number? Open an issue with your host spec and your
raw k6 output attached. That's the only currency this repo trades in.*
