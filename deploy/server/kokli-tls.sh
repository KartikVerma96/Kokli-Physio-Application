#!/usr/bin/env bash
# =============================================================================
#  kokli.in and *.kokli.in on the shared proxy — and nothing else touched
# =============================================================================
#  The reverse proxy on this server, Nginx Proxy Manager (NPM), is a friend's
#  and fronts their sites. Kokli gets two proxy hosts in it, and that is all:
#
#    kokli.in     certificate from NPM itself (Let's Encrypt, HTTP-01), renewed
#                 by NPM the way it renews every other certificate it holds
#    *.kokli.in   certificate from Kokli's own certbot (DNS-01 through the
#                 Hostinger API, in a container of its own), handed to NPM as a
#                 custom certificate; `renew`, from cron, keeps it current
#
#  NPM could make the wildcard itself, but only by installing the Hostinger
#  plugin into the one certbot that renews the friend's certificates, keeping
#  the Hostinger token — which can do anything in that account — in their
#  panel, and making every start of their NPM wait on PyPI. So it does not.
#
#  NPM is driven through its API, as an NPM user of Kokli's own that is not an
#  admin and sees only what it made. `user` makes that user once, with an admin
#  login given for that alone, and then deletes the admin login. Every later
#  login checks the user is still exactly that, and every lookup and delete
#  also matches Kokli's own names — so nothing here can reach the friend's.
#
#      bash kokli-tls.sh user       once: the NPM user (needs ~/kokli/secrets/npm-admin)
#      bash kokli-tls.sh apex       kokli.in: certificate and proxy host
#      bash kokli-tls.sh wildcard   *.kokli.in: certificate (needs
#                                   ~/kokli/secrets/hostinger.ini), the daily
#                                   renewal in cron, and the proxy host
#      bash kokli-tls.sh renew      (cron) renew *.kokli.in when due and hand it to
#                                   NPM; warn when either certificate runs low
#      bash kokli-tls.sh verify     Kokli answers on both; renewal scheduled; the
#                                   friend's side as it is now
#      bash kokli-tls.sh remove     take Kokli's hosts and certificates out of NPM
#
#  Every command that changes NPM first records the friend's proxy-host files
#  byte for byte, the HSTS value nginx uses, and how every one of their names
#  answers; afterwards it proves all of it unchanged, and stops at the first
#  difference. Cron runs ~/kokli/kokli-tls.sh: every command refreshes that
#  copy from the one being run.
# =============================================================================
set -u

NAME="${NPM_CONTAINER:-nginx-proxy-manager}"
API="${NPM_API:-http://127.0.0.1:81/api}"
EDGE="${NPM_EDGE:-127.0.0.1}"        # where this server's ports 80/443 answer
DOMAIN="${KOKLI_DOMAIN:-kokli.in}"
K="${KOKLI_HOME:-$HOME/kokli}"
SEC="$K/secrets"
TLS="$K/tls"
NPM_USER_EMAIL="npm@$DOMAIN"
CERTBOT_IMAGE="kokli-certbot:5.8.0"
ADVANCED=$'client_max_body_size 2m;\nset_real_ip_from 127.0.0.1;'
WILD="*.$DOMAIN"
LIVE="$TLS/conf/live/wildcard"
CRON_LINE='41 3 * * *   /bin/bash $HOME/kokli/kokli-tls.sh renew >> $HOME/kokli/tls.log 2>&1'
SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
ME=""                                 # Kokli's NPM user id, once logged in

