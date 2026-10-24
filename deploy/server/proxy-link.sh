#!/bin/sh
# =============================================================================
#  Put the reverse proxy back on kokli-network, if an upgrade dropped it.
# =============================================================================
#  bootstrap.sh installs this as ~/kokli/proxy-link.sh, and cron runs it every
#  five minutes. Re-creating the proxy's container — which is what upgrading it
#  does — drops a network that was connected by hand, and every Kokli address
#  then answers 502 until something connects it again.
#
#  It does nothing at all unless every one of these holds:
#    * kokli-network exists
#    * the proxy named in ~/kokli/.proxy-container exists and is RUNNING
#    * it is not on kokli-network already
#  A stopped proxy is left alone on purpose: Docker accepts a network for a
#  stopped container without checking that the network exists, and a proxy
#  given one that does not would refuse to start.
#
#  --gw-priority -1 (Docker 28 and later): kokli-network is never the proxy's
#  way out to the internet.
# =============================================================================
p="$(cat "$HOME/kokli/.proxy-container" 2>/dev/null)" || exit 0
[ -n "$p" ] || exit 0
docker network inspect kokli-network >/dev/null 2>&1 || exit 0
[ "$(docker container inspect -f '{{.State.Running}}' "$p" 2>/dev/null)" = true ] || exit 0
docker container inspect -f '{{range $k, $v := .NetworkSettings.Networks}} {{$k}} {{end}}' "$p" | grep -q ' kokli-network ' && exit 0
gw=""
if docker network connect --help 2>/dev/null | grep -q -- '--gw-priority'; then gw="--gw-priority -1"; fi
# $gw is two words or none: unquoted on purpose.
docker network connect $gw kokli-network "$p" && echo "$(date -u) reconnected $p to kokli-network"
