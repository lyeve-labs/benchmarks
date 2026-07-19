# Seeding

One generic seeder, [`seed.mjs`](./seed.mjs), driven by `targets.json`. It:

1. logs in with the admin creds (`ADMIN_EMAIL` / `ADMIN_PASSWORD`),
2. ensures the `article` content model exists (created over the schema API for
   LyEve and Directus. Baked into the built app for Strapi and Payload, see
   [`../compose/README.md`](../compose/README.md)),
3. creates categories then articles from [`dataset.json`](./dataset.json).

**Determinism.** All randomness comes from a `mulberry32` PRNG seeded with
`dataset.seed` (42), so two runs seed byte-identical data, a precondition for
comparable numbers (methodology §3).

**Idempotency.** Model creation checks for existence first, so re-running the seeder
against a populated stack is safe.

**Honest failure.** If a target's content model can't be bootstrapped, the seeder
exits non-zero and `run.sh` records that target's scenarios as **pending**, never
a fabricated number.