say() { printf '%s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/kokli-tls.XXXXXX")" || exit 1
trap 'rm -rf "$WORK"' EXIT
HDR="$WORK/auth"

lock() {
  mkdir -p "$TLS" && chmod 700 "$TLS" || die "cannot create $TLS."
  exec 7>>"$K/.kokli-tls.lock"
  flock -w 600 7 || die "another kokli-tls.sh has held $K/.kokli-tls.lock for ten minutes."
}

# ---------------------------------------------------------------- NPM's API
# login FILE: FILE holds an NPM login, the email on line 1 and the password on
# line 2. The token lands in $HDR (in a directory only this user can read) and
# is never printed; neither is anything in FILE.
login() {
  local f="$1" resp token code
  [ -s "$f" ] || die "$f is missing (DEPLOYMENT.md 7d)."
  python3 - "$f" > "$WORK/login.json" <<'PY' || die "could not read $f."
import json, sys
lines = open(sys.argv[1], encoding="utf-8").read().split("\n")
print(json.dumps({"identity": lines[0].strip(), "secret": lines[1] if len(lines) > 1 else "", "scope": "user"}))
PY
  resp="$(curl -s -m 20 -H 'Content-Type: application/json' --data-binary @"$WORK/login.json" "$API/tokens")"
  rm -f "$WORK/login.json"
  if [ "$(jq -r '.requires_2fa // false' <<< "$resp" 2>/dev/null)" = true ]; then
    [ -t 0 ] || die "this NPM login has two-factor authentication on: run the same command yourself, in a terminal, to type its code."
    read -r -p "NPM two-factor code: " code
    resp="$(jq --arg c "$code" '{challenge_token: .challenge_token, code: $c}' <<< "$resp" \
      | curl -s -m 20 -H 'Content-Type: application/json' --data-binary @- "$API/tokens/2fa")"
  fi
  token="$(jq -r '.token // empty' <<< "$resp" 2>/dev/null)"
  [ -n "$token" ] || die "NPM did not accept the login in $f: $(jq -r '.error.message // "no answer"' <<< "$resp" 2>/dev/null)"
  printf 'Authorization: Bearer %s\n' "$token" > "$HDR"
}

# api METHOD PATH [JSON]: the answer on stdout. An HTTP error ends the script
# (from inside $(…) too: always call it as  x="$(api …)" || exit 1).
api() {
  local m="$1" p="$2" code
  if [ $# -ge 3 ]; then
    printf '%s' "$3" > "$WORK/body.json"
    code="$(curl -s -m 300 -o "$WORK/resp" -w '%{http_code}' -X "$m" -H @"$HDR" \
      -H 'Content-Type: application/json' --data-binary @"$WORK/body.json" "$API$p")"
    rm -f "$WORK/body.json"
  else
    code="$(curl -s -m 60 -o "$WORK/resp" -w '%{http_code}' -X "$m" -H @"$HDR" "$API$p")"
  fi
  case "$code" in
    2??) cat "$WORK/resp" ;;
    *) die "NPM: $m $p answered ${code:-nothing}: $(jq -r '.error.message // empty' "$WORK/resp" 2>/dev/null | head -c 400)" ;;
  esac
}

# The Kokli login must still be what `user` made: not an admin, and seeing
# nothing that is not its own. Checked at every login — the friend could change
# either in their panel — because every lookup and every delete here trusts it.
guard_scope() {
  local me list
  me="$(api GET /users/me)" || exit 1
  ME="$(jq -r '.id // empty' <<< "$me")"
  [ -n "$ME" ] || die "NPM did not say who the Kokli login is."
  jq -e '(.roles // []) | index("admin") | not' <<< "$me" >/dev/null \
    || die "the Kokli NPM login ($NPM_USER_EMAIL) is an administrator now: nothing was changed. In NPM: Users -> that user -> not an administrator."
  for p in /nginx/proxy-hosts /nginx/certificates; do
    list="$(api GET "$p")" || exit 1
    jq -e --argjson me "$ME" 'all(.[]; .owner_user_id == $me)' <<< "$list" >/dev/null \
      || die "the Kokli NPM login ($NPM_USER_EMAIL) can see items that are not its own: nothing was changed. In NPM: Users -> that user -> Permissions -> Item Visibility: Created Items."
  done
}
kokli_login() { login "$SEC/npm-kokli"; guard_scope; }

# Only Kokli's own, by owner and by name.
host_id() {  # host_id NAME -> the id of our proxy host for exactly that one name
  local all; all="$(api GET /nginx/proxy-hosts)" || exit 1
  jq -r --arg d "$1" --argjson me "$ME" \
    '[.[] | select(.owner_user_id == $me and .domain_names == [$d])][0].id // empty' <<< "$all"
}
cert_id() {  # cert_id PROVIDER NAME -> the id of our certificate for that name
  local all; all="$(api GET /nginx/certificates)" || exit 1
  jq -r --arg p "$1" --arg d "$2" --argjson me "$ME" \
    '[.[] | select(.owner_user_id == $me and .provider == $p and (.domain_names == [$d] or .nice_name == $d))][0].id // empty' <<< "$all"
}

