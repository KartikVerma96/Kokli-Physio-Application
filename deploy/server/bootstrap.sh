#!/usr/bin/env bash
# =============================================================================
#  Kokli — one-time server setup. Safe to run again.
# =============================================================================
#  Run ON the server, from an up-to-date copy of the repository:
#
#      git -C ~/kokli-src pull --ff-only && bash ~/kokli-src/deploy/server/bootstrap.sh
#
#  It creates everything Jenkins's deploy expects to find, and starts MySQL:
#
#    networks   kokli-network    Nginx Proxy Manager <-> the app
#               kokli-internal   the app <-> MySQL, with no route to the internet
#    volume     kokli-db-data    the database's files
#    folders    ~/kokli (with backups/), ~/kokli-db
#    files      the compose files and the database's first-start SQL
#    secrets    ~/kokli-db/.env and ~/kokli/.env.local, freshly generated
#    database   kokli-mysql, started and waited for until healthy
#    cron       the scheduled jobs, in a marked block of this user's crontab
#
#  The reverse proxy's container is assumed to be called nginx-proxy-manager.
#  If yours is called something else:  PROXY_CONTAINER=<name> bash .../bootstrap.sh
#
#  A run that worked ends with "== Done". Anything else stopped on an ERROR
#  that says what to fix.
#
#  WHAT IT WILL NEVER DO
#  ---------------------
#  Print a secret, or put one on a command line. Overwrite an existing secret
#  file. Touch an existing volume. Replace a compose file that is already in
#  place: after the first deploy, Jenkins owns ~/kokli's, and ~/kokli-db's is
#  changed by hand, deliberately (see the note where it is installed). Touch
#  anything in the crontab outside its own marked block.
# =============================================================================
set -euo pipefail
# ${var/pattern/replacement} below takes values literally: off, bash 5.2+ would
# turn every & in a replacement into the matched text (2>&1 included). The
# replacements are left unquoted because older bash would keep the quotes.
shopt -u patsub_replacement 2>/dev/null || true

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="$HOME/kokli"
DB_DIR="$HOME/kokli-db"
PROXY_CONTAINER="${PROXY_CONTAINER:-nginx-proxy-manager}"

say()  { printf '   %s\n' "$*"; }
step() { printf '\n== %s\n' "$*"; }
die()  { printf '\nERROR: %s\n' "$*" >&2; exit 1; }

# -----------------------------------------------------------------------------
step "Checks"
# -----------------------------------------------------------------------------
command -v docker  >/dev/null || die "Docker is not installed."
docker info >/dev/null 2>&1   || die "$(whoami) cannot use Docker. Run: sudo usermod -aG docker $(whoami) — then log in again."
docker compose version >/dev/null 2>&1 || die "The Docker Compose plugin is missing: sudo apt install docker-compose-plugin"
command -v openssl >/dev/null || die "openssl is missing: sudo apt install openssl"
command -v crontab >/dev/null || die "cron is missing: sudo apt install cron"
command -v flock   >/dev/null || die "flock is missing: sudo apt install util-linux"
command -v jq      >/dev/null || die "jq is missing: sudo apt install jq"
command -v python3 >/dev/null || die "python3 is missing: sudo apt install python3"
for f in docker-compose.yml deploy/server/docker-compose.override.yml deploy/server/env.local.example \
         deploy/server/check-env.js deploy/server/proxy-link.sh deploy/server/kokli-tls.sh \
         deploy/kokli-db/docker-compose.yml deploy/kokli-db/init/01-grants.sql; do
  [ -f "$REPO/$f" ] || die "Run this from a copy of the repository: $f is missing."
done

# An old copy would install old files: an old cron block, and — on a new
# server — an old database definition. Only "behind" stops the run; a copy
# with commits of its own is somebody's deliberate choice.
if git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$REPO" fetch -q origin main 2>/dev/null; then
    here="$(git -C "$REPO" rev-parse HEAD)"
    upstream="$(git -C "$REPO" rev-parse FETCH_HEAD)"
    if [ "$here" != "$upstream" ] && git -C "$REPO" merge-base --is-ancestor "$here" "$upstream"; then
      die "$REPO is behind GitHub's main. Run: git -C $REPO pull --ff-only — then this again."
    fi
  else
    say "WARNING: could not reach GitHub to check that $REPO is up to date"
  fi
fi
say "docker, compose, openssl, cron and flock are here; repository files found"

