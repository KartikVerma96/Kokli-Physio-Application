# =============================================================================
#  Kokli — the application as one image
# =============================================================================
#  One Node process. MySQL is NOT in here: it holds medical records, and a
#  database that can be deleted by `docker compose down -v` is a database that
#  will be, eventually, by somebody who meant to restart it. It runs on its own
#  (on Kokli's server, the separate compose project in deploy/kokli-db) and
#  DB_HOST points at it. See DEPLOYMENT.md.
#
#  Separate stages, because the thing that ships should not carry the things
#  that built it:
#
#    mysql-client  MySQL's own client tools, borrowed from the server's image
#    deps          every dependency, including dev — needed to compile
#    check         eslint over the source; `build` waits for it to pass
#    build         `next build`, which writes .next
#    runtime       production dependencies, the build output, and nothing else
#
#  BUILD  (Jenkins does this on every push — see the Jenkinsfile)
#    docker build -t kokli \
#      --build-arg NEXT_PUBLIC_SITE_URL=https://kokli.in \
#      --build-arg KOKLI_VERSION=$(git rev-parse --short=12 HEAD) .
#
#  RUN  (env comes from the host, never from a file baked into the image)
#    docker run -d --name kokli -p 127.0.0.1:3000:3000 --env-file .env.local kokli
# =============================================================================

# -------------------------------------------------------- 0. mysql-client ---
# The exact image the production database runs (deploy/kokli-db). Only two
# binaries are taken from it, in the runtime stage below — see the note there
# for why they come from here and not from Debian.
FROM mysql:9.7 AS mysql-client

# ---------------------------------------------------------------- 1. deps ---
FROM node:24-bookworm-slim AS deps
WORKDIR /app

# Only the manifests first. Docker caches this layer, so a change to a page does
# not reinstall 600 packages.
COPY package.json package-lock.json ./

# `npm ci` not `npm install`: it installs exactly the lockfile, so an image can
# never quietly contain a different dependency version from the one CI tested.
RUN npm ci

# --------------------------------------------------------------- 2. check ---
# Lint, inside the build sandbox. Jenkins used to run it in a container of its
# own, which the Docker Pipeline plugin hands the host's docker.sock and all of
# Jenkins' home (every job's secrets) — and linting executes code from every
# dependency. A `docker build` step sees neither.
FROM deps AS check
COPY . .
RUN npx eslint . && touch /tmp/lint-passed

# --------------------------------------------------------------- 3. build ---
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Waits for the check stage, so no image is ever built from code that fails
# lint — and lint and `next build` never run at once and double the memory.
COPY --from=check /tmp/lint-passed /tmp/lint-passed

# NEXT_PUBLIC_* values are compiled INTO the JavaScript the browser downloads,
# so this one has to be known here rather than at `docker run`. Everything else
# the app needs is read at runtime.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# The build only needs these to EXIST — it never reads their values. The real
# ones are passed to the running container, and must be different.
ENV AUTH_SECRET=build-time-placeholder-never-used-at-runtime
ENV PLATFORM_ENCRYPTION_KEY=build-time-placeholder-never-used-at-runtime

RUN npm run build

# Nothing the runtime stage copies out of here may be writable by `node`, the
# user the image runs as. Everything is root's, so only a WORLD-writable file
# would be — which is what a build context with loose permissions hands over,
# as COPY keeps modes — and it would let code running as node rewrite the app
# and keep it rewritten across restarts. Only those files are touched: a blanket
# chmod would copy every file into one more layer, a few hundred MB per commit.
RUN find .next public next.config.mjs server.js lib config scripts database \
      ! -type l -perm /o+w -exec chmod o-w {} +

# ------------------------------------------------------------- 4. runtime ---
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# India time, for every container made from this image — the app, the backups,
# the scheduled jobs. The code treats every stored time as a clinic's wall clock
# (config/site.js), and compares it with MySQL's NOW(). So this MUST match the
# database's --default-time-zone=+05:30 (deploy/kokli-db/docker-compose.yml):
# set one without the other and OTP cooldowns, trial ends and invoice numbers go
# wrong by five and a half hours. Node reads TZ through its own bundled time-zone
# data, so the image needs no tzdata package for this.
ENV TZ=Asia/Kolkata

# Docker sets HOSTNAME to the container id, and server.js passes it to Next. Set
# it to the address we actually bind, or Next is configured with a hex string
# and every startup log reads like a bug.
ENV HOSTNAME=0.0.0.0

# ---------------------------------------------------------------------------
#  mysqldump and mysql — MySQL's own, not Debian's
# ---------------------------------------------------------------------------
#  scripts/backup.js shells out to mysqldump before every deploy and every
#  night, and `backup.js --verify` restores with mysql. Debian's "mysql client"
#  is MariaDB's, and it CANNOT be used here: it writes values for STORED
#  generated columns into the dump (appointments.active_slot_key and
#  subscriptions.active_clinic_key, the double-booking guards), and MySQL refuses
#  every such row on restore with ERROR 3105. Its backups look perfect and do not
#  restore — which is the one thing a backup must not do.
#
#  So the client comes from the database's own image (stage 0): the same
#  version as the server, and nothing to keep in step by hand. It needs two
#  libraries that image has and this one does not. The --version calls fail the
#  build, loudly, if a future mysql image ever needs another one.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libssl3 libncurses6 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=mysql-client /usr/bin/mysqldump /usr/bin/mysql /usr/local/bin/
RUN mysqldump --version && mysql --version

# Production dependencies only. --ignore-scripts because no package here needs a
# postinstall, and an image build is the worst place to run arbitrary ones.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# The build output, and the files server.js actually reaches for at runtime:
# its own entry point, lib/videoToken, the config the app reads, the public
# folder, and the scripts and SQL migrations — every deploy runs this image's
# migrate.js and backup.js before it goes live (DEPLOYMENT.md §7e).
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/lib ./lib
COPY --from=build /app/config ./config
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/database ./database

# Which commit this image is. Jenkins passes it; /api/health reports it, so
# "what is live right now?" is one curl rather than an archaeology project.
# Declared this late on purpose: an ARG invalidates every layer after it, and
# the apt and npm layers above should survive a new commit untouched.
ARG KOKLI_VERSION=dev
ENV KOKLI_VERSION=$KOKLI_VERSION

# `source` links the image to the repository on ghcr.io, so it inherits the
# repository's access — a collaborator who can read the code can pull the image.
# `title` and `revision` say what an image is to anyone running `docker inspect`
# on a shared server. (The deploy's clean-up selects by repository name — kokli
# — so it only ever removes old Kokli images, never someone else's.)
LABEL org.opencontainers.image.source="https://github.com/KartikVerma96/Kokli-Physio-Application" \
      org.opencontainers.image.title="kokli" \
      org.opencontainers.image.revision=$KOKLI_VERSION

# `node` is a user the base image already provides. Running as root inside a
# container that serves the public internet buys nothing and costs a layer of
# defence if the process is ever exploited.
USER node

EXPOSE 3000

# A process that is alive but no longer serving is the failure this catches.
# /api/health answers "is Node up, and can it reach MySQL" and nothing else —
# see app/api/health/route.js. Node 24 has fetch built in, so this needs no curl
# in the image.
#
# Docker only MARKS a container unhealthy; it does not restart it. The deploy is
# what acts on the answer: it waits for healthy, and rolls back if it never is.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Straight to node, with no npm in between: npm would be PID 1 and would swallow
# the SIGTERM that `docker stop` sends, turning every stop into a ten-second
# wait and a kill.
CMD ["node", "server.js"]
