# S03: create one record

> Same shape as the worked example [S01](./S01-content-read-by-id.md). This file
> only calls out what's different.

## Why
The write path. Where S01/S02 are reads, S03 stresses **body validation, one row
insert, lifecycle hooks/events, and returning the created record**. This is where
a platform's write-side machinery (hooks, revalidation, audit logging) shows its
cost.

## Behavior
> **POST a valid record body. Expect `201`/`200` and the created record including
> a server-assigned id.**

| Target | Endpoint for S03 |
|--------|------------------|
| **LyEve** | `POST /api/v1/content/article` |
| Strapi | `POST /api/articles` (body wrapped in `{ "data": {...} }`) |
| Directus | `POST /items/article` |
| Payload | `POST /api/articles` |

Each target's k6 mapping knows its body envelope. The *content* of the body comes
from the shared dataset generator so every platform inserts equivalent rows.

## Measurement
| Parameter | Value |
|-----------|-------|
| Rate | **100 req/s**, 60 s |
| Pass thresholds | `p95 < 120 ms`, `error_rate < 1 %` |
| Primary metric | `p99_ms` |

Writes are rate-limited lower (100/s) than reads on purpose: the goal is a
sustainable write rate with a clean error budget, not to find the point where the
DB falls over (that's a separate stress test, out of scope for the comparison).

## Run
```bash
make run TARGET=lyeve SCENARIO=S03
```

## Ordering
S03 inserts rows, so `run.sh` runs the write scenarios **last** in a sweep, after
S01/S02/S04 have measured against the pristine seeded dataset. That way a create
run never changes the data a read scenario sees, and the stack is torn down
afterward. Everything runs against one seeded stack per target, and we just order the
writes to the end rather than reseeding between every scenario.

## Watch for
- **Synchronous hooks.** A platform that fires webhooks/emails inline on create
  will show it here as tail latency. We record whether hooks are on (default) per
  target in `targets.json`.
- **Auto-revalidation / cache busting** on write can dominate p99, noted as a
  footnote when present.