mkdir -p "$APP_DIR/backups" "$DB_DIR/init"

# -----------------------------------------------------------------------------
step "Networks"
# -----------------------------------------------------------------------------
if docker network inspect kokli-network >/dev/null 2>&1; then say "kokli-network exists"
else
  docker network create kokli-network >/dev/null || die "could not create kokli-network (Docker's reason is above)."
  say "created kokli-network"
fi

# --internal: containers on it can reach each other and nothing else. MySQL is
# only on this one, so it has no route to or from the internet at all.
if docker network inspect kokli-internal >/dev/null 2>&1; then say "kokli-internal exists"
else
  docker network create --internal kokli-internal >/dev/null || die "could not create kokli-internal (Docker's reason is above)."
  say "created kokli-internal (internal: no internet)"
fi
[ "$(docker network inspect kokli-internal -f '{{.Internal}}')" = true ] \
  || say "WARNING: kokli-internal exists but is NOT internal — MySQL would have internet access. Recreate it with --internal."

# The proxy reaches the app by container name, so it has to share a network
# with it. This is how the other sites on this server are wired too.
#
# `docker network connect` lasts until the proxy's container is RE-CREATED —
# which is what upgrading it does — so its name is written down for the two
# things that put the link back: every deploy's preflight, and a cron line.
#
# --gw-priority -1 (Docker 28 and later): with several networks, one of them is
# the proxy's way out to the internet, and adding a network must never change
# which. Older Docker has no such flag, and keeps the first network by name.
GW_PRIORITY=""
if docker network connect --help 2>/dev/null | grep -q -- '--gw-priority'; then GW_PRIORITY="--gw-priority -1"; fi
if docker container inspect "$PROXY_CONTAINER" >/dev/null 2>&1; then
  if docker container inspect -f '{{range $k, $v := .NetworkSettings.Networks}} {{$k}} {{end}}' "$PROXY_CONTAINER" | grep -q ' kokli-network '; then
    say "$PROXY_CONTAINER is already on kokli-network"
  else
    # GW_PRIORITY is two words, or none: unquoted on purpose.
    docker network connect $GW_PRIORITY kokli-network "$PROXY_CONTAINER" \
      || die "could not connect $PROXY_CONTAINER to kokli-network (Docker's reason is above)."
    say "connected $PROXY_CONTAINER to kokli-network (it keeps running)"
  fi
  printf '%s\n' "$PROXY_CONTAINER" > "$APP_DIR/.proxy-container"
else
  rm -f "$APP_DIR/.proxy-container"
  say "WARNING: no container named '$PROXY_CONTAINER'. Run this again with its real name:"
  say "         PROXY_CONTAINER=<proxy-container> bash $REPO/deploy/server/bootstrap.sh"
fi

# -----------------------------------------------------------------------------
step "Database volume"
# -----------------------------------------------------------------------------
if docker volume inspect kokli-db-data >/dev/null 2>&1; then say "kokli-db-data exists — left exactly as it is"
else
  docker volume create kokli-db-data >/dev/null || die "could not create the volume kokli-db-data (Docker's reason is above)."
  say "created kokli-db-data"
fi

# -----------------------------------------------------------------------------
step "Folders and files"
# -----------------------------------------------------------------------------
# uid 1000 is the `node` user inside the app container, which writes the dumps.
[ "$(stat -c %u "$APP_DIR/backups")" = 1000 ] \
  || say "WARNING: ~/kokli/backups is not owned by uid 1000, so backups will fail. Run: sudo chown 1000:1000 ~/kokli/backups"

# Installed only where nothing is in place yet. After the first deploy Jenkins
# owns ~/kokli's two compose files and replaces them with each commit's; a
# re-run of this script from an older copy must not put old ones back.
for pair in "docker-compose.yml:docker-compose.yml" "deploy/server/docker-compose.override.yml:docker-compose.override.yml"; do
  from="${pair%%:*}"; to="${pair#*:}"
  if [ -f "$APP_DIR/$to" ]; then say "~/kokli/$to exists — kept (deploys keep it current)"
  else
    install -m 644 "$REPO/$from" "$APP_DIR/$to" || die "could not install ~/kokli/$to."
    say "installed ~/kokli/$to"
  fi
done
# Kokli's own, refreshed on every run: the cron lines below run them.
install -m 755 "$REPO/deploy/server/proxy-link.sh" "$APP_DIR/proxy-link.sh" || die "could not install ~/kokli/proxy-link.sh."
install -m 755 "$REPO/deploy/server/kokli-tls.sh" "$APP_DIR/kokli-tls.sh" || die "could not install ~/kokli/kokli-tls.sh."

