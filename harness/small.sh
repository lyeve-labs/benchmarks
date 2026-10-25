#!/usr/bin/env bash
#
# small.sh: run one target alone on a small remote server, and drive it from here.
#
# The target and its own PostgreSQL run on the remote server, the way someone
# renting the smallest plan would run them. k6 runs on this machine, so the load
# generator never takes the server's CPU. One run:
#
#   rig     read the server's CPU model, core count, memory, kernel and Docker
#   clear   remove a stack an earlier run could not tear down
#   images  for each image the server lacks, or holds with other bytes than
#           this machine's, it pulls a public one by the digest this machine
#           holds, and every one it cannot pull is streamed to it over SSH.
#           The record names the image ID the server runs
#   boot    compose up, then time the first answer on the target's ready path
#   idle    settle 45 s, then five samples of free and docker stats
#   seed    the shared dataset, sent over the network
#   steps   the scenario at each offered rate: 10 s warm-up, then the measured
#           window, with the CPU time of the server and of this machine read
#           around it, so a step that falls short shows which one ran out
#   down    remove the stack, its volumes, the images the run brought, the
#           firewall rules and the work directory
#
# A run during which this machine's address changed is marked void, because the
# firewall rule then dropped its requests and the target would read as failing.
# So is a run that lost its SSH connection to the server.
#
# Usage:
#   HOST=root@203.0.113.10 KEY=~/.ssh/bench-vm ./small.sh --target lyeve
#   HOST=root@203.0.113.10 KEY=~/.ssh/bench-vm ./small.sh --target lyeve --prepare
#
# --prepare installs Docker when the server has none, puts the target's images
# on the server and stops there. It measures nothing and keeps the images.
#
# Environment:
#   HOST          ssh destination, user@address (required)
#   KEY           private key for that destination (required)
#   SSH_PORT      ssh port (default 22)
#   SSH_OPTS      extra ssh options, split on spaces
#   PROVIDER      hosting provider, recorded with the rig
#   PLAN          plan name, recorded with the rig
#   CAMPAIGN      the sweep this run belongs to, recorded with the rig
#   RATES         offered rates in req/s, in the order they run (default "25 50 100 200 300 500")
#   BOOT_TIMEOUT  seconds the target has to answer after compose up (default 300)
#   BENCH_PORT    application port on the server (default 8080)
#   KEEP_IMAGES   1 leaves the images this run brought on the server (default 0)
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
TARGETS_JSON="$REPO_DIR/targets/targets.json"
SCENARIOS_JSON="$REPO_DIR/scenarios/scenarios.json"

TARGET=""
SCENARIO="S01"
PREPARE=0
SSH_PORT="${SSH_PORT:-22}"
RATES="${RATES:-25 50 100 200 300 500}"
BOOT_TIMEOUT="${BOOT_TIMEOUT:-300}"
BENCH_PORT="${BENCH_PORT:-8080}"
# The work directory on the server. Teardown removes it.
W="/tmp/lyeve-bench-small"

jget() { node -e 'const d=require(process.argv[1]);process.stdout.write(String(eval(process.argv[2])))' "$1" "$2"; }
log()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
_now() { date -u +%Y%m%d-%H%M%S; }
_ms()  { local t="${EPOCHREALTIME/./}"; echo $(( t / 1000 )); }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)   TARGET="$2"; shift 2 ;;
    --scenario) SCENARIO="$2"; shift 2 ;;
    --prepare)  PREPARE=1; shift ;;
    -h|--help)  grep -E '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done
# `make small` passes the Makefile's default scenario, which names every one.
[[ -z "$SCENARIO" || "$SCENARIO" == "all" ]] && SCENARIO="S01"

[[ -n "$TARGET" ]] || die "pass --target <id> (see targets/targets.json)"
[[ -n "${HOST:-}" ]] || die "set HOST to the server's ssh destination, for example HOST=root@203.0.113.10"
[[ -n "${KEY:-}" ]] || die "set KEY to the private key for $HOST"
KEY="${KEY/#\~/$HOME}"
[[ -r "$KEY" ]] || die "cannot read the key file named in KEY"
for tool in docker node k6 ssh curl; do command -v "$tool" >/dev/null 2>&1 || die "$tool not found on this machine: run 'make doctor'"; done

