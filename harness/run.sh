#!/usr/bin/env bash
#
# run.sh: the benchmark orchestrator.
#
# Runs the SAME sequence for every target so none gets a warm-up the others
# didn't: up → cold-start → seed → warm → measure → sample memory → collect → down.
# Reads targets/targets.json and scenarios/scenarios.json (via node, so no jq
# dependency). Raw k6 output lands in results/raw/<run-id>/.
#
# Usage:
#   ./run.sh --doctor
#   ./run.sh --target lyeve --scenario S01
#   ./run.sh --target directus --scenario all
#   ./run.sh --sweep
#   ./run.sh --sweep --pull      # pull latest official images first (e.g. after a core upgrade)
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
TARGETS_JSON="$REPO_DIR/targets/targets.json"
SCENARIOS_JSON="$REPO_DIR/scenarios/scenarios.json"
PROFILES_JSON="$REPO_DIR/profiles/profiles.json"
RAW_DIR="$REPO_DIR/results/raw"

TARGET=""
SCENARIO="all"
PROFILE=""
DURATION_OVERRIDE=""
DO_SWEEP=0
DO_DOCTOR=0
STATIC_ONLY=0
DO_PULL="${PULL:-0}"

# LyEve creates its first admin only for a caller holding the setup token. One
# value per run goes to the engine (compose/lyeve.yml) and to the seeders.
if [[ -z "${LYEVE_SETUP_TOKEN:-}" ]]; then
  LYEVE_SETUP_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
fi
export LYEVE_SETUP_TOKEN

# ── small JSON helpers (node, no jq) ─────────────────────────────────────────
jget() { # jget <file> <js-expression on `d`>
  node -e 'const d=require(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"
}

log()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Pull the latest official images before a run (skips services built from source).
# Use it after upgrading LyEve core so the sweep measures the new image, not a
# stale cached one. Off by default. Enabled by --pull or PULL=1.
maybe_pull() { # compose_file
  [[ "$DO_PULL" == "1" ]] || return 0
  log "pulling latest official images ($1)"
  docker compose -f "$1" pull --ignore-buildable >/dev/null 2>&1 \
    || warn "pull failed, continuing with the images already on disk"
}

# ── arg parsing ──────────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --doctor)      DO_DOCTOR=1; shift ;;
    --sweep)       DO_SWEEP=1; shift ;;
    --static-only) STATIC_ONLY=1; shift ;;
    --pull)        DO_PULL=1; shift ;;
    --profile)     PROFILE="$2"; shift 2 ;;
    --target)      TARGET="$2"; shift 2 ;;
    --scenario)    SCENARIO="$2"; shift 2 ;;
    --duration)    DURATION_OVERRIDE="$2"; shift 2 ;;
    -h|--help)  grep -E '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

# ── doctor ───────────────────────────────────────────────────────────────────
doctor() {
  local ok=1
  check() { if command -v "$1" >/dev/null 2>&1; then printf '  \033[32m✓\033[0m %-8s %s\n' "$1" "$($2 2>&1 | head -1)"; else printf '  \033[31m✗\033[0m %-8s not found\n' "$1"; ok=0; fi; }
  echo "Environment check:"
  check docker  "docker --version"
  check node    "node --version"
  check k6      "k6 version"
  if docker compose version >/dev/null 2>&1; then
    printf '  \033[32m✓\033[0m %-8s %s\n' "compose" "$(docker compose version | head -1)"
  else
    printf '  \033[31m✗\033[0m %-8s not found (need Docker Compose v2)\n' "compose"; ok=0
  fi
  echo
  # LyEve's free tier allows five logins per fifteen minutes per address, and
  # changing that limit needs a license. A run therefore logs in once, in the
  # seeder, and every load script reuses that token. S05 measures login itself,
  # so on a stock LyEve it is refused after the fifth request and reads pending.
  printf '  \033[33m!\033[0m %-8s %s\n' "logins" "LyEve allows five per fifteen minutes per address; S05 reads pending on a stock install"
  echo
  if [[ $ok -eq 1 ]]; then log "ready to run benchmarks"; else die "install the missing tools above, then re-run --doctor"; fi
}

