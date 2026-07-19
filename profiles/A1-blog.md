# Blog: real-world profile · **worked example**

> The reference profile, documented end to end. The others follow the same shape.

## 1. The application

A personal or team **content blog**. Editors publish articles with a cover image,
an excerpt, a category and an author. Readers browse recent posts, open a post,
see it with its author and category, browse a category, and now and then search.
It is the archetypal read-heavy CMS workload: every request in the mix is a
read.

## 2. Content model (schema)

Three content types, created over `POST /api/admin/schemas`:

| Type | Key fields | Relations |
|---|---|---|
| **blog_authors** | title, slug*, bio | none |
| **blog_categories** | title, slug* | none |
| **blog_posts** | title, slug*, excerpt, body, cover_media_id | author, category |

`*` unique and indexed. Relations are indexed. Those indexes are what keep the
list and filter traffic fast, so the benchmark reflects a correctly modeled
blog rather than a missing-index accident.

Three details are not cosmetic:

- **The display field is `title`, not `name`.** The write path this profile uses
  requires a `title`, so every type has one.
- **No relation is declared required.** A required belongs_to relation generates
  a column no writer fills, and every insert then fails.
- **A relation is filtered by `<field>_id`.** `filters[category_id]=<uuid>`
  narrows the list. `filters[category]=<uuid>` is a 400. There is no way to
  filter posts by a category's *slug* in one request, because the engine does
  not join: resolve the slug to an id first, then filter. The traffic mix below
  samples category ids for exactly that reason.

This model matches the runnable example application in
`lyeve-examples/apps/blog` field for field, so a figure here describes something
you can open and use.

## 3. Features the mix touches

Everything except search is the **content core**: reads, lists, relation
population and filters on the content router, with no plugin and no license.
The 8% search slice uses the `search` plugin on the admin router.

## 4. Seed data

500 posts across 20 categories and 10 authors. A believable small blog with
enough long-tail content that list and filter queries are not trivially cached.
Deterministic (fixed seed), so two runs are identical.

## 5. Traffic mix (how it's actually used)

Weighted arrival mix at **200 req/s**, `p95 < 120 ms`, error budget < 1%:

| Weight | Request | Needs |
|---:|---|---|
| 45% | read one post by id | core |
| 25% | a page of 25 recent posts | core |
| 12% | one post with its author and category populated | core |
| 10% | posts in a category, filtered on `category_id` | core |
| 8% | full-text post search, on the admin router | `search` |

A page is 25 rows because `limit` is clamped to 25..200, so a smaller page cannot
be requested. The list is newest-first because that is the only order there is.
The engine has no sort parameter, and any other ordering is the application's
job.

Without `FULL=1` the 8% `search` slice is reported `pending`, and the other 92%
(the content core) runs and is measured. With `FULL=1` all five run.

## 6. Run it

```bash
make profile PROFILE=blog TARGET=lyeve            # the content core
make profile PROFILE=blog TARGET=lyeve FULL=1     # every entry, search included
```

The harness sets the secrets it needs (JWT, and for `FULL=1` a dev license you
supply in the environment), creates the schema, seeds, and drives the mix.
Results land in `results/raw/` and fold into `results/RESULTS.md` under
**Real-world profiles**.

## 7. What a good result looks like

A blog is the easy case: reads dominate, the working set caches well, and a Go
engine on a small box should hold the 200 req/s mix comfortably under the 120 ms
p95 budget. The interesting signal is the **populated read** p99, which costs a
relation lookup per post, and **search** p99 under `FULL=1`.