idx="$(jget "$TARGETS_JSON" "d.targets.findIndex(t=>t.id==='$TARGET')")"
[[ "$idx" == "-1" ]] && die "unknown target '$TARGET' (see targets/targets.json)"
[[ "$(jget "$TARGETS_JSON" "d.targets[$idx].kind")" == "hosted" ]] && die "'$TARGET' is hosted and cannot run on a server of ours"
category="$(jget "$SCENARIOS_JSON" "(d.scenarios.find(s=>s.id==='$SCENARIO')||{}).category")"
[[ "$category" == "read" ]] || die "scenario '$SCENARIO' is not a read scenario: small-server mode steps a read scenario's rate"
compose_file="$REPO_DIR/$(jget "$TARGETS_JSON" "d.targets[$idx].compose")"
compose_name="$(basename "$compose_file")"
ready="$(jget "$TARGETS_JSON" "d.targets[$idx].readyPath || d.targets[$idx].healthPath")"
health="$(jget "$TARGETS_JSON" "d.targets[$idx].healthPath")"
duration="$(jget "$SCENARIOS_JSON" "d.scenarios.find(x=>x.id==='$SCENARIO').k6.duration || '60s'")"
budget="$(jget "$SCENARIOS_JSON" "d.scenarios.find(x=>x.id==='$SCENARIO').thresholds.error_rate")"

# The address k6 reaches, resolved the way ssh resolves the destination.
ADDR="$(ssh -G -p "$SSH_PORT" "$HOST" 2>/dev/null | awk '$1=="hostname"{print $2; exit}')"
[[ -n "$ADDR" ]] || die "cannot resolve the address of $HOST"
BASE_URL="http://$ADDR:$BENCH_PORT"

if [[ -z "${LYEVE_SETUP_TOKEN:-}" ]]; then
  LYEVE_SETUP_TOKEN="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("hex"))')"
fi
export LYEVE_SETUP_TOKEN
# A small-server run measures the free engine. A license in the caller's shell
# must not reach it.
unset BENCH_LICENSE_KEY

# ── ssh ──────────────────────────────────────────────────────────────────────
# One master connection carries every command, so each step does not pay a new
# handshake on the server's one core.
LOCAL_TMP="$(mktemp -d)"
SSH=(ssh -i "$KEY" -p "$SSH_PORT" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=15
     -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15
     -o ControlMaster=auto -o "ControlPath=$LOCAL_TMP/ssh" -o ControlPersist=1800)
# shellcheck disable=SC2206
[[ -n "${SSH_OPTS:-}" ]] && SSH+=($SSH_OPTS)

