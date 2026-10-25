#!/usr/bin/env bash
# =============================================================================
#  Upgrade the server's Nginx Proxy Manager — carefully, on a shared server
# =============================================================================
#  Nginx Proxy Manager (the container `nginx-proxy-manager`) fronts other
#  people's live sites as well as Kokli. This upgrades it from one image to
#  another without guessing: every check that can be made before the sites go
#  down is made first, the downtime is the stop/start itself (~30 s), and any
#  failure on the way brings the old container back by itself.
#
#      bash npm-upgrade.sh check          baseline, no downtime: every host's
#                                         answers, and nginx -t; run it first,
#                                         at most an hour before the upgrade
#      bash npm-upgrade.sh upgrade        the upgrade (runs on by itself if the
#                                         ssh connection drops; log below)
#      bash npm-upgrade.sh rollback       back to the old container, same data
#      bash npm-upgrade.sh restore-data   only after rollback, only if needed:
#                                         the data as it was before the upgrade
#      bash npm-upgrade.sh cleanup        days later: remove the old container
#
#  Everything it writes lives in ~/npm-backup: the data archive (mode 600: it
#  holds every certificate's private key), the old container's full inspect,
#  the before/after checks, and upgrade.log.
#
#  NEW_IMAGE below is the target. The old container's networks (and each one's
#  gw-priority), ports and volumes are read from the container itself, so a
#  network added since this was written is not lost.
# =============================================================================
set -u

