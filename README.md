# LyEve Performance Benchmarks

Reproducible performance benchmarks for [LyEve Core](https://lyeve.com) and a
head-to-head comparison against other content platforms.

Everything here is designed to be **run by anyone**. We publish the harness, the
scenarios, the raw output, and the generated report so that every number on
[lyeve.com/benchmarks](https://lyeve.com/benchmarks) can be independently
reproduced, or challenged.

> **One rule governs this repo: we never publish a number we did not measure.**
> Every value carries a provenance tag (`measured`, `target`, `vendor-published`,
> or `pending`). See [METHODOLOGY.md](./METHODOLOGY.md) §7.
>
> **Correction, 2026-09-04:** that rule held, but some figures measured the
> wrong request. The harness drove the engine with a filter syntax it does not
> have, so the filter scenarios returned unfiltered lists. Every figure was
> re-measured on 2026-09-25 with the corrected harness; see
> [results/ERRATA.md](./results/ERRATA.md) for what changed and why.

---

## What's here

| Path | What it is |
|------|------------|
| [`METHODOLOGY.md`](./METHODOLOGY.md) | How we test: hardware, dataset, fairness rules, provenance, how to reproduce. Read this first. |
| [`scenarios/`](./scenarios/) | The workload catalog: one file per scenario, plus a machine-readable `scenarios.json`. Includes a fully **worked example** ([`S01`](./scenarios/S01-content-read-by-id.md)). |
| [`targets/targets.json`](./targets/targets.json) | The vendor registry: LyEve + each competitor, how each is deployed, and what's fair to compare. |
| [`harness/`](./harness/) | The runnable test rig: portable k6 scripts, a Docker Compose stack per target, seed scripts, and the `run.sh` orchestrator. |
| [`results/results.json`](./results/results.json) | Canonical machine-readable results. **Every number on the website comes from this file.** |
| [`results/RESULTS.md`](./results/RESULTS.md) | Human-readable report, generated from `results.json`. |
| [`results/ERRATA.md`](./results/ERRATA.md) | Corrections to figures we have published, with the measurements that prove them. |
| [`tools/`](./tools/) | The generator (`generate-report.mjs`) and the k6-output parser (`collect.mjs`). |

---

## Quickstart

```bash
# 0. Prerequisites: Docker, Docker Compose, k6, Node 20+.
make doctor                      # check your machine has what it needs

# 1. Run one scenario against one target
make run TARGET=lyeve SCENARIO=S01

# 2. Run the full sweep against every self-hostable target
make sweep

# 3. Regenerate results.json + RESULTS.md from the raw output
make report
```

No Docker or k6 on this machine? `make report` still works. It regenerates the
report from whatever is already in `results/raw/` (and the committed LyEve
baseline), so you can iterate on the report without re-running the load tests.

---

## How this reaches the website

This repo is the source of truth. [lyeve.com/benchmarks](https://lyeve.com/benchmarks)
renders a copy of [`results/results.json`](./results/results.json) from a
published release. If the page and this repo ever disagree, this repo is right
and the page is stale. See [`METHODOLOGY.md`](./METHODOLOGY.md) §8.

---

## Status

The head-to-head is **measured for four engines**: LyEve, Directus 11, Strapi 5,
and Payload 3, across image size, idle memory, cold start, and all five
scenarios (S01-S05), every target in the same local Docker environment. Each
figure is the median of the clean runs (three for LyEve, four for each
competitor), each on a fresh stack, with the lowest and highest beside it. The machine, the engine commit and the method are in
[`results/rig.json`](./results/rig.json). Login (S05) reads pending for LyEve
and Strapi, whose stock configurations both rate-limit it. LyEve's
internal micro-benchmarks (auth, DB, middleware) are measured separately. The
sustained-throughput REST rows are still published as **targets** and get
promoted to `measured` once the sweep runs on the Hetzner reference host. Hosted,
vendor-run platforms (SaaS) stay context-only, because we can't run them on our host, so
we never put them in a "measured on the same rig" column. A cell reads `pending`
when a run hasn't happened or blew the error budget, never a guess. Follow
[`results/RESULTS.md`](./results/RESULTS.md) for the live state.

---

*Part of the [LyEve](https://lyeve.com) project. MIT licensed, see [LICENSE](./LICENSE).*
