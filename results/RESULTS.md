# LyEve Benchmark Results

> Generated 2026-10-20 from the [benchmark harness](../README.md). Every value is tagged with its provenance. We never publish a number we did not measure ([methodology §1](../METHODOLOGY.md#1-the-one-rule)).

**Rig:** Intel Core Ultra 5 125H (18 threads), 32 GB RAM, NVMe, Ubuntu 26.04, Docker 29.8 · PostgreSQL 16, one container per target on the same host

Every figure in the head-to-head, the static metrics and the S01 to S05 latencies alike, was measured on this one rig, each target and its own PostgreSQL side by side, so the A/B is valid. The load generator runs on the same machine. No figure here comes from the Hetzner reference host. The sustained-throughput rows stay targets until that sweep runs.

## How this run was made

| | |
|---|---|
| Date | 2026-10-20 (every target, the application profiles and the micro-benchmarks) |
| Machine | Intel Core Ultra 5 125H (18 threads), 32 GB RAM, NVMe, Ubuntu 26.04, Linux 7.0 |
| Container runtime | Docker 29.9 (containerd image store), Compose v2 |
| Load generator | k6 2.3.0 on the same machine, constant arrival rate |
| LyEve engine | the published v0.55.0 image as it ships, with all 51 plugins compiled in, pulled rather than built. No license: the free baseline starts. Micro-benchmarks from the engine source at the same tag |
| Directus | 11.17.4, official image directus/directus:11 |
| Strapi | 5.6.0, built from the committed app on node:20-alpine |
| Payload | 3.11.0 on Next.js 15.1.0, built from the committed app on node:24-alpine |
| Repetitions | Every target on 2026-10-20: four repetitions, interleaved (lyeve, strapi, directus, payload, then again), each on a fresh stack. Every kept run started and ended below load 4. Each application profile ran three times. |

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
| Container image size | 83 MB (measured)<br><sub>83 to 83, n=4</sub> | 1,884 MB (measured)<br><sub>1,884 to 1,884, n=4</sub> | 970 MB (measured)<br><sub>970 to 970, n=4</sub> | 1,994 MB (measured)<br><sub>1,994 to 1,994, n=4</sub> | 11.7× better |
| Idle memory | 27.5 MB (measured)<br><sub>27 to 29, n=4</sub> | 98 MB (measured)<br><sub>98 to 98, n=4</sub> | 212.5 MB (measured)<br><sub>212 to 213, n=4</sub> | 103 MB (measured)<br><sub>102 to 103, n=4</sub> | 3.6× better |
| p99 read-by-id | 1.8 ms (measured)<br><sub>1.8 to 1.9, n=4</sub> | 719.2 ms (measured)<br><sub>698.2 to 755.7, n=4</sub><br><sub>served 306 of 500 req/s</sub> | 67.6 ms (measured)<br><sub>33.1 to 88.2, n=4</sub> | 8 ms (measured)<br><sub>6.8 to 10.9, n=4</sub> | 4.4× better |
| p99 list-50 | 2.8 ms (measured)<br><sub>2.8 to 2.9, n=4</sub> | 1,615.8 ms (measured)<br><sub>1,546.6 to 1,769.6, n=4</sub><br><sub>served 131 of 300 req/s</sub> | 12.5 ms (measured)<br><sub>11.4 to 17.7, n=4</sub> | 9.4 ms (measured)<br><sub>8.1 to 16.2, n=4</sub> | 3.4× better |
| p99 create | 7.6 ms (measured)<br><sub>6.2 to 8.4, n=4</sub> | 18.4 ms (measured)<br><sub>17.9 to 29.1, n=4</sub> | 11 ms (measured)<br><sub>9.5 to 12.9, n=4</sub> | 7.8 ms (measured)<br><sub>7.6 to 8.6, n=4</sub> | on par |
| p99 filter | 2.5 ms (measured)<br><sub>2.5 to 2.5, n=4</sub> | 1,479.9 ms (measured)<br><sub>1,363.7 to 2,412, n=4</sub><br><sub>served 149 of 200 req/s</sub> | 5.9 ms (measured)<br><sub>5.7 to 6.3, n=4</sub> | 6 ms (measured)<br><sub>5.9 to 6, n=4</sub> | 2.4× better |
| p99 login | _pending_ | _pending_ | 505.6 ms (measured)<br><sub>505.5 to 505.8, n=4</sub> | 63 ms (measured)<br><sub>61.8 to 65, n=4</sub> | n/a |
| Cold start | 335 ms (measured)<br><sub>323 to 345, n=4</sub> | 2,377.5 ms (measured)<br><sub>1,699 to 2,795, n=4</sub> | 5,027.5 ms (measured)<br><sub>4,987 to 5,135, n=4</sub> | 2,721 ms (measured)<br><sub>2,636 to 2,843, n=4</sub> | 7.1× better |

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

_core bench suite (go test -bench -benchmem -count=5, median), commit 27d8c49 (v0.55.0); Intel Core Ultra 5 125H (18 threads), Go 1.27.2, 2026-10-20._

**Auth / crypto**

| Operation | Cost |
|---|---|
| JWT sign (HMAC) | `5.5 µs` |
| JWT verify (parse) | `6.1 µs` |
| Ed25519 sign | `15.9 µs` |
| Ed25519 verify | `36.4 µs` |
| Password hash (bcrypt, cost 10) | `48 ms` |
| Password hash (argon2id) | `17 ms` |

**Database (placeholder rewrite hot path)**

| Operation | Cost |
|---|---|
| PostgreSQL passthrough | `2.1 ns` |
| MySQL rewrite ($N → ?) | `258 ns` |
| MSSQL rewrite ($N → @pN) | `236 ns` |

**Middleware**

| Operation | Cost |
|---|---|
| Full stack (4 middlewares) | `4.9 µs` |
| Tenant header (no-op) | `508 ns` |
| Rate limiter (allow) | `2.2 µs` |

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
- **Result** (core, median of 3 runs, 2026-10-20): **200 req/s**, p95 2 ms (2 to 2.1), p99 2.5 ms (2.5 to 2.6), 0.00% err at worst (measured). Without a license, the 8% of the mix that needs search is left out and the rest runs at the full rate.

### Community Forum: A forum: topics read constantly, and the thread under each one.

- **Schema:** comments (7f) · forum_topics (7f)
- **Seed:** 1,200 forum_topics, 2,400 comments
- **Traffic** (200 req/s, p95 < 150 ms): 38% `topic-read` · 30% `topic-list` · 22% `thread` `[schema]` · 10% `search` `[search]`
- **Result** (core, median of 3 runs, 2026-10-20): **200 req/s**, p95 2 ms (1.9 to 2), p99 2.5 ms (2.4 to 2.5), 0.00% err at worst (measured). Without a license, the 10% of the mix that needs search is left out and the rest runs at the full rate.

### Company Profile: A corporate site: a small, stable content set read constantly.

- **Schema:** site_pages (6f) · site_team (7f) · site_openings (9f)
- **Seed:** 30 site_pages, 15 site_team, 10 site_openings
- **Traffic** (150 req/s, p95 < 100 ms): 40% `page-read` · 20% `page-by-slug` · 18% `openings-list` · 15% `team-list` · 7% `page-list`
- **Result** (core, median of 3 runs, 2026-10-20): **150 req/s**, p95 2.2 ms (2.1 to 2.2), p99 2.8 ms (2.7 to 2.9), 0.00% err at worst (measured)

### Documentation Portal: A docs site: a deep page tree, assembled by the application.

- **Schema:** docs_spaces (4f) · docs_pages (6f)
- **Seed:** 10 docs_spaces, 2,000 docs_pages
- **Traffic** (200 req/s, p95 < 140 ms): 35% `page-read` · 30% `space-tree` · 20% `page-by-slug` · 15% `search` `[search]`
- **Result** (core, median of 3 runs, 2026-10-20): **200 req/s**, p95 3.5 ms (3.5 to 3.5), p99 4.4 ms (4.4 to 4.5), 0.00% err at worst (measured). Without a license, the 15% of the mix that needs search is left out and the rest runs at the full rate.

### Events and Registration: An events site: reads against a counter the application maintains.

- **Schema:** events_events (9f) · events_registrations (5f)
- **Seed:** 300 events_events, 6,000 events_registrations
- **Traffic** (200 req/s, p95 < 140 ms): 38% `event-read` · 30% `upcoming` · 22% `registrations` · 10% `event-by-slug`
- **Result** (core, median of 3 runs, 2026-10-20): **200 req/s**, p95 2.1 ms (2 to 2.1), p99 2.5 ms (2.5 to 2.5), 0.00% err at worst (measured)

### Job Board: A job board: search-led browsing over a mid-sized listing set.

- **Schema:** jobs_companies (4f) · jobs_listings (9f) · jobs_applications (7f)
- **Seed:** 200 jobs_companies, 3,000 jobs_listings
- **Traffic** (200 req/s, p95 < 150 ms): 30% `listing-read` · 26% `search` `[search]` · 16% `listing-populated` · 16% `company-filter` · 12% `listing-index`
- **Result** (core, median of 3 runs, 2026-10-20): **200 req/s**, p95 2.1 ms (2 to 2.2), p99 2.6 ms (2.4 to 2.7), 0.00% err at worst (measured). Without a license, the 26% of the mix that needs search is left out and the rest runs at the full rate.

### Course Platform: A course platform: three levels of nesting per page load.

- **Schema:** lms_courses (6f) · lms_enrollments (6f) · lms_modules (4f) · lms_lessons (6f)
- **Seed:** 120 lms_courses, 600 lms_modules, 4,000 lms_lessons
- **Traffic** (180 req/s, p95 < 160 ms): 32% `lesson-read` · 24% `course-modules` · 22% `module-lessons` · 14% `course-read` · 8% `catalog`
- **Result** (core, median of 3 runs, 2026-10-20): **180 req/s**, p95 2 ms (1.9 to 2), p99 2.4 ms (2.3 to 2.5), 0.00% err at worst (measured)

### Small Marketplace: A multi-seller catalog: browse-heavy, with search and reviews.

- **Schema:** shop_categories (2f) · shop_sellers (4f) · shop_products (8f) · shop_reviews (5f)
- **Seed:** 100 shop_sellers, 50 shop_categories, 2,000 shop_products, 5,000 shop_reviews
- **Traffic** (250 req/s, p95 < 150 ms): 30% `product-read` · 24% `product-browse` · 14% `product-populated` · 14% `category-filter` · 10% `review-list` · 8% `search` `[search]`
- **Result** (core, median of 3 runs, 2026-10-20): **250 req/s**, p95 1.9 ms (1.9 to 2), p99 2.3 ms (2.3 to 2.5), 0.00% err at worst (measured). Without a license, the 8% of the mix that needs search is left out and the rest runs at the full rate.

### Multi-language Site: A translated site: every page load resolves a locale.

- **Schema:** i18n_sections (3f) · i18n_pages (6f)
- **Seed:** 12 i18n_sections, 800 i18n_pages
- **Traffic** (180 req/s, p95 < 140 ms): 34% `page-read` · 30% `resolve` `[localization]` · 20% `page-by-slug` · 16% `section-pages`
- **Result** (core, median of 3 runs, 2026-10-20): **180 req/s**, p95 2 ms (2 to 2.1), p99 2.5 ms (2.4 to 2.5), 0.00% err at worst (measured)

### Editorial Newsroom: An editorial desk: a public front page over a draft-heavy store.

- **Schema:** news_desks (2f) · news_reporters (4f) · news_stories (8f)
- **Seed:** 8 news_desks, 25 news_reporters, 1,500 news_stories
- **Traffic** (180 req/s, p95 < 140 ms): 34% `story-read` · 26% `front-page` · 16% `story-populated` · 14% `desk-filter` · 10% `revisions`
- **Result** (core, median of 3 runs, 2026-10-20): **180 req/s**, p95 2.2 ms (2.1 to 2.2), p99 2.6 ms (2.5 to 2.8), 0.00% err at worst (measured)

### GraphQL Storefront: The same catalog over GraphQL, where a page is one request.

- **Schema:** gql_collections (3f) · gql_products (7f) · gql_reviews (6f)
- **Seed:** 20 gql_collections, 1,500 gql_products, 3,000 gql_reviews
- **Traffic** (200 req/s, p95 < 150 ms): 40% `list-25` `[graphql]` · 35% `multi-root` `[graphql]` · 25% `wide-selection` `[graphql]`
- **Result:** pending

### Photo Library: A photo archive: deep albums, read constantly, written in bursts.

- **Schema:** gallery_albums (3f) · gallery_photos (7f)
- **Seed:** 40 gallery_albums, 4,000 gallery_photos
- **Traffic** (180 req/s, p95 < 120 ms): 34% `photo-read` · 28% `album-photos` · 20% `photo-populated` · 18% `album-list`
- **Result** (core, median of 3 runs, 2026-10-20): **180 req/s**, p95 2.5 ms (2.4 to 2.5), p99 3.3 ms (3.1 to 3.3), 0.00% err at worst (measured)

### Search-Heavy Knowledge Base: A support knowledge base where almost every request is a search.

- **Schema:** kb_categories (2f) · kb_articles (6f)
- **Seed:** 20 kb_categories, 5,000 kb_articles
- **Traffic** (120 req/s, p95 < 220 ms): 30% `search-term` `[search]` · 15% `search-highlight` `[search]` · 12% `instant` `[search]` · 10% `search-facets` `[search]` · 8% `search-paged` `[search]` · 5% `search-browse` `[search]` · 8% `article-read` · 7% `article-by-slug` · 5% `category-filter`
- **Result** (core, median of 3 runs, 2026-10-20): **120 req/s**, p95 2.5 ms (2.3 to 2.6), p99 3.2 ms (2.9 to 3.3), 0.00% err at worst (measured). Without a license, the 80% of the mix that needs search is left out and the rest runs at the full rate.

### Appointment Booking: A clinic's booking site: every page reads a practitioner's whole diary.

- **Schema:** booking_practitioners (5f) · booking_slots (6f) · booking_appointments (6f)
- **Seed:** 30 booking_practitioners, 4,000 booking_slots, 2,500 booking_appointments
- **Traffic** (200 req/s, p95 < 160 ms): 18% `practitioner-list` · 18% `diary` · 18% `practitioner-by-slug` · 18% `practitioner-diary` · 13% `slot-by-slug` · 12% `practitioner-read` · 3% `confirmation`
- **Result** (core, median of 3 runs, 2026-10-20): **200 req/s**, p95 2.9 ms (2.9 to 3), p99 3.8 ms (3.7 to 3.8), 0.00% err at worst (measured)

### Support Helpdesk: A support desk whose inbox reads every ticket and every reply on each view.

- **Schema:** desk_tickets (8f) · desk_replies (6f)
- **Seed:** 1,000 desk_tickets, 3,000 desk_replies
- **Traffic** (150 req/s, p95 < 200 ms): 4% `queue-first-page` · 14% `queue-deep-page` · 4% `reply-count-first-page` · 49% `reply-count-deep-page` · 18% `ticket-by-slug` · 11% `thread`
- **Result** (core, median of 3 runs, 2026-10-20): **150 req/s**, p95 3.7 ms (3.6 to 3.8), p99 4.8 ms (4.6 to 4.9), 0.00% err at worst (measured)

### Subscription Publication: A paywalled publication: each signed-in page view also reads the reader.

- **Schema:** sub_articles (5f) · sub_members (5f)
- **Seed:** 1,500 sub_articles, 2,000 sub_members
- **Traffic** (200 req/s, p95 < 120 ms): 42% `article-by-slug` · 28% `reader` · 24% `article-list` · 4% `entitlements` · 2% `roster`
- **Result** (core, median of 3 runs, 2026-10-20): **200 req/s**, p95 1.9 ms (1.9 to 1.9), p99 2.3 ms (2.3 to 2.4), 0.00% err at worst (measured)

### Operations Dashboard: An operations console that reads the engine's own telemetry, not content.

- **Schema:** metrics_notes (4f)
- **Seed:** 500 metrics_notes
- **Traffic** (120 req/s, p95 < 220 ms): 10% `request-summary` `[apianalytics]` · 10% `request-trend` `[apianalytics]` · 9% `collector-config` `[apianalytics]` · 5% `tenant-breakdown` `[apianalytics]` · 4% `endpoint-breakdown` `[apianalytics]` · 4% `method-breakdown` `[apianalytics]` · 4% `agent-breakdown` `[apianalytics]` · 4% `anomalies` `[apianalytics]` · 6% `content-activity` `[analytics]` · 6% `daily-rollup` `[analytics]` · 6% `providers` `[analytics]` · 7% `notes` · 3% `healthz` · 3% `readyz` · 3% `startup` · 3% `ready` · 3% `pool-health` · 3% `latency` · 3% `runtime-metrics` · 1% `tenant-usage` `[usage]` · 1% `quotas` `[usage]` · 1% `quota-status` `[usage]` · 1% `quota-requests` `[usage]`
- **Result** (core, median of 3 runs, 2026-10-20): **120 req/s**, p95 3.4 ms (3.3 to 3.5), p99 4.5 ms (4.2 to 4.6), 0.00% err at worst (measured). Without a license, the 50% of the mix that needs apianalytics is left out and the rest runs at the full rate.

## Reproduce

```bash
make doctor
make run TARGET=lyeve SCENARIO=S01
make sweep      # every self-hostable target
make report     # regenerate this file
```

*Disagree with a number? Re-run it and open an issue with your host spec and raw k6 output.*
