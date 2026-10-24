# Deploying Kokli

Everything needed to take this from a laptop to `kokli.in`, in the order it has
to happen. Written for one server running everything, because that is what the
application is: one Node process and one MySQL.

> **Kokli's own server is §7.** It is a shared machine that already runs Docker,
> Jenkins and Nginx Proxy Manager, so it needs only DNS (§2) and §7 — the app and
> its database in containers, deployed by Jenkins on every push to `main`. §1 and
> §3–§6 describe the other way: a dedicated server built by hand, with Node, MySQL
> and Caddy installed directly. Both are kept: §3–§6 is how to start again on a
> machine without Docker, §7a–§7b on any machine with it.

---

## What the app needs, and why the obvious hosts do not work

| Requirement | Why |
|---|---|
| **A long-lived Node process** | `npm start` runs `server.js`, a custom server that hosts Next.js **and** Socket.IO together. Serverless platforms ignore it. |
| **WebSockets** | Video consultations signal over Socket.IO. A serverless function cannot hold that connection open. |
| **Wildcard DNS + wildcard TLS** | Every clinic is `{slug}.kokli.in`. Without `*.kokli.in` the entire multi-tenant model stops working. |
| **A scheduler** | Two cron endpoints have to be called, one of them every ten minutes. |

That rules out Vercel, Netlify and Cloudflare Pages — not because they are bad,
but because this application is a server, not a set of functions.

---

## 1. The server

**Oracle Cloud Always Free, Mumbai region** — 4 ARM cores and 24 GB, free
forever, and physically close to Indian patients. Pick **Ubuntu 24.04**.

Choose the region carefully: it cannot be changed later, and a European region
adds ~150 ms to every page load for a clinic in Pune.

Oracle's ARM capacity is often exhausted. Give it half an hour; if no instance
appears, take a **₹500/month box in Bangalore or Mumbai** from DigitalOcean,
Vultr or Linode instead. The first clinic's ₹1,299 covers three months of it,
and time spent fighting a free tier is time not spent selling.

Open ports **22, 80 and 443** in the cloud firewall *and* in `ufw`. Oracle in
particular blocks everything by default at the VCN level, which is a reliable
way to lose an hour wondering why Caddy cannot get a certificate.

---

## 2. DNS

At the registrar for `kokli.in`:

```
A     @    <server IP>
A     *    <server IP>      ← the wildcard. Without it, no clinic has a website.
```

Check it before going further — TLS will fail silently and confusingly if DNS
is not ready:

```bash
dig +short kokli.in
dig +short anything.kokli.in     # must return the same IP
```

---

## 3. Server setup

> **On Kokli's server (§7) none of this section applies** — MySQL runs in its own
> container there. This is the hand-built server's way.

```bash
# India time for the whole machine, BEFORE MySQL is installed. MySQL's clock
# (time_zone=SYSTEM), Node under pm2 and cron in §6 all follow it — and it has
# to be right before the first row is written (see the note in §7a).
sudo timedatectl set-timezone Asia/Kolkata

# Node — the version is pinned in package.json's engines field
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git mysql-server

sudo npm install -g pm2

sudo mysql_secure_installation
openssl rand -hex 24          # the app's MySQL password: use it below and in §4
sudo mysql <<'SQL'
CREATE DATABASE physio_clinic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'kokli'@'localhost' IDENTIFIED BY '<the password>';
GRANT ALL ON physio_clinic.* TO 'kokli'@'localhost';
-- backup:verify (§6) restores into this throwaway database, then drops it.
GRANT ALL ON `physio\_clinic\_verify`.* TO 'kokli'@'localhost';
SQL
```

MySQL runs **natively, not in a container**. It holds medical records, and a
misconfigured Docker volume is one of the most common ways to lose a database.

---

## 4. The application

```bash
git clone https://github.com/KartikVerma96/Kokli-Physio-Application.git ~/kokli
cd ~/kokli
npm ci

cp .env.example .env.local
nano .env.local
```

The values that must change from the example:

```bash
DB_USER=kokli
DB_PASSWORD=<the password from step 3>

PLATFORM_DOMAIN=kokli.in
PLATFORM_PROTOCOL=https
# No AUTH_URL — it breaks Google sign-in on clinic subdomains. See auth.config.js.

# Generate each of these. Never reuse the development values.
AUTH_SECRET=$(openssl rand -base64 32)
PLATFORM_ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -hex 32)
```

`PLATFORM_ENCRYPTION_KEY` encrypts every clinic's Razorpay and WhatsApp
credentials. **Losing it means every clinic has to re-enter them**; changing it
has the same effect. Keep a copy somewhere other than this server.