# ── run one (target, scenario) ───────────────────────────────────────────────
run_one() {
  local target="$1" scenario="$2"
  unset BENCH_LICENSE_KEY
  local idx; idx="$(jget "$TARGETS_JSON" "d.targets.findIndex(t=>t.id==='$target')")"
  [[ "$idx" == "-1" ]] && die "unknown target '$target' (see targets/targets.json)"

  local kind compose base_env health image
  kind="$(jget "$TARGETS_JSON" "d.targets[$idx].kind")"
  if [[ "$kind" == "hosted" ]]; then
    warn "target '$target' is hosted (SaaS) and cannot run through this rig. Its results are vendor-published only. Skipping."
    return 0
  fi
  compose="$(jget "$TARGETS_JSON" "d.targets[$idx].compose")"
  base_env="$(jget "$TARGETS_JSON" "d.targets[$idx].baseUrlEnv")"
  health="$(jget "$TARGETS_JSON" "d.targets[$idx].healthPath")"
  image="$(jget "$TARGETS_JSON" "d.targets[$idx].image")"
  # Targets whose image is built locally (Strapi, Payload) carry the real tag in
  # `imageLocal`, and that's what we size, since `image` is only a human label.
  if [[ "$image" == built:* ]]; then
    local image_local; image_local="$(jget "$TARGETS_JSON" "d.targets[$idx].imageLocal || ''")"
    [[ -n "$image_local" ]] && image="$image_local"
  fi
  # A LyEve image built from source is named in LYEVE_IMAGE (see lyeve.yml).
  # Size the image that runs, not the tag the file defaults to.
  [[ "$target" == "lyeve" && -n "${LYEVE_IMAGE:-}" ]] && image="$LYEVE_IMAGE"
  local compose_file="$REPO_DIR/$compose"
  [[ -f "$compose_file" ]] || die "compose file not found: $compose_file"

  local run_id="$(_now)-$target-$scenario"
  local out_dir="$RAW_DIR/$run_id"
  mkdir -p "$out_dir"
  local base_url="http://localhost:${BENCH_PORT:-8080}"   # every compose file maps the app to BENCH_PORT

  log "[$target/$scenario] bringing up stack ($compose)"
  maybe_pull "$compose_file"
  # `up -d` (not `--wait`): depends_on still gates the app on a healthy DB, and we
  # gate readiness with our own host-side health poll below, which is more reliable across
  # images than compose's healthcheck timing on a first, cold install.
  docker compose -f "$compose_file" up -d >/dev/null 2>&1 \
    || die "compose up failed for $target: check $compose_file and 'docker compose -f $compose_file logs'"
  trap "docker compose -f '$compose_file' down -v >/dev/null 2>&1 || true" RETURN EXIT

  _wait_health "$base_url$health" 180 || die "$target never became healthy at $base_url$health (see 'docker compose -f $compose_file logs')"

  # cold start (static metric M-cold). Timed against the target's readyPath
  # when it has one: a probe can answer before the application serves.
  local ready; ready="$(jget "$TARGETS_JSON" "d.targets[$idx].readyPath || d.targets[$idx].healthPath")"
  local cold_ms; cold_ms="$(_cold_start "$compose_file" "$base_url$ready")"
  log "[$target/$scenario] cold start: ${cold_ms} ms"
  echo "{\"metric\":\"M-cold\",\"target\":\"$target\",\"value_ms\":$cold_ms}" > "$out_dir/M-cold.json"

  # image size (static metric M-image), exact and cheap
  local img_mb; img_mb="$(_image_mb "$image")"
  [[ -n "$img_mb" ]] && echo "{\"metric\":\"M-image\",\"target\":\"$target\",\"value_mb\":$img_mb}" > "$out_dir/M-image.json"

  # idle memory (M-mem-idle): settle, then the median of a few samples. Samples
  # taken too soon under-report before the runtime's heap settles, so we wait
  # 45 s (the conservative, steady-state reading) before sampling.
  sleep 45
  local samples=() k idle_mb
  for k in 1 2 3 4 5; do samples+=("$(_app_mem_mb "$compose_file")"); sleep 3; done
  idle_mb="$(printf '%s\n' "${samples[@]}" | grep -E '^[0-9]+$' | sort -n | awk '{a[NR]=$1} END{if(NR)print a[int((NR+1)/2)]}')"
  [[ -n "$idle_mb" ]] && echo "{\"metric\":\"M-mem-idle\",\"target\":\"$target\",\"value_mb\":$idle_mb}" > "$out_dir/M-mem-idle.json"

  # static-only: cold start + idle memory + image size need no k6 and no seeding.
  if [[ "$STATIC_ONLY" == "1" ]]; then
    log "[$target] static-only → cold=${cold_ms}ms idle=${idle_mb:-?}MB image=${img_mb:-?}MB → $out_dir"
    return 0
  fi

  # seed the shared dataset
  log "[$target/$scenario] seeding shared dataset"
  # The token file lives outside results/ so a bearer token never lands in the
  # published raw output.
  local token_file; token_file="$(mktemp)"
  if ! BASE_URL="$base_url" TARGET="$target" TOKEN_FILE="$token_file" node "$HARNESS_DIR/seed/seed.mjs"; then
    warn "seeder incomplete for '$target', recording scenario as pending, not a fabricated number"
    echo "{\"target\":\"$target\",\"scenario\":\"$scenario\",\"status\":\"pending\",\"reason\":\"seed-not-implemented\"}" > "$out_dir/$scenario.pending.json"
    return 0
  fi

  # which scenarios? Run write scenarios LAST so their inserts never pollute the
  # dataset a read scenario (e.g. S04's filter pool) measures against.
  local scenarios=()
  if [[ "$scenario" == "all" ]]; then
    mapfile -t scenarios < <(jget "$SCENARIOS_JSON" "d.scenarios.slice().sort((a,b)=>(a.category==='write')-(b.category==='write')).map(s=>s.id).join('\n')")
  else
    scenarios=("$scenario")
  fi

  # peak-memory sampler in the background for the whole measure window
  ( while true; do _app_mem_mb "$compose_file"; echo; sleep 2; done ) > "$out_dir/mem-samples.txt" 2>/dev/null &
  local sampler_pid=$!

  BENCH_TOKEN="$(cat "$token_file" 2>/dev/null || true)"
  : > "$token_file"
  for s in "${scenarios[@]}"; do
    log "[$target/$s] warm-up ${WARMUP:-10s} (discarded)"
    K6_QUIET=1 _k6 "$target" "$s" "$base_url" "$out_dir" "${WARMUP:-10s}" "/dev/null" || true

    log "[$target/$s] measuring"
    local dur; dur="${DURATION_OVERRIDE:-$(jget "$SCENARIOS_JSON" "d.scenarios.find(x=>x.id==='$s')?.k6?.duration || '60s'")}"
    _k6 "$target" "$s" "$base_url" "$out_dir" "$dur" "$out_dir/$s.json" \
      || warn "[$target/$s] k6 reported threshold breach, kept as raw for the report generator to gate"
  done

  kill "$sampler_pid" 2>/dev/null || true
  local peak_mb; peak_mb="$(sort -n "$out_dir/mem-samples.txt" 2>/dev/null | tail -1 || true)"
  [[ -n "$peak_mb" ]] && echo "{\"metric\":\"M-mem-peak\",\"target\":\"$target\",\"value_mb\":$peak_mb}" > "$out_dir/M-mem-peak.json"

  log "[$target/$scenario] done → $out_dir"
}

