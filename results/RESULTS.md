# LyEve Benchmark Results

> Generated 2026-10-05 from the [benchmark harness](../README.md). Every value is tagged with its provenance. We never publish a number we did not measure ([methodology §1](../METHODOLOGY.md#1-the-one-rule)).

**Rig:** Intel Core Ultra 5 125H (18 threads), 32 GB RAM, NVMe, Ubuntu 26.04, Docker 29.8 · PostgreSQL 16, one container per target on the same host

Every figure in the head-to-head, the static metrics and the S01 to S05 latencies alike, was measured on this one rig, each target and its own PostgreSQL side by side, so the A/B is valid. The load generator runs on the same machine. No figure here comes from the Hetzner reference host. The sustained-throughput rows stay targets until that sweep runs.

## How this run was made

| | |
|---|---|
| Date | 2026-10-05 (every target, the application profiles and the micro-benchmarks) |
| Machine | Intel Core Ultra 5 125H (18 threads), 32 GB RAM, NVMe, Ubuntu 26.04, Linux 7.0 |
| Container runtime | Docker 29.8 (containerd image store), Compose v2 |
| Load generator | k6 2.3.0 on the same machine, constant arrival rate |
| LyEve engine | the published v0.51.2 image as it ships, with all 51 plugins compiled in, pulled rather than built. No license: the free baseline starts. Micro-benchmarks from the engine source at the same tag |
| Directus | 11.17.4, official image directus/directus:11 |
| Strapi | 5.6.0, built from the committed app on node:20-alpine |
| Payload | 3.11.0 on Next.js 15.1.0, built from the committed app on node:24-alpine |
| Repetitions | Every target on 2026-10-05: four repetitions, interleaved (LyEve, Directus, Strapi, Payload, then again), each on a fresh stack. Every run started and ended below load 4. One Directus run is set aside under results/raw/excluded because an unrelated build ran on the machine during it, so Directus is the median of 3 runs and every other target of 4. Each application profile ran 3 times the same evening. |

- Every run brings the target's stack up from nothing, seeds the same 2,020 records from a fixed seed, and tears it down with its volumes afterwards.
- Each scenario gets a 10 s discarded warm-up, then a 60 s measured window. The published figure is the median of the runs. The range beneath it is the lowest and highest run.
- Before each run the driver waits until no other test workload runs on the machine and the one-minute load average is under 4. The load at the start and end of every run is logged, and a run with either above 4 is excluded.
- Image size is the sum of the image's layers from `docker history`, uncompressed. Cold start is `docker start` of the stopped container to the first request the application serves, polled every 50 ms.
- LyEve runs in its default production mode behind a proxy that forwards the https scheme. Its free tier limits logins to five per fifteen minutes per address and only a license changes that, so the load scripts reuse one token and S05 reads pending, the rule that has always applied to Strapi.

## Provenance

| Marker | State | Meaning |
|:---:|---|---|
| (measured) | `measured` | We ran it on the rig described in this report and kept the raw output. |
| (target) | `target` | A number we engineer against and gate regressions on, not an end-to-end measurement. |
| (vendor) | `vendor-published` | A competitor's own published figure, cited, not independently reproduced by us. |
| (pending) | `pending` | The harness supports it. We have not run it yet. Shown as a dash, never a guess. |

## Head-to-head

Runtimes: **LyEve** (Go) · **Strapi** (Node.js) · **Directus** (Node.js) · **Payload** (Node.js).

Each cell is the median of the runs, with the lowest and highest run beneath it.

| Metric | LyEve | Strapi | Directus | Payload | LyEve lead* |
|---|---|---|---|---|---|
| Container image size | 78 MB (measured)<br><sub>78 to 78, n=4</sub> | 1,884 MB (measured)<br><sub>1,884 to 1,884, n=4</sub> | 970 MB (measured)<br><sub>970 to 970, n=3</sub> | 1,994 MB (measured)<br><sub>1,994 to 1,994, n=4</sub> | 12.4× better |
| Idle memory | 26.5 MB (measured)<br><sub>26 to 28, n=4</sub> | 100.5 MB (measured)<br><sub>97 to 102, n=4</sub> | 188 MB (measured)<br><sub>181 to 197, n=3</sub> | 101 MB (measured)<br><sub>100 to 101, n=4</sub> | 3.8× better |
| p99 read-by-id | 1.8 ms (measured)<br><sub>1.7 to 1.8, n=4</sub> | 751.9 ms (measured)<br><sub>716.7 to 778.8, n=4</sub><br><sub>served 301 of 500 req/s</sub> | 112.1 ms (measured)<br><sub>66.3 to 120, n=3</sub> | 9.7 ms (measured)<br><sub>8.8 to 23.6, n=4</sub> | 5.4× better |
| p99 list-50 | 2.9 ms (measured)<br><sub>2.9 to 2.9, n=4</sub> | 1,621.4 ms (measured)<br><sub>1,612.1 to 1,658.7, n=4</sub><br><sub>served 133.5 of 300 req/s</sub> | 15.2 ms (measured)<br><sub>12.1 to 16, n=3</sub> | 8.6 ms (measured)<br><sub>8.1 to 16.4, n=4</sub> | 3× better |
| p99 create | 6.7 ms (measured)<br><sub>6 to 7.1, n=4</sub> | 17.2 ms (measured)<br><sub>16.5 to 21.9, n=4</sub> | 12.2 ms (measured)<br><sub>11.3 to 12.3, n=3</sub> | 7.8 ms (measured)<br><sub>7.3 to 8.2, n=4</sub> | 1.2× better |
| p99 filter | 2.4 ms (measured)<br><sub>2.4 to 2.4, n=4</sub> | 1,379.3 ms (measured)<br><sub>1,360.4 to 1,456.4, n=4</sub><br><sub>served 158.5 of 200 req/s</sub> | 5.9 ms (measured)<br><sub>5.6 to 6, n=3</sub> | 5.5 ms (measured)<br><sub>5.4 to 5.6, n=4</sub> | 2.3× better |
| p99 login | _pending_ | _pending_ | 505.9 ms (measured)<br><sub>505.8 to 505.9, n=3</sub> | 65.5 ms (measured)<br><sub>64.8 to 66, n=4</sub> | n/a |
| Cold start | 488 ms (measured)<br><sub>329 to 751, n=4</sub> | 2,212.5 ms (measured)<br><sub>1,711 to 2,345, n=4</sub> | 7,251 ms (measured)<br><sub>7,129 to 7,271, n=3</sub> | 2,664.5 ms (measured)<br><sub>2,614 to 2,821, n=4</sub> | 4.5× better |

*Lead is LyEve's median against the **strongest** competitor's median on each metric (the best, lowest value), so it is a conservative floor: LyEve is at least this much better than the best alternative, not the worst. A lead below 1 means a competitor is ahead. Every competitor's own value is in its column.

- **Container image size:** Uncompressed image: the sum of its layers from `docker history` (amd64). A compiled Go binary against a Node runtime plus node_modules.
- **Idle memory:** Container memory from `docker stats` at rest after a restart, empty database, default config: the median of five samples taken after 45 seconds of settling. LyEve runs the free engine: every plugin compiled in, the free baseline started, no license.
- **p99 read-by-id:** One record by id at 500 req/s (scenario S01).
- **p99 list-50:** First page of 50 at 300 req/s (scenario S02).
- **p99 create:** Create one record at 100 req/s (scenario S03).
- **p99 filter:** Filter by an indexed field, 25 rows, at 200 req/s (scenario S04). Each run first proves the filter applies: a value no record holds must return no rows, and a real value must return only matching rows.
- **p99 login:** Token issuance at 20 req/s, where slower is expected (password hash). A target whose stock config rate-limits authentication refuses the burst and reads pending here rather than posting a number for refused logins. Scenario S05.
- **Cold start:** From `docker start` of a stopped container to the first request the application serves (includes DB connect and migration check), polled every 50 ms.

A cell marked "served N of M req/s" belongs to a target that could not keep up with the offered rate. Its latency is bounded by the load generator's limit on concurrent requests, so it understates how slow that target is at the full rate.

Why a cell is pending:

- p99 login, LyEve: over the error budget in 4 of 4 runs: the free tier allows five logins per fifteen minutes per address and refuses the rest with 429. Changing the limit needs a license.
- p99 login, Strapi: over the error budget in 4 of 4 runs: the stock users-permissions plugin rate-limits /api/auth/local and refuses the burst with 429.

> A cell reads `pending` until that platform is measured through the identical harness, or when a run blew the error budget (an invalid result, not a slow one). That is by design, not an omission.

## Under the hood: LyEve micro-benchmarks (measured)

_core bench suite (go test -bench -benchmem -count=5, median), commit da80fdd (v0.51.2); Intel Core Ultra 5 125H (18 threads), Go 1.27.1, 2026-10-05._

**Auth / crypto**

| Operation | Cost |
|---|---|
| JWT sign (HMAC) | `5.2 µs` |
| JWT verify (parse) | `6.4 µs` |
| Ed25519 sign | `16.1 µs` |
| Ed25519 verify | `36.5 µs` |
| Password hash (bcrypt, cost 10) | `49 ms` |
| Password hash (argon2id) | `18 ms` |

**Database (placeholder rewrite hot path)**

| Operation | Cost |
|---|---|
| PostgreSQL passthrough | `2.1 ns` |
| MySQL rewrite ($N → ?) | `269 ns` |
| MSSQL rewrite ($N → @pN) | `246 ns` |

**Middleware**

| Operation | Cost |
|---|---|
| Full stack (4 middlewares) | `5.1 µs` |
| Tenant header (no-op) | `452 ns` |
| Rate limiter (allow) | `2.0 µs` |

## LyEve REST targets (targets, not measurements)

| Endpoint | Sustained RPS | p50 | p99 |
|---|---:|---:|---:|
| `GET /content/{schema} (50 items)` | 1,000 | 8 ms | 50 ms |
| `GET /content/{schema}/{id}` | 2,000 | 3 ms | 20 ms |
| `POST /content/{schema}` | 500 | 15 ms | 80 ms |
| `PUT /content/{schema}/{id}` | 400 | 20 ms | 100 ms |
| `DELETE /content/{schema}/{id}` | 800 | 8 ms | 40 ms |
| `GET /schemas (list 20)` | 500 | 5 ms | 30 ms |

## What we test: scenarios

| ID | Scenario | Type | Offered load | Threshold |
|---|---|---|---|---|
| S01 | Read one content record by ID | read | 500/s | p95 < 50 ms |
| S02 | List 50 records (page 1) | read | 300/s | p95 < 80 ms |
| S03 | Create one record | write | 100/s | p95 < 120 ms |
| S04 | Filter by an indexed field | read | 200/s | p95 < 90 ms |
| S05 | Authenticate (token issuance) | auth | 20/s | p95 < 1000 ms |

See [`scenarios/`](../scenarios/) for each scenario, and the worked example [S01](../scenarios/S01-content-read-by-id.md).

## Real-world profiles

Complete applications: schema plus realistic traffic, on the free engine. See [`profiles/`](../profiles/).

### Small Blog: A content blog: mostly readers, an occasional search.

- **Schema:** blog_authors (3f) · blog_categories (2f) · blog_posts (7f)
- **Seed:** 10 blog_authors, 20 blog_categories, 500 blog_posts
- **Traffic** (200 req/s, p95 < 120 ms): 45% `post-read` · 25% `post-list` · 12% `post-populated` · 10% `category-filter` · 8% `search` `[search]`
- **Result** (core, median of 3 runs, 2026-10-05): **200 req/s**, p95 2 ms (2 to 2), p99 2.4 ms (2.4 to 2.5), 0.00% err at worst (measured)

### Community Forum: A forum: topics read constantly, and the thread under each one.

- **Schema:** forum_topics (7f)
- **Seed:** 1,200 forum_topics
- **Traffic** (200 req/s, p95 < 150 ms): 38% `topic-read` · 30% `topic-list` · 22% `thread` `[comments]` · 10% `search` `[search]`
- **Result** (core, median of 3 runs, 2026-10-05): **200 req/s**, p95 1.9 ms (1.9 to 1.9), p99 2.3 ms (2.3 to 2.3), 0.00% err at worst (measured)

### Company Profile: A corporate site: a small, stable content set read constantly.

- **Schema:** site_pages (6f) · site_team (7f) · site_openings (9f)
- **Seed:** 30 site_pages, 15 site_team, 10 site_openings
- **Traffic** (150 req/s, p95 < 100 ms): 40% `page-read` · 20% `page-by-slug` · 18% `openings-list` · 15% `team-list` · 7% `page-list`
- **Result** (core, median of 3 runs, 2026-10-05): **150 req/s**, p95 2.1 ms (2.1 to 2.1), p99 2.6 ms (2.5 to 2.6), 0.00% err at worst (measured)

### Documentation Portal: A docs site: a deep page tree, assembled by the application.

- **Schema:** docs_spaces (4f) · docs_pages (6f)
- **Seed:** 10 docs_spaces, 2,000 docs_pages
- **Traffic** (200 req/s, p95 < 140 ms): 35% `page-read` · 30% `space-tree` · 20% `page-by-slug` · 15% `search` `[search]`
- **Result** (core, median of 3 runs, 2026-10-05): **200 req/s**, p95 3.5 ms (3.5 to 3.5), p99 4.6 ms (4.6 to 4.6), 0.00% err at worst (measured)

### Events and Registration: An events site: reads against a counter the application maintains.

- **Schema:** events_events (9f) · events_registrations (5f)
- **Seed:** 300 events_events, 6,000 events_registrations
- **Traffic** (200 req/s, p95 < 140 ms): 38% `event-read` · 30% `upcoming` · 22% `registrations` · 10% `event-by-slug`
- **Result** (core, median of 3 runs, 2026-10-05): **200 req/s**, p95 2 ms (2 to 2), p99 2.4 ms (2.4 to 2.5), 0.00% err at worst (measured)

### Job Board: A job board: search-led browsing over a mid-sized listing set.

- **Schema:** jobs_companies (4f) · jobs_listings (9f) · jobs_applications (7f)
- **Seed:** 200 jobs_companies, 3,000 jobs_listings
- **Traffic** (200 req/s, p95 < 150 ms): 30% `listing-read` · 26% `search` `[search]` · 16% `listing-populated` · 16% `company-filter` · 12% `listing-index`
- **Result** (core, median of 3 runs, 2026-10-05): **200 req/s**, p95 2 ms (2 to 2), p99 2.5 ms (2.5 to 2.6), 0.00% err at worst (measured)

### Course Platform: A course platform: three levels of nesting per page load.

- **Schema:** lms_courses (6f) · lms_enrollments (6f) · lms_modules (4f) · lms_lessons (6f)
- **Seed:** 120 lms_courses, 600 lms_modules, 4,000 lms_lessons
- **Traffic** (180 req/s, p95 < 160 ms): 32% `lesson-read` · 24% `course-modules` · 22% `module-lessons` · 14% `course-read` · 8% `catalog`
- **Result** (core, median of 3 runs, 2026-10-05): **180 req/s**, p95 1.9 ms (1.9 to 1.9), p99 2.3 ms (2.3 to 2.4), 0.00% err at worst (measured)

### Small Marketplace: A multi-seller catalog: browse-heavy, with search and reviews.

- **Schema:** shop_categories (2f) · shop_sellers (4f) · shop_products (8f) · shop_reviews (5f)
- **Seed:** 100 shop_sellers, 50 shop_categories, 2,000 shop_products, 5,000 shop_reviews
- **Traffic** (250 req/s, p95 < 150 ms): 30% `product-read` · 24% `product-browse` · 14% `product-populated` · 14% `category-filter` · 10% `review-list` · 8% `search` `[search]`
- **Result** (core, median of 3 runs, 2026-10-05): **250 req/s**, p95 1.9 ms (1.9 to 1.9), p99 2.4 ms (2.4 to 2.5), 0.00% err at worst (measured)

### Multi-language Site: A translated site: every page load resolves a locale.

- **Schema:** i18n_sections (3f) · i18n_pages (6f)
- **Seed:** 12 i18n_sections, 800 i18n_pages
- **Traffic** (180 req/s, p95 < 140 ms): 34% `page-read` · 30% `resolve` `[localization]` · 20% `page-by-slug` · 16% `section-pages`
- **Result** (core, median of 3 runs, 2026-10-05): **180 req/s**, p95 1.9 ms (1.9 to 2), p99 2.4 ms (2.4 to 2.4), 0.00% err at worst (measured)

### Editorial Newsroom: An editorial desk: a public front page over a draft-heavy store.

- **Schema:** news_desks (2f) · news_reporters (4f) · news_stories (8f)
- **Seed:** 8 news_desks, 25 news_reporters, 1,500 news_stories
- **Traffic** (180 req/s, p95 < 140 ms): 34% `story-read` · 26% `front-page` · 16% `story-populated` · 14% `desk-filter` · 10% `revisions`
- **Result** (core, median of 3 runs, 2026-10-05): **180 req/s**, p95 2 ms (2 to 2), p99 2.5 ms (2.5 to 2.5), 0.00% err at worst (measured)

## Reproduce

```bash
make doctor
make run TARGET=lyeve SCENARIO=S01
make sweep      # every self-hostable target
make report     # regenerate this file
```

*Disagree with a number? Re-run it and open an issue with your host spec and raw k6 output.*
