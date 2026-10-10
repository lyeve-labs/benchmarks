# Errata

Corrections to numbers this repository has published. Recorded 2026-09-04.
The re-measurement of 2026-09-25 is in section 9 and LyEve's of 2026-09-26 in
section 10.

Status on 2026-09-26: every entry below is closed. Entry 1 was re-measured with
a run that proves the filter applies, and the figures entry 9 lists replace the
ones published on 2026-07-23.

One rule governs this repo: we never publish a number we did not measure. That
held. What follows is a different failure: numbers that were measured, but not
of the thing they were labeled as.

## 1. The filter figures measured an unfiltered list

The harness drove the engine with `filter=category:{slug}`. The engine has no
such parameter. Its filter syntax is `filters[column]=value`, and an unknown
query parameter is ignored silently, so the request returned the whole page and
answered 200.

Measured against a live engine on 2026-09-03, on a type holding 3 rows:

| Request | Rows returned |
|---|---|
| `?filter=category:nonexistent&limit=25` | 3 |
| `?limit=25` (control) | 3 |
| `?filters[slug]=<a real slug>&limit=25` | 1 |

And after the fix, on a seeded 500-post set:

| Request | Rows returned |
|---|---|
| `?filter=slug:<a real slug>&limit=25` | 25, unfiltered |
| `?filters[slug]=<a real slug>&limit=25` | 1 |
| `?filters[category_id]=<a category id>&limit=200` | 30 of 500 |

**Affected:** scenario **S04** (`content-filter-query`) for the `lyeve` target,
and the `category-filter` traffic entry in all three application profiles. The
published S04 figure describes an unindexed-path list of 25 rows, not a filtered
query. It needs re-measuring before the next publish.

**Not affected by this entry:** S01 (read by id), S03 (create) and S05
(login). Entry 9 found separate faults in the static metrics.

**Closed 2026-09-25.** S04 was re-measured on all four targets. Every run now
asks, before measuring, for a value no record holds and for one real value, and
stops if the first returns rows or the second returns a row that does not hold
the value. LyEve returned 0 rows for the missing value and 25 matching rows for
the real one in every run. The filter figure for LyEve is 4.0 ms at p99, where
the unfiltered list had read 4.6 ms. The profile category entries were re-run
with the rest of each profile.

## 2. S02 requested an ordering the engine does not offer

The S02 path carried `sort=-created_at`. The engine has no sort parameter and
always returns rows newest-first, so the parameter was accepted and ignored. The
figure is a valid measurement of "first page of 50", which is what S02 claims to
test, so the number stands. The path has been corrected so it no longer implies
a capability that does not exist.

## 3. The profile search traffic hit a route that does not exist

Profiles drove `GET /api/v1/search`. There is no public search route. Search is
`GET /api/admin/search` on the admin listener. The entry answered 404 for every
request it made.

## 4. The profile slug pools were always empty

`harness/k6/profile.js` collected slugs from `item.slug`. A list response is a
bare JSON array whose user fields sit under `data`, so the slug is at
`item.data.slug` and the pool was empty on every run. The driver skips an entry
it cannot resolve, so every `{slug}` entry was silently dropped and the run
still reported pass. Confirmed live: `item.slug` is absent, `item.data.slug`
holds the slug.

## 5. The profile seeder wrote content search can never see

`seed-profile.mjs` wrote through `POST /api/v1/content/{schema}`, which reaches
the generated table only. Nothing records those rows in the content store that
search reads, so the search traffic would have measured an empty index even had
it targeted the right route. It now writes through `POST /api/admin/content`.

Measured after the fix: seeding the company profile through the admin route and
then searching it returns `total: 30`. The same content written through the
public route returns `total: 0`, permanently and without an error.

## 6. The compose stack could never report healthy

`harness/compose/lyeve.yml` probed `/api/v1/health`, which requires a bearer
token and answers 401. The public probe is `/readyz`. The file also set
`LISTEN_ADDR`, which the engine does not read. The run worked only because the
default matches. Both corrected.

Separately, anonymous pulls of `ghcr.io/lyeve-labs/lyeve-core:latest` answer 403
(control: `ghcr.io/actions/actions-runner:latest` answers 200), so a reader
outside the publishing organization cannot run the compose file as written.

## 7. The seeder could not create a type with a required slug

Found when the profiles started being generated from the engine rather than
written by hand. The generated profiles carry the `required` flag the schema
actually has, and the examples mark `slug` required.

`createRow` passed `slug` as a top-level argument and injected only `title` into
the body. The admin content route validates `body` against the schema
separately, so every create of a type with a required slug answered 422 naming a
field the caller had in fact supplied. Both are now injected.

Nothing published was affected: the hand-written profiles never marked slug
required, so the case could not arise before.

