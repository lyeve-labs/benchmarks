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
# 0. Prerequisites: Docker, Docker Compose, k6, Node 26. pnpm is the only package manager.
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

## Small-server mode

The head-to-head runs every target on one capable machine. `make small`
answers a second question: what one target does alone on the smallest server
people rent, 1 vCPU and 1 GB. The target and its own PostgreSQL run on the
remote server, and k6 drives them from your machine over the network.

```bash
make small TARGET=lyeve HOST=root@203.0.113.10 KEY=~/.ssh/bench-vm PROVIDER=<provider> PLAN=<plan>
```

The server needs SSH as root, or as a user with passwordless sudo, and the same
CPU architecture as your machine. The harness installs Docker there if it is
missing and copies only the target's compose file and images. It measures the
boot, idle memory and one read scenario at rising rates, then removes
everything it brought. A target that fails to boot is a result, recorded with
the reason the server shows. Each run lands in
`results/raw/small/<run-id>/small.json`.

| Variable | Default | Meaning |
|---|---|---|
| `HOST` | required | SSH destination, `user@address` |
| `KEY` | required | private key for that destination |
| `SSH_PORT`, `SSH_OPTS` | `22`, none | SSH port and extra options |
| `PROVIDER`, `PLAN` | none | recorded with the rig. The CPU, cores and memory are read from the server |
| `SCENARIO` | `S01` | a read scenario |
| `RATES` | `25 50 100 200 300 500` | offered rates in req/s, run in order |
| `BOOT_TIMEOUT` | `300` | seconds the target has to answer after it starts |
| `BENCH_PORT` | `8080` | application port on the server |

See [`METHODOLOGY.md`](./METHODOLOGY.md) §13 for the rules and what a boot
failure means.

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
