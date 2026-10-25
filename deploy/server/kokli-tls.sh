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
#  NPM is driven through its API, as an NPM user of Kokli's own that sees and
#  changes only what it created. `user` makes that user once, with an admin
#  login given for that alone, and then deletes the admin login.
#
#      bash kokli-tls.sh user       once: the NPM user (needs ~/kokli/secrets/npm-admin)
#      bash kokli-tls.sh apex       kokli.in: certificate and proxy host
#      bash kokli-tls.sh wildcard   *.kokli.in: certificate (needs
#                                   ~/kokli/secrets/hostinger.ini), proxy host,
#                                   and the daily renewal in cron
#      bash kokli-tls.sh renew      (cron) renew *.kokli.in when due; NPM serves it
#      bash kokli-tls.sh verify     Kokli answers on both; the friend's hosts too
#      bash kokli-tls.sh remove     take Kokli's hosts and certificates out of NPM
#
#  Every command that changes NPM first records the friend's proxy-host files,
#  byte for byte, and how every one of their names answers; afterwards it
#  proves both unchanged, and stops at the first difference.
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

# What the Kokli user sees is only what it made, so these find only Kokli's.
host_id() {  # host_id NAME -> the id of our proxy host for exactly that one name
  local all; all="$(api GET /nginx/proxy-hosts)" || exit 1
  jq -r --arg d "$1" '[.[] | select(.domain_names == [$d])][0].id // empty' <<< "$all"
}
cert_id() {  # cert_id PROVIDER NAME -> the id of our certificate for that name
  local all; all="$(api GET /nginx/certificates)" || exit 1
  jq -r --arg p "$1" --arg d "$2" \
    '[.[] | select(.provider == $p and (.domain_names == [$d] or .nice_name == $d))][0].id // empty' <<< "$all"
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

# upload CERT_ID: hand NPM the live wildcard certificate (it writes the files;
# nginx reads them at its next reload — see reload_wildcard).
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
# Their proxy-host files byte for byte, and how each of their names answers
# here (HTTP, HTTPS, and the ACME path every certificate here renews through),
# asked at this server itself so that no DNS or CDN sits in between.
friend_state() {
  local acme=/data/letsencrypt-acme-challenge/.well-known/acme-challenge h r ours
  ours="(^|\\.)$(sed 's/\./\\./g' <<< "$DOMAIN")$"
  docker exec -e D="$DOMAIN" "$NAME" sh -c 'cd /data/nginx/proxy_host 2>/dev/null || exit 0
    for f in *.conf; do [ -e "$f" ] || continue
      grep -qF -e " $D;" -e ".$D;" "$f" || sha256sum "$f"
    done'
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
before() {
  friend_state > "$TLS/friend-before.txt"
  grep -q '^nginx -t  *ok$' "$TLS/friend-before.txt" || die "nginx -t already fails in $NAME, before any change: nothing was changed."
  say "== the friend's side, before: $(grep -c ' http=' "$TLS/friend-before.txt") names, $(grep -c '\.conf$' "$TLS/friend-before.txt") proxy-host files (saved in $TLS/friend-before.txt)"
}
after() {
  friend_state > "$TLS/friend-after.txt"
  if diff "$TLS/friend-before.txt" "$TLS/friend-after.txt" > "$TLS/friend-diff.txt"; then
    say "== the friend's side, after: every proxy-host file and every answer exactly as before"
  else
    say "== STOP: something of the friend's differs from before (< before, > after):"
    sed 's/^/   /' "$TLS/friend-diff.txt"
    exit 1
  fi
}

# ------------------------------------------------------------ Kokli's side
check_kokli() {  # check_kokli NAME: health over HTTPS, HTTP sent to HTTPS, the certificate
  local h="$1" r="--resolve $1:80:$EDGE --resolve $1:443:$EDGE" body to cert
  body="$(curl -s -m 15 $r "https://$h/api/health")"
  to="$(curl -s -o /dev/null -m 15 $r -w '%{http_code} %{redirect_url}' "http://$h/")"
  cert="$(echo | openssl s_client -connect "$EDGE:443" -servername "$h" 2>/dev/null | openssl x509 -noout -subject -enddate 2>/dev/null | tr '\n' ' ')"
  say "   https://$h/api/health -> ${body:-no answer}"
  say "   http://$h/ -> $to"
  say "   certificate: ${cert:-none}"
  case "$body" in *'"ok":true'*) ;; *) return 1 ;; esac
}
check_real_ip() {  # an invented X-Real-IP must not be believed (DEPLOYMENT.md 7d, step 4)
  local id line
  id="$(host_id "$DOMAIN")" || exit 1
  [ -n "$id" ] || return 0
  curl -s -o /dev/null -m 15 --resolve "$DOMAIN:443:127.0.0.1" -H 'X-Real-IP: 9.9.9.9' "https://$DOMAIN/api/health?real-ip-check"
  sleep 1
  line="$(docker exec "$NAME" sh -c "grep -F 'real-ip-check' /data/logs/proxy-host-${id}_access.log | tail -1")"
  case "$line" in
    *'[Client 9.9.9.9]'*) say "   X-Real-IP: BELIEVED - the Advanced lines are not in effect: $line"; return 1 ;;
    *'[Client '*) say "   X-Real-IP: ignored, as it must be ($(grep -o '\[Client [^]]*\]' <<< "$line"))" ;;
    *) say "   X-Real-IP: no log line found for the check" ;;
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
certbot() {  # as this user, so its files stay this user's; state in ~/kokli/tls
  mkdir -p "$TLS/conf" "$TLS/work" "$TLS/logs"
  docker run --rm --name "kokli-certbot-$$" --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$TLS:/tls" -v "$SEC/hostinger.ini:/run/hostinger.ini:ro" \
    "$CERTBOT_IMAGE" --config-dir /tls/conf --work-dir /tls/work --logs-dir /tls/logs "$@"
}
ISSUE=(--non-interactive --agree-tos --register-unsafely-without-email
       --authenticator dns-hostinger --dns-hostinger-credentials /run/hostinger.ini
       --dns-hostinger-propagation-seconds 120 --key-type ecdsa --cert-name wildcard -d "$WILD")