host_json() {  # host_json NAME CERT_ID: Kokli's settings (DEPLOYMENT.md 7d, step 3)
  jq -n --arg d "$1" --argjson c "$2" --arg adv "$ADVANCED" '{
    domain_names: [$d], forward_scheme: "http", forward_host: "kokli", forward_port: 3000,
    certificate_id: $c, ssl_forced: true, http2_support: true,
    hsts_enabled: false, hsts_subdomains: false, trust_forwarded_proto: false,
    block_exploits: false, caching_enabled: false, allow_websocket_upgrade: true,
    access_list_id: 0, advanced_config: $adv, meta: {}, locations: []
  }'
}

# ensure_host NAME CERT_ID: make the proxy host, or set an existing one of ours
# back to these settings. NPM tests nginx's config before it reloads: a host
# whose config fails is switched off on its own, and nobody else's changes.
ensure_host() {
  local d="$1" c="$2" id out
  id="$(host_id "$d")" || exit 1
  if [ -n "$id" ]; then
    out="$(api PUT "/nginx/proxy-hosts/$id" "$(host_json "$d" "$c")")" || exit 1
    say "   proxy host $d (#$id): settings applied"
  else
    out="$(api POST /nginx/proxy-hosts "$(host_json "$d" "$c")")" || exit 1
    id="$(jq -r .id <<< "$out")"
    say "   proxy host $d made (#$id)"
  fi
  out="$(api GET "/nginx/proxy-hosts/$id")" || exit 1
  [ "$(jq -r '.meta.nginx_online' <<< "$out")" != false ] \
    || die "nginx refused the config of $d (#$id), so NPM switched that host off: $(jq -r '.meta.nginx_err' <<< "$out")"
}

# NPM writes an uploaded certificate's files but does not reload nginx; saving
# our host again makes NPM rebuild that one host's config and reload, gracefully.
resave_host() {  # resave_host NAME
  local h; h="$(host_id "$1")" || exit 1
  [ -n "$h" ] || return 0
  api PUT "/nginx/proxy-hosts/$h" '{"forward_port":3000}' >/dev/null || exit 1
}

# upload CERT_ID: hand NPM the live wildcard certificate.
upload() {
  local code
  code="$(curl -s -m 60 -o "$WORK/resp" -w '%{http_code}' -H @"$HDR" \
    -F "certificate=@$LIVE/cert.pem" -F "certificate_key=@$LIVE/privkey.pem" \
    -F "intermediate_certificate=@$LIVE/chain.pem" "$API/nginx/certificates/$1/upload")"
  case "$code" in
    2??) say "   certificate $WILD uploaded to NPM (#$1)" ;;
    *) die "NPM refused the certificate (${code:-no answer}): $(jq -r '.error.message // empty' "$WORK/resp" 2>/dev/null)" ;;
  esac
}