Then the database's first contents — in this order, before the site is public:

```bash
# 1. Schema, the three plans and the platform owner — plus a demo clinic whose
#    passwords are public in this repository, removed in step 3.
npm run db:setup

# 2. Every migration, NOW, while the database is empty. They are recorded as
#    done; run for the first time later, on live data, some would rebuild live
#    tables.
npm run db:migrate

# 3. The demo clinic out. Refuses to run if any real clinic exists.
sudo mysql physio_clinic < deploy/server/remove-demo.sql

# 4. The platform owner's password — the seeded owner123 is public. Prints the
#    new one once: straight into a password manager.
npm run set-password -- owner@kokli.in --generate

# 5. A first backup, and proof that it restores.
npm run backup && npm run backup:verify
```

And the app itself:

```bash
npm run build
pm2 start npm --name kokli -- start
pm2 save
pm2 startup           # run the line it prints, so it survives a reboot
```

---

## 5. TLS and the wildcard, with Caddy

> On Kokli's server, Nginx Proxy Manager already owns ports 80 and 443 and does
> this job — see §7d. Caddy is for the hand-built server.

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

`/etc/caddy/Caddyfile`:

```caddyfile
# One certificate covering kokli.in and every clinic subdomain.
#
# Caddy obtains and renews it automatically, but a WILDCARD certificate can only
# be issued through a DNS-01 challenge — Let's Encrypt has to see a TXT record it
# asked for. That needs a Caddy build with your DNS provider's plugin:
#
#     sudo caddy add-package github.com/caddy-dns/hostinger
#
# Substitute your registrar's plugin if the domain moves. This is the one step
# that cannot be skipped: without DNS-01 there is no wildcard, and without a
# wildcard every clinic's site shows a certificate warning.

*.kokli.in, kokli.in {
	tls {
		dns hostinger {env.HOSTINGER_API_TOKEN}
	}

	reverse_proxy localhost:3000 {
		# Socket.IO upgrades to a WebSocket. Without the real client address the
		# sign-in rate limiter in lib/loginThrottle.js would see every request as
		# coming from the proxy and throttle all clinics together. Both headers
		# are OVERWRITTEN, so a client cannot choose its own (lib/clientIp.js).
		header_up X-Real-IP {remote_host}
		header_up X-Forwarded-For {remote_host}
		header_up X-Forwarded-Proto {scheme}
	}

	encode gzip zstd
}
```

```bash
sudo systemctl edit caddy      # add: Environment="HOSTINGER_API_TOKEN=..."
sudo systemctl restart caddy
sudo systemctl status caddy
```

---

## 6. The scheduled jobs

> On Kokli's server, deploy/server/bootstrap.sh installs these jobs (§7a), in UTC
> times chosen for India and running inside the container. The lines below are for
> the hand-built server, whose clock §3 set to India time.

```bash
crontab -e
```

```cron
# The jobs' bearer token — the value from .env.local. Without this line every
# call below is refused.
CRON_SECRET=<the value from .env.local>

# Subscription lifecycle: trials ending, grace periods, cancellations that have
# run out, and the nightly cleanup of expired OTPs and reset tokens.
30 2 * * * curl -sf -X POST -H "authorization: Bearer $CRON_SECRET" https://kokli.in/api/cron/subscriptions >/dev/null

# Appointment reminders, package nudges and review requests. Every ten minutes,
# as the route asks: a reminder is only useful at roughly the right moment.
*/10 * * * * curl -sf -X POST -H "authorization: Bearer $CRON_SECRET" https://kokli.in/api/cron/whatsapp >/dev/null

# Backups, before the day starts. `backup:verify` restores the newest dump into
# a throwaway database — an unverified backup is not a backup.
0 2 * * * cd ~/kokli && npm run backup >> backups/backup.log 2>&1
0 3 * * 0 cd ~/kokli && npm run backup:verify >> backups/verify.log 2>&1
```

**Copy the backups off this machine.** A backup on the same disk as the database
does not survive the failure it exists for. Any S3-compatible bucket with a
lifecycle rule will do.

---

## 7. Production: Kokli's server

Kokli runs on a shared OVH server (Warsaw; Ubuntu, 4 cores, 7.6 GB, no swap)
that already hosts a friend's sites. Jenkins runs there in a container with the
host's Docker; Nginx Proxy Manager owns ports 80 and 443. Nothing in §1–§6 is
needed on it except DNS (§2). Once this section is done, deploying is
`git push` to `main`.