# ── run a real-world profile (schema + seed + weighted traffic mix) ──────────
run_profile() {
  local target="${1:-lyeve}" profile="$2"
  local pidx; pidx="$(node -e 'const d=require(process.argv[1]);process.stdout.write(String(d.profiles.findIndex(p=>p.id===process.argv[2])))' "$PROFILES_JSON" "$profile")"
  [[ "$pidx" == "-1" ]] && die "unknown profile '$profile' (see profiles/profiles.json)"
  local idx; idx="$(jget "$TARGETS_JSON" "d.targets.findIndex(t=>t.id==='$target')")"
  [[ "$idx" == "-1" ]] && die "unknown target '$target'"
  [[ "$(jget "$TARGETS_JSON" "d.targets[$idx].kind")" == "hosted" ]] && die "profiles run on self-host targets only"
  local compose health compose_file base_url full
  compose="$(jget "$TARGETS_JSON" "d.targets[$idx].compose")"
  health="$(jget "$TARGETS_JSON" "d.targets[$idx].healthPath")"
  compose_file="$REPO_DIR/$compose"
  base_url="http://localhost:${BENCH_PORT:-8080}"
  full="${FULL:-0}"

  local suffix=""; [[ "$full" == "1" ]] && suffix="-full"
  unset BENCH_LICENSE_KEY
  local run_id="$(_now)-$target-profile-$profile$suffix"
  local out_dir="$RAW_DIR/$run_id"; mkdir -p "$out_dir"

  if [[ "$full" == "1" ]]; then
    local feats; feats="$(node -e 'const d=require(process.argv[1]);const p=d.profiles.find(x=>x.id===process.argv[2]);process.stdout.write([...new Set(p.traffic.map(t=>t.needs).filter(Boolean))].join(","))' "$PROFILES_JSON" "$profile")"
    log "[profile:$profile] FULL run also drives the traffic that needs: $feats, reading the dev license through harness/gen-license.sh"
    # The token reaches the engine through the compose file's environment and
    # never a file under results/, which is committed as evidence. It travels
    # as BENCH_LICENSE_KEY, which only this branch sets, so a LYEVE_LICENSE_KEY
    # exported in the caller's shell cannot license a free run.
    local lic
    if lic="$("$HARNESS_DIR/gen-license.sh" "$feats" 2>/dev/null)"; then
      BENCH_LICENSE_KEY="$(printf '%s\n' "$lic" | sed -n 's/^LYEVE_LICENSE_KEY=//p')"
      export BENCH_LICENSE_KEY
    else
      warn "no license: set LYEVE_LICENSE_KEY and LICENSE_PUBLIC_KEY_HEX, and run an engine+plugins image built with that key"
    fi
  fi

  log "[profile:$profile/$target] bringing up stack"
  maybe_pull "$compose_file"
  docker compose -f "$compose_file" up -d >/dev/null 2>&1 || die "compose up failed for $target"
  trap "docker compose -f '$compose_file' down -v >/dev/null 2>&1 || true" RETURN EXIT
  _wait_health "$base_url$health" 180 || die "$target never healthy at $base_url$health"

  log "[profile:$profile] building schema + seeding"
  if ! BASE_URL="$base_url" PROFILE="$profile" OUT_DIR="$out_dir" \
        ADMIN_EMAIL="${ADMIN_EMAIL:-admin@lyeve.com}" ADMIN_PASSWORD="${ADMIN_PASSWORD:-benchmark-Passw0rd!}" \
        node "$HARNESS_DIR/seed/seed-profile.mjs"; then
    warn "[profile:$profile] seed failed, recording pending"
    echo "{\"profile\":\"$profile\",\"target\":\"$target\",\"status\":\"pending\",\"reason\":\"seed-failed\"}" > "$out_dir/profile.pending.json"
    return 0
  fi

  if ! command -v k6 >/dev/null 2>&1; then
    warn "[profile:$profile] k6 not installed: schema and seed OK, traffic recorded pending"
    echo "{\"profile\":\"$profile\",\"target\":\"$target\",\"mode\":\"$([[ "$full" == '1' ]] && echo full || echo core)\",\"status\":\"pending\",\"reason\":\"no-k6\"}" > "$out_dir/profile.pending.json"
    return 0
  fi

  log "[profile:$profile] warm-up 20s (discarded)"
  K6_QUIET=1 _kprofile "$profile" "$full" "$base_url" "20s" "/dev/null" || true
  log "[profile:$profile] measuring ($([[ "$full" == '1' ]] && echo 'full mix' || echo 'content core'))"
  _kprofile "$profile" "$full" "$base_url" "60s" "$out_dir/profile.json" \
    || warn "[profile:$profile] k6 threshold breach, kept raw for the report to gate"
  log "[profile:$profile] done → $out_dir"
}

