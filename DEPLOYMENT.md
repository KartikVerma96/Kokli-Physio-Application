# Deploying Kokli

Everything needed to take this from a laptop to `kokli.in`, in the order it has
to happen. Written for one server running everything, because that is what the
application is: one Node process and one MySQL.

---

## What the app needs, and why the obvious hosts do not work

| Requirement | Why |
|---|---|
| **A long-lived Node process** | `npm start` runs `server.js`, a custom server that hosts Next.js **and** Socket.IO together. Serverless platforms ignore it. |
| **WebSockets** | Video consultations signal over Socket.IO. A serverless function cannot hold that connection open. |
| **Wildcard DNS + wildcard TLS** | Every clinic is `{slug}.kokli.in`. Without `*.kokli.in` the entire multi-tenant model stops working. |
| **A scheduler** | Two cron endpoints have to be called daily. |

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

```bash
# Node — the version is pinned in package.json's engines field
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git mysql-server

sudo npm install -g pm2

sudo mysql_secure_installation
sudo mysql -e "CREATE DATABASE physio_clinic CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
sudo mysql -e "CREATE USER 'kokli'@'localhost' IDENTIFIED BY 'a-long-random-password';"
sudo mysql -e "GRANT ALL ON physio_clinic.* TO 'kokli'@'localhost'; FLUSH PRIVILEGES;"
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
AUTH_URL=https://kokli.in

# Generate each of these. Never reuse the development values.
AUTH_SECRET=$(openssl rand -base64 32)
PLATFORM_ENCRYPTION_KEY=$(openssl rand -base64 32)
CRON_SECRET=$(openssl rand -base64 32)
```

`PLATFORM_ENCRYPTION_KEY` encrypts every clinic's Razorpay and WhatsApp
credentials. **Losing it means every clinic has to re-enter them**; changing it
has the same effect. Keep a copy somewhere other than this server.

Then:

```bash
npm run db:setup      # schema + the seeded platform owner
npm run build
pm2 start npm --name kokli -- start
pm2 save
pm2 startup           # run the line it prints, so it survives a reboot
```

---

## 5. TLS and the wildcard, with Caddy

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
		# coming from the proxy and throttle all clinics together.
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

```bash
crontab -e
```

```cron
# Subscription lifecycle: trials ending, grace periods, cancellations that have
# run out, and the nightly cleanup of expired OTPs and reset tokens.
30 2 * * * curl -sf -X POST -H "authorization: Bearer $CRON_SECRET" https://kokli.in/api/cron/subscriptions >/dev/null

# Appointment reminders, package nudges and review requests. Runs hourly because
# a reminder is only useful at roughly the right hour.
0 * * * * curl -sf -X POST -H "authorization: Bearer $CRON_SECRET" https://kokli.in/api/cron/whatsapp >/dev/null

# Backups, before the day starts. `backup:verify` restores the newest dump into
# a throwaway database — an unverified backup is not a backup.
0 2 * * * cd ~/kokli && npm run backup >> backups/backup.log 2>&1
0 3 * * 0 cd ~/kokli && npm run backup:verify >> backups/verify.log 2>&1
```

**Copy the backups off this machine.** A backup on the same disk as the database
does not survive the failure it exists for. Any S3-compatible bucket with a
lifecycle rule will do.

---

## 7. Continuous deployment

`.github/workflows/ci.yml` runs eslint, a build, and the full suite against a
real MySQL on every push. `deploy.yml` ships to the server, but only once CI has
passed.

On the server:

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
cat ~/.ssh/deploy_key      # the private key — this goes into GitHub, then delete it here
```

In the repository → Settings → Secrets → Actions:

| Secret | Value |
|---|---|
| `DEPLOY_HOST` | the server IP |
| `DEPLOY_USER` | `ubuntu` |
| `DEPLOY_SSH_KEY` | the private key printed above |

Each deploy takes a backup first, then pulls, builds and **reloads** — pm2
starts the new process and only stops the old one once the new one is serving,
so no request and no video call is dropped.

**Migrations are not automatic.** Run them by hand:

```bash
ssh server
cd ~/kokli && npm run backup && npm run db:migrate
```

A schema change against medical records should be run by somebody who is
watching it, with a backup taken minutes earlier.

---

## 8. Before the first real clinic

- [ ] `AUTH_SECRET`, `PLATFORM_ENCRYPTION_KEY`, `CRON_SECRET` are fresh — not the development ones
- [ ] The seeded platform password is changed: `npm run set-password -- owner@kokli.in --generate`
- [ ] The **demo accounts block is removed** from `app/(auth)/login/LoginForm.js` — it currently prints working credentials on the sign-in page
- [ ] The seed clinics are deleted, or the database is reset with `npm run db:reset`
- [ ] Google OAuth: `https://kokli.in/api/auth/callback/google` added, and the consent screen moved from **Testing** to **In production** — otherwise only 100 accounts can sign in
- [ ] Razorpay: live keys in place and the webhook pointed at `https://kokli.in/api/billing/webhook`
- [ ] SMTP configured, with SPF and DKIM — without them every appointment email lands in spam
- [ ] `npm run backup:verify` has been run once and passed
- [ ] The legal pages carry the real company details (they already do — `config/platform.js`)
