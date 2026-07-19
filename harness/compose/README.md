# Compose stacks: one per target

Each target gets a Compose stack that brings up the app plus its own PostgreSQL 16
and maps the app to host **:8080** (LyEve goes through a small Caddy proxy because
it serves the admin and content APIs on two ports). Every stack sets a distinct
Compose project name (`bench-<target>`) so two targets never share a container,
network, or volume. From there `run.sh` treats them all the same.

Two variables let a run live beside other stacks on the same machine:
`BENCH_PORT` moves the host port off 8080, and `COMPOSE_PROJECT_NAME` renames
the containers, networks and volumes. `LYEVE_IMAGE` names a LyEve image built
from source (`make build-lyeve-image` and `docker build` in the engine
repository), because anonymous pulls of the published package are refused.

The one place targets genuinely differ is **how the content model gets created**
before seeding. That is a real product difference, not a harness artifact, so it
is documented here rather than hidden.

| Target | Image | How the `article` model is created | Ready to run? |
|--------|-------|-------------------------------------|:--------:|
| **LyEve** | `ghcr.io/lyeve-labs/lyeve-core`, or `LYEVE_IMAGE` | Admin bootstrapped over `/api/admin/setup`. `article` schema created over the schema API by the seeder | yes |
| **Directus** | `directus/directus:11` (official) | Admin from env. `article` collection + fields + index created over the schema API by the seeder | yes |
| **Strapi** | built from `strapi.Dockerfile` + `strapi-app/` | Content types are code, so the `article` and `category` types ship in the committed app | Built here |
| **Payload** | built from `payload-app/` | Collections are code, so `articles`, `categories` and `users` ship in the committed app | Built here |

The two official images run as-is. The two code-first frameworks (Strapi, Payload)
are built from app source committed alongside these compose files, so there is no
manual scaffold step, and everything needed to reproduce them is in the tree.

## LyEve

The `core` image is distroless (no shell), so the stack fronts it with a Caddy
proxy that answers the health check. The engine runs in its default production
mode, which refuses to boot without a separate `ENCRYPTION_KEY`, an audit HMAC
key, `SECURE_COOKIE=true` and a global rate limit, and redirects plain HTTP to
HTTPS. The file sets the four, and the proxy forwards `X-Forwarded-Proto:
https` as a TLS-terminating proxy in production would. The seeder creates the
first admin over the setup endpoint, presenting the setup token that `run.sh`
generates and passes to the engine as `LYEVE_SETUP_TOKEN` (setup answers 401
without it), then builds the `article` schema and loads rows over the
admin/content APIs, with no separate bootstrap command.

## Directus

The official image creates its admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on
first boot (the email needs a real TLD, because Directus rejects `.local`). The seeder
then creates the `article` and `category` collections, their fields, and the
category index over the schema API before loading rows.

## Strapi (`strapi-app/`)

A minimal Strapi 5 app. It ships the `article` and `category` content types and a
`bootstrap` that opens those endpoints to the public role and creates the one
benchmark user the login scenario authenticates as. `strapi.Dockerfile` installs
dependencies and runs `strapi build`. The container starts with `strapi start`.
A fresh database plus this app gives an identical, ready-to-seed instance.

## Payload (`payload-app/`)

A minimal Payload 3 app on Next.js. It defines the `articles`, `categories`, and
`users` collections, opens read/write access for the benchmark, and creates the
benchmark user on startup. The schema comes from a committed migration that
`payload migrate` applies when the container starts, so a fresh volume comes up
fully migrated before the seeder runs.

## Adding a target

Add a `<target>.yml` here (app + its own Postgres, app on :8080, a distinct
`name:`), register the target in [`../../targets/targets.json`](../../targets/targets.json)
with its endpoints, and, if the content model can be created over an API, teach
[`../seed/seed.mjs`](../seed/seed.mjs) how. If the model is code (Strapi, Payload),
commit the app source next to the compose file. If a target can't be bootstrapped,
the seeder exits non-zero and `run.sh` records its scenarios as **pending** rather
than publishing a number against an empty database.
