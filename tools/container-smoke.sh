#!/usr/bin/env bash
# Container smoke for the web image (SEED-R23, SEED-R24).
#
# Runs the image under the Docker equivalent of the pod security context infra applies
# (runAsNonRoot, allowPrivilegeEscalation: false, capabilities.drop: [ALL],
# seccompProfile: RuntimeDefault, readOnlyRootFilesystem), waits for /healthz to answer,
# checks that the reserved subcommands exit 2, and that serve refuses to start without the
# environment it requires. serve gets harmless placeholder values for its required names.
#
# Usage: tools/container-smoke.sh <image>
# Optional env: EXPECTED_VERSION (exact), EXPECTED_COMMIT (prefix, so a short SHA works),
#               SMOKE_TIMEOUT (seconds to wait for /healthz, default 30).
set -euo pipefail

image=${1:?usage: tools/container-smoke.sh <image>}
timeout=${SMOKE_TIMEOUT:-30}
name="linear-smoke-$$"

# Docker's default seccomp profile is the RuntimeDefault equivalent, so it needs no flag.
hardening=(--user 10001 --read-only --cap-drop ALL --security-opt no-new-privileges --tmpfs /tmp)

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
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

# runAsNonRoot needs a numeric, non-zero uid in the image itself.
user=$(docker image inspect --format '{{.Config.User}}' "$image")
[[ ${user%%:*} =~ ^[0-9]+$ && ${user%%:*} != 0 ]] || fail "image USER is '$user', want a numeric non-root uid"
pass "image runs as uid ${user%%:*}"

# Harmless values for the names serve requires (MIRROR-R7); none is a credential.
serve_env=(
  --env DATABASE_URL=postgres://smoke:smoke@localhost:5432/smoke
  --env LINEAR_CLIENT_ID=smoke-client-id
  --env LINEAR_CLIENT_SECRET=smoke-client-secret
  --env LINEAR_WEBHOOK_SECRET=smoke-webhook-secret
  --env SESSION_SECRET=smoke-session-secret-at-least-32-characters
  --env TOKEN_ENCRYPTION_KEY=c21va2UtdG9rZW4tZW5jcnlwdGlvbi1rZXktMzItYnk=
)

docker run --detach --name "$name" "${hardening[@]}" "${serve_env[@]}" --publish 127.0.0.1::3000 "$image" serve >/dev/null
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

for command in scheduler migrate; do
  code=0
  docker run --rm "${hardening[@]}" "$image" "$command" >/dev/null 2>&1 || code=$?
  [[ $code == 2 ]] || fail "'$command' exited $code, want 2"
  pass "'$command' is reserved and exits 2"
done

# MIRROR-R7: serve refuses to start without its environment, naming what is missing.
code=0
output=$(docker run --rm "${hardening[@]}" "$image" serve 2>&1) || code=$?
[[ $code == 1 ]] || fail "'serve' without its environment exited $code, want 1"
grep -q "DATABASE_URL: is required" <<<"$output" || fail "'serve' did not name DATABASE_URL as missing"
pass "'serve' without its environment exits 1 listing the missing names"

echo "container-smoke: passed for $image"
