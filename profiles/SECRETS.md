# Secrets a profile run needs

A profile run generates the secrets it needs. Nothing is checked in.

| Secret | What it's for | How it's produced |
|---|---|---|
| `JWT_SECRET` | signs admin/session tokens | a fixed benchmark value set in the compose stack (`harness/compose/lyeve.yml`). Config requires it even in EdDSA mode. |
| `LYEVE_SETUP_TOKEN` | the credential the first-admin setup call must present | generated per run by `harness/run.sh` when unset, passed to the engine through the compose stack and to the seeder. Setup answers 401 without it. |
| admin account | create schemas + seed content | bootstrapped at run time via `POST /api/admin/setup` (the first-run super_admin), presenting `LYEVE_SETUP_TOKEN`. |
| `LYEVE_LICENSE_KEY` + `LICENSE_PUBLIC_KEY_HEX` | activate paid plugins for a `FULL=1` run | supplied by you in the environment and passed to the run by `harness/gen-license.sh`. This repo does not issue licenses. |

## Content core vs. FULL

- **Content core** (`make profile PROFILE=blog`) needs only `JWT_SECRET` + the
  bootstrapped admin. It runs on the pre-built **free engine** image and measures
  every `needs: null` traffic entry (the bulk of each profile).

- **FULL** (`make profile PROFILE=blog FULL=1`) additionally reads a dev license
  granting the profile's plugins from the environment. **Caveat:** a license verifies against the
  public key *embedded in the core binary at build time*. The pre-built free image
  is plugin-less and fails closed to the free tier, so a `FULL` run only activates
  plugins on an **engine+plugins image built with the supplied
  `LICENSE_PUBLIC_KEY_HEX`**. `gen-license.sh` prints both values so that image can
  be built/run. Until then, plugin-dependent traffic is recorded `pending`.

Nothing generated here is a customer license. All are dev or self-signed, local only.
