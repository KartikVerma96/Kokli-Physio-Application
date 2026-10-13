# =============================================================================
#  Kokli — the application as one image
# =============================================================================
#  One Node process. MySQL is NOT in here: it holds medical records, and a
#  database that can be deleted by `docker compose down -v` is a database that
#  will be, eventually, by somebody who meant to restart it. Run MySQL on the
#  host (or a managed one) and point DB_HOST at it. See DEPLOYMENT.md.
#
#  Three stages, because the thing that ships should not carry the things that
#  built it:
#
#    deps     every dependency, including dev — needed to compile
#    build    `next build`, which writes .next
#    runtime  production dependencies, the build output, and nothing else
#
#  BUILD
#    docker build -t kokli --build-arg NEXT_PUBLIC_SITE_URL=https://kokli.in .
#
#  RUN  (env comes from the host, never from a file baked into the image)
#    docker run -d --name kokli -p 3000:3000 --env-file .env.local kokli
# =============================================================================

# ---------------------------------------------------------------- 1. deps ---
FROM node:24-bookworm-slim AS deps
WORKDIR /app

# Only the manifests first. Docker caches this layer, so a change to a page does
# not reinstall 600 packages.
COPY package.json package-lock.json ./

# `npm ci` not `npm install`: it installs exactly the lockfile, so an image can
# never quietly contain a different dependency version from the one CI tested.
RUN npm ci

# --------------------------------------------------------------- 2. build ---
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

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

# ------------------------------------------------------------- 3. runtime ---
FROM node:24-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Docker sets HOSTNAME to the container id, and server.js passes it to Next. Set
# it to the address we actually bind, or Next is configured with a hex string
# and every startup log reads like a bug.
ENV HOSTNAME=0.0.0.0

# Production dependencies only. --ignore-scripts because no package here needs a
# postinstall, and an image build is the worst place to run arbitrary ones.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# The build output, and the files server.js actually reaches for at runtime:
# its own entry point, lib/videoToken, the config the app reads, the public
# folder, and the SQL migrations so `npm run db:migrate` can be run against a
# live container when a human decides to.
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/next.config.mjs ./next.config.mjs
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/lib ./lib
COPY --from=build /app/config ./config
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/database ./database

# `node` is a user the base image already provides. Running as root inside a
# container that serves the public internet buys nothing and costs a layer of
# defence if the process is ever exploited.
USER node

EXPOSE 3000

# Docker restarts an unhealthy container; a process that is alive but no longer
# serving is the failure this catches. Node 24 has fetch built in, so this needs
# no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Straight to node, with no npm in between: npm would be PID 1 and would swallow
# the SIGTERM that `docker stop` sends, turning every stop into a ten-second
# wait and a kill.
CMD ["node", "server.js"]