# ------------------------------------------------------- the friend's state
# Their proxy-host files byte for byte; the HSTS value nginx actually sends
# (one `map` shared by every host — the definition parsed last wins, NPM issue
# #5947 — and each of Kokli's files carries one); and how each of their names
# answers here (HTTP, HTTPS, and the ACME path every certificate here renews
# through), asked at this server itself so that no DNS or CDN sits in between.
friend_state() {
  local acme=/data/letsencrypt-acme-challenge/.well-known/acme-challenge h r ours
  ours="(^|\\.)$(sed 's/\./\\./g' <<< "$DOMAIN")$"
  docker exec -e D="$DOMAIN" "$NAME" sh -c 'cd /data/nginx/proxy_host 2>/dev/null || exit 0
    for f in *.conf; do [ -e "$f" ] || continue
      grep -qF -e " $D;" -e ".$D;" "$f" || sha256sum "$f"
    done'
  printf '%-34s %s\n' "hsts value in use" \
    "$(docker exec "$NAME" nginx -T 2>/dev/null | awk '/^map \$scheme \$hsts_header/ { getline; v = $0 } END { gsub(/^[ \t]+/, "", v); print (v == "" ? "none" : v) }')"
  docker exec "$NAME" sh -c "mkdir -p $acme && echo kokli-ok > $acme/kokli-check" 2>/dev/null
  docker exec "$NAME" sh -c 'cat /data/nginx/proxy_host/*.conf /data/nginx/redirection_host/*.conf 2>/dev/null' \
    | awk '$1 == "server_name" { for (i = 2; i <= NF; i++) { gsub(";", "", $i); if ($i != "" && $i !~ /[*]/) print $i } }' \
    | grep -v -E "$ours" | sort -u | while read -r h; do
      r="--resolve $h:80:$EDGE --resolve $h:443:$EDGE"
      # shellcheck disable=SC2086
      printf '%-34s http=%s https=%s acme=%s\n' "$h" \
        "$(curl -s -o /dev/null -m 15 $r -w '%{http_code}' "http://$h/")" \
        "$(curl -s -o /dev/null -m 15 $r -w '%{http_code}' "https://$h/")" \
        "$(curl -s -k -L -m 15 $r "http://$h/.well-known/acme-challenge/kokli-check" | grep -qx kokli-ok && echo ok || echo FAIL)"
    done
  docker exec "$NAME" rm -f "$acme/kokli-check" 2>/dev/null
  printf '%-34s %s\n' "nginx -t" "$(docker exec "$NAME" nginx -t >/dev/null 2>&1 && echo ok || echo FAIL)"
}
# before [soft]: soft (for `remove`) records but goes on when nginx -t already
# fails — taking Kokli's hosts out can only remove references, never add one.
before() {
  friend_state > "$TLS/friend-before.txt"
  if ! grep -q '^nginx -t  *ok$' "$TLS/friend-before.txt"; then
    [ "${1:-}" = soft ] || die "nginx -t already fails in $NAME, before any change: nothing was changed."
    say "   (nginx -t fails before this change - see whether taking Kokli out mends it)"
  fi
  say "== the friend's side, before: $(grep -c ' http=' "$TLS/friend-before.txt") names, $(grep -c '\.conf$' "$TLS/friend-before.txt") proxy-host files (saved in $TLS/friend-before.txt)"
}
after() {
  local b a
  friend_state > "$TLS/friend-after.txt"
  if ! diff <(grep -v '^nginx -t ' "$TLS/friend-before.txt") <(grep -v '^nginx -t ' "$TLS/friend-after.txt") > "$TLS/friend-diff.txt"; then
    say "== STOP: something of the friend's differs from before (< before, > after):"
    sed 's/^/   /' "$TLS/friend-diff.txt"
    say "   (to take Kokli's hosts out again: bash $SELF remove)"
    exit 1
  fi
  b="$(awk '/^nginx -t / { print $NF }' "$TLS/friend-before.txt")"
  a="$(awk '/^nginx -t / { print $NF }' "$TLS/friend-after.txt")"
  if [ "$a" != ok ] && [ "$b" = ok ]; then
    say "== STOP: nginx -t passed before this change and fails now (docker exec $NAME nginx -t)"
    say "   (to take Kokli's hosts out again: bash $SELF remove)"
    exit 1
  fi
  [ "$a" = ok ] || say "   nginx -t still fails, as it did before this change"
  [ "$a" != ok ] || [ "$b" = ok ] || say "   nginx -t failed before this change, and passes now"
  say "== the friend's side, after: every proxy-host file, the HSTS value and every answer exactly as before"
}

# ------------------------------------------------------------ Kokli's side
served_pem() {  # served_pem NAME FILE: the certificate this server's 443 hands out for NAME
  echo | timeout 20 openssl s_client -connect "$EDGE:443" -servername "$1" 2>/dev/null \
    | openssl x509 > "$2" 2>/dev/null
}
fingerprint() { openssl x509 -noout -fingerprint -sha256 -in "$1" 2>/dev/null; }
# soon FILE: true when less than a quarter of the certificate's lifetime is left
# (or it cannot be read) — 22 days of a 90-day certificate, and in step with
# Let's Encrypt's shorter lifetimes as they come.
soon() {
  local d
  d="$(openssl x509 -noout -startdate -enddate -dateopt iso_8601 -in "$1" 2>/dev/null)" || return 0
  python3 -c '
import sys, datetime as t
v = dict(l.split("=", 1) for l in sys.argv[1].splitlines())
p = lambda s: t.datetime.strptime(s.strip(), "%Y-%m-%d %H:%M:%SZ").replace(tzinfo=t.timezone.utc)
nb, na = p(v["notBefore"]), p(v["notAfter"])
sys.exit(0 if (na - t.datetime.now(t.timezone.utc)) < (na - nb) / 4 else 1)' "$d"
}