```
git push ──► GitHub ──┬─ Actions: lint, build, the full suite (.github/workflows/ci.yml)
                      └─ webhook ──► Jenkins, on the server itself
                                       1  image: lint + build, boot it, migrate + back up + restore the real schema
                                       3  wait for GitHub's CI run of this exact push            ◄─ main only
                                       4  deploy, run on the server itself: backup → migrations → swap → health → (roll back)

patients ──► Nginx Proxy Manager :443 ──kokli-network──► kokli (app) ──kokli-internal──► kokli-mysql
```

**Why the full suite runs on GitHub, not on the server.** It drives a Next.js dev
server that keeps every compiled route in memory. Measured on this server it passed
3.7 GB part-way through and was still climbing — on a machine with no swap that also
runs production. GitHub's runners have the memory and are free for a public
repository; Jenkins waits for their verdict before it deploys. (On a Jenkins with its
own machine, `KOKLI_FULL_SUITE_HERE=yes` runs it in Jenkins instead.)

**Sharing the server.** Everything Kokli adds stays out of the way of what was
already there:

- **Builds** go through a `docker buildx` builder of Kokli's own, capped at 3 GB and
  two cores, so a build cannot push production out of memory. Its cache is Kokli's
  alone and pruned to 5 GB after every build; nobody else's build cache is touched.
  If that builder cannot be made, the build stops rather than use Docker's shared one.
- **Disk**: a build stops before it starts with less than 4 GB free, a deploy with
  less than 2 GB — the disk is shared with other people's databases. The server keeps
  the three versions deployed last, not more.
- **Clean-up** selects only what Kokli made — containers and networks by the label
  `kokli-ci`, images by the repository name `kokli` or Kokli's own label. Never
  another image, volume or cache.
- **Ports**: Kokli publishes none on the host. The proxy reaches the app over
  `kokli-network`; health checks run inside the container.
- **Names**: the app answers on `kokli-network` only to `kokli` — its Compose service
  has that name too, not the usual `app`, which could shadow somebody else's `app`
  for the proxy.
- **Jenkins**: the deploy's settings are global properties named `KOKLI_…`, which no
  other job reads. No code from npm runs in a Jenkins Pipeline container — those are
  handed the host's Docker and all of Jenkins' home — only inside `docker build`'s
  sandbox and in plain containers that get neither. A build holds one executor at a
  time, and none while it waits for GitHub. A failed deploy's app log stays on the
  server: Jenkins' build log, which other people read, never gets a line of it.
- **The proxy** gets one more network, `kokli-network`, connected with
  `--gw-priority -1` so it is never the proxy's way out to the internet; nothing else
  changes in it, and the friend's proxy hosts are not touched.
- **The crontab** gets one marked block; every other line stays as it is, and if the
  crontab cannot be read, bootstrap stops instead of writing it.

What lives where on the server:

```
~/kokli-src/                   a clone of the repository: bootstrap.sh and the first image come from it
~/kokli/                       the app
  docker-compose.yml           this commit's, put there by every deploy (the one before it: *.prev)
  docker-compose.override.yml  this server's part: the two networks, no published port
  .env.local                   production secrets — mode 600, never in git or Jenkins
  .env                         KOKLI_IMAGE=kokli:<commit> — what is live; deploys write it
  .deployed                    the images deployed, newest last
  deploy-<run>.sh / .log / .result   each deploy: the script Jenkins sent, its log, its exit
                               code (kept a month); deploy-<run>-app.log, mode 600, if it failed
  .proxy-container             the proxy's container name, for putting its network back
  .kokli.lock                  taken by every deploy, the nightly backup and the restore test
  backups/                     the nightly dumps (newest 30), each with its .counts.json
  backups/predeploy/           a dump before every deploy (newest 10)
  backup.log, cron.log         the scheduled jobs' output
~/kokli-db/                    the database — a separate Compose project
  docker-compose.yml, .env (the two MySQL passwords), init/01-grants.sql
volume kokli-db-data           the data itself. External: Compose never deletes it,
                               not even with `docker compose down -v`
```

### 7a. The server, once

The repository is public, so the server can clone it without credentials:

```bash
git clone https://github.com/KartikVerma96/Kokli-Physio-Application.git ~/kokli-src
bash ~/kokli-src/deploy/server/bootstrap.sh
```

A run that worked ends with **`== Done`**. Anything else stopped on an `ERROR` that
says what to fix; fix it and run it again. To run it again later, first
`git -C ~/kokli-src pull --ff-only` — it refuses an out-of-date copy. It expects the
proxy's container to be called `nginx-proxy-manager`; if it is not,
`PROXY_CONTAINER=<name> bash ~/kokli-src/deploy/server/bootstrap.sh`.