## 8. A sweep cannot finish on the default login limit

Each seed and each driver authenticates once. The rate-limit plugin seeds a rule
of five logins per fifteen minutes per address, and the core
`PUBLIC_RATE_LIMITS` setting does not reach it, so a sweep across ten profiles
runs out partway through. The drivers refuse to measure 401s and fail loudly
rather than recording them, which is right, but it means a sweep has to relax
the rule first. `run.sh --doctor` now says so, and the procedure is in a comment
beside the check.

Reproduced: `login failed (429)` from the driver's setup after several seeds and
runs against one stack.

## What was done

All of the above is fixed in the harness. The
corrected harness was then run end to end against a throwaway engine and
database to prove it drives what it claims:

- company profile: 105 rows seeded, 3001 iterations at 150/s over 20s, all six
  traffic entries exercised, 0 failures.
- blog profile: 2530 rows seeded including two relations, 6001 iterations at
  200/s over 30s, all six entries exercised including search and a write, 0
  failures.

Two of the generated profiles were then run the same way, to prove the
generation and not just the corrections:

- courses profile: 4,720 rows across a three-level relation chain, 3600 checks
  at 180/s over 20s, all five entries exercised, 0 failures, p95 7.5ms.
- docs profile: 2,010 rows, 4000 checks at 200/s over 20s, all four entries
  exercised, 0 failures, p95 40.9ms. The gap between the two is the point of
  having both: the docs tree entry reads 200 rows per request because the engine
  has no tree query, and it costs about five times a single-record read.

**Those two runs are validation of the harness, not benchmark results.** They
ran on a development machine against a throwaway database for twenty and thirty
seconds. They are not comparable with anything in `RESULTS.md` and are recorded
here only as evidence that the corrected paths resolve and return data.

No published number in `results.json` or `RESULTS.md` was changed at the time.
They were replaced on 2026-09-25. See entry 9.

## 9. Re-measured on 2026-09-25

Every figure was measured again against an engine built from source at
lyeve-core `a39e106` with the plugin set of that date, and every competitor
was run again on the same machine. `results/rig.json` records the machine, the
build and the method. Each figure is now the median of four clean runs per
competitor and three for LyEve, each on a fresh stack. Runs the machine's
other work disturbed are kept under `results/raw/excluded/` with the rule and
the reason.

Five things were wrong with the published figures, beyond entry 1.

**Image size.** The report said 50 MB for LyEve. Its own note called that the
free engine image of 2026-07-18. The image that ships today compiles every
plugin in. The binary is 97,329,312 bytes and the image unpacks to 103 MB. The
method was also wrong for every target: the `docker images` SIZE column counts
the compressed blobs as well as the unpacked layers on the containerd image
store, which is why it reads 137 MB for this image. The harness now sums the
layers from `docker history`, and the competitor images were re-measured the
same way.

**Idle memory.** The report said 5 MB for LyEve. That could not be reproduced:
the engine at rest reads 28 MB, the same in every run. The figure is replaced.

**Cold start.** The report said 1,021 ms for LyEve. It was timed as a restart,
which counts the shutdown, against `/readyz`, which answers before the engine
serves a request. It is now timed from `docker start` to the first 200 from
`/api/admin/setup`, which answers 503 until the engine serves, polled every
50 ms: 2,864 ms. On this measure LyEve starts slower than Strapi (1,807 ms) and
Payload (2,602 ms), and the report says so.

**Login.** The report said 61.6 ms for LyEve. The free tier now allows five
logins per fifteen minutes per address and only a license changes that, so a
burst of logins is refused with 429. The cell reads pending, the rule that
already applied to Strapi.

**The compose stack could not run the current engine.** It pointed
`MIGRATIONS_PATH` at a directory the image no longer ships and lacked settings
production mode requires, and the Strapi app could not boot from a fresh clone.
Both are fixed, so every figure here comes from a stack a reader can bring up
from this repository.

| Metric | LyEve, 2026-07-23 | LyEve, 2026-09-25 |
|---|---:|---:|
| Image size | 50 MB | 103 MB |
| Idle memory | 5 MB | 28 MB |
| p99 read-by-id | 1.4 ms | 2.5 ms |
| p99 list-50 | 9.1 ms | 5.3 ms |
| p99 create | 4.4 ms | 4.7 ms |
| p99 filter | 4.6 ms, unfiltered | 4.0 ms |
| p99 login | 61.6 ms | pending |
| Cold start | 1,021 ms | 2,864 ms |

The engine micro-benchmarks were re-run at the same commit, five times each.
Several are slower than the figures of 2026-05-31 (JWT sign 5.1 µs against
3.2 µs, the MySQL placeholder rewrite 247 ns against 133 ns). The new figures
replace them.

## 10. LyEve re-measured on 2026-09-26, after a change to how it starts