# rsh <script> [args...]: run a script on the server with bash. The script
# travels base64-encoded in the command, so any login shell passes it through
# untouched and stdin stays free for data. S is sudo when the login is not
# root, and D is docker through it.
rsh() {
  local script b64 args=""
  script='S=$([ "$(id -u)" = 0 ] || echo "sudo -n"); D="$S docker"; '"$1"; shift
  b64="$(printf '%s' "$script" | base64 -w0)"
  [[ $# -gt 0 ]] && args="$(printf '%q ' "$@")"
  "${SSH[@]}" "$HOST" "bash -c \"\$(echo $b64 | base64 -d)\" _ $args"
}

run_id="$(_now)-$TARGET-small"
out_dir="$REPO_DIR/results/raw/small/$run_id"
# A prepare run measures nothing, so it leaves no run directory behind.
(( PREPARE )) && out_dir="$LOCAL_TMP/prepare"
mkdir -p "$out_dir"
brought=()      # images this run put on the server, removed at teardown unless kept
fw_client=""    # the address the firewall rules allow, set once they exist

teardown() {
  set +e
  local remove=("${brought[@]}")
  [[ "${KEEP_IMAGES:-0}" == 1 || "$PREPARE" == 1 ]] && remove=()
  if "${SSH[@]}" "$HOST" true >/dev/null 2>&1; then
    log "tearing down on the server"
    rsh '
      W="$1" F="$2" PORT="$3" CLIENT="$4"; shift 4
      [ -f "$W/sampler.pid" ] && kill "$(cat "$W/sampler.pid")" 2>/dev/null
      [ -f "$W/$F" ] && (cd "$W" && $D compose -f "$F" down -v --remove-orphans >/dev/null 2>&1)
      [ $# -gt 0 ] && $D image rm "$@" >/dev/null 2>&1
      if [ -n "$CLIENT" ]; then
        $S iptables -D DOCKER-USER -p tcp -m conntrack --ctorigdstport "$PORT" --ctdir ORIGINAL ! -s "$CLIENT" -j DROP 2>/dev/null
        $S ip6tables -D INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null
      fi
      $S rm -rf "$W"
      true
    ' "$W" "$compose_name" "$BENCH_PORT" "$fw_client" "${remove[@]}"
    "${SSH[@]}" -O exit "$HOST" >/dev/null 2>&1
  else
    warn "cannot reach $HOST to tear down: remove the stack and $W by hand"
  fi
  rm -rf "$LOCAL_TMP"
}
trap teardown EXIT

# ── rig ──────────────────────────────────────────────────────────────────────
log "[$TARGET] reading the server"
"${SSH[@]}" "$HOST" true || die "ssh to $HOST failed"
rig_remote="$(rsh '
  if ! command -v docker >/dev/null 2>&1; then
    command -v curl >/dev/null 2>&1 || { echo "no-curl"; exit 1; }
    curl -fsSL https://get.docker.com | $S sh >/dev/null 2>&1 || { echo "docker-install-failed"; exit 1; }
    echo "docker_installed_by_run=yes"
  fi
  $D compose version >/dev/null 2>&1 || { echo "no-compose"; exit 1; }
  echo "server_cpu=$(LC_ALL=C lscpu 2>/dev/null | sed -n "s/^Model name:[[:space:]]*//p" | head -1)"
  echo "server_nproc=$(nproc)"
  echo "server_mem_total_mb=$(free -m | awk "/^Mem:/{print \$2}")"
  echo "server_swap_total_mb=$(free -m | awk "/^Swap:/{print \$2}")"
  echo "server_cgroup_mem_max=$(cat /sys/fs/cgroup/memory.max 2>/dev/null || echo none)"
  echo "server_kernel=$(uname -r)"
  echo "server_arch=$(uname -m)"
  echo "server_os=$(. /etc/os-release 2>/dev/null; echo "${PRETTY_NAME:-unknown}")"
  echo "server_docker=$($D version --format "{{.Server.Version}}")"
  echo "server_load=$(cut -d " " -f1-3 /proc/loadavg)"
  echo "server_uptime_s=$(cut -d. -f1 /proc/uptime)"
  echo "client=${SSH_CLIENT%% *}"
')" || die "server preparation failed: $rig_remote"
loadgen_load="$(cut -d ' ' -f1-3 /proc/loadavg)"
client="$(sed -n 's/^client=//p' <<<"$rig_remote")"
[[ "$client" == *:* ]] && die "ssh reached the server over IPv6 ($client). Name its IPv4 address in HOST, so the firewall rule can allow only this machine"
[[ "$(sed -n 's/^server_arch=//p' <<<"$rig_remote")" == "$(uname -m)" ]] \
  || die "the server is $(sed -n 's/^server_arch=//p' <<<"$rig_remote") and this machine is $(uname -m): the images would not be the ones the local rig measured"

# A stack whose run could not tear it down would hold the port, or answer this
# run in its place with the data that run seeded, and its firewall rule would
# drop this machine if its address changed since. Its containers, their
# volumes, its sampler and its rules go before anything else.
left="$(rsh '
  [ -f "$1/sampler.pid" ] && kill "$(cat "$1/sampler.pid")" 2>/dev/null
  c=$($D ps -aq --filter name=^bench-); v=$($D volume ls -q | grep "^bench-")
  [ -z "$c" ] || $D rm -f -v $c >/dev/null || exit 1
  [ -z "$v" ] || $D volume rm $v >/dev/null || exit 1
  f=$($S iptables -S DOCKER-USER 2>/dev/null | grep -e "--ctorigdstport $2 ")
  printf "%s\n" "$f" | sed -n "s/^-A /-D /p" | while read -r r; do $S iptables $r; done
  while $S ip6tables -D INPUT -p tcp --dport "$2" -j DROP 2>/dev/null; do :; done
  echo $c $v ${f:+firewall rules}' "$W" "$BENCH_PORT")" || die "cannot remove what an earlier run left on the server"
[[ -n "$left" ]] && warn "[$TARGET] removed what an earlier run left on the server: $left"

# ── images ───────────────────────────────────────────────────────────────────
# An image the server already holds stays when it holds the same bytes as this
# machine's, or when this machine has none, so a load generator needs no images
# to drive a server prepared by the machine that has them. The ID for one
# platform names the same bytes on every machine. The plain ID does not,
# because docker save gives the copy an index of its own.
mapfile -t images < <(docker compose -f "$compose_file" config --images)
image_lines=()
for img in "${images[@]}"; do
  repo="${img%:*}"
  mine=""
  if docker image inspect "$img" >/dev/null 2>&1; then
    platform="linux/$(docker image inspect -f '{{.Architecture}}' "$img")"
    mine="$(docker image inspect --platform "$platform" -f '{{.Id}}' "$img")"
    theirs="$(rsh '$D image inspect --platform "$2" -f "{{.Id}}" "$1" 2>/dev/null' "$img" "$platform" || true)"
  else
    theirs="$(rsh '$D image inspect -f "{{.Id}}" "$1" 2>/dev/null' "$img" || true)"
  fi
  if [[ -n "$theirs" && ( -z "$mine" || "$theirs" == "$mine" ) ]]; then
    log "[$TARGET] $img is already on the server"
  else
    if [[ -n "$theirs" ]]; then
      log "[$TARGET] the server's $img holds other bytes than this machine's, replacing it"
      rsh '$D image rm "$1" >/dev/null' "$img" || die "cannot remove the server's $img"
    fi
    if [[ -z "$mine" ]]; then
      log "[$TARGET] $img is not on this machine, building or pulling it"
      docker compose -f "$compose_file" build >/dev/null 2>&1 || true
      docker image inspect "$img" >/dev/null 2>&1 || docker pull "$img" >/dev/null || die "cannot get $img on this machine"
    fi
    digest="$(docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$img" | grep -m1 "^$repo@" || true)"
    # An image the server lacked leaves with the run unless kept. One that
    # replaced the server's copy stays, so the server keeps this machine's bytes.
    [[ -n "$theirs" ]] || brought+=("$img")
    if [[ -n "$digest" ]] && rsh '$D pull -q "$1" >/dev/null 2>&1 && $D tag "$1" "$2"' "$digest" "$img"; then
      log "[$TARGET] $img pulled on the server by digest"
    else
      log "[$TARGET] $img streamed to the server"
      docker save --platform "linux/$(docker image inspect -f '{{.Architecture}}' "$img")" "$img" | gzip -1 \
        | rsh 'gunzip | $D load -q >/dev/null' || die "cannot copy $img to the server"
    fi
  fi
  # The record names the bytes the server runs: the repository digest it was
  # pulled by (a dash for an image built here) and the image ID on the server.
  read -r -a held < <(rsh '$D image inspect -f "{{.Id}}{{range .RepoDigests}} {{.}}{{end}}" "$1"' "$img")
  digest="-"
  for d in "${held[@]:1}"; do [[ "$d" == "$repo@"* ]] && { digest="${d#*@}"; break; }; done
  image_lines+=("image=$img $digest ${held[0]:-unknown}")
done
if (( PREPARE )); then
  log "[$TARGET] images ready on the server"
  exit 0
fi

# Only what the target needs: its compose file and the files it mounts.
mapfile -t mounts < <(sed -nE 's/^[[:space:]]*-[[:space:]]+\.\/([^:]+):.*/\1/p' "$compose_file")
tar -C "$(dirname "$compose_file")" -cf - "$compose_name" "${mounts[@]}" \
  | rsh 'mkdir -p "$1" && tar -C "$1" -xf -' "$W"

# The application port answers only this machine while the run lasts. A port
# Docker publishes skips the INPUT chain, so IPv4 is held in DOCKER-USER. On
# IPv6 Docker's userland proxy serves the port, which INPUT does see.
rsh '
  PORT="$1" CLIENT="$2"
  $S iptables -I DOCKER-USER -p tcp -m conntrack --ctorigdstport "$PORT" --ctdir ORIGINAL ! -s "$CLIENT" -j DROP
  $S ip6tables -I INPUT -p tcp --dport "$PORT" -j DROP 2>/dev/null || true
' "$BENCH_PORT" "$client" || die "cannot add the firewall rule that limits port $BENCH_PORT to this machine"
fw_client="$client"

# ── state capture ────────────────────────────────────────────────────────────
# Writes <name>.txt (the app container's state) and <name>-dmesg.txt (OOM lines).
capture_state() { # name
  rsh '
    cd "$1"; app=$($D compose -f "$2" ps -a -q app 2>/dev/null | head -1)
    if [ -n "$app" ]; then
      $D inspect -f "status={{.State.Status}}
exit_code={{.State.ExitCode}}
oom_killed={{.State.OOMKilled}}
restarts={{.RestartCount}}" "$app"
    else
      echo "status=missing"
    fi
  ' "$W" "$compose_name" > "$out_dir/$1.txt" 2>/dev/null || true
  rsh '$S dmesg 2>/dev/null | grep -iE "out of memory|oom-kill|killed process" | tail -20; true' \
    > "$out_dir/$1-dmesg.txt" 2>/dev/null || true
}

app_running() { rsh 'cd "$1"; app=$($D compose -f "$2" ps -q app | head -1); [ -n "$app" ] && [ "$($D inspect -f "{{.State.Running}}" "$app")" = true ]' "$W" "$compose_name"; }

# void <reason> <what happened>: the run measured the rig rather than the
# target, so it is kept for the record and no report reads it.
void() {
  echo "reason=$1" > "$out_dir/void.txt"
  warn "[$TARGET] $2, so the run is void"
}

# The firewall rule admits only the address the run started from. When this
# machine's address changes during a run, the server drops every request after
# the change, so the run is void rather than a result.
check_client() {
  local now
  now="$(rsh 'echo "${SSH_CLIENT%% *}"' 2>/dev/null || true)"
  if [[ -n "$now" && "$now" != "$client" ]]; then
    void client-address-changed "this machine's address changed during the run"
  fi
}

# ── boot ─────────────────────────────────────────────────────────────────────
log "[$TARGET] starting the stack on the server (limit ${BOOT_TIMEOUT}s)"
boot_start="$(_ms)"
boot_status="ok"; boot_reason=""
# The setup token travels on stdin, so it is never in a file or an argument on
# the server, and it leaves with the containers. ssh exits 255 when the
# connection failed, which says nothing about the stack.
rc=0
printf '%s\n' "$LYEVE_SETUP_TOKEN" | rsh '
  cd "$1"; IFS= read -r LYEVE_SETUP_TOKEN; export LYEVE_SETUP_TOKEN BENCH_PORT="$3"
  [ -n "$4" ] && export LYEVE_IMAGE="$4"
  $S ${S:+--preserve-env=LYEVE_SETUP_TOKEN,BENCH_PORT,LYEVE_IMAGE} docker compose -f "$2" up -d --no-build --pull never >/dev/null 2>&1
' "$W" "$compose_name" "$BENCH_PORT" "${LYEVE_IMAGE:-}" || rc=$?
(( rc == 255 )) && void ssh-lost "lost the connection to the server at compose up"
(( rc )) && { boot_status="failed"; boot_reason="compose-up-failed"; }
if [[ "$boot_status" == "ok" ]]; then
  deadline=$(( boot_start + BOOT_TIMEOUT * 1000 ))
  boot_status="failed"; boot_reason="not-ready-within-limit"
  while (( $(_ms) < deadline )); do
    code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' "$BASE_URL$ready" 2>/dev/null || true)"
    if [[ "$code" =~ ^2 ]]; then boot_status="ok"; boot_reason=""; break; fi
    sleep 0.25
  done
fi
boot_ms=$(( $(_ms) - boot_start ))
capture_state boot
if [[ "$boot_status" == "ok" ]]; then
  log "[$TARGET] answered $ready after ${boot_ms} ms"
else
  [[ "$(sed -n 's/^status=//p' "$out_dir/boot.txt")" =~ ^(exited|dead|missing)$ ]] && boot_reason="exited"
  warn "[$TARGET] boot failed: $boot_reason, recording the reason the server shows"
  rsh 'cd "$1"; $D compose -f "$2" logs --no-color --tail 60 app 2>&1' "$W" "$compose_name" \
    | sed "s/$LYEVE_SETUP_TOKEN/<setup-token>/g" > "$out_dir/boot-logs.txt" || true
fi
{ echo "status=$boot_status"; echo "reason=$boot_reason"; echo "boot_ms=$boot_ms"; echo "timeout_s=$BOOT_TIMEOUT"; echo "ready_path=$ready"; } > "$out_dir/boot-result.txt"

# ── rig record ───────────────────────────────────────────────────────────────
# The harness commit, marked dirty when the files that decide a run differ from it.
harness="$(git -C "$REPO_DIR" rev-parse --short=12 HEAD 2>/dev/null || true)"
[[ -n "$harness" ]] && ! git -C "$REPO_DIR" diff --quiet HEAD -- harness tools scenarios targets 2>/dev/null && harness+="-dirty"
rtt_ms=""
if [[ "$boot_status" == "ok" ]]; then
  rtt_ms="$(for _ in 1 2 3 4 5 6 7 8 9 10 11; do curl -s -o /dev/null -w '%{time_connect}\n' "$BASE_URL$health"; done \
    | sort -n | awk '{a[NR]=$1} END{if(NR) printf "%.2f", a[int((NR+1)/2)]*1000}')"
fi
{
  echo "date=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "harness=$harness"
  echo "provider=${PROVIDER:-}"
  echo "plan=${PLAN:-}"
  echo "campaign=${CAMPAIGN:-}"
  echo "target=$TARGET"
  echo "scenario=$SCENARIO"
  echo "rates=$RATES"
  grep -v '^client=' <<<"$rig_remote"
  echo "loadgen_cpu=$(LC_ALL=C lscpu 2>/dev/null | sed -n 's/^Model name:[[:space:]]*//p' | head -1)"
  echo "loadgen_nproc=$(nproc)"
  echo "loadgen_mem_total_mb=$(free -m | awk '/^Mem:/{print $2}')"
  echo "loadgen_load=$loadgen_load"
  echo "loadgen_k6=$(k6 version 2>/dev/null | head -1 | awk '{print $2}')"
  echo "rtt_ms=$rtt_ms"
  printf '%s\n' "${image_lines[@]}"
} > "$out_dir/rig.txt"

if [[ "$boot_status" != "ok" ]]; then
  check_client
  node "$REPO_DIR/tools/small-summary.mjs" "$out_dir"
  log "[$TARGET] done, boot failed → $out_dir"
  exit 0
fi

# ── idle memory ──────────────────────────────────────────────────────────────
SAMPLE='echo "sample $(date +%s)"; free -m | awk "/^Mem:/{print \"vm\", \$2, \$3, \$7}"; $D stats --no-stream --format "ctr {{.Name}} {{.MemUsage}} {{.CPUPerc}}"'
log "[$TARGET] idle: settling 45 s, then five samples"
sleep 45
rsh "for k in 1 2 3 4 5; do $SAMPLE; sleep 3; done" > "$out_dir/idle.txt"

# ── seed ─────────────────────────────────────────────────────────────────────
log "[$TARGET] seeding the shared dataset over the network"
token_file="$LOCAL_TMP/token"
seeded=1
BASE_URL="$BASE_URL" TARGET="$TARGET" TOKEN_FILE="$token_file" node "$HARNESS_DIR/seed/seed.mjs" || seeded=0

# ── steps ────────────────────────────────────────────────────────────────────
# A sampler on the server records memory every 5 s while the steps run. Each
# sample costs the server a docker stats call, which is why it is not every 2 s.
rsh '( trap "" HUP; while :; do '"$SAMPLE"'; sleep 5; done ) </dev/null >"$1/samples.txt" 2>&1 &
  echo $! > "$1/sampler.pid"' "$W"

: > "$out_dir/load.txt"
if [[ "$seeded" == "0" ]]; then
  warn "[$TARGET] seeding failed, recording the load steps as pending"
  echo "seed=failed" >> "$out_dir/load.txt"
else
  BENCH_TOKEN="$(cat "$token_file" 2>/dev/null || true)"
  for rate in $RATES; do
    # ssh exits 255 when it cannot reach the server. A target that stalls the
    # server is as likely a cause as the network, so the check asks again for
    # a minute and acts on the first answer.
    up=0
    app_running || up=$?
    for _ in 1 2 3; do
      (( up == 255 )) || break
      sleep 20
      up=0
      app_running || up=$?
    done
    if (( up == 255 )); then
      void ssh-lost "lost the connection to the server before ${rate} req/s"
      break
    elif (( up )); then
      echo "stopped=app-not-running before ${rate}" >> "$out_dir/load.txt"
      warn "[$TARGET] the application is no longer running, stopping before ${rate} req/s"
      break
    fi
    log "[$TARGET/$SCENARIO] ${rate} req/s: warm-up 10s (discarded)"
    k6 run --quiet --summary-mode=disabled \
      -e TARGET="$TARGET" -e SCENARIO="$SCENARIO" -e BASE_URL="$BASE_URL" -e DURATION=10s -e BENCH_RATE="$rate" \
      -e TOKEN="$BENCH_TOKEN" "$HARNESS_DIR/k6/scenario.js" >/dev/null 2>&1 || true
    log "[$TARGET/$SCENARIO] ${rate} req/s: measuring $duration"
    summary="$out_dir/$SCENARIO-r$rate.summary.json"
    # The first line of /proc/stat on both machines, read just outside the
    # window, gives each one's busy and stolen share of it.
    cpu_server="$(rsh 'head -1 /proc/stat' || true)"
    cpu_here="$(head -1 /proc/stat)"
    k6 run --quiet -e TARGET="$TARGET" -e SCENARIO="$SCENARIO" -e BASE_URL="$BASE_URL" \
      -e DURATION="$duration" -e BENCH_RATE="$rate" -e TOKEN="$BENCH_TOKEN" \
      --summary-export "$summary" "$HARNESS_DIR/k6/scenario.js" >/dev/null 2>&1 || true
    {
      echo "loadgen_before=$cpu_here"
      echo "loadgen_after=$(head -1 /proc/stat)"
      echo "server_before=$cpu_server"
      echo "server_after=$(rsh 'head -1 /proc/stat' || true)"
    } > "$out_dir/$SCENARIO-r$rate.cpu.txt"
    echo "step=$rate" >> "$out_dir/load.txt"
    if ! verdict="$(node "$REPO_DIR/tools/small-summary.mjs" --check "$summary" "$rate" "$budget")"; then
      echo "stopped=$verdict" >> "$out_dir/load.txt"
      log "[$TARGET/$SCENARIO] $verdict, so no higher rate runs"
      break
    fi
    log "[$TARGET/$SCENARIO] $verdict"
  done
  BENCH_TOKEN=""
fi
: > "$token_file"

rsh 'kill "$(cat "$1/sampler.pid")" 2>/dev/null; cat "$1/samples.txt"' "$W" > "$out_dir/load-samples.txt" || true
capture_state end
check_client

node "$REPO_DIR/tools/small-summary.mjs" "$out_dir"
log "[$TARGET] done → $out_dir"
