# S05: authenticate (token issuance)

> Same shape as the worked example [S01](./S01-content-read-by-id.md). This file
> only calls out what's different.

## Why
Login is intentionally the *slowest* endpoint any secure platform has, because it
runs a deliberately expensive password hash (bcrypt or argon2id). S05 does not
reward a fast hash, because a fast password hash is a *security bug*. It measures
something subtler: **how gracefully a platform absorbs a burst of logins without
the hash starving every other request on the box.**

## Behavior
> **POST valid credentials. Expect `200` and a bearer token or session.**

| Target | Endpoint for S05 |
|--------|------------------|
| **LyEve** | `POST /api/admin/auth/login` → `{ token }` |
| Strapi | `POST /api/auth/local` → `{ jwt }` |
| Directus | `POST /auth/login` → `{ data: { access_token } }` |
| Payload | `POST /api/users/login` → `{ token }` |

## Measurement
| Parameter | Value |
|-----------|-------|
| Rate | **20 req/s**, 60 s |
| Pass thresholds | `p95 < 1000 ms`, `error_rate < 1 %` |
| Primary metric | `p99_ms` |

The rate is low (20/s) because each request holds a CPU core busy for tens of
milliseconds by design. The interesting output is not the absolute latency (that
is a tunable cost factor) but the **error rate and p99 stability**, where a platform
that lets the hash pool exhaust connections will spike p99 or shed requests here.

## Interpreting it honestly
Because the hash cost is a security *choice*, we publish S05 with an explicit
footnote of each platform's default algorithm and cost factor. A lower login
latency with a weaker default hash is **not** a win, and the report says so. This
is the one scenario where "faster" can be the wrong answer, and the methodology
treats it that way.

## Run
```bash
make run TARGET=lyeve SCENARIO=S05
```
