#!/usr/bin/env bash
#
# small-sweep.sh: run a whole small-server campaign against one server, in rounds.
#
# A campaign is every self-hosted target on every read scenario, run ROUNDS
# times on one server, so the report can give each figure as a median with its
# range. The server hosts the targets in turn:
#
#   hold    mask the server's active timers and hold snap refreshes, so no
#           package or maintenance job shares the CPU with a step. Both come
#           back when the sweep ends, however it ends
#   images  put every target's images on the server once (small.sh --prepare)
#   runs    for each round, each scenario and each target: reboot the server, so
#           no target inherits another's memory, page cache or kernel log, wait
#           until it has been up two minutes with Docker active and its load
#           under 0.3, wait until this machine's load is under half its cores,
#           then run small.sh
#
# The order interleaves the targets, so a slow hour at the provider spreads over
# all of them instead of landing on one. A run the campaign already holds is not
# run again, so the same command resumes a stopped sweep, and a second pass
# retries a run that failed. A void run, or one small.sh could not finish, moves
# to results/raw/small/void/, which git ignores and no report reads.
#
# Usage:
#   HOST=ubuntu@10.0.1.20 KEY=~/.ssh/bench.pem CAMPAIGN=2026-10-25-aws-t2-micro \
#     PROVIDER=AWS PLAN="t2.micro" ./small-sweep.sh
#   HOST=ubuntu@203.0.113.10 KEY=~/.ssh/bench.pem ./small-sweep.sh --prepare
#   HOST=ubuntu@10.0.1.20 KEY=~/.ssh/bench.pem ./small-sweep.sh --restore
#
# --prepare puts every target's images on the server and stops. Run it from the
# machine that holds the images, so a load generator without them can run the
# sweep. --restore unmasks the timers and releases the snap hold a stopped sweep
# left on the server. Neither measures anything.
#
# Environment, beside every variable small.sh reads:
#   CAMPAIGN   the name every run of the sweep carries (required): letters,
#              digits, dots, dashes and underscores
#   ROUNDS     runs of each target on each scenario (default 3)
#   TARGETS    targets, in the order they run (default every self-hosted target)
#   SCENARIOS  read scenarios, in the order they run (default every read scenario)
#   REBOOT     0 runs without rebooting the server first (default 1)
set -euo pipefail

HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$HARNESS_DIR/.." && pwd)"
RAW="$REPO_DIR/results/raw/small"
# Where the server keeps what the sweep held, so a resumed or stopped sweep
# restores exactly that.
STATE=/var/lib/lyeve-bench

log()  { printf '\033[36m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

RESTORE=0
PREPARE=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --prepare) PREPARE=1; shift ;;
    --restore) RESTORE=1; shift ;;
    -h|--help) grep -E '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown arg: $1" ;;
  esac
done

[[ -n "${HOST:-}" ]] || die "set HOST to the server's ssh destination, for example HOST=root@203.0.113.10"
[[ -n "${KEY:-}" ]] || die "set KEY to the private key for $HOST"
KEY="${KEY/#\~/$HOME}"
[[ -r "$KEY" ]] || die "cannot read the key file named in KEY"

SSH=(ssh -i "$KEY" -p "${SSH_PORT:-22}" -o IdentitiesOnly=yes -o BatchMode=yes -o ConnectTimeout=10
     -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=5 -o ServerAliveCountMax=3)
# shellcheck disable=SC2206
[[ -n "${SSH_OPTS:-}" ]] && SSH+=($SSH_OPTS)