[bootstrap.sh](deploy/server/bootstrap.sh) never prints a secret or puts one on a
command line, never overwrites a secret file, never touches the data volume, and
never replaces a compose file already in place — after the first deploy Jenkins
owns `~/kokli`'s, and a difference in `~/kokli-db`'s is reported for a person to
apply, because re-creating MySQL is the one step that can stop every clinic at once.

| It makes | Why |
|---|---|
| network `kokli-network`, and connects Nginx Proxy Manager to it | the proxy reaches the app by its name, `kokli` — the same pattern as the other sites on this server |
| network `kokli-internal` (`--internal`: no route to the internet) | the only way to MySQL. The firewall here is off, so a published 3306 would be a public database |
| volume `kokli-db-data` | the database's files, outside any Compose project |
| `~/kokli-db/.env`, `~/kokli/.env.local` | freshly generated secrets, from [env.local.example](deploy/server/env.local.example), checked by [check-env.js](deploy/server/check-env.js) |
| `kokli-mysql` started, and checked | MySQL 9.7 with **`--default-time-zone=+05:30`** and **utf8mb4_unicode_ci** — see the note below. Root can log in only from inside its own container |
| a marked block in the crontab | 02:00 IST backup, 02:30 subscriptions, Sunday 03:00 restore test, WhatsApp every 10 minutes — and every 5 minutes the proxy's link to `kokli-network`, put back if an upgrade of the proxy dropped it. The backup and the restore test run in a container of their own, under the lock a deploy takes, so a deploy can neither kill one half-way nor start under one |

Then, **before anything else, copy `PLATFORM_ENCRYPTION_KEY` off the server** into a
password manager. It encrypts every clinic's Razorpay and WhatsApp credentials; lose
it and every clinic has to reconnect both, and backups do not contain it:

```bash
grep '^PLATFORM_ENCRYPTION_KEY=' ~/kokli/.env.local; clear
```

> **India time, on both sides.** Appointment times are stored as the clinic's wall
> clock and compared with MySQL's `NOW()`. The server's clock is UTC, so without the
> two settings reminders go out 5.5 hours late, cancellations inside the refund window
> get refunded, and "today" changes at 05:30. The image sets `TZ=Asia/Kolkata`; the
> database runs `+05:30`. They must always match — one without the other is worse than
> neither — and it has to be true before the first row is written, because DATETIME
> never converts afterwards.

### 7b. The database's first contents, once

The first image is built on the server from the clone; Jenkins builds every one after
it. Run these in order, before Nginx Proxy Manager sends anyone to the site:

```bash
# Built in a builder of its own, capped like Jenkins' (3 GB), and removed with its
# whole cache afterwards: Docker's default builder has no cap, and its cache is
# shared with everyone else's on this server.
cd ~/kokli-src && TAG=$(git rev-parse --short=12 HEAD)
docker buildx create --name kokli-setup --driver docker-container \
  --driver-opt memory=3g --driver-opt memory-swap=3g
docker buildx build --builder kokli-setup --load -t kokli:$TAG \
  --build-arg NEXT_PUBLIC_SITE_URL=https://kokli.in --build-arg KOKLI_VERSION=$TAG .
docker buildx rm kokli-setup

# Which image ~/kokli runs — written into .env, the file Compose reads by itself.
# Not exported: a variable in your shell would outrank .env in every later
# `docker compose` typed in that shell, deploys included.
echo "KOKLI_IMAGE=kokli:$TAG" > ~/kokli/.env && cd ~/kokli

# 1. Schema, the three plans and the platform owner — plus the demo clinic, removed
#    in step 3. Its output lists the demo passwords, so it is kept off the screen.
docker compose run --rm --no-deps -T kokli node scripts/setup-db.js </dev/null | grep 'Database ready'

# 2. Every migration, NOW, while the database is empty. They are recorded as done;
#    run for the first time later, on live data, some would rebuild live tables.
docker compose run --rm --no-deps -T kokli node scripts/migrate.js </dev/null

# 3. The demo clinic out: its logins are in this repository, so on a public server
#    anyone could sign in as the admin of a live clinic. Refuses to run if any real
#    clinic exists.
docker exec -i kokli-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot physio_clinic' \
  < ~/kokli-src/deploy/server/remove-demo.sql

# 4. The platform owner's password: long, random, into a file only you can read.
#    The seeded owner123 is public. --stdin keeps it out of every command line.
( umask 077; openssl rand -base64 24 > ~/kokli/OWNER-PASSWORD.txt )
docker compose run --rm --no-deps -T kokli node scripts/set-password.js owner@kokli.in --stdin \
  < ~/kokli/OWNER-PASSWORD.txt

# 5. A first backup, and proof that it restores.
docker compose run --rm --no-deps -T kokli node scripts/backup.js </dev/null
docker compose run --rm --no-deps -T kokli node scripts/backup.js --verify </dev/null

# 6. Start it, and ask it how it is.
docker compose up -d --no-build
docker exec kokli node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"
#    → {"ok":true,"version":"<the commit>"}
```