Entry 9 reported that LyEve started slower than Strapi and Payload. Part of
that figure measured this harness rather than the engine. LyEve answered 503
until its startup probe had run once, and it ran that probe only when a
caller asked for `/startup` or `/readyz`. In this rig the only caller was the
proxy's healthcheck, every 3 s, so the 2,864 ms included waiting for the next
healthcheck. Without any caller the engine served 503 for five seconds.

lyeve-core `1ff134a` runs the probe itself as soon as it listens, derives its
master encryption key once instead of once per plugin, and a plugin stopped
retrying a Redis address nobody had deployed. LyEve's head-to-head column was
measured again on the same machine with an image built from that commit and
the plugins' development heads of the same day: three clean runs, their
median, and the two runs other work disturbed kept under
`results/raw/excluded/`. The competitors' figures are those of 2026-09-25,
from the same machine.

| Metric | LyEve, 2026-09-25 | LyEve, 2026-09-26 |
|---:|---:|---:|
| Cold start | 2,864 ms | 311 ms |
| Image size | 103 MB | 104 MB |
| Idle memory | 28 MB | 26 MB |
| p99 read-by-id | 2.5 ms | 3.0 ms |
| p99 list-50 | 5.3 ms | 5.3 ms |
| p99 create | 4.7 ms | 5.0 ms |
| p99 filter | 4.0 ms | 4.1 ms |

Only the cold start changed materially. The other medians moved by amounts
the old and new ranges overlap: idle memory 28 to 26 MB, read-by-id 2.5 to
3.0 ms (one run reached 7.4 ms at p99), create 4.7 to 5.0 ms, filter 4.0 to
4.1 ms, which turns a 1.1x filter lead over Payload (4.2 ms) into on par. The
image is 327,680 bytes larger, which crosses a rounding boundary. The
application profiles and the micro-benchmarks were not re-run. They stay at
`a39e106`.

The load average (one, five and fifteen minutes) at each run's start and end,
which the harness does not write into the run directories:

| Run | Start | End | Kept |
|---|---|---|---|
| 20260926-144455 | 0.49 0.97 2.85 | 45.12 22.00 10.56 | no |
| 20260926-145708 | 1.43 10.84 9.03 | 1.41 4.57 6.90 | yes |
| 20260926-150442 | 1.41 4.57 6.90 | 1.44 2.46 5.03 | yes |
| 20260926-151307 | 1.66 2.39 4.86 | 16.44 13.90 8.72 | no |
| 20260926-153509 | 0.63 5.76 7.84 | 0.40 1.94 5.18 | yes |

The binary size is the file size of the built `lyeve` (97,607,840 bytes). The
compressed image size is the `docker images` figure less the layer sum, the
method of section 9.

## 11. LyEve re-measured on 2026-09-27, after changes to its request path and image

Three engine changes landed after section 10. A plugin that records requests
had redacted and stored each one on the request itself, which put its cost
inside every latency figure. It now stores them in the background. The
storage drivers talk to S3, Google Cloud Storage and Azure over their HTTP
APIs instead of through the vendors' SDKs, which removed about 19 MB from
the binary. The last key derivation at start runs while the database
connects.

The column was measured again from an image built at lyeve-core `271cd9e`
with the plugins' development heads of the same day: four runs, the first
set aside under `results/raw/excluded/` (load 7.35 at its end), and the
median of the other three, which started and ended at a load between 0.7
and 1.7. The competitors' figures are those of 2026-09-25 on the same
machine.

| Metric | LyEve, 2026-09-26 | LyEve, 2026-09-27 |
|---:|---:|---:|
| Image size | 104 MB | 85 MB |
| Idle memory | 26 MB | 24 MB |
| p99 read-by-id | 3.0 ms | 1.9 ms |
| p99 list-50 | 5.3 ms | 2.7 ms |
| p99 create | 5.0 ms | 4.0 ms |
| p99 filter | 4.1 ms | 2.4 ms |
| Cold start | 311 ms | 266 ms |

The filter lead over Payload (4.2 ms) goes from on par to 1.8 times. One
read-by-id run reached 5.6 ms at p99 and one filter run 4.7 ms, which the
ranges show. The medians are the figures. The binary is 78,721,184 bytes,
the image unpacks to 84,848,640 bytes and its compressed layers are 28.9
MB. The application profiles and the micro-benchmarks were not re-run.

The load at each run's start and end:

| Run | Start | End | Kept |
|---|---|---|---|
| 20260927-034624 | 2.08 4.14 5.23 | 7.35 4.47 4.78 | no |
| 20260927-053805 | 1.16 1.51 2.47 | 1.74 1.63 2.13 | yes |
| 20260927-055520 | 1.07 1.60 1.88 | 1.14 2.24 2.21 | yes |
| 20260927-060333 | 0.72 1.97 2.12 | 1.25 1.67 1.94 | yes |

