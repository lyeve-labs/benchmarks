# Marketplace: real-world profile

> Same shape as the worked example [Blog](./A1-blog.md). This file calls out what's different.

## The application
A small **multi-seller marketplace**. Sellers list products with prices and
stock. Buyers browse, filter by category, search and read reviews. It is the
heaviest of the three documented profiles: **browse and search heavy**, with the
largest catalog.

## Content model
| Type | Key fields | Relations |
|---|---|---|
| **shop_sellers** | title, slug*, bio, rating | none |
| **shop_categories** | title, slug* | none |
| **shop_products** | title, slug*, description, price_cents, stock, cover_media_id | seller, category |
| **shop_reviews** | title, slug*, body, rating | product |

`*` unique and indexed. Relations are indexed.

This model matches `lyeve-examples/apps/marketplace`. The display field is
`title` on every type because the write path requires one, and no relation is
declared required because a required relation makes every insert fail.

Browse traffic asks for a page of 25 and ranks in the application: the engine
has no sort parameter, and price ranges are not expressible either, since
`filters[]` is exact equality only.

## Features the mix touches
Product, category and review reads are **content core**. The 8% product search
uses the `search` plugin on the admin router.

## Seed data
2,000 products across 50 categories and 100 sellers, with 5,000 reviews. Enough
catalog that search and category filters do real work.

## Traffic mix: 250 req/s, `p95 < 150 ms`
| Weight | Request | Needs |
|---:|---|---|
| 30% | read one product by id | core |
| 24% | browse a page of 25 products | core |
| 14% | one product with its seller and category populated | core |
| 14% | products in a category, filtered on `category_id` | core |
| 10% | reviews for a product, filtered on `product_id` | core |
| 8% | product search, on the admin router | `search` |

Without `FULL=1` the 8% search slice is `pending`, and the 92% content core runs
and is measured.

## Run it
```bash
make profile PROFILE=marketplace TARGET=lyeve         # the content core
make profile PROFILE=marketplace TARGET=lyeve FULL=1  # every entry, search included
```

## Watch for
The marketplace is where **filter and relation** cost shows up (product to
category and seller, review to product). p99 on the category filter and on the
populated product read are the numbers to watch.