check_kokli() {  # check_kokli NAME: health over HTTPS, HTTP sent to HTTPS, the certificate
  local h="$1" r="--resolve $1:80:$EDGE --resolve $1:443:$EDGE" body to cert
  # shellcheck disable=SC2086
  body="$(curl -s -m 15 $r "https://$h/api/health")"
  # shellcheck disable=SC2086
  to="$(curl -s -o /dev/null -m 15 $r -w '%{http_code} %{redirect_url}' "http://$h/")"
  served_pem "$h" "$WORK/check.pem" && cert="$(openssl x509 -noout -subject -enddate -in "$WORK/check.pem" | tr '\n' ' ')"
  say "   https://$h/api/health -> ${body:-no answer}"
  say "   http://$h/ -> $to"
  say "   certificate: ${cert:-none}"
  case "$body" in *'"ok":true'*) ;; *) return 1 ;; esac
}
check_real_ip() {  # an invented X-Real-IP must not be believed (DEPLOYMENT.md 7d, step 4)
  local id line m client
  id="$(host_id "$DOMAIN")" || exit 1
  [ -n "$id" ] || { say "   X-Real-IP: no $DOMAIN host to check"; return 1; }
  m="real-ip-check-$$-$(date +%s)"
  # By 127.0.0.1, so the request arrives from Docker's gateway, an address NPM
  # trusts out of the box: without the Advanced lines, 9.9.9.9 would be believed.
  curl -s -o /dev/null -m 15 --resolve "$DOMAIN:443:127.0.0.1" -H 'X-Real-IP: 9.9.9.9' "https://$DOMAIN/api/health?$m"
  sleep 1
  line="$(docker exec "$NAME" sh -c "grep -F '$m' /data/logs/proxy-host-${id}_access.log | tail -1")"
  client="$(grep -o '\[Client [^]]*\]' <<< "$line" | head -1)"
  case "$client" in
    '[Client 9.9.9.9]') say "   X-Real-IP: BELIEVED - the Advanced lines are not in effect"; return 1 ;;
    '[Client 10.'*|'[Client 192.168.'*|'[Client 172.'*) say "   X-Real-IP: ignored, as it must be ($client)" ;;
    *) say "   X-Real-IP: the check did not get a usable answer (${client:-no log line})"; return 1 ;;
  esac
}

# ----------------------------------------------------------------- certbot
certbot_image() {
  docker image inspect "$CERTBOT_IMAGE" >/dev/null 2>&1 && return 0
  say "== building $CERTBOT_IMAGE (once; a minute)"
  docker build -q -t "$CERTBOT_IMAGE" - > /dev/null <<'DOCKERFILE' || die "could not build $CERTBOT_IMAGE."
FROM python:3.13-slim
RUN pip install --no-cache-dir --disable-pip-version-check \
      'certbot==5.8.0' 'certbot-dns-hostinger==0.1.3' 'hostinger_api==4.2.0' \
 && certbot --version
ENTRYPOINT ["certbot"]
DOCKERFILE
}
# As this user, so its files stay this user's; state in ~/kokli/tls. At most
# half an hour: the Hostinger client waits forever on a stalled connection, and
# a run that never ends would hold the lock and starve every later renewal.
certbot() {
  local rc
  mkdir -p "$TLS/conf" "$TLS/work" "$TLS/logs"
  timeout -k 60 1800 docker run --rm --name "kokli-certbot-$$" --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$TLS:/tls" -v "$SEC/hostinger.ini:/run/hostinger.ini:ro" \
    "$CERTBOT_IMAGE" --config-dir /tls/conf --work-dir /tls/work --logs-dir /tls/logs "$@"
  rc=$?
  docker rm -f "kokli-certbot-$$" >/dev/null 2>&1
  return $rc
}
ISSUE=(--non-interactive --agree-tos --register-unsafely-without-email
       --authenticator dns-hostinger --dns-hostinger-credentials /run/hostinger.ini
       --dns-hostinger-propagation-seconds 120 --key-type ecdsa --cert-name wildcard -d "$WILD")
need_token() {
  [ -s "$SEC/hostinger.ini" ] || die "the Hostinger API token is missing: save it as $SEC/hostinger.ini (DEPLOYMENT.md 7d)."
  chmod 600 "$SEC/hostinger.ini"
}