fingerprint() { openssl x509 -noout -fingerprint -sha256 -in "$1" 2>/dev/null; }
served_fingerprint() {
  echo | openssl s_client -connect "$EDGE:443" -servername "renew-check.$DOMAIN" 2>/dev/null \
    | openssl x509 -noout -fingerprint -sha256 2>/dev/null
}

# NPM writes an uploaded certificate's files but does not reload nginx; saving
# our host again makes NPM rebuild that host's config and reload (gracefully).
reload_wildcard() {
  local h; h="$(host_id "$WILD")" || exit 1
  [ -n "$h" ] || return 0
  api PUT "/nginx/proxy-hosts/$h" '{"forward_port":3000}' >/dev/null || exit 1
}

install_cron() {
  local self line tab
  self="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
  [ "$self" = "$K/kokli-tls.sh" ] || install -m 755 "$self" "$K/kokli-tls.sh" || die "could not install $K/kokli-tls.sh."
  line='41 3 * * *   /bin/bash $HOME/kokli/kokli-tls.sh renew >> $HOME/kokli/tls.log 2>&1'
  tab="$WORK/crontab"
  crontab -l > "$tab" 2>/dev/null || die "could not read this user's crontab: the daily renewal is NOT scheduled."
  if grep -qF 'kokli-tls.sh renew' "$tab"; then say "   daily renewal: already in cron"; return 0; fi
  grep -q '^# <<< kokli <<<$' "$tab" || die "Kokli's block is not in the crontab (deploy/server/bootstrap.sh makes it): the daily renewal is NOT scheduled."
  awk -v l="$line" '/^# <<< kokli <<<$/ { print l } { print }' "$tab" > "$tab.new"
  crontab "$tab.new" && say "   daily renewal: in cron (03:41 UTC), log $K/tls.log"
}

# ---------------------------------------------------------------- commands
cmd_user() {
  local me users id n out
  if [ -s "$SEC/npm-kokli" ]; then
    login "$SEC/npm-kokli"
    say "== the NPM user $NPM_USER_EMAIL exists and logs in"
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
  api PUT "/users/$id/permissions" '{"visibility":"user","proxy_hosts":"manage","certificates":"manage","redirection_hosts":"hidden","dead_hosts":"hidden","streams":"hidden","access_lists":"hidden"}' >/dev/null || exit 1
  ( umask 077; { printf '%s\n' "$NPM_USER_EMAIL"; cat "$WORK/pw"; printf '\n'; } > "$SEC/npm-kokli" )
  rm -f "$WORK/pw"
  # The proof: it logs in, it is not an admin, and it sees none of the friend's.
  login "$SEC/npm-kokli"
  me="$(api GET /users/me)" || exit 1
  jq -e '.roles | index("admin") | not' <<< "$me" >/dev/null || die "the new NPM user is an admin: remove it in NPM (Users) and run this again."
  out="$(api GET /nginx/proxy-hosts)" || exit 1; n="$(jq length <<< "$out")"
  [ "$n" = 0 ] || die "the new NPM user sees $n proxy hosts; it must see none of the friend's."
  out="$(api GET /nginx/certificates)" || exit 1; n="$(jq length <<< "$out")"
  [ "$n" = 0 ] || die "the new NPM user sees $n certificates; it must see none of the friend's."
  say "== NPM user $NPM_USER_EMAIL made (#$id): not an admin, and it sees none of the friend's hosts or certificates"
  rm -f "$SEC/npm-admin" && say "   deleted the admin login $SEC/npm-admin; Kokli's own is $SEC/npm-kokli"
}

