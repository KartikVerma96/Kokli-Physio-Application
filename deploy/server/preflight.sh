#!/usr/bin/env bash
# =============================================================================
#  Is this server ready for a Kokli deploy?
# =============================================================================
#  Jenkins runs it before every deploy (the Jenkinsfile, stage 4):
#
#      ssh <server> bash -s < deploy/server/preflight.sh
#
#  Every check names its own fix, because the first deploy to a new server is
#  exactly when these are missing. It changes nothing, with two exceptions:
#  it creates ~/kokli/backups if missing, and it puts the proxy back on
#  kokli-network if an upgrade of the proxy dropped it.
#
#  One function, called on the last line with stdin from /dev/null: this file
#  arrives on stdin, and any command that read stdin would swallow the rest.
# =============================================================================

main() {
set -eu
cd ~
mkdir -p kokli/backups

need() { command -v "$1" >/dev/null 2>&1 || { echo "ERROR: $1 is missing on this server. $2"; exit 1; }; }
need docker "See DEPLOYMENT.md 7a."
docker info >/dev/null 2>&1 || { echo "ERROR: $(whoami) cannot use Docker. Run: sudo usermod -aG docker $(whoami) - then log out and in again."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: the Docker Compose plugin is missing. Run: sudo apt install docker-compose-plugin"; exit 1; }
need flock "Run: sudo apt install util-linux"
need curl "Run: sudo apt install curl"
[ -f kokli/.env.local ] || { echo "ERROR: ~/kokli/.env.local does not exist. Run deploy/server/bootstrap.sh - DEPLOYMENT.md 7a."; exit 1; }
[ "$(stat -c %u kokli/backups)" = 1000 ] || { echo "ERROR: ~/kokli/backups must belong to uid 1000, the user inside the container. Run: sudo chown 1000:1000 ~/kokli/backups"; exit 1; }

# The disk is shared with other people's databases. A deploy writes a backup
# and starts a container; below this, it is better not to start than to be the
# thing that fills the disk.
free_gb=$(( $(df -Pk kokli | awk 'NR==2 {print $4}') / 1024 / 1024 ))
[ "$free_gb" -ge 2 ] || { echo "ERROR: only $free_gb GB free on this server's disk. Nothing was changed. See what holds it: docker system df"; exit 1; }

if [ -f kokli/docker-compose.override.yml ]; then
  for n in kokli-network kokli-internal; do
    docker network inspect "$n" >/dev/null 2>&1 || { echo "ERROR: Docker network $n is missing. Run deploy/server/bootstrap.sh - DEPLOYMENT.md 7a."; exit 1; }
  done
  if docker container inspect kokli-mysql >/dev/null 2>&1; then
    [ "$(docker container inspect -f '{{.State.Health.Status}}' kokli-mysql)" = healthy ] || { echo "ERROR: kokli-mysql is not healthy. On the server: docker logs kokli-mysql"; exit 1; }
  fi
  # The proxy reaches Kokli over kokli-network. That link lives in the proxy's
  # container, not in any file, so re-creating the proxy — an upgrade — drops
  # it, and every Kokli address answers 502. Put it back. --gw-priority -1:
  # this network must never become the proxy's way out to the internet.
  # Only a RUNNING proxy: Docker accepts a network for a stopped container
  # without checking it, and a stopped proxy is somebody's maintenance.
  if [ -f kokli/.proxy-container ]; then
    proxy="$(cat kokli/.proxy-container)"
    if ! docker container inspect "$proxy" >/dev/null 2>&1; then
      echo "WARNING: the proxy container $proxy, named in ~/kokli/.proxy-container, does not exist here."
    elif [ "$(docker container inspect -f '{{.State.Running}}' "$proxy")" != true ]; then
      echo "WARNING: the proxy container $proxy is not running, so nobody can reach Kokli until it is."
    elif ! docker container inspect -f '{{range $k, $v := .NetworkSettings.Networks}} {{$k}} {{end}}' "$proxy" | grep -q ' kokli-network '; then
      docker network connect --gw-priority -1 kokli-network "$proxy"
      echo "reconnected $proxy to kokli-network"
    fi
  fi
fi
echo "server is ready for a deploy ($free_gb GB free)"
}

main "$@" </dev/null