# k6 writes setup()'s return value into the summary export, and the profile
# driver returns its bearer token there. The summaries are committed as
# evidence, so the token comes out before anything else reads the file.
_scrub_summary() { # summary.json
  [[ -f "$1" ]] || return 0
  node -e 'const fs=require("fs");const p=process.argv[1];const d=JSON.parse(fs.readFileSync(p,"utf8"));if(d.setup_data&&"token" in d.setup_data){delete d.setup_data.token;fs.writeFileSync(p,JSON.stringify(d,null,2))}' "$1"
}

_kprofile() { # profile full base_url duration json_out
  local profile="$1" full="$2" base_url="$3" duration="$4" json_out="$5"
  local quiet=(); [[ "${K6_QUIET:-0}" == "1" ]] && quiet=(--quiet --summary-mode=disabled)
  local summary=(); [[ "$json_out" != "/dev/null" ]] && summary=(--summary-export "${json_out%.json}.summary.json")
  local stream=(); [[ "${K6_RAW:-0}" == "1" && "$json_out" != "/dev/null" ]] && stream=(--out json="$json_out")
  k6 run "${quiet[@]}" \
    -e PROFILE="$profile" -e FULL="$full" -e BASE_URL="$base_url" -e DURATION="$duration" \
    -e ADMIN_EMAIL="${ADMIN_EMAIL:-admin@lyeve.com}" -e ADMIN_PASSWORD="${ADMIN_PASSWORD:-benchmark-Passw0rd!}" \
    "${stream[@]}" "${summary[@]}" \
    "$HARNESS_DIR/k6/profile.js"
  local rc=$?
  [[ "$json_out" != "/dev/null" ]] && _scrub_summary "${json_out%.json}.summary.json"
  return $rc
}

