# Application profiles: real-world usage

Where [`scenarios/`](../scenarios/) tests one atomic behavior (read a record,
list, filter...), a **profile** is a *complete application*: its content schema,
the plugins it needs, realistic seed volumes, and a weighted traffic mix that
mirrors how the app is actually used. It answers the question a scenario can't:
**"what does a real blog / marketplace / company site do on LyEve, and how does
it hold up?"**

Machine-readable definitions live in [`profiles.json`](./profiles.json).

| Profile | What it is | Paired example | Seed |
|---|---|---|---|
| [Blog](./A1-blog.md) | Content blog | `apps/blog` | 530 rows |
| [Marketplace](./A2-marketplace.md) | Multi-seller catalog | `apps/marketplace` | 7,150 rows |
| [Company Profile](./A3-company-profile.md) | Corporate site | `apps/company-site` | 55 rows |
| Documentation Portal | A deep page tree the app assembles | `apps/docs-portal` | 2,010 rows |
| Editorial Newsroom | A public front page over a draft-heavy store | `apps/newsroom` | 1,533 rows |
| Community Forum | Topics as content, threads from a plugin | `apps/community-forum` | 1,200 rows |
| Job Board | Search-led browsing | `apps/jobs-board` | 3,200 rows |
| Course Platform | Three levels of nesting per page | `apps/lms-courses` | 4,720 rows |
| Events and Registration | Reads against an app-maintained counter | `apps/events-ticketing` | 6,300 rows |
| Multi-language Site | Every page load resolves a locale | `apps/multi-language-site` | 812 rows |

### A POST entry can carry its own body

A traffic entry with `postBody` posts that object verbatim. Without it the only
POST the driver could express was an admin content create, which left a
transport whose every request is a POST with a fixed document, GraphQL, with no
way to be driven.

### These are generated

`profiles.json` is written by `lyeve-examples/perf/export-profiles.mjs` and
committed here. Do not hand-edit it.

The schemas are not declared in this repository at all: the generator reads them
from a running, seeded engine, which is the only authority on what an example
actually provisioned. Each example declares the rest beside its own code, in
`apps/<name>/benchmark.json`: the seed volumes at benchmark scale, the arrival
rate, the thresholds and the request mix.

That arrangement exists because the previous one failed. The profiles were
written by hand next to the apps they described, drifted, and ended up driving
field names and a query syntax the engine does not have. See
[../results/ERRATA.md](../results/ERRATA.md).

This repository still runs on its own. The generated output is committed, so
nothing here needs the examples present. What is gone is the drift, not the
independence.

Each profile's content model matches the runnable example application named in
its `pairedExample` field, so a figure here describes an application you can
open, read and run rather than a synthetic shape. A schema or traffic entry
marked `benchmarkOnly` exists to exercise a path the paired example does not
implement.

## How a profile runs

```
make profile PROFILE=blog TARGET=lyeve
```

1. **Secrets:** sets what's needed (a `JWT_SECRET`, and for the plugin-active
   run a signed **dev license** granting the profile's plugin features, which
   you supply in the environment and `harness/gen-license.sh` passes to the run).
   See [SECRETS.md](./SECRETS.md).
2. **Schema:** creates the profile's content types over `POST /api/admin/schemas`.
3. **Seed:** inserts the profile's seed volumes (deterministic, fixed seed).
4. **Drive:** `harness/k6/profile.js` runs the weighted traffic mix at the
   profile's arrival rate. Reports throughput, p50/p95/p99, and error rate.

## Content core vs. plugin features

Each traffic entry declares what it `needs`:

- **`needs: null`**: pure content (CRUD / list / filter on a schema). Runs on the
  **free engine**, no license. This is the bulk of a blog or company site.
- **`needs: "<feature>"`**: depends on something beyond the content core: the
  `search` plugin, the `localization` plugin, or the schema plugin's `comments`
  preset applied before the run. These entries run only with `FULL=1`. Without
  it they are reported `pending` and their weight is renormalized, so the
  content-core result is still valid.

That split is deliberate and honest: we can measure the content core anywhere,
and we never pretend a plugin ran when the plugin wasn't there.

## Live-run status

The harness runs a profile **end-to-end for real** on the free-engine image: it
boots the engine, bootstraps the admin (`POST /api/admin/setup` with the
run's `LYEVE_SETUP_TOKEN`),
creates every schema (`POST /api/admin/schemas`, which applies the DDL), grants
the role permission on each schema (`POST /api/admin/permissions`), seeds all rows
(`POST /api/v1/content/{type}` with the `{ "data": {...} }` envelope), and drives
the k6 traffic mix. The **content-core mix is measured**, while plugin-dependent traffic
(`needs: "<feature>"`) stays `pending` until it runs with `FULL=1`.

Three API contract details the harness accounts for:

- The schema field key is `field_type` (values `text|number|boolean|json|relation|uid`).
- `/api/v1/content/*` is gated per `(role, schema)` in `sys_permissions`.
- The content write body is `{ "data": {...} }`.

Any run over the error budget is still gated to `pending` (never published).

## Why these three

They span the real shape space: **read-dominated** (blog, company) vs.
**browse+search+write** (marketplace). **Tiny dataset** (company) vs. **thousands
of rows** (marketplace). **Cache-friendly** (company) vs. **long-tail reads**
(blog/marketplace). If LyEve is comfortable across all three on a $5 box, it's
comfortable for most small-to-mid sites.