## 12. Every target re-measured on 2026-10-05, on the published v0.51.2 image

Until now the LyEve column was measured on an image built from a source
checkout. This sweep pulled the published `ghcr.io/lyeve-labs/lyeve-core:0.51.2`
image (revision `da80fdd`) and ran it as shipped, so the figures describe the
bytes a reader can pull. `targets.json` and the compose file now name that tag
instead of `latest`.

v0.51.2 refuses to boot on a secret that reads as a placeholder, and the
compose file's `JWT_SECRET` contained "change-me". The secret was renamed. No
other part of the harness changed.

All four targets ran again the same evening, four interleaved repetitions each
on a fresh stack, so the head-to-head compares runs from one sitting:

| Metric | LyEve, 2026-09-27 | LyEve, 2026-10-05 | Strongest competitor, 2026-10-05 |
|---:|---:|---:|---:|
| Image size | 85 MB | 78 MB | 970 MB (Directus) |
| Idle memory | 24 MB | 26.5 MB | 100.5 MB (Strapi) |
| p99 read-by-id | 1.9 ms | 1.8 ms | 9.7 ms (Payload) |
| p99 list-50 | 2.7 ms | 2.9 ms | 8.6 ms (Payload) |
| p99 create | 4.0 ms | 6.7 ms | 7.8 ms (Payload) |
| p99 filter | 2.4 ms | 2.4 ms | 5.5 ms (Payload) |
| Cold start | 266 ms | 488 ms | 2,212.5 ms (Strapi) |

Create and cold start moved for every target, not for LyEve alone. Payload's
create went from 5.5 to 7.8 ms and Directus's from 7.8 to 12.2. Every
competitor's cold start rose as well. LyEve's create lead narrows from 1.4 to
1.2 times and its cold-start lead from 6.8 to 4.5 times. Its cold-start runs
spread from 329 to 751 ms, which the range shows. LyEve still leads the
strongest competitor on every published metric.

The binary is 72,589,472 bytes, the image unpacks to 78,323,712 bytes and its
compressed amd64 layers are 27.6 MB.

The application profiles ran three times each on the same image. Every profile
is faster than on 2026-09-25: p99 fell from 3.5 to 8.8 ms to between 2.3 and
4.6 ms at the same offered rates, the docs profile most (8.8 to 4.6 ms).

The micro-benchmarks ran at the v0.51.2 source, five runs each. Every row is
within 12 percent of 2026-09-25, under the 20 percent regression gate. JWT
verify, both placeholder rewrites and the rate limiter are 9 to 11 percent
slower. Ed25519 sign and verify are 4 and 6 percent faster.

The load at each head-to-head run's start and end (one-minute average). The
profile runs stayed at or below 3.18.

| Run | Target | Start | End | Kept |
|---|---|---|---|---|
| 20261005-190230 | lyeve | 1.75 | 1.72 | yes |
| 20261005-191007 | directus | 1.72 | 2.29 | no, an unrelated build ran during it |
| 20261005-191751 | strapi | 2.29 | 1.47 | yes |
| 20261005-192531 | payload | 1.47 | 1.25 | yes |
| 20261005-193257 | lyeve | 1.25 | 0.79 | yes |
| 20261005-194028 | directus | 0.79 | 2.42 | yes |
| 20261005-194809 | strapi | 2.42 | 1.34 | yes |
| 20261005-195545 | payload | 1.34 | 1.22 | yes |
| 20261005-200307 | lyeve | 1.22 | 0.77 | yes |
| 20261005-201047 | directus | 0.77 | 2.18 | yes |
| 20261005-201827 | strapi | 2.18 | 1.46 | yes |
| 20261005-202603 | payload | 1.46 | 1.50 | yes |
| 20261005-203326 | lyeve | 1.50 | 0.75 | yes |
| 20261005-204103 | directus | 0.75 | 2.12 | yes |
| 20261005-204844 | strapi | 2.11 | 1.44 | yes |
| 20261005-205621 | payload | 1.44 | 1.15 | yes |

## 13. The LyEve stack started two plugins short of the free baseline

The LyEve stack ran the engine in its production mode with no
`LYEVE_CONSOLE_URL`. In that mode the password reset and magic-link plugins
refuse to start without the console's public URL. The section 12 sweep ran
v0.51.2, whose two plugins already refused, so its LyEve figures were measured
with 49 of the 51 plugins the image carries running, two short of the free
baseline the report describes. The engine logged both refusals at boot. The
earlier sweeps were not checked for it.

The stack now sets a console URL, and the published 0.52.2 image boots with no
plugin refusing to start. The figures above stand as they were measured. The
next sweep is the first on the whole baseline, and its section says so.
