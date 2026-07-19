# S04: filter by an indexed field

> Same shape as the worked example [S01](./S01-content-read-by-id.md). This file
> only calls out what's different.

## Why
Most real API reads are not "get one by id". They are "get the records where X."
S04 measures a **WHERE clause on an indexed column, with pagination**, which is
the shape a filtered list or a relation lookup actually takes. It is the scenario
most likely to expose a missing index or N+1 relation loading.

## Behavior
> **GET records filtered by an indexed field (category slug), paginated to 25.
> Expect `200` and a JSON array.**

| Target | Endpoint for S04 |
|--------|------------------|
| **LyEve** | `GET /api/v1/content/article?filters[category]={slug}&limit=25` |
| Strapi | `GET /api/articles?filters[category][slug][$eq]={slug}&pagination[pageSize]=25` |
| Directus | `GET /items/article?filter[category][_eq]={slug}&limit=25` |
| Payload | `GET /api/articles?where[category][equals]={slug}&limit=25` |

`setup()` collects the real set of category slugs from the seeded data and samples
across them, so the filter hits a realistic distribution, not one hot value.

> **Correction, 2026-09-04.** This scenario previously sent
> `?filter=category:{slug}`, which LyEve does not recognize. Unknown query
> parameters are ignored silently, so the request returned an unfiltered page and
> answered 200: the published LyEve figure for S04 measures a list, not a filter.
> The path above is the syntax the engine actually has. The figure was
> re-measured on 2026-09-25. See [results/ERRATA.md](../results/ERRATA.md).

Every run now proves the filter applies before it measures. `setup()` asks for
a value no record holds, which must return no rows or be refused, and for one
real value, whose rows must all hold it where the response carries the field.
An ignored filter stops the run rather than publishing an unfiltered list. The
result lands in the summary export as `setup_data.filterCheck`.

On LyEve the filtered column here is a plain indexed text column, which is why
`filters[category]` is valid. Filtering a *relation* takes the foreign key
(`filters[category_id]=<uuid>`), and filtering by a related record's slug is not
expressible in one request at all, because the engine does not join. `filters[]`
is exact equality only: no ranges, no operators, no text match.

## Measurement
| Parameter | Value |
|-----------|-------|
| Rate | **200 req/s**, 60 s |
| Pass thresholds | `p95 < 90 ms`, `error_rate < 1 %` |
| Primary metric | `p99_ms` |

## Fairness note
Every target is seeded with an **index on the filtered column** (the seeder
ensures it), so no platform wins or loses S04 on a missing index we forgot to
create. If a platform does not create the index by default, that is recorded as a
footnote. It is a real product difference, not a harness artifact.

## Run
```bash
make run TARGET=lyeve SCENARIO=S04
```

## Watch for
- **N+1 relation loading** when the filtered type has a relation, where 25 rows should
  be 1-2 queries, never 26.
- **Full-table scan** from an un-hinted filter, which appears as latency that climbs
  with dataset size. Our fixed dataset keeps this comparable across targets.