cmd_apex() {
  local c out
  login "$SEC/npm-kokli"
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
  [ -s "$SEC/hostinger.ini" ] || die "first save the Hostinger API token as $SEC/hostinger.ini (DEPLOYMENT.md 7d)."
  chmod 600 "$SEC/hostinger.ini"
  login "$SEC/npm-kokli"
  certbot_image
  if [ ! -s "$LIVE/cert.pem" ]; then
    say "== a dry run first, on Let's Encrypt's test server: the token, the plugin, the DNS record (2-3 minutes)"
    certbot certonly --dry-run "${ISSUE[@]}" || die "the dry run failed (above): nothing was issued, and NPM was not touched."
    say "== the real certificate for $WILD (2-3 minutes)"
    certbot certonly "${ISSUE[@]}" || die "Let's Encrypt did not issue $WILD (above); NPM was not touched."
  fi
  say "   certificate $WILD: $(openssl x509 -noout -enddate -in "$LIVE/cert.pem")"
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
  install_cron
}

cmd_renew() {
  local was now served c
  date -u '+== %F %T UTC  renew'
  [ -s "$LIVE/cert.pem" ] || { say "   no $WILD certificate here yet: nothing to renew"; return 0; }
  [ -s "$SEC/hostinger.ini" ] || die "$SEC/hostinger.ini is missing: $WILD cannot be renewed."
  was="$(fingerprint "$LIVE/cert.pem")"
  certbot_image
  certbot renew --non-interactive --no-random-sleep-on-renew --cert-name wildcard \
    || say "WARNING: certbot could not renew $WILD (above); tomorrow's run tries again"
  now="$(fingerprint "$LIVE/cert.pem")"
  served="$(served_fingerprint)"
  if [ "$served" != "$now" ]; then
    [ "$was" = "$now" ] && say "   NPM serves another certificate than the live one: uploading it again" \
                        || say "   renewed: handing the new certificate to NPM"
    login "$SEC/npm-kokli"
    before
    c="$(cert_id other "$WILD")" || exit 1
    [ -n "$c" ] || die "Kokli's custom certificate for $WILD is not in NPM: run 'bash kokli-tls.sh wildcard'."
    upload "$c"
    reload_wildcard
    sleep 2
    after
    [ "$(served_fingerprint)" = "$now" ] && say "   NPM now serves the renewed certificate" \
      || die "NPM still serves the old certificate for $WILD."
  fi
  say "   $WILD: $(openssl x509 -noout -enddate -in "$LIVE/cert.pem")"
  if ! openssl x509 -noout -checkend $((20 * 86400)) -in "$LIVE/cert.pem" >/dev/null; then
    say "WARNING: $WILD expires within 20 days and has not been renewed - look at $TLS/logs/letsencrypt.log"
    exit 1
  fi
}

cmd_verify() {
  local ok=yes
  login "$SEC/npm-kokli"
  say "== Kokli"
  check_kokli "$DOMAIN" || ok=no
  check_kokli "renew-check.$DOMAIN" || ok=no
  check_real_ip || ok=no
  say "== the friend's side, now:"
  friend_state | sed 's/^/   /'
  [ "$ok" = yes ]
}

cmd_remove() {
  local all id
  login "$SEC/npm-kokli"
  before
  all="$(api GET /nginx/proxy-hosts)" || exit 1
  for id in $(jq -r '.[].id' <<< "$all"); do api DELETE "/nginx/proxy-hosts/$id" >/dev/null || exit 1; say "   removed proxy host #$id"; done
  all="$(api GET /nginx/certificates)" || exit 1
  for id in $(jq -r '.[].id' <<< "$all"); do api DELETE "/nginx/certificates/$id" >/dev/null || exit 1; say "   removed certificate #$id"; done
  after
}

main() {
  for t in curl jq python3 openssl flock docker; do command -v "$t" >/dev/null || die "$t is missing on this server."; done
  case "${1:-}" in
    user) lock; cmd_user ;;
    apex) lock; cmd_apex ;;
    wildcard) lock; cmd_wildcard ;;
    renew) lock; cmd_renew ;;
    verify) lock; cmd_verify ;;
    remove) lock; cmd_remove ;;
    *) awk 'NR > 1 && !/^#/ { exit } NR > 1' "$0"; exit 2 ;;
  esac
}

# Sourced (by a test), it only defines the functions.
[ "${BASH_SOURCE[0]}" != "$0" ] || main "$@"