# rsh <script> [args...]: run a script on the server with bash, the way small.sh
# does. No connection is shared, because the server reboots between runs.
rsh() {
  local script b64 args=""
  script='S=$([ "$(id -u)" = 0 ] || echo "sudo -n"); '"$1"; shift
  b64="$(printf '%s' "$script" | base64 -w0)"
  [[ $# -gt 0 ]] && args="$(printf '%q ' "$@")"
  "${SSH[@]}" "$HOST" "bash -c \"\$(echo $b64 | base64 -d)\" _ $args" </dev/null
}

read -r -d '' HOLD <<'SH' || true
STATE="$1"
$S mkdir -p "$STATE"
# Every timer active now, except a transient one systemd-run made.
now=$(systemctl list-units --type=timer --state=active --no-legend --plain | awk '{print $1}' | grep -v '^run-' || true)
if [ -n "$now" ]; then
  printf '%s\n' $now | $S tee -a "$STATE/held-timers" >/dev/null
  $S systemctl mask --now $now >/dev/null 2>&1
fi
if command -v snap >/dev/null 2>&1 && [ ! -f "$STATE/snap-held" ] && [ -z "$(snap get system refresh.hold 2>/dev/null)" ]; then
  $S snap refresh --hold >/dev/null 2>&1 && $S touch "$STATE/snap-held"
fi
# A job a timer started before the hold runs to its end before the first run.
for _ in $(seq 120); do
  busy=""
  for t in $(cat "$STATE/held-timers" 2>/dev/null); do
    systemctl is-active --quiet "${t%.timer}.service" && busy="$busy ${t%.timer}"
  done
  [ -z "$busy" ] && break
  sleep 5
done
[ -n "$busy" ] && echo "still running after ten minutes:$busy"
echo "held: $(sort -u "$STATE/held-timers" 2>/dev/null | tr '\n' ' ')"
SH

read -r -d '' RELEASE <<'SH' || true
STATE="$1"
if [ -f "$STATE/held-timers" ]; then
  held=$(sort -u "$STATE/held-timers")
  $S systemctl unmask $held >/dev/null 2>&1
  $S systemctl start $held >/dev/null 2>&1
  $S rm -f "$STATE/held-timers"
  echo "timers back: $(echo $held | wc -w)"
fi
if [ -f "$STATE/snap-held" ]; then
  $S snap refresh --unhold >/dev/null 2>&1
  $S rm -f "$STATE/snap-held"
  echo "snap refreshes back"
fi
true
SH

release() {
  if rsh "$RELEASE" "$STATE"; then
    log "the server's timers and snap refreshes are back"
  else
    warn "cannot reach $HOST to restore its timers: run this script with --restore"
  fi
}

if (( RESTORE )); then
  release
  exit 0
fi

TARGETS="${TARGETS:-$(node -e 'console.log(require(process.argv[1]).targets.filter(t=>t.kind!=="hosted").map(t=>t.id).join(" "))' "$REPO_DIR/targets/targets.json")}"
prepare() {
  for t in $TARGETS; do
    "$HARNESS_DIR/small.sh" --target "$t" --prepare </dev/null || die "cannot put $t's images on the server"
  done
}
if (( PREPARE )); then
  prepare
  exit 0
fi

[[ -n "${CAMPAIGN:-}" ]] || die "set CAMPAIGN to the sweep's name, for example CAMPAIGN=2026-10-25-aws-t2-micro"
[[ "$CAMPAIGN" =~ ^[A-Za-z0-9._-]+$ ]] || die "CAMPAIGN takes letters, digits, dots, dashes and underscores"
ROUNDS="${ROUNDS:-3}"
[[ "$ROUNDS" =~ ^[1-9][0-9]*$ ]] || die "ROUNDS must be a positive number"
REBOOT="${REBOOT:-1}"
SCENARIOS="${SCENARIOS:-$(node -e 'console.log(require(process.argv[1]).scenarios.filter(s=>s.category==="read").map(s=>s.id).join(" "))' "$REPO_DIR/scenarios/scenarios.json")}"
node -e '
  const [t, s, targets, scenarios] = process.argv.slice(1);
  const T = require(t).targets, S = require(s).scenarios;
  for (const id of targets.split(/\s+/).filter(Boolean)) {
    const x = T.find((y) => y.id === id);
    if (!x || x.kind === "hosted") { console.error(`not a self-hosted target: ${id}`); process.exit(1); }
  }
  for (const id of scenarios.split(/\s+/).filter(Boolean)) {
    if ((S.find((y) => y.id === id) || {}).category !== "read") { console.error(`not a read scenario: ${id}`); process.exit(1); }
  }' "$REPO_DIR/targets/targets.json" "$REPO_DIR/scenarios/scenarios.json" "$TARGETS" "$SCENARIOS" || die "fix TARGETS or SCENARIOS"
# small.sh reads both. The images stay on the server between runs.
export CAMPAIGN KEEP_IMAGES=1

reboot_server() {
  local before now deadline
  before="$(rsh 'cat /proc/sys/kernel/random/boot_id')" || die "cannot reach $HOST"
  rsh '$S systemd-run --quiet --on-active=2 /usr/bin/systemctl reboot' >/dev/null || die "cannot reboot $HOST"
  deadline=$(( SECONDS + 600 ))
  until now="$(rsh 'cat /proc/sys/kernel/random/boot_id' 2>/dev/null)" && [[ -n "$now" && "$now" != "$before" ]]; do
    (( SECONDS < deadline )) || die "$HOST did not come back within ten minutes of the reboot"
    sleep 5
  done
}

# The server counts as quiet once it has been up two minutes, Docker runs and
# the one-minute load is under 0.3. A run starts after ten minutes regardless,
# and the rig record keeps the load it started at.
wait_server() {
  rsh '
    for _ in $(seq 120); do
      up=$(cut -d. -f1 /proc/uptime); load=$(cut -d" " -f1 /proc/loadavg)
      if [ "$up" -ge 120 ] && systemctl is-active --quiet docker && awk "BEGIN{exit !($load < 0.3)}"; then
        echo "server quiet: up ${up}s, load $load"; exit 0
      fi
      sleep 5
    done
    echo "server still busy after ten minutes: load $load"' || true
}

wait_here() {
  local limit deadline=$(( SECONDS + 600 ))
  limit="$(awk -v n="$(nproc)" 'BEGIN{print n/2}')"
  until awk -v l="$limit" '{exit !($1 < l)}' /proc/loadavg; do
    if (( SECONDS >= deadline )); then
      warn "this machine's load is still $(cut -d' ' -f1 /proc/loadavg) after ten minutes"
      return
    fi
    sleep 10
  done
}

held_runs() { node "$REPO_DIR/tools/small-report.mjs" --count "$CAMPAIGN" "$1" "$2"; }

# run <round> <scenario> <target>
run() {
  local round="$1" s="$2" t="$3" before dir rc
  log "round $round, $s, $t ($(date -u +%H:%M) UTC)"
  mkdir -p "$RAW"
  before="$(ls -1 "$RAW")"
  if (( REBOOT )); then reboot_server; fi
  wait_server
  wait_here
  set +e
  "$HARNESS_DIR/small.sh" --target "$t" --scenario "$s" </dev/null
  rc=$?
  set -e
  dir="$(comm -13 <(sort <<<"$before") <(ls -1 "$RAW" | sort) | grep -E -- "-$t-small$" | tail -1 || true)"
  [[ -n "$dir" ]] || { warn "small.sh left no run directory (exit $rc)"; return; }
  if (( rc != 0 )) || [[ ! -f "$RAW/$dir/small.json" ]]; then
    [[ -f "$RAW/$dir/void.txt" ]] || echo "reason=harness-exit-$rc" > "$RAW/$dir/void.txt"
  fi
  if [[ -f "$RAW/$dir/void.txt" ]]; then
    mkdir -p "$RAW/void"
    mv "$RAW/$dir" "$RAW/void/"
    warn "run void ($(sed -n 's/^reason=//p' "$RAW/void/$dir/void.txt")): moved to results/raw/small/void/$dir, the next pass runs it again"
  fi
}

trap release EXIT
log "holding the server's timers and snap refreshes"
rsh "$HOLD" "$STATE"
prepare

for _ in 1 2; do
  for round in $(seq "$ROUNDS"); do
    for s in $SCENARIOS; do
      for t in $TARGETS; do
        (( $(held_runs "$t" "$s") >= round )) && continue
        run "$round" "$s" "$t"
      done
    done
  done
done

node "$REPO_DIR/tools/small-report.mjs"
missing=0
for s in $SCENARIOS; do
  for t in $TARGETS; do
    n="$(held_runs "$t" "$s")"
    if (( n < ROUNDS )); then
      warn "$t on $s has $n of $ROUNDS runs"
      missing=1
    fi
  done
done
if (( missing )); then
  die "the campaign is incomplete: run the same command again to resume it"
fi
log "campaign $CAMPAIGN complete: results/SMALL.md"