# ── k6 invocation ────────────────────────────────────────────────────────────
_k6() { # target scenario base_url out_dir duration json_out
  local target="$1" scenario="$2" base_url="$3" out_dir="$4" duration="$5" json_out="$6"
  local quiet=(); [[ "${K6_QUIET:-0}" == "1" ]] && quiet=(--quiet --summary-mode=disabled)
  # A summary-export next to the raw json is what tools/collect.mjs reads to get
  # aggregated p50/p95/p99 + throughput + error rate (skipped for the warm-up).
  local summary=(); [[ "$json_out" != "/dev/null" ]] && summary=(--summary-export "${json_out%.json}.summary.json")
  # The per-request stream is tens of megabytes a minute, and writing it costs
  # the load generator CPU on the host it shares with the target. The summary is
  # what the report reads; K6_RAW=1 keeps the stream when it is wanted.
  local stream=(); [[ "${K6_RAW:-0}" == "1" && "$json_out" != "/dev/null" ]] && stream=(--out json="$json_out")
  k6 run "${quiet[@]}" \
    -e TARGET="$target" -e SCENARIO="$scenario" -e BASE_URL="$base_url" \
    -e DURATION="$duration" -e TOKEN="${BENCH_TOKEN:-}" \
    -e ADMIN_EMAIL="${ADMIN_EMAIL:-admin@lyeve.com}" \
    -e ADMIN_PASSWORD="${ADMIN_PASSWORD:-benchmark-Passw0rd!}" \
    "${stream[@]}" "${summary[@]}" \
    "$HARNESS_DIR/k6/scenario.js"
  local rc=$?
  [[ "$json_out" != "/dev/null" ]] && _scrub_summary "${json_out%.json}.summary.json"
  return $rc
}

# ── primitives ───────────────────────────────────────────────────────────────
_now() { date -u +%Y%m%d-%H%M%S; }

# Milliseconds since the epoch. `date +%s%3N` is not portable: the uutils date
# some distributions ship prints nine digits for %3N, which turned a two-second
# cold start into a figure a million times larger.
_ms() { local t="${EPOCHREALTIME/./}"; echo $(( t / 1000 )); }

_wait_health() { # url timeout_s
  local url="$1" timeout="$2" i=0
  while (( i < timeout )); do
    local code; code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    [[ "$code" =~ ^2 ]] && return 0
    sleep 1; ((i++))
  done
  return 1
}