Every later image is Jenkins', in Kokli's own builder. Signing in comes at the end of
§7d, once the proxy is in place.

Never run `npm run db:reset` (or `setup-db --reset`) on this server: it does not
recreate the database, and half-empties a current one.

### 7c. Jenkins, once

Jenkins is already installed, with every plugin the Jenkinsfile uses (Credentials
Binding, GitHub Branch Source; Docker Pipeline only matters for
`KOKLI_FULL_SUITE_HERE`). It is the friend's: everything below adds to it, and
changes nothing their jobs use.

**1. A deploy key for Jenkins** — its own key, never anybody's personal one. On the
server:

```bash
ssh-keygen -t ed25519 -N "" -C "jenkins-deploy" -f ~/kokli-deploy-key
echo "from=\"172.16.0.0/12\",no-port-forwarding,no-agent-forwarding,no-X11-forwarding $(cat ~/kokli-deploy-key.pub)" \
  >> ~/.ssh/authorized_keys
cat ~/kokli-deploy-key        # paste into the credential below, then:
rm ~/kokli-deploy-key ~/kokli-deploy-key.pub
```

`from="172.16.0.0/12"` makes the key work only from Docker's private networks on this
machine — which is where Jenkins connects from, whichever address it uses — so the key
is useless anywhere else even if it leaks.

**2. Credentials** (Manage Jenkins → Credentials → System → Global → Add):

| ID (exactly) | Kind | Contents |
|---|---|---|
| `kokli-deploy-key` | SSH Username with private key | Username `ubuntu`; the private key from step 1 |
| `github-read` | Username with password | Username: your GitHub user name. Password: a **fine-grained personal access token** (GitHub → Settings → Developer settings → Fine-grained tokens) with *Public repositories* read-only access and no other permission, expiring in a year — with a calendar reminder |

