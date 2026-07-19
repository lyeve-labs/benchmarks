#!/usr/bin/env bash
#
# gen-license.sh: pass the dev license a FULL profile run needs into the run.
#
# Prints two KEY=VALUE lines:
#   LICENSE_PUBLIC_KEY_HEX=...   (the public key that must be embedded in core)
#   LYEVE_LICENSE_KEY=...        (the signed license JWT to run with)
#
# Both come from the environment. This repo does not issue licenses: supply one
# that grants the profile's plugins, with the public key it verifies against.
#
#   LYEVE_LICENSE_KEY=... LICENSE_PUBLIC_KEY_HEX=... \
#     ./gen-license.sh "media,search,comments,seo,cache,rate-limit,localization"
#
# IMPORTANT: a license verifies against the public key EMBEDDED IN THE CORE
# BINARY AT BUILD TIME (-ldflags). The pre-built free image is plugin-less and
# fails closed to the free tier, so this license only activates plugins on an
# engine+plugins image BUILT with the printed LICENSE_PUBLIC_KEY_HEX. Supplying
# the license is this step. Wiring it to a full image is the build step.
set -euo pipefail
FEATURES="${1:-}"
if [ -z "${LYEVE_LICENSE_KEY:-}" ] || [ -z "${LICENSE_PUBLIC_KEY_HEX:-}" ]; then
  echo "gen-license: set LYEVE_LICENSE_KEY and LICENSE_PUBLIC_KEY_HEX to a license granting: ${FEATURES:-the profile's plugins}" >&2
  exit 1
fi
printf 'LICENSE_PUBLIC_KEY_HEX=%s\nLYEVE_LICENSE_KEY=%s\n' "$LICENSE_PUBLIC_KEY_HEX" "$LYEVE_LICENSE_KEY"
