#!/usr/bin/env bash
# =============================================================================
#  Kokli's deploy — runs ON the server
# =============================================================================
#  Jenkins (the Jenkinsfile, stage 4) uploads this file for every deploy as
#  ~/kokli/deploy-<run>.sh, and starts it with:
#
#      bash ~/kokli/deploy-<run>.sh --start <image> <tag> <run> [registry]
#
#  --start runs it again DETACHED from the ssh session — its output going to
#  ~/kokli/deploy-<run>.log — and prints the process id. Jenkins follows that
#  log until the process ends, then reads its exit code from
#  ~/kokli/deploy-<run>.result. Detached, because nothing on Jenkins' side —
#  an abort, a timeout, Jenkins restarting, a dropped connection — may stop a
#  deploy half-way through a swap. It always runs to its end: live, or rolled
#  back.
#
#  Its last line, KOKLI-DEPLOYED <image>, is printed only when the new version
#  is live and healthy. What each step does, and what a failure leaves behind:
#  DEPLOYMENT.md §7e.
#
#  The whole deploy is one function, called with stdin from /dev/null: bash
#  reads a script as it runs it, and the function is read whole first.
# =============================================================================

start() {
  local self run i
  self="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  run="$3"
  cd ~/kokli
  rm -f "deploy-$run.pid" "deploy-$run.result"
  setsid nohup bash "$self" "$@" > "deploy-$run.log" 2>&1 < /dev/null &
  for i in $(seq 1 100); do
    [ -s "deploy-$run.pid" ] && break
    sleep 0.1
  done
  cat "deploy-$run.pid"
}