# The database's own definition is changed only by a person, on purpose:
# re-creating MySQL from a different definition — another server version, a
# changed flag — is the one step here that can stop every clinic at once. So a
# difference is reported, never applied.
if [ ! -f "$DB_DIR/docker-compose.yml" ]; then
  install -m 644 "$REPO/deploy/kokli-db/docker-compose.yml" "$DB_DIR/docker-compose.yml"
  say "installed ~/kokli-db/docker-compose.yml"
elif cmp -s "$REPO/deploy/kokli-db/docker-compose.yml" "$DB_DIR/docker-compose.yml"; then
  say "~/kokli-db/docker-compose.yml is current"
else
  say "NOTE: ~/kokli-db/docker-compose.yml differs from the repository's, and was left as it is."
  say "      To apply the repository's (it re-creates kokli-mysql — take a backup first):"
  say "      diff ~/kokli-db/docker-compose.yml $REPO/deploy/kokli-db/docker-compose.yml"
  say "      cp $REPO/deploy/kokli-db/docker-compose.yml ~/kokli-db/ && cd ~/kokli-db && docker compose up -d"
fi
for sql in "$REPO"/deploy/kokli-db/init/*.sql; do
  [ -f "$DB_DIR/init/$(basename "$sql")" ] || install -m 644 "$sql" "$DB_DIR/init/"
done
say "init SQL in place (MySQL reads it once, on its very first start)"

# -----------------------------------------------------------------------------
step "Secrets — generated only when missing, never printed"
# -----------------------------------------------------------------------------
# Hex for the passwords: no character in it needs quoting in an env file, in
# mysqldump's defaults file, or on a command line.
strong() { [[ "$1" =~ ^[A-Za-z0-9]{24,}$ ]]; }

umask 077
if [ -f "$DB_DIR/.env" ]; then
  say "~/kokli-db/.env exists — kept"
else
  printf 'MYSQL_ROOT_PASSWORD=%s\nMYSQL_PASSWORD=%s\n' "$(openssl rand -hex 24)" "$(openssl rand -hex 24)" > "$DB_DIR/.env.new"
  mv "$DB_DIR/.env.new" "$DB_DIR/.env"
  say "generated ~/kokli-db/.env (mode 600)"
fi
DB_ROOT_PASSWORD="$(sed -n 's/^MYSQL_ROOT_PASSWORD=//p' "$DB_DIR/.env")"
DB_PASSWORD="$(sed -n 's/^MYSQL_PASSWORD=//p' "$DB_DIR/.env")"
# A file copied from env.example would otherwise start MySQL with a password
# anyone can read on GitHub.
strong "$DB_ROOT_PASSWORD" || die "MYSQL_ROOT_PASSWORD in ~/kokli-db/.env is missing or weak. Use: openssl rand -hex 24"
strong "$DB_PASSWORD"      || die "MYSQL_PASSWORD in ~/kokli-db/.env is missing or weak. Use: openssl rand -hex 24"

if [ -f "$APP_DIR/.env.local" ]; then
  say "~/kokli/.env.local exists — kept"
  [ "$(sed -n 's/^DB_PASSWORD=//p' "$APP_DIR/.env.local")" = "$DB_PASSWORD" ] \
    || say "WARNING: DB_PASSWORD in ~/kokli/.env.local is not MYSQL_PASSWORD from ~/kokli-db/.env — the app will not be able to log in."
else
  # Filled in by bash itself, not by sed: arguments to a program are visible
  # to every user of this machine (ps, /proc), and these are secrets.
  auth="$(openssl rand -base64 32)"
  key="$(openssl rand -base64 32)"
  cron="$(openssl rand -hex 32)"
  new="$APP_DIR/.env.local.new"
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line//__AUTH_SECRET__/$auth}"
    line="${line//__PLATFORM_ENCRYPTION_KEY__/$key}"
    line="${line//__CRON_SECRET__/$cron}"
    line="${line//__DB_PASSWORD__/$DB_PASSWORD}"
    printf '%s\n' "$line"
  done < "$REPO/deploy/server/env.local.example" > "$new"
  unset auth key cron
  # Only KEY=value lines count: a comment may mention a placeholder by name.
  if grep -qE '^[A-Z_][A-Z0-9_]*=.*__[A-Z_]+__' "$new"; then
    rm -f "$new"
    die "a placeholder was left unfilled in the generated env file — is deploy/server/env.local.example current?"
  fi
  mv "$new" "$APP_DIR/.env.local"
  say "generated ~/kokli/.env.local (mode 600) — integrations are empty until you fill them in"
fi
umask 022

# The server has no Node of its own, so the checker runs in a throwaway Node
# container. It prints key names and verdicts, never a value.
docker run --rm -v "$APP_DIR/.env.local:/env:ro" -v "$REPO/deploy/server/check-env.js:/check.js:ro" \
  node:24-bookworm-slim node /check.js /env | sed 's/^/   /' \
  || die "~/kokli/.env.local has problems (listed above). Fix them and run this again."

# -----------------------------------------------------------------------------
step "MySQL"
# -----------------------------------------------------------------------------
( cd "$DB_DIR" && docker compose up -d --quiet-pull 2>&1 | sed 's/^/   /' ) \
  || die "MySQL did not start — Docker's reason is just above."
printf '   waiting for kokli-mysql to be healthy'
status=missing
for i in $(seq 1 60); do
  status="$(docker container inspect -f '{{.State.Health.Status}}' kokli-mysql 2>/dev/null || echo missing)"
  [ "$status" = healthy ] && break
  printf '.'; sleep 3
done
echo
[ "$status" = healthy ] || die "kokli-mysql is '$status' after 3 minutes. See: docker logs kokli-mysql"
say "kokli-mysql is healthy"

# The two settings the app depends on and nothing else would catch: India time
# (or reminders and "today" shift by 5.5 hours) and the schema's collation.
# MYSQL_PWD, so the root password never appears in a process list.
read -r tz coll <<<"$(docker exec kokli-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -e "SELECT @@global.time_zone, @@collation_server"')"
[ "$tz" = "+05:30" ] || die "kokli-mysql's time zone is '$tz', not +05:30. Check deploy/kokli-db/docker-compose.yml."
[ "$coll" = "utf8mb4_unicode_ci" ] || die "kokli-mysql's collation is '$coll', not utf8mb4_unicode_ci."
say "time zone +05:30, collation utf8mb4_unicode_ci"

# -----------------------------------------------------------------------------
step "Scheduled jobs (crontab)"
# -----------------------------------------------------------------------------
# One marked block, replaced whole on every run, so running this twice never
# leaves two copies. The rest of the crontab is not touched.
#
# The server's clock is UTC; the times below are chosen for India (IST = UTC+5:30):
#   20:30 UTC = 02:00 IST   nightly backup
#   21:00 UTC = 02:30 IST   subscriptions: trials ending, grace periods, cleanup
#   21:30 UTC Sat = 03:00 IST Sun   weekly restore test of the newest backup
#   every 10 minutes        appointment reminders and the other WhatsApp messages
#                           (the route asks for ten-minute runs: a reminder is
#                           only useful at roughly the right moment)
#   every 5 minutes         the proxy's link to kokli-network, put back if an
#                           upgrade of the proxy dropped it (only with a proxy)
#   03:41 UTC = 09:11 IST   the *.kokli.in certificate, renewed when due and
#                           handed to the proxy (kokli-tls.sh; until
#                           DEPLOYMENT.md 7d made one, it does nothing)
#
# The backup and the restore test run in a one-off container of their own,
# under the same lock a deploy takes (~/kokli/.kokli.lock): a deploy swapping
# the app's container can neither kill one half-way nor start under one. The
# container name ends in the cron shell's process id — unique, and a fixed
# name left behind by a crash would block every later night. Each run starts
# with the date in backup.log, and --verbose makes the lock say how long it
# waited — or that it gave up after an hour, so a skipped night leaves a trace.
#
# The two HTTP jobs run INSIDE the app container, with Node's fetch against its
# own port: CRON_SECRET never leaves the container's environment (so it is not
# in the crontab), and nothing depends on DNS, TLS or the proxy's 90-second
# timeout. A run during a deploy's few-second container swap simply fails, and
# the next one catches up.
#
# The proxy line runs ~/kokli/proxy-link.sh, which connects nothing unless the
# network exists and the proxy is running and off it (see the script).
CRON_BLOCK="$(cat <<'CRON'
# >>> kokli (managed by deploy/server/bootstrap.sh — edit there, not here) >>>
30 20 * * *  cd $HOME/kokli && date -u >> backup.log && flock --verbose -w 3600 .kokli.lock docker compose run --rm --no-deps -T --name kokli-nightly-$$ kokli node scripts/backup.js < /dev/null >> backup.log 2>&1
30 21 * * 6  cd $HOME/kokli && date -u >> backup.log && flock --verbose -w 3600 .kokli.lock docker compose run --rm --no-deps -T --name kokli-verify-$$ kokli node scripts/backup.js --verify < /dev/null >> backup.log 2>&1
0 21 * * *   docker exec kokli node -e "fetch('http://127.0.0.1:3000/api/cron/subscriptions',{method:'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(r=>{console.log(new Date().toISOString(),'subscriptions',r.status);process.exit(r.ok?0:1)},e=>{console.error(e.message);process.exit(1)})" >> $HOME/kokli/cron.log 2>&1
*/10 * * * * docker exec kokli node -e "fetch('http://127.0.0.1:3000/api/cron/whatsapp',{method:'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(r=>{console.log(new Date().toISOString(),'whatsapp',r.status);process.exit(r.ok?0:1)},e=>{console.error(e.message);process.exit(1)})" >> $HOME/kokli/cron.log 2>&1
41 3 * * *   /bin/bash $HOME/kokli/kokli-tls.sh renew >> $HOME/kokli/tls.log 2>&1
PROXY_LINE
# <<< kokli <<<
CRON
)"
if [ -f "$APP_DIR/.proxy-container" ]; then
  CRON_BLOCK="${CRON_BLOCK/PROXY_LINE/*/5 * * * *  /bin/sh \$HOME/kokli/proxy-link.sh >> \$HOME/kokli/cron.log 2>&1}"