`github-read` is how Jenkins asks GitHub for the verdict of its CI run (lint, build
and the full suite) on the commit about to ship, and how the job scans the repository. Without a token both share GitHub's 60 anonymous calls an
hour with everything else on this server, and a busy hour turns into a red build.
The image never leaves this server, so no registry token is needed
(`ghcr-credentials` is only for a registry — see the Jenkinsfile's header).

**3. One global variable for now** (Manage Jenkins → System → Global properties →
Environment variables). First check that nothing there already starts with `KOKLI_`:

| Name | Value |
|---|---|
| `KOKLI_SITE_URL` | `https://kokli.in` — compiled into the browser bundle; a deploy refuses to ship without it |

`KOKLI_DEPLOY_HOST`, the switch that turns deploying on, comes last, in step 7.

**4. Executors**: leave them as they are. A Kokli build holds one executor at a time
— none while it waits for GitHub — and the build itself is capped in its own builder.

**5. The job.** First delete the old `kokli` Pipeline job (it points at the same
repository, has only failed builds and no triggers). Then New Item → **Multibranch
Pipeline** → Branch Sources → Add → GitHub → Credentials **`github-read`** →
Repository HTTPS URL `https://github.com/KartikVerma96/Kokli-Physio-Application`.
Under **Behaviours**:

- keep *Discover branches*
- keep *Discover pull requests from origin*
- **delete *Discover pull requests from forks*.** The repository is public, and a
  build runs the pull request's own code — its npm packages included — on a Jenkins
  that can reach this server's Docker and every job's secrets. A stranger's pull
  request would get both. GitHub Actions still checks fork pull requests, in GitHub's
  own sandbox.

Under *Scan Multibranch Pipeline Triggers*, tick *Periodically if not otherwise run*,
1 day — the safety net for a missed webhook.

**6. The webhook** — GitHub → repository → Settings → Webhooks → Add webhook:
Payload URL `https://jenkins.aayatwebtech.com/github-webhook/` (the trailing `/`
matters), content type `application/json`, events *Pushes* and *Pull requests*.

No shared secret: Jenkins has one webhook secret for every job on it, and the
friend's repositories' unsigned webhooks would then be refused. An unsigned call can
only make Jenkins look at GitHub again; Jenkins fetches the code itself, so it cannot
choose what is built, and nothing deploys without GitHub's own verdict.

**7. The first run, in two steps.** Run the job's *Scan Repository Now*, and let the
first build of `main` go green with `KOKLI_DEPLOY_HOST` still unset — it proves the
image builds, boots, migrates and backs up, with nothing at stake. Only then add
`KOKLI_DEPLOY_HOST` = `145.239.89.241` beside `KOKLI_SITE_URL`, and run *Build Now*
on `main` (or push): that build deploys.

### 7d. Nginx Proxy Manager, once

Ask the friend to **upgrade Nginx Proxy Manager to 2.16.0 or later first**: 2.15.0
(installed today) has CVE-2026-40519, an authenticated code execution through exactly
the DNS-credentials field step 2 fills in. An upgrade re-creates the proxy's
container, which drops its link to `kokli-network`; the cron line from §7a puts it
back within five minutes (or at once:
`docker network connect kokli-network nginx-proxy-manager`), and every deploy checks.

**1. Hostinger API token** — hPanel → profile → API → new token, 1-year expiry, a
calendar reminder a month before. Hostinger's API documentation says a token inherits
every permission of the account that made it — there is no DNS-only scope — so it
goes into Nginx Proxy Manager and nowhere else.

**2. Two certificates** (SSL Certificates → Add → Let's Encrypt). Two, because the
Hostinger plugin deletes the other `_acme-challenge` record when it adds one, so a
single certificate for both names fails every first attempt:

| | Domain names | Challenge |
|---|---|---|
| Cert 1 | `kokli.in` | HTTP (no token; the apex carries Google sign-in for every clinic, so it does not depend on Hostinger) |
| Cert 2 | `*.kokli.in` | DNS → Hostinger.com → credentials `dns_hostinger_api_token = <token>` → propagation **120** seconds |

**3. Two proxy hosts**, identical apart from the domain and certificate — `kokli.in`
with Cert 1, `*.kokli.in` with Cert 2:

| Setting | Value | Why |
|---|---|---|
| Scheme / Forward host / Port | `http` / `kokli` / `3000` | the container, by name, over `kokli-network` |
| **Websockets Support** | **ON** | video consultations signal over Socket.IO, and the client has no fallback |
| **Cache Assets** | **OFF** | it caches responses with their `Set-Cookie` — one user's session handed to the next |
| Block Common Exploits | OFF | it blocks nothing this app is exposed to, and 403s clinical words like "erectile" in a search |
| Force SSL / HTTP/2 | ON / ON | the session cookie is `Secure` |
| HSTS | **OFF** for now | on this NPM the HSTS header is shared between every site (issue #5947) and always includes `preload`. Revisit after the first automatic renewal |
| Advanced | the two lines below | |

```nginx
client_max_body_size 2m;
set_real_ip_from 127.0.0.1;
```

The first: no upload in the app is bigger, and NPM's default is 2 GB. The second
matters more. Out of the box NPM believes an `X-Real-IP` header sent from any private
address and from every Cloudflare and CloudFront address — and anyone can send from
Cloudflare's, with a free Worker. The sign-in throttle counts attempts per address, so
a client choosing its own address gets unlimited password guesses. Set inside a
proxy host, `set_real_ip_from` *replaces* that list rather than adding to it: for
Kokli's two hosts nothing is trusted, and the address the app sees is the real one.
The friend's hosts keep their settings.

This server has an IPv6 address, and NPM listens on it. Do **not** add an AAAA record
for kokli.in: through Docker, every IPv6 visitor arrives from one internal address,
and would share one sign-in throttle.

**4. Check:**

```bash
curl -s https://kokli.in/api/health                       # {"ok":true,"version":"<commit>"}
curl -sI http://any-clinic.kokli.in/ | head -1            # 301 → https
echo | openssl s_client -connect 145.239.89.241:443 -servername x.kokli.in 2>/dev/null \
  | openssl x509 -noout -subject -enddate                 # *.kokli.in, ~90 days out
```

And that an invented `X-Real-IP` gets nowhere. On the server, find the proxy host's
number in NPM (the `kokli.in` host's edit URL ends in it), then:

```bash
curl -s -o /dev/null -H 'X-Real-IP: 9.9.9.9' https://kokli.in/api/health
docker exec nginx-proxy-manager tail -1 /data/logs/proxy-host-<number>_access.log
#    → [Client <one of this server's own addresses, or Docker's 172.x>] — not 9.9.9.9
```

**5. Sign in.** At `https://kokli.in/login`, as `owner@kokli.in` with the password in
`~/kokli/OWNER-PASSWORD.txt`. Store it in a password manager and delete the file.
`owner@kokli.in` has no mailbox, so password reset cannot reach it; to use a real
address instead:

```bash
docker exec -i kokli-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot physio_clinic' \
  <<< "UPDATE users SET email = 'you@example.com' WHERE email = 'owner@kokli.in';"
```

Let's Encrypt no longer emails before a certificate expires. Put `https://kokli.in`
and one clinic subdomain on an uptime monitor with certificate-expiry alerts.

### 7e. What a push does

| Pushed to | Jenkins: image built (lint included), booted, backup tested | GitHub: CI (lint, build, full suite) | Deployed |
|---|:-:|:-:|:-:|
| `main`, `KOKLI_DEPLOY_HOST` set | ✓ | ✓ (Jenkins waits for it) | ✓ |
| `main`, `KOKLI_DEPLOY_HOST` unset | ✓ | ✓ | — |
| a branch | ✓ | — | — |
| a pull request | ✓ | ✓ | — |

The image gets the commit's tag (`kokli:<commit>`) only after it has booted and passed
its backup round trip in Jenkins; until then it has a name of that build's own.

**The deploy runs on the server, not in Jenkins.** Jenkins sends
[deploy/server/deploy.sh](deploy/server/deploy.sh), starts it detached, and follows
its log, `~/kokli/deploy-<run>.log`. So stopping the build — Abort, a timeout,
Jenkins restarting, a dropped connection — never stops a deploy half-way through the
swap: it carries on to its end, live or rolled back, and the log says which. Step by
step, and what each failure does:

| Step | If it fails |
|---|---|
| checks the server ([preflight.sh](deploy/server/preflight.sh)): Docker, Compose, `.env.local`, `backups/`, 2 GB free, the two networks, `kokli-mysql` healthy — and puts the proxy back on `kokli-network` if it has dropped off | stops, printing the command that fixes it |
| waits for `~/kokli/.kokli.lock` — a running nightly backup or restore test finishes first | after 25 minutes, stops; nothing changed |
| finds the image (already on this Docker — Jenkins built it here) | stops; nothing changed |
| checks this commit's compose files against this server's settings | stops; nothing changed |
| backs up the database **with the new image**, into `backups/predeploy` | stops; nothing changed — and it proves the new image reaches MySQL first |
| applies the new image's migrations, while the old version keeps serving | stops before the swap; the old version stays live. Statements that did apply stay applied |
| swaps the compose files and the container; waits up to 90 s for `/api/health` to report the new commit from the new image | **puts the previous image and compose files back**, checks that they are healthy, and fails the build. The new version's own log goes to `~/kokli/deploy-<run>-app.log` (mode 600), not into Jenkins: it can hold patients' details |
| keeps the three images deployed last, plus `kokli:rollback` (the one just replaced) and `kokli:latest`; removes other `kokli` tags | — |
| `https://kokli.in/api/health`, asked from the server through DNS, TLS and the proxy | the build turns **yellow**: the app is fine; DNS, TLS or the proxy is not |

**The swap is not invisible:** for about five seconds the proxy answers 502, and a video
call in progress drops. Merge to `main` outside clinic hours.

**Migrations ship with the code, and run before it.** Every deploy applies the new
image's migrations while the old version is still serving, and a rollback puts the
old code back on the new schema. So a migration must leave the schema usable by the
code before it:

- **Additive only**: a new table, a new column with a default, a new index.
- **Dropping or renaming** something comes in a later release, once no code that
  production might roll back to still uses it.
- Never edit a migration that has shipped: it is recorded statement by statement, and
  an edited statement is a new one. Write the next file instead.

### 7f. By hand

```bash
curl https://kokli.in/api/health                 # which commit is live
cd ~/kokli && docker compose logs -f kokli       # the app's log
tail ~/kokli/backup.log ~/kokli/cron.log         # the scheduled jobs
ls -t ~/kokli/deploy-*.log | head -3             # the latest deploys' logs

# Change a setting: edit, check, then RECREATE (restart does not re-read env files)
nano ~/kokli/.env.local
docker run --rm -v ~/kokli/.env.local:/env:ro -v ~/kokli-src/deploy/server/check-env.js:/c.js:ro \
  node:24-bookworm-slim node /c.js /env
cd ~/kokli && docker compose up -d --no-build

# Go back to an earlier version: one of the three deployed last (newest last), or
# kokli:rollback — the one the last deploy replaced. Migrations are additive, so
# an older version runs on today's schema.
cat ~/kokli/.deployed; docker image ls kokli
cd ~/kokli && echo "KOKLI_IMAGE=kokli:<commit>" > .env && docker compose up -d --no-build

# Which migrations has this database not had yet? (Deploys apply them; this only looks.)
cd ~/kokli && docker compose run --rm --no-deps -T kokli node scripts/migrate.js --pending </dev/null

# A backup now, under the same lock as everything else
cd ~/kokli && flock .kokli.lock docker compose run --rm --no-deps -T kokli node scripts/backup.js </dev/null
```

**Disaster recovery** — putting a dump back into the live database. The app is
stopped first, so nothing writes while tables are being replaced; the state being
replaced is dumped first, in case the wrong file was picked:

```bash
cd ~/kokli && exec 9>>.kokli.lock && flock 9          # no deploy or backup meanwhile
docker compose stop kokli
docker compose run --rm --no-deps -T -e BACKUP_DIR=/app/backups/before-restore kokli node scripts/backup.js </dev/null
gunzip -c ~/kokli/backups/<file>.sql.gz \
  | docker exec -i kokli-mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot physio_clinic'
docker compose start kokli
exec 9>&-                                             # the lock, released
```

Tables created after that dump was taken stay as they are, and WhatsApp reminders sent
after it may go out a second time.

**Two pools of backups:** `~/kokli/backups` keeps the 30 newest nightly dumps (a month),
`~/kokli/backups/predeploy` the 10 newest taken before a deploy, so a busy day of
deploys never pushes nightly history out. Every Sunday the restore test restores the
newest nightly dump into a throwaway database and compares it with the row counts
recorded when it was taken; its verdict is the last lines of `~/kokli/backup.log`.

**Copy the backups off this server.** They sit on the same disk as the database, so a
lost disk loses both. Any S3-compatible bucket with a lifecycle rule will do — until
then, the nightly dump protects against mistakes, not against losing the machine.

---

## 8. Docker by hand, on a laptop

From a checkout of the repository, with MySQL in a throwaway container. In
`.env.local`, point the app at it:

```bash
DB_HOST=db
DB_USER=root
DB_PASSWORD=devpassword    # the profile's default root password
```

```bash
docker compose --profile local-db up -d --build
docker compose run --rm kokli node scripts/setup-db.js     # schema and demo data, once
```

The `local-db` profile runs the same MySQL as production (9.7, `+05:30`,
utf8mb4_unicode_ci). It must never be used on a server: its data is an ordinary
volume, one `docker compose down -v` from gone.

---

## 9. Before the first real clinic

Done in this repository:

- [x] The demo-accounts box on the sign-in page only exists in development builds
- [x] Backups restore — the image uses MySQL's own client, and Jenkins proves a backup
      of the real schema restores on every build
- [x] A login code is never printed to a production log

Done once on the server (§4, or §7a and §7b):

- [ ] Fresh secrets generated, and `PLATFORM_ENCRYPTION_KEY` copied off the server
- [ ] India time on both sides, before the first row
- [ ] The demo clinic removed and the owner password replaced
- [ ] Every migration run while the database was empty
- [ ] `backup.js --verify` passed

Still to do:

- [ ] Jenkins: `kokli-deploy-key` and `github-read`, `KOKLI_SITE_URL`, the Multibranch job
      with fork pull requests **off**, the webhook, one green build — then
      `KOKLI_DEPLOY_HOST`
- [ ] Nginx Proxy Manager upgraded to ≥ 2.16.0, both certificates and proxy hosts in
      place, the `X-Real-IP` check passed
- [ ] Email for `support@kokli.in` and `hello@kokli.in` (MX records) — the site shows both
- [ ] SMTP, with SPF, DKIM and DMARC on kokli.in — without it, password reset cannot work
- [ ] Google OAuth: `https://kokli.in/api/auth/callback/google` registered, consent screen
      **In production** (otherwise 100 accounts at most)
- [ ] Razorpay: live keys, webhook at `https://kokli.in/api/billing/webhook`
- [ ] WhatsApp (Meta) and a TURN server, when those features are switched on
- [ ] Backups copied off the server, automatically, and a failed nightly backup or
      restore test alerting someone (a dead-man's-switch ping such as healthchecks.io)
- [ ] An uptime monitor with certificate-expiry alerts on kokli.in and one clinic
- [ ] The legal pages carry the real company details (they already do — `config/platform.js`)