main() {
set -euo pipefail
NEW="$1"
TAG="$2"
RUN="$3"
# Empty without a registry — and ssh drops an empty argument altogether, which
# is why it comes last.
REGISTRY="${4:-}"
REPO="${NEW%:*}"
ROLLBACK="$REPO:rollback"
K="$HOME/kokli"
cd "$K"
echo "$$" > "deploy-$RUN.pid"

# On the way out, success or failure: the exit code for Jenkins, and the
# registry login (only ever for the pull) forgotten. That login lives in a
# Docker config of Kokli's own, never in this account's ~/.docker, which other
# people's tools on this server use too.
trap 'rc=$?; if [ -n "$REGISTRY" ]; then DOCKER_CONFIG="$K/.docker" docker logout "$REGISTRY" >/dev/null 2>&1 || true; fi; echo "$rc" > "$K/deploy-$RUN.result"' EXIT

# Earlier deploys' scripts, logs and results: a month of them is kept.
find "$K" -maxdepth 1 -name 'deploy-*' -mtime +30 -delete 2>/dev/null || true

# One at a time. The nightly backup and the weekly restore check take this
# same lock (the cron block bootstrap.sh installs): a deploy that stopped the
# container under a running backup would leave half a dump behind.
exec 9>>.kokli.lock
if ! flock -w 1500 9; then
  echo "ERROR: a backup, a restore check or another deploy has held ~/kokli/.kokli.lock for 25 minutes."
  echo "       Nothing was changed."
  exit 1
fi

# Healthy: answering, able to reach MySQL, and reporting the version asked for
# (none asked for: any version).
healthy() {
  local want="$1" body i
  for i in $(seq 1 45); do
    body="$(docker exec kokli node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.text()).then(t=>console.log(t)).catch(()=>process.exit(1))" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -q '"ok":true' && { [ -z "$want" ] || printf '%s' "$body" | grep -q "$want"; }; then
      return 0
    fi
    sleep 2
  done
  return 1
}

PREV="$(sed -n 's/^KOKLI_IMAGE=//p' .env 2>/dev/null || true)"
echo "live now:  ${PREV:-nothing yet - this is the first deploy}"
echo "deploying: $NEW"

# Built by Jenkins on this very Docker? Then it is already here.
if docker image inspect "$NEW" >/dev/null 2>&1; then
  echo "image is already on this server"
elif [ -n "$REGISTRY" ]; then
  DOCKER_CONFIG="$K/.docker" docker pull --quiet "$NEW"
else
  echo "ERROR: $NEW is not on this server, and there is no registry to fetch it from."
  echo "       Without a registry, Jenkins and the app must share a machine. Otherwise set"
  echo "       KOKLI_IMAGE_REPO to a registry path - see WHERE THE IMAGE GOES in the Jenkinsfile."
  exit 1
fi
NEW_ID="$(docker image inspect -f '{{.Id}}' "$NEW")"

# A first deploy has no live compose file to back up with: this commit's
# becomes the live one at once — there is nothing running that it could break.
rm -f docker-compose.yml.prev docker-compose.override.yml.prev
for f in docker-compose.yml docker-compose.override.yml; do
  if [ ! -f "$f" ] && [ -f "$f.new" ]; then mv "$f.new" "$f"; fi
done

# This commit's compose files, checked against this server's own settings
# before anything depends on them.
files=(-f docker-compose.yml)
if [ -f docker-compose.yml.new ]; then files=(-f docker-compose.yml.new); fi
if [ -f docker-compose.override.yml.new ]; then files+=(-f docker-compose.override.yml.new)
elif [ -f docker-compose.override.yml ]; then files+=(-f docker-compose.override.yml); fi
if ! KOKLI_IMAGE="$NEW" docker compose "${files[@]}" config -q; then
  echo "ERROR: this commit's docker-compose.yml does not work with this server's settings (see above)."
  echo "       Nothing was changed."
  exit 1
fi

# A backup BEFORE anything changes. It costs seconds, and it is the difference
# between a bad deploy and a bad day. Taken with the NEW image, which also
# proves that image can reach MySQL before the old one is stopped: if this
# fails, the site is still up and nothing has been touched. Into a pool of its
# own (backups/predeploy, the newest ten), so a busy day of deploys never pushes
# the nightly dumps out of their thirty slots. Its own container name, so it
# can never collide with the `kokli` container serving patients right now.
echo "== backing up the database"
if ! KOKLI_IMAGE="$NEW" docker compose run --rm --no-deps -T --name "kokli-backup-$TAG-$$" -e BACKUP_DIR=/app/backups/predeploy -e BACKUP_KEEP=10 kokli node scripts/backup.js </dev/null; then
  echo "ERROR: the backup failed, so nothing was changed - ${PREV:-the current version} is still live."
  echo "       Most often the new container cannot reach MySQL: DB_HOST in ~/kokli/.env.local,"
  echo "       and DEPLOYMENT.md 7a for letting containers in."
  exit 1
fi

# The schema, brought up to what the new code expects — by the new image's own
# migrations, while the old version keeps serving. Migrations are additive by
# rule (scripts/migrate.js), so the old code works on the new schema too: now,
# and after a rollback.
echo "== applying database migrations"
if ! KOKLI_IMAGE="$NEW" docker compose run --rm --no-deps -T --name "kokli-migrate-$TAG-$$" kokli node scripts/migrate.js </dev/null; then
  echo "ERROR: a migration failed, so the new version was NOT started - ${PREV:-the current version} is still live."
  echo "       Statements that did apply stay applied and recorded: fix the migration and push again."
  echo "       The backup taken just before is the newest file in ~/kokli/backups/predeploy."
  exit 1
fi

# The image serving right now, pinned by its id under a tag of its own. A
# rebuild of the same commit takes over its old tag, so a name read from .env
# could point at the new image; this cannot.
RUNNING_ID="$(docker container inspect -f '{{.Image}}' kokli 2>/dev/null || true)"
if [ -n "$RUNNING_ID" ]; then docker tag "$RUNNING_ID" "$ROLLBACK"; fi

# The switch. .env is the file Compose reads by itself, so it now also tells
# anyone typing `docker compose ...` on this server which version is live.
for f in docker-compose.yml docker-compose.override.yml; do
  if [ -f "$f.new" ]; then
    cp -p "$f" "$f.prev"
    mv "$f.new" "$f"
  fi
done
echo "KOKLI_IMAGE=$NEW" > .env

# `up` is inside the `if` on purpose. By the time it fails — port 3000 still
# held by something else, say — it has already removed the old container.
# Left to `set -e`, the script would stop right there, with the site down and
# the rollback below never reached.
echo "== starting $NEW"
state=down
if docker compose up -d --no-build; then
  state=unhealthy
  if healthy "$TAG" && [ "$(docker container inspect -f '{{.Image}}' kokli 2>/dev/null || true)" = "$NEW_ID" ]; then
    state=healthy
  fi
fi

if [ "$state" != healthy ]; then
  if [ "$state" = unhealthy ]; then
    # The app's own log stays on this server: it can hold patients' details —
    # with SMTP not set up, whole emails, reset links included — and this
    # output is copied into Jenkins, which other people can read.
    ( umask 077; docker compose logs --no-color --tail 200 kokli > "deploy-$RUN-app.log" 2>&1 ) || true
    echo "ERROR: $NEW started but did not become healthy within 90 seconds."
    echo "       Its last lines are on the server, in ~/kokli/deploy-$RUN-app.log"
  else
    echo "ERROR: $NEW could not be started at all - Docker's reason is just above."
  fi
  for f in docker-compose.yml docker-compose.override.yml; do
    if [ -f "$f.prev" ]; then mv "$f.prev" "$f"; fi
  done
  if [ -z "$RUNNING_ID" ]; then
    echo "Nothing to roll back to: no version was running before this one."
    exit 1
  fi
  echo "Rolling back to the image that was serving before ($ROLLBACK)"
  echo "KOKLI_IMAGE=$ROLLBACK" > .env
  if docker compose up -d --no-build --force-recreate && healthy ""; then
    echo "rolled back - the previous version is serving again"
  else
    echo "ERROR: the previous version did not come back healthy either. THE SITE IS DOWN."
    echo "       On the server: cd ~/kokli && docker compose logs kokli"
  fi
  exit 1
fi

echo "live: $NEW"
docker tag "$NEW" "$REPO:latest"

# Old Kokli images. The three deployed last stay, and so do :rollback (the one
# just replaced) and :latest — going back never needs a rebuild or a registry.
# Everything else under this repository name goes: versions more than three
# deploys old, and anything that was never deployed. Only this repository's
# images are listed, so nothing else on the server is touched, and `image rm`
# refuses any image a container is still using. The disk is shared: three is
# what it can spare.
echo "$NEW" >> .deployed
tail -n 20 .deployed > .deployed.tmp && mv .deployed.tmp .deployed
keep="$(tail -n 3 .deployed)"
docker image ls "$REPO" --format '{{.Repository}}:{{.Tag}}' | while read -r img; do
  case "$img" in
    "$REPO:latest"|"$ROLLBACK"|*':<none>') continue ;;
  esac
  if echo "$keep" | grep -qxF -- "$img"; then continue; fi
  docker image rm "$img" >/dev/null 2>&1 || true
done
docker image prune -f --filter label=org.opencontainers.image.title=kokli >/dev/null 2>&1 || true
docker compose ps
echo "KOKLI-DEPLOYED $NEW"
}

if [ "${1:-}" = --start ]; then
  shift
  start "$@"
  exit 0
fi
main "$@" </dev/null
exit $?