else
  CRON_BLOCK="${CRON_BLOCK/PROXY_LINE/# (no proxy container was found, so nothing reconnects one)}"
fi

# Everything outside the marked block goes back byte for byte. `crontab -l`
# fails when this user has no crontab yet — that is an empty one — but any
# OTHER failure stops here: treated as empty, it would replace whatever this
# account's crontab holds (other people's jobs included) with Kokli's block.
tab="$(mktemp)"
if ! crontab -l > "$tab" 2> "$tab.err"; then
  if grep -qi 'no crontab for' "$tab.err"; then
    : > "$tab"
  else
    cat "$tab.err" >&2
    rm -f "$tab" "$tab.err"
    die "could not read this user's crontab (above), so it was left exactly as it is."
  fi
fi
rm -f "$tab.err"

# The block is removed from its start marker to its end marker. With a marker
# missing or doubled, that would also remove every line after it — other
# people's jobs — so a damaged block stops the run instead.
starts="$(grep -c '^# >>> kokli ' "$tab" || true)"
ends="$(grep -c '^# <<< kokli <<<$' "$tab" || true)"
if [ "$starts" != 0 ] || [ "$ends" != 0 ]; then
  # `|| true`: under pipefail a marker that is missing would end the run right
  # here, silently, instead of with the message below.
  first_start="$(grep -n '^# >>> kokli ' "$tab" | head -1 | cut -d: -f1 || true)"
  first_end="$(grep -n '^# <<< kokli <<<$' "$tab" | head -1 | cut -d: -f1 || true)"
  if [ "$starts" != 1 ] || [ "$ends" != 1 ] || [ "${first_start:-0}" -ge "${first_end:-0}" ]; then
    rm -f "$tab"
    die "the kokli block in $(whoami)'s crontab is damaged (start markers: $starts, end markers: $ends). Fix it with crontab -e; the crontab was left exactly as it is."
  fi
fi
if ! { sed '/^# >>> kokli /,/^# <<< kokli <<<$/d' "$tab"; printf '%s\n' "$CRON_BLOCK"; } | crontab -; then
  rm -f "$tab"
  die "crontab refused the new block — see its message above."
fi
rm -f "$tab"
crontab -l 2>/dev/null | grep -qF '# >>> kokli (' || die "the kokli block did not reach the crontab."
say "crontab block installed ($(crontab -l | grep -c '^[0-9*]') job lines in total for $(whoami))"

# -----------------------------------------------------------------------------
step "Done"
# -----------------------------------------------------------------------------
say "The server side is ready. Before the first deploy, the database needs its"
say "one-time set-up — schema, migrations, removing the demo clinic, the owner's"
say "password — in DEPLOYMENT.md §7b. Jenkins does everything after that."
