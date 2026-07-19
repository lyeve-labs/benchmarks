# S02: list 50 records (page 1)

> Same shape as the worked example [S01](./S01-content-read-by-id.md). This file
> only calls out what's different.

## Why
The list view behind every admin table and public index. Where S01 is a single
point lookup, S02 measures a **bounded, ordered scan plus serializing 50 rows**,
the first place serialization cost and row-marshaling overhead show up.

## Behavior
> **GET the first page of 50 records, ordered by created time. Expect `200` and a
> JSON array of 50 items.**

| Target | Endpoint for S02 |
|--------|------------------|
| **LyEve** | `GET /api/v1/content/article?limit=50` |
| Strapi | `GET /api/articles?pagination[pageSize]=50&sort=createdAt:desc` |
| Directus | `GET /items/article?limit=50&sort=-id` |
| Payload | `GET /api/articles?limit=50&sort=-createdAt` |

Each target sorts on the newest-first ordering its own schema exposes. A Directus
collection created over the API has no `date_created` column unless you add one,
so we sort by its primary key, a monotonically increasing id, i.e. newest first
all the same. The point is 50 ordered rows off an index, which every target does.


### Ordering is not symmetric here

LyEve has no sort parameter. Its list route always returns rows newest-first, so
the request carries no ordering instruction and cannot be given one. The other
three are asked to order explicitly, which is the only way to get a comparable
page from them.

That asymmetry favors LyEve slightly: it is not being asked to honor an
`ORDER BY` the others are. It is recorded here rather than corrected, because
the alternative would be to ask LyEve for something it cannot do. Read the S02
figures as "first page of 50 in the platform's default order", which is what a
list view actually renders.

## Measurement
| Parameter | Value |
|-----------|-------|
| Rate | **300 req/s**, 60 s |
| Pass thresholds | `p95 < 80 ms`, `error_rate < 1 %` |
| Primary metric | `p99_ms` |

Peak memory (`M-mem-peak`) is sampled during this scenario because a 50-row
serialize at 300 req/s is the most allocation-heavy sustained read we run.

## Run
```bash
make run TARGET=lyeve SCENARIO=S02
```

## Watch for
- **N+1 on relations.** If the platform eager-loads a relation per row, 50 items
  becomes 51 queries. S04 isolates this deliberately. If S02 is unexpectedly slow,
  suspect it here too.
- **Offset vs. cursor pagination.** Page 1 hides offset cost. It appears at deep
  pages. S02 is page 1 on purpose (best case for everyone). So we do not reward or
  punish pagination strategy in this scenario.
