# Scenario catalog

A **scenario** is one workload we run identically against every target. Each is
defined by *behavior* (not a URL), so it is fair across platforms with different
APIs, and each target maps the behavior to its own idiomatic endpoint in
[`targets/targets.json`](../targets/targets.json).

Machine-readable definitions live in [`scenarios.json`](./scenarios.json). Start
with the fully **worked example**, [S01](./S01-content-read-by-id.md). It
documents the whole flow, and the rest follow the same shape.

## Workload scenarios (driven by k6)

| ID | Scenario | Type | Rate | Pass threshold | What it stresses |
|----|----------|------|-----:|----------------|------------------|
| [S01](./S01-content-read-by-id.md) | Read one record by ID | read | 500/s | p95 < 50 ms | routing, auth, indexed point lookup, JSON |
| [S02](./S02-content-list-50.md) | List 50 records | read | 300/s | p95 < 80 ms | bounded ordered scan, multi-row serialize |
| [S03](./S03-content-create.md) | Create one record | write | 100/s | p95 < 120 ms | validation, insert, lifecycle hooks |
| [S04](./S04-content-filter-query.md) | Filter by indexed field | read | 200/s | p95 < 90 ms | WHERE on index, pagination, relations |
| [S05](./S05-auth-login.md) | Authenticate (token) | auth | 20/s | p95 < 1 s | password hash under burst |

## Static metrics (collected by `run.sh` around every run, no k6)

| ID | Metric | Unit | How |
|----|--------|------|-----|
| `M-cold` | Cold start | ms | `docker start` of the stopped container → first 200 on the target's `readyPath`, polled every 50 ms |
| `M-mem-idle` | Idle memory | MB | container RSS at rest, empty DB, defaults |
| `M-mem-peak` | Peak memory | MB | max RSS sampled during S02 |
| `M-image` | Image size | MB | uncompressed on-disk size from the `docker images` SIZE column |

## Design rules (why the scenarios look the way they do)

- **Behavior, not URL.** Fair across different API shapes.
- **Arrival-rate, not fixed VUs.** A slow target can't lower its own offered load.
- **One concern per scenario.** S01 avoids joins so a slow join can't hide in a
  read number, and S04 exists precisely to measure the join/filter path on its own.
- **Rates are the offered load, not a claim.** The published number is the
  *latency and error rate at that offered load*, plus the sustained throughput
  the target actually held.

See [METHODOLOGY.md](../METHODOLOGY.md) for the environment, fairness rules, and
the provenance model that governs how these results get published.
