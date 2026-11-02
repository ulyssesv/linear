#!/usr/bin/env bash
# Container smoke for the web image (SEED-R23, SEED-R24, MIRROR-R30).
#
# Runs the image under the Docker equivalent of the pod security context infra applies
# (runAsNonRoot, allowPrivilegeEscalation: false, capabilities.drop: [ALL],
# seccompProfile: RuntimeDefault, readOnlyRootFilesystem) against a throwaway Postgres on
# a private Docker network: `migrate` applies the migrations and is safe to run again,
# `serve` answers /healthz and is ready on /readyz, and `scheduler` behaves as specified.
#
# Usage: tools/container-smoke.sh <image>
# Optional env: EXPECTED_VERSION (exact), EXPECTED_COMMIT (prefix, so a short SHA works),
#               SMOKE_TIMEOUT (seconds to wait for Postgres and for /healthz, default 30),
#               POSTGRES_IMAGE (default: the postgres service's image in compose.yaml).
set -euo pipefail

image=${1:?usage: tools/container-smoke.sh <image>}
timeout=${SMOKE_TIMEOUT:-30}
name="linear-smoke-$$"
db="linear-smoke-db-$$"
network="linear-smoke-$$"
root=$(cd "$(dirname "$0")/.." && pwd)
postgres_image=${POSTGRES_IMAGE:-$(docker compose -f "$root/compose.yaml" config --images postgres)}
database_url="postgres://linear:linear@${db}:5432/linear"

# Docker's default seccomp profile is the RuntimeDefault equivalent, so it needs no flag.
hardening=(--user 10001 --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp)

cleanup() {
  docker rm -f "$name" "$db" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() {
  echo "container-smoke: FAIL: $*" >&2
  if docker inspect "$name" >/dev/null 2>&1; then
    echo "--- container logs ---" >&2
    docker logs "$name" >&2 || true
  fi
  exit 1
}

pass() { echo "container-smoke: ok: $*"; }

field() { sed -n "s/.*\"$1\":\"\\([^\"]*\\)\".*/\\1/p" <<<"$2"; }

# A one-off command of the image, hardened, on the database network.
oneoff() { docker run --rm "${hardening[@]}" --network "$network" "$@"; }

# runAsNonRoot needs a numeric, non-zero uid in the image itself.
user=$(docker image inspect --format '{{.Config.User}}' "$image")
[[ ${user%%:*} =~ ^[0-9]+$ && ${user%%:*} != 0 ]] || fail "image USER is '$user', want a numeric non-root uid"
pass "image runs as uid ${user%%:*}"

# A throwaway database configured as production's: logical replication on (docs/deploy.md).
docker network create "$network" >/dev/null
docker run --detach --name "$db" --network "$network" \
  --env POSTGRES_USER=linear --env POSTGRES_PASSWORD=linear --env POSTGRES_DB=linear \
  "$postgres_image" postgres -c wal_level=logical >/dev/null
deadline=$((SECONDS + timeout))
# Over TCP: during its first initialisation the image runs a socket-only server.
until docker exec "$db" pg_isready --quiet --host 127.0.0.1 --username linear --dbname linear; do
  ((SECONDS < deadline)) || fail "Postgres ($postgres_image) was not ready within ${timeout}s"
  sleep 1
done
pass "throwaway Postgres is ready ($postgres_image)"

# MIRROR-R5: migrate applies the pending migrations, then has nothing left to do, and
# fails loudly when the database cannot be reached.
output=$(oneoff --env DATABASE_URL="$database_url" "$image" migrate 2>&1) || fail "'migrate' exited non-zero: $output"
[[ $output == *"applied"* ]] || fail "'migrate' applied nothing to an empty database: $output"
pass "$output"
output=$(oneoff --env DATABASE_URL="$database_url" "$image" migrate 2>&1) || fail "'migrate' run again exited non-zero: $output"
[[ $output == *"up to date"* ]] || fail "'migrate' run again did not report the database up to date: $output"
pass "$output"
code=0
oneoff --env DATABASE_URL="postgres://linear:linear@${db}:1/linear" "$image" migrate >/dev/null 2>&1 || code=$?
[[ $code != 0 ]] || fail "'migrate' exited 0 against an unreachable database"
pass "'migrate' exits $code when the database cannot be reached"

docker run --detach --name "$name" "${hardening[@]}" --network "$network" \
  --env DATABASE_URL="$database_url" --publish 127.0.0.1::3000 "$image" serve >/dev/null
host_port=$(docker port "$name" 3000/tcp | head -n 1 | sed 's/.*://')
url="http://127.0.0.1:${host_port}/healthz"

body=""
deadline=$((SECONDS + timeout))
while ((SECONDS < deadline)); do
  [[ $(docker inspect --format '{{.State.Running}}' "$name") == true ]] || fail "container exited before /healthz answered"
  if body=$(curl --silent --fail --max-time 2 "$url"); then break; fi
  body=""
  sleep 1
done
[[ -n $body ]] || fail "/healthz did not answer 200 within ${timeout}s"
pass "/healthz answered: $body"

[[ $(field status "$body") == ok ]] || fail "/healthz status is not ok"
version=$(field version "$body")
commit=$(field commit "$body")
[[ -n $version ]] || fail "/healthz has no version"
[[ -n $commit ]] || fail "/healthz has no commit"
if [[ -n ${EXPECTED_VERSION:-} && $version != "$EXPECTED_VERSION" ]]; then
  fail "version is '$version', expected '$EXPECTED_VERSION'"
fi
if [[ -n ${EXPECTED_COMMIT:-} && $commit != "$EXPECTED_COMMIT"* ]]; then
  fail "commit is '$commit', expected '$EXPECTED_COMMIT'"
fi
pass "version $version, commit $commit"

# MIRROR-R6: ready only with the database.
ready=$(curl --silent --fail --max-time 5 "http://127.0.0.1:${host_port}/readyz") || fail "/readyz did not answer 200"
[[ $ready == *'"database":{"status":"ok"}'* ]] || fail "/readyz has no passing database check: $ready"
pass "/readyz answered: $ready"

# SEED-R24: scheduler is still reserved and exits 2.
# MIRROR T5 turns this into a run against the throwaway database that must exit 0
# (MIRROR-R13); the command line below already passes it DATABASE_URL.
code=0
oneoff --env DATABASE_URL="$database_url" "$image" scheduler >/dev/null 2>&1 || code=$?
[[ $code == 2 ]] || fail "'scheduler' exited $code, want 2"
pass "'scheduler' is reserved and exits 2"

echo "container-smoke: passed for $image"