_cold_start() { # compose_file ready_url  → prints ms
  # Stop first and start the clock at `docker start`: timing a restart counted
  # the target's graceful shutdown as part of its start.
  local compose_file="$1" url="$2"
  local app; app="$(_app_container "$compose_file")"
  [[ -z "$app" ]] && { echo "0"; return; }
  docker stop "$app" >/dev/null 2>&1 || true
  local start end; start="$(_ms)"
  docker start "$app" >/dev/null 2>&1 || true
  _wait_ready "$url" 120 || true
  end="$(_ms)"
  echo $(( end - start ))
}

_wait_ready() { # url timeout_s: polls every 50 ms, so the reading is not rounded to a second
  local url="$1" deadline=$(( $(_ms) + $2 * 1000 ))
  while (( $(_ms) < deadline )); do
    local code; code="$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)"
    [[ "$code" =~ ^2 ]] && return 0
    sleep 0.05
  done
  return 1
}

_app_container() { # compose_file → the app service container id (service named 'app')
  docker compose -f "$1" ps -q app 2>/dev/null | head -1
}

_app_mem_mb() { # compose_file → RSS of app container in MB (integer)
  local app; app="$(_app_container "$1")"
  [[ -z "$app" ]] && return 0
  local raw; raw="$(docker stats --no-stream --format '{{.MemUsage}}' "$app" 2>/dev/null | awk '{print $1}')"
  node -e 'const s=process.argv[1]||"";const m=s.match(/([\d.]+)\s*([KMGT]i?B)/i);if(!m){process.exit(0)}const n=parseFloat(m[1]);const u=m[2].toUpperCase();const f={KIB:1/1024,MIB:1,GIB:1024,KB:1/1024,MB:1,GB:1024}[u]||1;process.stdout.write(String(Math.round(n*f)))' "$raw"
}

_image_mb() { # image ref → MB (integer) or empty
  # The sum of the image's layers, uncompressed, from `docker history`. The
  # `docker images` SIZE column is not that figure on the containerd image
  # store: it adds the compressed blobs to the unpacked layers, which counted
  # every image about a third larger than what it unpacks to.
  local ref="$1"
  [[ -z "$ref" || "$ref" == "null" || "$ref" == built:* ]] && return 0
  local bytes; bytes="$(docker history --no-trunc --human=false --format '{{.Size}}' "$ref" 2>/dev/null | awk '{s+=$1} END{if(NR)print s}')"
  [[ -z "$bytes" ]] && return 0
  echo $(( (bytes + 500000) / 1000000 ))
}

# ── sweep ────────────────────────────────────────────────────────────────────
sweep() {
  local set; set="$(jget "$TARGETS_JSON" "d.reference.comparisonSet.join('\n')")"
  while IFS= read -r t; do
    [[ -z "$t" ]] && continue
    run_one "$t" "all" || warn "sweep: target '$t' failed, continuing"
  done <<< "$set"
  log "sweep complete: run 'make report' to fold results/raw into results.json"
}

# ── main ─────────────────────────────────────────────────────────────────────
[[ $DO_DOCTOR -eq 1 ]] && { doctor; exit 0; }
command -v docker >/dev/null 2>&1 || die "docker not installed: run './run.sh --doctor'."
# k6 is only needed to drive load scenarios; --static-only and --profile handle
# its absence gracefully (static metrics need no k6, and a profile still builds +
# seeds and records the traffic run pending).
if [[ $STATIC_ONLY -eq 0 && -z "$PROFILE" ]]; then
  command -v k6 >/dev/null 2>&1 || die "k6 not installed: run './run.sh --doctor', or use --static-only / --profile."
fi

if [[ $DO_SWEEP -eq 1 ]]; then
  sweep
elif [[ -n "$PROFILE" ]]; then
  run_profile "${TARGET:-lyeve}" "$PROFILE"
elif [[ -n "$TARGET" ]]; then
  run_one "$TARGET" "$SCENARIO"
else
  die "nothing to do: pass --target <id> [--scenario Sxx], --profile <id>, --sweep, or --doctor"
fi