NEW_IMAGE="${NEW_IMAGE:-jc21/nginx-proxy-manager:2.16.0}"
NAME=nginx-proxy-manager
OLD="$NAME-old"
B="$HOME/npm-backup"
LOG="$B/upgrade.log"
SELF="${BASH_SOURCE[0]:-}"   # empty when the script is piped into bash

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
version_of() { docker container inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$1" 2>/dev/null | sed -n 's/^NPM_BUILD_VERSION=//p'; }
exists() { docker container inspect "$1" >/dev/null 2>&1; }

# One command of this script at a time: a rollback typed while an upgrade is
# still running would race it for the same two containers. The detached
# upgrade inherits the lock from the command that started it and keeps it to
# its last line, even after that ssh session is gone.
lock() {
  mkdir -p "$B" && chmod 700 "$B" || die "cannot create $B."
  exec 8>>"$B/.lock"
  flock -n 8 || die "another npm-upgrade.sh command is running right now (an upgrade's progress: tail -f $LOG). Nothing was changed."
}

# During an upgrade: remove $NAME only if it is the container made from the
# new image — never the old proxy, whatever happened meanwhile.
rm_new() {
  [ "$(docker container inspect -f '{{.Image}}' "$NAME" 2>/dev/null)" = "$new_id" ] && docker rm -f "$NAME" >/dev/null 2>&1
}

# Every name the proxy serves, asked straight at this server (127.0.0.1, so no
# DNS or CDN in between): HTTP status, HTTPS status (000 = no answer, or a
# certificate not valid for the name), and whether the Let's Encrypt HTTP-01
# path serves a file — the path every certificate here renews through.
check_hosts() {
  local p=/data/letsencrypt-acme-challenge/.well-known/acme-challenge h r
  docker exec "$NAME" sh -c "mkdir -p $p && echo npm-ok > $p/npm-check" 2>/dev/null
  docker exec "$NAME" sh -c "cat /data/nginx/proxy_host/*.conf /data/nginx/redirection_host/*.conf 2>/dev/null" \
    | awk '$1 == "server_name" { for (i = 2; i <= NF; i++) { gsub(";", "", $i); if ($i != "" && $i !~ /[*]/) print $i } }' \
    | sort -u | while read -r h; do
      r="--resolve $h:80:127.0.0.1 --resolve $h:443:127.0.0.1"
      # shellcheck disable=SC2086
      printf '%-34s http=%s https=%s acme=%s\n' "$h" \
        "$(curl -s -o /dev/null -m 15 $r -w '%{http_code}' "http://$h/")" \
        "$(curl -s -o /dev/null -m 15 $r -w '%{http_code}' "https://$h/")" \
        "$(curl -s -k -L -m 15 $r "http://$h/.well-known/acme-challenge/npm-check" | grep -qx npm-ok && echo ok || echo FAIL)"
    done
  printf '%-34s %s\n' "admin UI (127.0.0.1:81)" "$(curl -s -o /dev/null -m 10 -w '%{http_code}' http://127.0.0.1:81/)"
  printf '%-34s %s\n' "admin API (127.0.0.1:81/api/)" "$(curl -s -m 10 http://127.0.0.1:81/api/ | grep -o '"status":"[A-Za-z]*"' || echo none)"
  docker exec "$NAME" rm -f "$p/npm-check" 2>/dev/null || true
}

shape_of() {
  docker container inspect -f 'mode={{.HostConfig.NetworkMode}} restart={{.HostConfig.RestartPolicy.Name}} binds={{json .HostConfig.Binds}} ports={{json .HostConfig.PortBindings}} nets={{range $k, $v := .NetworkSettings.Networks}}{{$k}}({{$v.GwPriority}}) {{end}}' "$1"
}

cmd_check() {
  exists "$NAME" || die "no container called $NAME here."
  say "== $NAME is $(version_of "$NAME"), $(docker container inspect -f '{{.State.Status}}' "$NAME")"
  say "== nginx -t in the running proxy (must succeed: if not, no restart of any version can bring nginx up)"
  docker exec "$NAME" nginx -t 2>&1 | tail -2
  say "== every host it serves (saved as $B/before.txt)"
  check_hosts | tee "$B/before.txt"
}

cmd_upgrade() {
  # Detached: a dropped ssh connection or a closed window must not stop this
  # half-way, with the old proxy stopped and the new one not started.
  if [ -z "${NPM_UPGRADE_DETACHED:-}" ]; then
    [ -n "$SELF" ] && [ -f "$SELF" ] || die "run this from its file (bash ~/kokli-src/deploy/server/npm-upgrade.sh upgrade), not through a pipe. Nothing was changed."
    : > "$LOG"
    rm -f "$B/upgrade.pid" "$B/upgrade.result"
    NPM_UPGRADE_DETACHED=1 setsid nohup bash "$SELF" upgrade > "$LOG" 2>&1 < /dev/null &
    for i in $(seq 1 100); do [ -s "$B/upgrade.pid" ] && break; sleep 0.1; done
    [ -s "$B/upgrade.pid" ] || { cat "$LOG"; die "the upgrade has not reported in after 10 s. Follow it with: tail -f $LOG"; }
    say "running on its own; its log is $LOG (Ctrl-C or a dropped connection stops only this view; watch again with: tail -f $LOG)"
    tail -n +1 -f --pid="$(cat "$B/upgrade.pid")" "$LOG"
    exit "$(cat "$B/upgrade.result" 2>/dev/null || echo 1)"
  fi
  echo "$$" > "$B/upgrade.pid"
  trap 'echo $? > "$B/upgrade.result"' EXIT

  # ---------------------------------------------------------------- checks
  # All before anything stops: every one of these failing leaves the sites up.
  exists "$NAME" || die "no container called $NAME. Nothing was changed."
  ! exists "$OLD" || die "a container called $OLD already exists (an earlier upgrade?). Nothing was changed."
  [ "$(docker container inspect -f '{{.State.Running}}' "$NAME")" = true ] || die "$NAME is not running. Nothing was changed."
  docker image inspect "$NEW_IMAGE" >/dev/null 2>&1 || die "$NEW_IMAGE is not on this server yet: docker pull $NEW_IMAGE first. Nothing was changed."
  new_id="$(docker image inspect -f '{{.Id}}' "$NEW_IMAGE")"
  old_image_id="$(docker container inspect -f '{{.Image}}' "$NAME")"
  [ "$new_id" != "$old_image_id" ] || die "$NAME already runs $NEW_IMAGE. Nothing was changed."
  free_mb=$(( $(df -Pk "$B" | awk 'NR==2 {print $4}') / 1024 ))
  [ "$free_mb" -ge 2048 ] || die "only $free_mb MB free on the disk. Nothing was changed."
  docker exec "$NAME" nginx -t >/dev/null 2>&1 || die "nginx -t fails in the running proxy; a restart would not come back. Nothing was changed."
  [ -n "$(find "$B/before.txt" -mmin -60 -size +0 2>/dev/null)" ] \
    || die "run 'bash $0 check' first, less than an hour before, so there is a fresh before-picture to compare with. Nothing was changed."

  stamp="$(date +%Y%m%d-%H%M%S)"
  docker container inspect "$NAME" > "$B/old-$stamp.inspect.json"
  mode="$(docker container inspect -f '{{.HostConfig.NetworkMode}}' "$NAME")"
  nets="$(docker container inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}={{$v.GwPriority}} {{end}}' "$NAME")"
  shape_before="$(shape_of "$NAME")"
  # The first network is the container's NetworkMode, as before; every other
  # one is given at creation too, with its own gw-priority — so the new proxy
  # starts with all of them, and nothing has to be connected while it runs.
  net_args=(--network "$mode")
  for pair in $nets; do
    n="${pair%=*}"; p="${pair#*=}"
    [ "$n" = "$mode" ] && continue
    net_args+=(--network "name=$n,gw-priority=${p:-0}")
  done
  vol_args=()
  for bind in $(docker container inspect -f '{{range .HostConfig.Binds}}{{.}} {{end}}' "$NAME"); do vol_args+=(-v "$bind"); done
  [ "${#vol_args[@]}" -ge 4 ] || die "could not read $NAME's volumes (expected npm-data and npm-letsencrypt). Nothing was changed."
  # The ports are re-created as written here, so they must be exactly these.
  ports="$(docker container inspect -f '{{range $p, $c := .HostConfig.PortBindings}}{{$p}}={{range $c}}{{.HostIp}}:{{.HostPort}}{{end}} {{end}}' "$NAME")"
  [ "$ports" = "443/tcp=:443 80/tcp=:80 81/tcp=:81 " ] \
    || die "$NAME publishes other ports than 80, 81 and 443 on every address ($ports); this script would not re-create them as they are. Nothing was changed."
  port_args=(-p 80:80 -p 81:81 -p 443:443)
  say "== upgrading $NAME: $(version_of "$NAME") -> $NEW_IMAGE"
  say "   networks: $nets"
  say "   volumes:  ${vol_args[*]}"

  # ------------------------------------------------------- downtime starts
  t0=$(date +%s)
  docker stop "$NAME" >/dev/null || die "could not stop $NAME. Nothing was changed."
  archive="$B/npm-data-$stamp.tgz"
  # Read as root inside a container (the keys in the volumes are root's); the
  # archive is made private (600) and handed to this user there, before anyone
  # else could read it.
  docker run --rm --network none --entrypoint sh -e F="$(basename "$archive")" -e U="$(id -u):$(id -g)" \
      -v npm-data:/from/data:ro -v npm-letsencrypt:/from/letsencrypt:ro -v "$B":/to "$NEW_IMAGE" \
      -c 'umask 077; tar czf "/to/$F" -C /from . && chown "$U" "/to/$F"' \
    && gzip -t "$archive" \
    && tar tzf "$archive" | grep -qx './data/database.sqlite'
  if [ $? -ne 0 ]; then
    say "ERROR: the backup failed or is incomplete - starting the old proxy again"
    rm -f "$archive"
    docker start "$NAME" >/dev/null && say "old proxy is running again; nothing else was changed" || say "ERROR: the old proxy would not start: docker start $NAME"
    exit 1
  fi
  echo "$archive" > "$B/LAST"
  echo "$old_image_id" > "$B/OLD_IMAGE_ID"
  docker rename "$NAME" "$OLD" || { docker start "$NAME" >/dev/null; die "could not rename $NAME; it was started again."; }

  if ! docker run -d --name "$NAME" "${net_args[@]}" "${port_args[@]}" "${vol_args[@]}" "$NEW_IMAGE" >/dev/null; then
    say "ERROR: the new proxy did not start - putting the old one back"
    rm_new
    docker rename "$OLD" "$NAME" && docker start "$NAME" >/dev/null && say "old proxy is running again" || say "ERROR: could not restart the old proxy - see 'bash $0 rollback'"
    exit 1
  fi

  # Up means: the backend answers on the admin port's API, and nginx's config
  # tests clean. Not the admin page: nginx serves that by itself, backend or
  # not, and without the backend nothing renews. About three minutes: with a
  # DNS-challenge certificate, the backend first pip-installs its plugin.
  up=no
  for i in $(seq 1 180); do
    if curl -s -m 3 http://127.0.0.1:81/api/ | grep -q '"status":"OK"' && docker exec "$NAME" nginx -t >/dev/null 2>&1; then up=yes; break; fi
    sleep 1
  done
  if [ "$up" != yes ]; then
    say "ERROR: the new proxy's backend did not answer within about three minutes. Its log:"
    docker logs --tail 40 "$NAME" 2>&1 | grep -E -i 'emerg|error|fail' | tail -15
    say "putting the old one back"
    rm_new
    docker rename "$OLD" "$NAME" && docker start "$NAME" >/dev/null && say "old proxy is running again, on the data as the new one left it (if it misbehaves: bash $0 restore-data)" || say "ERROR: could not restart the old proxy - see 'bash $0 rollback'"
    exit 1
  fi
  say "== sites answering again after $(( $(date +%s) - t0 )) s"

  # ------------------------------------------------------------- the proof
  say "== same shape as before? (the two lines must match)"
  say "   old: $shape_before"
  say "   new: $(shape_of "$NAME")"
  docker port "$NAME" | sed 's/^/   /'
  sleep 5
  check_hosts > "$B/after.txt"
  if diff "$B/before.txt" "$B/after.txt" > "$B/diff.txt"; then
    say "== every host answers exactly as before (before.txt = after.txt)"
  else
    say "== DIFFERENT from before - look at these lines (< before, > after):"
    sed 's/^/   /' "$B/diff.txt"
    say "   If a site that worked is broken now: bash $0 rollback"
  fi
  say "== startup errors: $(docker logs "$NAME" 2>&1 | grep -c -E 'emerg|Startup Error|could not bind')"
  say "== done: $NAME runs $(version_of "$NAME"); the old one is kept, stopped, as $OLD; data backup $archive"
}

cmd_rollback() {
  exists "$OLD" || die "there is no $OLD to go back to. Nothing was changed."
  if exists "$NAME"; then
    [ "$(docker container inspect -f '{{.Image}}' "$NAME")" = "$(docker image inspect -f '{{.Id}}' "$NEW_IMAGE" 2>/dev/null)" ] \
      || die "$NAME is not the $NEW_IMAGE container, so it is not removed. Nothing was changed."
    docker rm -f "$NAME" >/dev/null || die "could not remove the new $NAME."
  fi
  docker rename "$OLD" "$NAME" || die "could not rename $OLD back."
  if ! docker start "$NAME" >/dev/null; then
    say "ERROR: the old proxy did not start. If Docker says a network is 'not found', that"
    say "       network was removed or re-created meanwhile:"
    say "       docker network disconnect <network> $NAME; docker start $NAME; docker network connect <network> $NAME"
    exit 1
  fi
  say "the old proxy ($(version_of "$NAME")) is running again, on the current data"
}

cmd_restore_data() {
  f="$(cat "$B/LAST" 2>/dev/null)"
  [ -n "$f" ] && [ -f "$f" ] || die "no archive recorded in $B/LAST. Nothing was changed."
  gzip -t "$f" || die "$f is damaged. Nothing was changed."
  tar tzf "$f" | grep -qx './data/database.sqlite' || die "$f has no database in it. Nothing was changed."
  exists "$OLD" && die "run 'bash $0 rollback' first: the new proxy is still in place. Nothing was changed."
  img="$(docker container inspect -f '{{.Image}}' "$NAME")"
  [ "$img" = "$(cat "$B/OLD_IMAGE_ID" 2>/dev/null)" ] || die "$NAME is not the old proxy. Nothing was changed."
  docker stop "$NAME" >/dev/null
  docker run --rm --network none --entrypoint sh -e F="$(basename "$f")" -v npm-data:/to/data -v npm-letsencrypt:/to/letsencrypt -v "$B":/b:ro "$img" \
    -c 'set -e; tar tzf "/b/$F" >/dev/null; find /to/data /to/letsencrypt -mindepth 1 -delete; tar xzf "/b/$F" -C /to' \
    || { say "ERROR: the restore stopped part-way. Run this again; do not start $NAME before it succeeds."; exit 1; }
  docker start "$NAME" >/dev/null && say "the old proxy is running on the data from $f"
}

cmd_cleanup() {
  exists "$OLD" || die "there is no $OLD. Nothing to clean."
  [ "$(docker container inspect -f '{{.Image}}' "$NAME" 2>/dev/null)" = "$(docker image inspect -f '{{.Id}}' "$NEW_IMAGE" 2>/dev/null)" ] \
    || die "$NAME is not running $NEW_IMAGE; nothing removed."
  docker rm "$OLD" >/dev/null && say "removed the stopped $OLD"
  id="$(cat "$B/OLD_IMAGE_ID" 2>/dev/null)"
  [ -n "$id" ] && docker image rm "$id" >/dev/null 2>&1 && say "removed the old image $id" || say "the old image is still used by something, or already gone - left alone"
}

case "${1:-}" in
  check) lock; cmd_check ;;
  upgrade) [ -n "${NPM_UPGRADE_DETACHED:-}" ] || lock; cmd_upgrade ;;
  rollback) lock; cmd_rollback ;;
  restore-data) lock; cmd_restore_data ;;
  cleanup) lock; cmd_cleanup ;;
  *) awk 'NR > 1 && !/^#/ { exit } NR > 1' "$0"; exit 2 ;;
esac
