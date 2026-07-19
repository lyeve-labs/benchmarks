# S01: read one content record by ID  · **worked example**

> This is the reference scenario, documented end-to-end. Read it once and every
> other scenario file will make sense. Because they follow the same shape. It shows
> exactly *what we do*, *how we run it*, and *how a result becomes a published
> number*.

---

## 1. Why this scenario

Reading a single record by its id is the most common request a CMS serves: an
app has an id and wants the object. It is the cleanest possible test of the
request path because almost nothing else is in the way:

```
HTTP route → auth check → one indexed primary-key lookup → JSON marshal → response
```

If a platform is slow here, it is slow at the thing it does most. If it is fast
here but slow elsewhere, the gap tells you exactly where its overhead lives
(query planning, serialization, middleware). That is why S01 is first.

**What it stresses:** routing, auth/JWT verification, a point lookup on an
indexed column, JSON encoding, and the HTTP write path.
**What it deliberately avoids:** joins, filtering, pagination and writes. Those are
S02-S05.

---

## 2. The behavior (same for every target)

> **GET a single record by its id. Expect `200` and a JSON body containing that
> record.**

The behavior is defined by *intent*, not by a URL, so it is fair across
platforms whose APIs differ. Each target maps it to its own idiomatic endpoint
(from [`targets/targets.json`](../targets/targets.json)):

| Target | Runtime | Endpoint for S01 |
|--------|---------|------------------|
| **LyEve** | Go (single binary) | `GET /api/v1/content/article/{id}` |
| Strapi | Node.js | `GET /api/articles/{id}` |
| Directus | Node.js | `GET /items/article/{id}` |
| Payload | Node.js | `GET /api/articles/{id}` |

We do **not** force a competitor through a URL shape it doesn't have. We hit the
endpoint its own docs tell a developer to use for "get one by id."

---

## 3. Setup (what `run.sh` does before measuring)

1. **Boot** the target + its own PostgreSQL 16 via
   [`harness/compose/<target>.yml`](../harness/compose/), wait for `/health`.
2. **Cold-start** measurement: kill the app container, restart it, time the
   first successful request (this feeds the `M-cold` static metric).
3. **Seed** the shared dataset (10k records, fixed seed `42`) via the target's
   seeder in [`harness/seed/`](../harness/seed/). Idempotent.
4. **Collect the id pool**: k6's `setup()` calls the list endpoint once and
   captures a few hundred real ids to sample from, so every request hits a row
   that exists (a 404 would measure the error path, not the read path).
5. **Warm up** 10 s at the scenario rate, discarded and never recorded.

---

## 4. The measurement

k6 drives the load using a **constant-arrival-rate** executor. It pins the
request rate and lets concurrency float, so a slower target cannot quietly lower
its own offered load.

Parameters (from `scenarios.json`):

| Parameter | Value |
|-----------|-------|
| Executor | `constant-arrival-rate` |
| Rate | **500 req/s** |
| Duration | 60 s (after a discarded 10 s warm-up) |
| Pre-allocated VUs | 50 (auto-scales up to 200) |
| Pass thresholds | `p95 < 50 ms`, `error_rate < 1 %` |

Run it:

```bash
make run TARGET=lyeve SCENARIO=S01
# under the hood:
#   k6 run -e TARGET=lyeve -e SCENARIO=S01 harness/k6/scenario.js --out json=results/raw/<run-id>/S01.json
```

During the 60 s, `run.sh` samples the container's RSS every 2 s to derive idle
and peak memory (`M-mem-*`).

---

## 5. How a run becomes a published number

```
k6 --out json  →  tools/collect.mjs  →  normalized row  →  results/results.json  →  RESULTS.md + website
```

`collect.mjs` extracts `throughput` (req/s actually served), `p50/p95/p99`, and
`error_rate` from the k6 summary, and attaches `host`, `target_version`, `commit`,
`date`, and a `provenance` tag. `generate-report.mjs` drops the row into the
comparison table, but only if the error rate was under budget. A run over the
1 % budget is written as `pending`, not published as a slow number. Where two
targets finish close, we re-run before trusting the ordering (methodology §5).

---

## 6. A completed result (what the output looks like)

Below is the **shape** of a finished S01 result, with the numbers we actually
measured on the local rig (every target in the same Docker environment, same
2,000-record dataset). Values change run to run. The shape does not.

```json
{
  "scenario": "S01",
  "host": "local-rig",
  "date": "2026-07-19",
  "rows": [
    { "target": "lyeve",    "runtime": "Go",   "throughput_rps": 500, "p99_ms": 1.4,   "error_rate": 0.0, "provenance": "measured" },
    { "target": "payload",  "runtime": "Node", "throughput_rps": 500, "p99_ms": 8.5,   "error_rate": 0.0, "provenance": "measured" },
    { "target": "directus", "runtime": "Node", "throughput_rps": 500, "p99_ms": 148.0, "error_rate": 0.0, "provenance": "measured" },
    { "target": "strapi",   "runtime": "Node", "throughput_rps": 500, "p99_ms": 961.1, "error_rate": 0.0, "provenance": "measured" }
  ]
}
```

**How to read it:** every target is offered the same 500 req/s. LyEve answers a
point read in ~1.4 ms p99, Payload stays quick at ~8.5 ms, Directus climbs to the
hundreds, and Strapi is saturating near a second, all without errors. That spread,
one indexed read, identical offered load, latency from single-digit to near a
second, is the whole reason S01 goes first. The higher figures are those engines
saturating at a rate LyEve barely notices. See the head-to-head in
[RESULTS.md](../results/RESULTS.md).

---

## 7. Reproduce just this scenario

```bash
make doctor                       # Docker + k6 + Node present?
make run TARGET=lyeve   SCENARIO=S01
make run TARGET=directus SCENARIO=S01   # e.g. compare against Directus
make report                       # fold both into results.json + RESULTS.md
```

Disagree with the number? Re-run it on your own box and open an issue with your
host spec and the `results/raw/<run-id>/S01.json` attached. That is the only
evidence this repo trades in.