install_cron() {
  local tab="$WORK/crontab"
  crontab -l > "$tab" 2>/dev/null || die "could not read this user's crontab: the daily renewal is NOT scheduled."
  if grep -qF 'kokli-tls.sh renew' "$tab"; then say "   daily renewal: in cron"; return 0; fi
  grep -q '^# <<< kokli <<<$' "$tab" || die "Kokli's block is not in the crontab (deploy/server/bootstrap.sh makes it): the daily renewal is NOT scheduled."
  awk -v l="$CRON_LINE" '/^# <<< kokli <<<$/ { print l } { print }' "$tab" > "$tab.new"
  crontab "$tab.new" && say "   daily renewal: added to cron (03:41 UTC), log $K/tls.log"
}

# ---------------------------------------------------------------- commands
cmd_user() {
  local me users id n out
  if [ -s "$SEC/npm-kokli" ]; then
    kokli_login
    say "== the NPM user $NPM_USER_EMAIL is there: logs in, not an admin, sees only its own"
    [ ! -e "$SEC/npm-admin" ] || { rm -f "$SEC/npm-admin" && say "   deleted the admin login $SEC/npm-admin"; }
    return 0
  fi
  [ -s "$SEC/npm-admin" ] || die "first save an NPM admin login as $SEC/npm-admin (DEPLOYMENT.md 7d)."
  login "$SEC/npm-admin"
  me="$(api GET /users/me)" || exit 1
  jq -e '.roles | index("admin")' <<< "$me" >/dev/null || die "the login in $SEC/npm-admin is not an NPM admin: nothing was changed."
  users="$(api GET /users)" || exit 1
  [ -z "$(jq -r --arg e "$NPM_USER_EMAIL" '.[] | select(.email == $e) | .id' <<< "$users")" ] \
    || die "an NPM user $NPM_USER_EMAIL exists already, but $SEC/npm-kokli does not: nothing was changed."
  ( umask 077; openssl rand -base64 48 | tr -d '/+=\n' | cut -c1-40 | tr -d '\n' > "$WORK/pw" )
  [ "$(wc -c < "$WORK/pw")" -ge 32 ] || die "could not make a password."
  out="$(api POST /users "$(jq -n --arg e "$NPM_USER_EMAIL" --rawfile p "$WORK/pw" \
    '{name: "Kokli", nickname: "Kokli", email: $e, roles: [], is_disabled: false, auth: {type: "password", secret: $p}}')")" || exit 1
  id="$(jq -r .id <<< "$out")"
  # Saved at once: should anything below fail, the user can still be logged into.
  ( umask 077; { printf '%s\n' "$NPM_USER_EMAIL"; cat "$WORK/pw"; printf '\n'; } > "$SEC/npm-kokli" )
  rm -f "$WORK/pw"
  api PUT "/users/$id/permissions" '{"visibility":"user","proxy_hosts":"manage","certificates":"manage","redirection_hosts":"hidden","dead_hosts":"hidden","streams":"hidden","access_lists":"hidden"}' >/dev/null || exit 1
  # The proof: it logs in, it is not an admin, and it sees none of the friend's.
  kokli_login
  out="$(api GET /nginx/proxy-hosts)" || exit 1; n="$(jq length <<< "$out")"
  [ "$n" = 0 ] || die "the new NPM user sees $n proxy hosts; it must see none of the friend's."
  out="$(api GET /nginx/certificates)" || exit 1; n="$(jq length <<< "$out")"
  [ "$n" = 0 ] || die "the new NPM user sees $n certificates; it must see none of the friend's."
  say "== NPM user $NPM_USER_EMAIL made (#$id): not an admin, and it sees none of the friend's hosts or certificates"
  rm -f "$SEC/npm-admin" && say "   deleted the admin login $SEC/npm-admin; Kokli's own is $SEC/npm-kokli"
}

