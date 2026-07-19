# Company Profile: real-world profile

> Same shape as the worked example [Blog](./A1-blog.md). This file calls out what's different.

## The application
A **corporate website**: a handful of pages, the team and the open roles.
Traffic is entirely **reads of a tiny, highly cacheable dataset** that rarely
changes. It is the "easy but real" profile, the shape most agency-built
small-business sites take.

## Content model
| Type | Key fields | Relations |
|---|---|---|
| **site_pages** | title, slug*, section†, summary, body, hero_media_id | none |
| **site_team** | title, slug*, role, location, bio, photo_media_id, sort_order | none |
| **site_openings** | title, slug*, location†, department†, employment_type, summary, body, sort_order | hiring_manager |

`*` unique and indexed. `†` indexed for filtering.

This model matches `lyeve-examples/apps/company-site`. The example's contact
form writes to a type the schema plugin's forms preset creates, and that write is
not part of this mix.

The page-by-slug entry in the traffic mix is a filtered list rather than a
lookup, because the engine has no get-by-slug route: `filters[slug]=<slug>`
returning one row is how a page is fetched.

## Features the mix touches
Every entry is **content core**: reads and lists on the content router, with no
plugin and no license. The whole profile runs and is measured without `FULL=1`.

## Seed data
30 pages, 15 team members and 10 open roles. The dataset is intentionally tiny.
The point is low latency, not scale.

## Traffic mix: 150 req/s, `p95 < 100 ms`
| Weight | Request | Needs |
|---:|---|---|
| 40% | read one page by id | core |
| 20% | look a page up by slug, a filtered list | core |
| 18% | the open roles | core |
| 15% | the team | core |
| 7% | the page index | core |

## Run it
```bash
make profile PROFILE=company TARGET=lyeve
```

## Watch for
This profile should be almost boring: a low p95 with nothing to wait on. If it
isn't, something is wrong with the read path, because there is nowhere for
latency to hide in a 30-page site.
