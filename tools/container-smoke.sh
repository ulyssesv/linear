#!/usr/bin/env bash
# Container smoke for the web image (SEED-R23, SEED-R24, MIRROR-R30).
#
# Runs the image under the Docker equivalent of the pod security context infra applies
# (runAsNonRoot, allowPrivilegeEscalation: false, capabilities.drop: [ALL],
# seccompProfile: RuntimeDefault, readOnlyRootFilesystem) against a throwaway Postgres on
# a private Docker network: `migrate` applies the migrations and is safe to run again,
# `serve` answers /healthz and is ready on /readyz, and `scheduler` runs a pass and exits 0,
# first bootstrapping the empty mirror, then reconciling it with the app token it stored.
# serve gets the throwaway database and harmless placeholders for its other required
# names, and must refuse to start without its environment.
#
# The smoke has no Linear credentials and never reaches Linear: `scheduler` talks to
# tools/linear-stub.mjs, run with the image's own Node on the same network, through
# LINEAR_API_URL, a name only tests and this smoke set.
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
stub="linear-smoke-stub-$$"
network="linear-smoke-$$"
root=$(cd "$(dirname "$0")/.." && pwd)
postgres_image=${POSTGRES_IMAGE:-$(docker compose -f "$root/compose.yaml" config --images postgres)}
database_url="postgres://linear:linear@${db}:5432/linear"

# Docker's default seccomp profile is the RuntimeDefault equivalent, so it needs no flag.
hardening=(--user 10001 --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp)

cleanup() {
  docker rm -f "$name" "$db" "$stub" >/dev/null 2>&1 || true
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

# Harmless values for the other names serve requires (MIRROR-R7); none is a credential.
serve_env=(
  --env LINEAR_CLIENT_ID=smoke-client-id
  --env LINEAR_CLIENT_SECRET=smoke-client-secret
  --env LINEAR_WEBHOOK_SECRET=smoke-webhook-secret
  --env SESSION_SECRET=smoke-session-secret-at-least-32-characters
  --env TOKEN_ENCRYPTION_KEY=c21va2UtdG9rZW4tZW5jcnlwdGlvbi1rZXktMzItYnk=
)

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
  --env DATABASE_URL="$database_url" "${serve_env[@]}" --publish 127.0.0.1::3000 "$image" serve >/dev/null
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

# MIRROR-R13: scheduler runs one pass against the throwaway database and exits 0. Linear is
# the stub, run hardened with the image's own Node; the credentials are placeholders.
docker run --detach --name "$stub" "${hardening[@]}" --network "$network" --entrypoint node \
  "$image" --input-type=module --eval "$(cat "$root/tools/linear-stub.mjs")" >/dev/null
deadline=$((SECONDS + timeout))
until docker logs "$stub" 2>&1 | grep -q "linear-stub: listening"; do
  ((SECONDS < deadline)) || fail "the Linear stub did not start within ${timeout}s"
  sleep 1
done
scheduler_env=(
  --env DATABASE_URL="$database_url"
  --env LINEAR_API_URL="http://${stub}:8080"
  "${serve_env[@]}"
)
output=$(oneoff "${scheduler_env[@]}" "$image" scheduler 2>&1) || fail "'scheduler' exited non-zero: $output"
[[ $output == *'"outcome":"ok"'*'"source":"bootstrap"'* ]] || fail "'scheduler' did not bootstrap the empty mirror: $output"
pass "'scheduler' bootstrapped the empty mirror and exited 0"
output=$(oneoff "${scheduler_env[@]}" "$image" scheduler 2>&1) || fail "'scheduler' run again exited non-zero: $output"
[[ $output == *'"outcome":"ok"'*'"source":"reconcile"'* ]] || fail "'scheduler' run again did not reconcile: $output"
pass "'scheduler' reconciled and exited 0: $output"
tokens=$(docker logs "$stub" 2>&1 | grep -c "linear-stub: token" || true)
[[ $tokens == 1 ]] || fail "two scheduler runs requested $tokens app tokens, want 1 (the second reuses the stored one)"
pass "two scheduler runs shared one app token"
code=0
oneoff "${scheduler_env[@]}" --env DATABASE_URL="postgres://linear:linear@${db}:1/linear" "$image" scheduler >/dev/null 2>&1 || code=$?
[[ $code != 0 ]] || fail "'scheduler' exited 0 against an unreachable database"
pass "'scheduler' exits $code when the database cannot be reached"

# MIRROR-R7: serve refuses to start without its environment, naming what is missing.
code=0
output=$(docker run --rm "${hardening[@]}" "$image" serve 2>&1) || code=$?
[[ $code == 1 ]] || fail "'serve' without its environment exited $code, want 1"
grep -q "DATABASE_URL: is required" <<<"$output" || fail "'serve' did not name DATABASE_URL as missing"
pass "'serve' without its environment exits 1 listing the missing names"

echo "container-smoke: passed for $image"