cmd_apex() {
  local c out
  kokli_login
  before
  # NPM deletes a certificate whose request failed, so one that is listed is real.
  c="$(cert_id letsencrypt "$DOMAIN")" || exit 1
  if [ -z "$c" ]; then
    say "== asking Let's Encrypt for $DOMAIN through NPM (HTTP-01, about a minute)"
    out="$(api POST /nginx/certificates "$(jq -n --arg d "$DOMAIN" \
      '{provider: "letsencrypt", domain_names: [$d], meta: {dns_challenge: false, key_type: "ecdsa"}}')")" || exit 1
    c="$(jq -r .id <<< "$out")"
  fi
  out="$(api GET "/nginx/certificates/$c")" || exit 1
  say "   certificate $DOMAIN: #$c, valid until $(jq -r .expires_on <<< "$out")"
  ensure_host "$DOMAIN" "$c"
  after
  say "== Kokli on $DOMAIN"
  check_kokli "$DOMAIN" || die "Kokli does not answer on https://$DOMAIN/ (above)."
  check_real_ip || exit 1
}

cmd_wildcard() {
  local c out
  need_token
  kokli_login
  certbot_image
  if [ ! -s "$LIVE/cert.pem" ]; then
    say "== a dry run first, on Let's Encrypt's test server: the token, the plugin, the DNS record (2-3 minutes)"
    certbot certonly --dry-run "${ISSUE[@]}" || die "the dry run failed (above): nothing was issued, and NPM was not touched."
    say "== the real certificate for $WILD (2-3 minutes)"
    certbot certonly "${ISSUE[@]}" || die "Let's Encrypt did not issue $WILD (above); NPM was not touched."
  else
    # Renews only when due — but after a lapse (an expired token, say) this is
    # what makes a certificate NPM will still accept.
    certbot renew --non-interactive --no-random-sleep-on-renew --cert-name wildcard \
      || { soon "$LIVE/cert.pem" && die "certbot could not renew $WILD, and it is due (above)."; say "   (certbot could not renew, but $WILD is not due yet)"; }
  fi
  say "   certificate $WILD: $(openssl x509 -noout -enddate -in "$LIVE/cert.pem")"
  # Scheduled as soon as there is something to renew, whatever happens below.
  install_cron
  before
  c="$(cert_id other "$WILD")" || exit 1
  if [ -z "$c" ]; then
    out="$(api POST /nginx/certificates "$(jq -n --arg n "$WILD" '{provider: "other", nice_name: $n}')")" || exit 1
    c="$(jq -r .id <<< "$out")"
  fi
  upload "$c"
  ensure_host "$WILD" "$c"
  after
  say "== Kokli on $WILD"
  check_kokli "renew-check.$DOMAIN" || die "Kokli does not answer on https://renew-check.$DOMAIN/ (above)."
}

cmd_renew() {
  local now c rc=0 file
  date -u '+== %F %T UTC  renew'
  if [ -s "$LIVE/cert.pem" ]; then
    need_token
    certbot_image
    # KOKLI_FORCE_RENEW=1: a new key now (say the old one was seen somewhere).
    certbot renew --non-interactive --no-random-sleep-on-renew --cert-name wildcard \
        ${KOKLI_FORCE_RENEW:+--force-renewal} \
      || say "WARNING: certbot could not renew $WILD (above); the next run tries again"
  else
    say "   no $WILD certificate here: nothing to renew"
  fi
  kokli_login
  # *.kokli.in: NPM must serve what certbot holds.
  c="$(cert_id other "$WILD")" || exit 1
  if [ -s "$LIVE/cert.pem" ] && [ -z "$c" ]; then
    say "ERROR: Kokli's $WILD certificate is not in NPM (deleted there?), so every clinic site is down: 'bash $SELF wildcard' puts it back"
    rc=1
  elif [ -s "$LIVE/cert.pem" ]; then
    now="$(fingerprint "$LIVE/cert.pem")"
    served_pem "renew-check.$DOMAIN" "$WORK/wild.pem"
    if [ "$(fingerprint "$WORK/wild.pem")" != "$now" ]; then
      say "   NPM does not serve the current $WILD certificate: handing it over"
      before
      upload "$c"
      resave_host "$WILD"
      sleep 2
      after
      served_pem "renew-check.$DOMAIN" "$WORK/wild.pem"
      [ "$(fingerprint "$WORK/wild.pem")" = "$now" ] && say "   NPM now serves the current certificate" \
        || { say "ERROR: NPM still serves another certificate for $WILD"; rc=1; }
    fi
    say "   $WILD: $(openssl x509 -noout -enddate -in "$LIVE/cert.pem")"
    soon "$LIVE/cert.pem" && { say "WARNING: $WILD has under a quarter of its life left and has not been renewed - look at $TLS/logs/letsencrypt.log"; rc=1; }
  fi
  # kokli.in: NPM renews it, but does not reload nginx afterwards; when the
  # file it holds is newer than what is served, re-saving our host loads it.
  c="$(cert_id letsencrypt "$DOMAIN")" || exit 1
  if [ -n "$c" ] && served_pem "$DOMAIN" "$WORK/apex.pem"; then
    file="$(docker exec "$NAME" cat "/etc/letsencrypt/live/npm-$c/fullchain.pem" 2>/dev/null | openssl x509 -noout -fingerprint -sha256 2>/dev/null)"
    if [ -n "$file" ] && [ "$file" != "$(fingerprint "$WORK/apex.pem")" ]; then
      say "   NPM renewed $DOMAIN, but nginx still serves the old certificate: re-saving the host"
      before; resave_host "$DOMAIN"; sleep 2; after
      served_pem "$DOMAIN" "$WORK/apex.pem"
    fi
    say "   $DOMAIN: $(openssl x509 -noout -enddate -in "$WORK/apex.pem")"
    soon "$WORK/apex.pem" && { say "WARNING: $DOMAIN (renewed by NPM) is served with under a quarter of its life left - NPM's renewal is failing"; rc=1; }
  fi
  return $rc
}

