# Application profiles: real-world usage

Where [`scenarios/`](../scenarios/) tests one atomic behavior (read a record,
list, filter...), a **profile** is a *complete application*: its content schema,
the plugins it needs, realistic seed volumes, and a weighted traffic mix that
mirrors how the app is actually used. It answers the question a scenario can't:
**"what does a real blog / marketplace / company site do on LyEve, and how does
it hold up?"**

Machine-readable definitions live in [`profiles.json`](./profiles.json).

| Profile | What it is | Paired example | Seed | Paid traffic |
|---|---|---|---|---|
| [Blog](./A1-blog.md) | Content blog | `apps/blog` | 530 rows | search |
| [Marketplace](./A2-marketplace.md) | Multi-seller catalog | `apps/marketplace` | 7,150 rows | search |
| [Company Profile](./A3-company-profile.md) | Corporate site | `apps/company-site` | 55 rows | none |
| Documentation Portal | A deep page tree the app assembles | `apps/docs-portal` | 2,010 rows | search |
| Editorial Newsroom | A public front page over a draft-heavy store | `apps/newsroom` | 1,533 rows | none |
| Community Forum | Topics as content, threads from the comments preset | `apps/community-forum` | 3,600 rows | search |
| Job Board | Search-led browsing | `apps/jobs-board` | 3,200 rows | search |
| Course Platform | Three levels of nesting per page | `apps/lms-courses` | 4,720 rows | none |
| Events and Registration | Reads against an app-maintained counter | `apps/events-ticketing` | 6,300 rows | none |
| Multi-language Site | Every page load resolves a locale | `apps/multi-language-site` | 812 rows | none |
| GraphQL Storefront | The same catalog over GraphQL, one request per page | `apps/graphql-storefront` | 4,520 rows | graphql, every entry |
| Photo Library | Deep albums, read constantly | `apps/media-library` | 4,040 rows | none |
| Search-Heavy Knowledge Base | Almost every request is a search | `apps/search-console` | 5,020 rows | search |
| Appointment Booking | Every page reads a practitioner's whole diary | `apps/booking` | 6,530 rows | none |
| Support Helpdesk | The inbox reads every ticket and reply per view | `apps/helpdesk` | 4,000 rows | none |
| Subscription Publication | Each signed-in page also reads the reader | `apps/subscription-gating` | 3,500 rows | none |
| Operations Dashboard | The engine's own telemetry, not content | `apps/analytics-dashboard` | 500 rows | apianalytics |

"Paid traffic" names the plugins a license has to grant for the full mix. A
profile with none runs whole on the free engine, and so does every unpaid entry
of the others. The GraphQL storefront has no free entry, so it runs only with a
license.

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

1. **Secrets:** sets what's needed (a `JWT_SECRET`, and for the licensed run a
   signed **dev license** granting the profile's paid plugins, which you supply
   in the environment and `harness/gen-license.sh` passes to the run).
   See [SECRETS.md](./SECRETS.md).
2. **Schema:** applies the schema plugin presets the profile names in
   `presets` (`POST /api/admin/schemas/presets/{name}`), as the paired example
   does, then creates the profile's content types over `POST /api/admin/schemas`.
3. **Seed:** inserts the profile's seed volumes (deterministic, fixed seed). A
   type's `seedValues` fixes a field for every row it seeds: a literal, `null`
   to leave the field unset, or `{id:<type>}` for a row already seeded into that
   type. That is how each forum reply names a real topic, so the thread read
   finds rows.
4. **Drive:** `harness/k6/profile.js` runs the weighted traffic mix at the
   profile's arrival rate. Reports throughput, p50/p95/p99, and error rate.

## Free and paid traffic

Each traffic entry declares what it `needs` and, when it needs a plugin,
whether that plugin is `paid`:

- **`needs: null`**: plain content (CRUD, list, filter on a type). Runs on the
  **free engine**, no license. This is the bulk of a blog or company site.
- **`needs: "<plugin>", paid: false`**: depends on a plugin every install runs
  for free, such as the schema plugin's comments preset or `localization`.
  Runs on the free engine too.
- **`needs: "<plugin>", paid: true`**: depends on a plugin a license unlocks,
  such as `search` or `graphql`. Runs only with `FULL=1` and a license granting
  exactly those plugins. Without it the entry is reported `pending` and the
  free entries' weights are renormalized, so the free result stays valid. A
  profile whose every entry is paid is not run free at all, and its free run is
  recorded `pending` with the reason `paid-only`.

The mark is checked, not trusted. Before it seeds, the harness reads
`GET /api/admin/plugins/status` on the engine about to be measured. On a free
run, every plugin an unpaid entry needs must be entitled and running there, or
the run stops and names the entry. On a licensed run the same holds for the
paid entries. So a free figure never includes a request that needed a license,
and a licensed figure never times the engine refusing one.

## Live-run status

The harness runs a profile **end-to-end for real** on the free-engine image: it
boots the engine, bootstraps the admin (`POST /api/admin/setup` with the
run's `LYEVE_SETUP_TOKEN`),
checks the paid condition, applies the presets, creates every schema
(`POST /api/admin/schemas`, which applies the DDL), grants the role permission
on each schema (`POST /api/admin/permissions`), seeds all rows through the
admin content route (`POST /api/admin/content`, so search sees them), and
drives the k6 traffic mix. The **free mix is measured** on every run, while paid
traffic stays `pending` until it runs with `FULL=1`.

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