cmd_verify() {
  local ok=yes
  kokli_login
  say "== Kokli"
  check_kokli "$DOMAIN" || ok=no
  check_kokli "renew-check.$DOMAIN" || ok=no
  check_real_ip || ok=no
  if crontab -l 2>/dev/null | grep -qF 'kokli-tls.sh renew' && cmp -s "$SELF" "$K/kokli-tls.sh"; then
    say "   daily renewal: in cron, and cron runs this version"
  else
    say "   daily renewal: NOT scheduled, or cron runs another version (bash $SELF wildcard schedules it)"; ok=no
  fi
  for h in "$DOMAIN" "renew-check.$DOMAIN"; do
    served_pem "$h" "$WORK/v.pem" && soon "$WORK/v.pem" && { say "   WARNING: the certificate for $h has under a quarter of its life left"; ok=no; }
  done
  say "== the friend's side, now:"
  friend_state | sed 's/^/   /'
  [ "$ok" = yes ]
}

cmd_remove() {
  local all id
  kokli_login
  before soft
  all="$(api GET /nginx/proxy-hosts)" || exit 1
  for id in $(jq -r --argjson me "$ME" --arg a "$DOMAIN" --arg w "$WILD" \
      '.[] | select(.owner_user_id == $me and (.domain_names == [$a] or .domain_names == [$w])) | .id' <<< "$all"); do
    api DELETE "/nginx/proxy-hosts/$id" >/dev/null || exit 1; say "   removed proxy host #$id"
  done
  all="$(api GET /nginx/certificates)" || exit 1
  for id in $(jq -r --argjson me "$ME" --arg a "$DOMAIN" --arg w "$WILD" \
      '.[] | select(.owner_user_id == $me and (.domain_names == [$a] or .domain_names == [$w] or .nice_name == $a or .nice_name == $w)) | .id' <<< "$all"); do
    api DELETE "/nginx/certificates/$id" >/dev/null || exit 1; say "   removed certificate #$id"
  done
  after
  if [ -d "$TLS/conf" ]; then
    mv "$TLS/conf" "$TLS/conf.removed-$(date -u +%Y%m%d-%H%M%S)" && say "   Kokli's certbot state set aside, so cron renews nothing any more"
  fi
}

main() {
  for t in curl jq python3 openssl flock docker timeout; do command -v "$t" >/dev/null || die "$t is missing on this server."; done
  case "${1:-}" in
    user|apex|wildcard|renew|verify|remove) ;;
    *) awk 'NR > 1 && !/^#/ { exit } NR > 1' "$0"; exit 2 ;;
  esac
  lock
  # Cron runs this copy; keep it the version being run.
  [ "$SELF" = "$K/kokli-tls.sh" ] || install -m 755 "$SELF" "$K/kokli-tls.sh" || die "could not install $K/kokli-tls.sh."
  "cmd_$1"
}

# Sourced (by a test), it only defines the functions.
[ "${BASH_SOURCE[0]}" != "$0" ] || main "$@"
