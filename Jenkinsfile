// =============================================================================
//  Kokli — CI/CD:  GitHub  →  Jenkins  →  Docker image  →  the server
// =============================================================================
//  A push to GitHub ends one of two ways: that commit running on kokli.in, or a
//  red build that says why it is not.
//
//    1. IMAGE            builds the Dockerfile — lint included — tagged with
//                        the commit, boots it, and proves it can migrate, back
//                        up and restore the real schema. With a registry
//                        configured, main pushes it.
//    2. FULL SUITE       a real MySQL and a real server: it signs in as four
//                        roles over HTTP and asserts that one clinic cannot
//                        reach another's data. Mocking that would prove nothing.
//                        It runs on GitHub's machines (see THE FULL SUITE below)
//                        — or here, with KOKLI_FULL_SUITE_HERE=yes.
//    3. GITHUB'S VERDICT on main: waits until GitHub's run of the full suite on
//                        this exact commit has passed
//    4. DEPLOY           on main: the server runs that exact image — it backs
//                        up the database, applies migrations, swaps the
//                        container, checks it is healthy, and puts the previous
//                        version back if not.
//
//  Branches and pull requests stop after the image. Nothing is pushed or
//  deployed from anything but main.
//
//  THE FULL SUITE, AND WHY IT IS NOT RUN ON KOKLI'S SERVER
//  -------------------------------------------------------
//  The suite drives a Next.js dev server, which keeps every route it compiles in
//  memory. Measured on Kokli's server it passed 3.7 GB part-way through and was
//  still climbing — on a 7.6 GB machine with no swap that also runs production
//  and a friend's sites. A test run must never be able to starve production.
//
//  So GitHub Actions runs it (.github/workflows/ci.yml, the same steps), on
//  machines with memory to spare and free for a public repository, and a deploy
//  waits for that verdict on this exact commit. On a Jenkins with a machine of
//  its own, set KOKLI_FULL_SUITE_HERE=yes and the suite runs here, in stage 2.
//
//  ON A JENKINS SHARED WITH OTHER PEOPLE
//  -------------------------------------
//  Kokli's Jenkins is a friend's: other jobs' secrets live in its home, and the
//  host's docker.sock is mounted into it. A container the Docker Pipeline plugin
//  starts is handed both (it mounts them with --volumes-from), so no code from
//  npm runs in one here. Lint and the build run inside `docker build`, whose
//  sandbox has neither; the app runs in plain `docker run` containers that are
//  given neither. Only the opt-in full suite uses a Pipeline container.
//
//  And builds go through a builder of Kokli's own (`docker buildx`, named
//  kokli): a build is capped at 3 GB and two cores, so it cannot push
//  production out of memory, and its cache is Kokli's alone, kept under 5 GB,
//  so it cannot fill the shared disk. Nobody else's build cache is ever pruned.
//  Every clean-up here is limited to what Kokli made — by label, by name.
//
//  WHAT IS DEPLOYED IS WHAT WAS TESTED
//  -----------------------------------
//  The server never builds anything. It runs the image this pipeline built from
//  the commit the suite passed on, identified by that commit's id — so "which
//  version is live?" has a one-word answer (`curl https://kokli.in/api/health`),
//  and a rollback is choosing an older id.
//
//  WHERE THE IMAGE GOES
//  --------------------
//  By default, nowhere: KOKLI_IMAGE_REPO defaults to the bare name `kokli`, and
//  the image stays in the Docker that built it. That is right when Jenkins and
//  the app share a machine — as they do on Kokli's server, where Jenkins drives
//  the host's own Docker — because the image the deploy needs is already there.
//  No registry, no token, no 400 MB upload and download on every deploy.
//
//  When they do NOT share a machine, set KOKLI_IMAGE_REPO to a registry path —
//  ghcr.io/kartikverma96/kokli, or docker.io/<you>/kokli — and add the
//  ghcr-credentials credential. Main then pushes there and the server pulls.
//  The deploy itself works the same either way: it uses the image if the
//  server already has it, and pulls it only if not.
//
//  HOW A PUSH REACHES JENKINS
//  --------------------------
//  A GitHub webhook to https://<jenkins>/github-webhook/ (DEPLOYMENT.md §7c).
//  The Multibranch job's own "scan periodically" setting is the safety net for
//  a webhook that went missing. There is deliberately no pollSCM here: in a
//  Multibranch job it adds nothing a webhook does not, and it can build — and
//  deploy — the same commit twice.
//
//  WHAT JENKINS NEEDS  (DEPLOYMENT.md §7c has the click-by-click version)
//  ------------------
//    * Docker on the agent with its buildx plugin (Docker's own packages
//      include it), and the `jenkins` user allowed to use it.
//    * Plugins: Credentials Binding and GitHub Branch Source come with the
//      "suggested plugins" install. Docker Pipeline is needed only for
//      KOKLI_FULL_SUITE_HERE=yes.
//    * Credentials:
//        github-read        Username with password: a GitHub user name and a
//                           fine-grained token that can read this public
//                           repository. Stage 3 asks GitHub with it, and the
//                           Multibranch job should scan with it too; without
//                           one, both share GitHub's 60 anonymous calls an hour.
//        kokli-deploy-key   SSH Username with private key: the server's user
//        ghcr-credentials   ONLY with a registry (see WHERE THE IMAGE GOES):
//                           Username with password — the registry user and a
//                           token allowed to push (for ghcr.io, a classic
//                           personal access token with write:packages)
//    * Global environment variables (Manage Jenkins → System → Global
//      properties). Every job on a Jenkins sees these, hence the KOKLI_ prefix.
//        KOKLI_DEPLOY_HOST  the server's address. THIS IS THE SWITCH: unset, the
//                           pipeline tests and builds and pushes/deploys nothing,
//                           and stays green. Set it LAST, once the server is
//                           ready and one build has passed without it.
//        KOKLI_SITE_URL     https://kokli.in — compiled into the browser bundle,
//                           so required whenever KOKLI_DEPLOY_HOST is set
//        KOKLI_IMAGE_REPO   optional. Default `kokli`: the image stays on this
//                           machine (see WHERE THE IMAGE GOES)
//        KOKLI_IMAGE_PLATFORM     optional, default linux/amd64 (see stage 1)
//        KOKLI_FULL_SUITE_HERE    optional. 'yes' runs the full suite in this
//                                 Jenkins instead of waiting for GitHub's
//        KOKLI_FULL_SUITE_MEMORY  optional, default 8g: that suite's memory cap
//
//  WHY THE SUITE USES THE DEV SERVER AND NOT THE PRODUCTION BUILD
//  --------------------------------------------------------------
//  The suites invoke server actions directly, and they find each action's id in
//  .next/dev/server/server-reference-manifest.json — a file only the dev server
//  writes. `next build` does not produce it. The production build is still
//  exercised: stage 1 builds it and boots it inside the image.
// =============================================================================

/* ------------------------------------------------------------------ helpers */
// Plain Groovy functions, outside the pipeline block so every stage can share
// them. Only recordCommit and ensureImageEnv change anything, and only env.

// The image's name. Image names must be lower case.
def imageRepo() {
  def repo = env.KOKLI_IMAGE_REPO?.trim() ? env.KOKLI_IMAGE_REPO.trim() : 'kokli'
  return repo.toLowerCase()
}

// The registry the image goes through, or null when it stays on this machine.
// A registry path starts with a host — a first part containing a dot or a port,
// like ghcr.io/... or localhost:5000/... — which a bare name like `kokli` has
// not. Plain String methods only, which the script sandbox always allows.
def registryHost() {
  def repo = imageRepo()
  def slash = repo.indexOf('/')
  if (slash < 0) return null
  def first = repo.substring(0, slash)
  return (first.contains('.') || first.contains(':') || first == 'localhost') ? first : null
}

// The branch being built. A Multibranch job says so in BRANCH_NAME; a plain
// "Pipeline script from SCM" job only has GIT_BRANCH ("origin/main"), or nothing.
def branchName() {
  if (env.BRANCH_NAME) return env.BRANCH_NAME
  if (env.GIT_BRANCH) return env.GIT_BRANCH.replaceFirst('^origin/', '')
  return null
}

def deployHost() {
  return env.KOKLI_DEPLOY_HOST?.trim() ?: ''
}

// Should this build leave the building — push an image and deploy it?
// Only main, and only once a server has been configured. A plain job that
// reports no branch at all is assumed to be pointed at main, because that is
// what DEPLOYMENT.md tells you to point it at; skipping silently would be worse.
//
// Asked afresh by every stage that needs the answer, never remembered from an
// earlier stage: "Restart from stage" skips the earlier stages, and a flag only
// they set would then quietly read as "do not ship" — a green build, nothing
// deployed.
def shouldShip() {
  def branch = branchName()
  def onMain = (branch == null || branch == 'main')
  return onMain && deployHost() != ''
}

def fullSuiteHere() {
  return env.KOKLI_FULL_SUITE_HERE?.trim() == 'yes'
}

// The commit this build tests, builds and ships, and the GitHub repository it
// came from. Recorded by stage 1 — and by any later stage that finds them
// missing, which is what "Restart from stage" leaves behind. In a Multibranch
// job every checkout of a build is the same pinned commit, so asking the
// checkout again gives the same answer.
def recordCommit() {
  env.TESTED_COMMIT = sh(script: "git -c safe.directory='*' rev-parse HEAD", returnStdout: true).trim()
  def repo = sh(
    script: '''git -c safe.directory='*' config --get remote.origin.url | sed -E 's#^(https://github[.]com/|git@github[.]com:)##; s#[.]git$##' ''',
    returnStdout: true
  ).trim()
  env.GITHUB_REPO = (repo.contains('/') && !repo.contains(':')) ? repo : 'KartikVerma96/Kokli-Physio-Application'
}

// Put this stage's workspace on the commit stage 1 recorded.
//
// A Multibranch job checks out one fixed commit in every stage. A plain job
// checks out the branch AGAIN in each stage — so a push landing half-way through
// a build could otherwise mean testing one commit and shipping the next. That
// is the one thing a deploy pipeline must never do.
def pinToTestedCommit() {
  if (!env.TESTED_COMMIT) { recordCommit() }
  sh "git -c safe.directory='*' checkout -q --detach ${env.TESTED_COMMIT}"
}

// Everything the image, verdict and deploy stages must agree on. Pure functions
// of the environment and the tested commit, so each stage can work them out
// again — see shouldShip() for why that matters.
def ensureImageEnv() {
  env.SHIP           = shouldShip() ? 'yes' : 'no'
  env.IMAGE_NAME     = imageRepo()
  env.REGISTRY       = registryHost() ?: ''
  env.PUSH           = (env.SHIP == 'yes' && env.REGISTRY) ? 'yes' : 'no'
  // 12 characters: short enough to read, long enough never to clash.
  env.IMAGE_TAG      = env.TESTED_COMMIT.substring(0, 12)
  env.BUILD_SITE_URL = env.KOKLI_SITE_URL?.trim() ?: 'http://localhost:3000'
  // The SERVER's processor, not this machine's. A Jenkins on an Apple-silicon
  // Mac builds arm64 images by default, and an arm64 image on an ordinary x86
  // server dies with "exec format error" on the very first start. Docker
  // builds the other one by emulation; slower, but correct.
  env.BUILD_PLATFORM = env.KOKLI_IMAGE_PLATFORM?.trim() ?: 'linux/amd64'
  env.DEPLOY_TO      = deployHost()
}

pipeline {
  // No global agent: each stage asks for what it needs, so an executor is never
  // held while nothing is running — stage 3 waits for GitHub without one.
  agent none

  options {
    // A pipeline that hangs forever holds an agent and tells you nothing. Long
    // enough for a cold Docker build plus GitHub's suite, the slowest things here.
    timeout(time: 60, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30'))
    // Two deploys at once would race each other on the server.
    disableConcurrentBuilds()
  }

  environment {
    // Only for the opt-in full suite. Pinned to the major version in
    // package.json's `engines`.
    NODE_IMAGE  = 'node:24-bookworm'
    // The same series as production (deploy/kokli-db). `mysql:9` would also be
    // 9.7 today, but `latest` is already MySQL 26 — be explicit.
    MYSQL_IMAGE = 'mysql:9.7'
    // Started exactly as production starts it — same collation, same India-time
    // clock — so nothing here can pass on settings the server does not have.
    MYSQL_FLAGS = '--character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci --default-time-zone=+05:30'
  }

  stages {
    /* ===================================================================== */
    /*  1. THE IMAGE                                                         */
    /* ===================================================================== */
    // One agent for both steps, so the image pushed is the image just built on
    // that same machine — never a stale one on a different agent.
    stage('Image') {
      agent any
      stages {
        stage('Build and boot') {
          steps {
            script {
              recordCommit()
              ensureImageEnv()
              echo "Commit ${env.TESTED_COMMIT} of ${env.GITHUB_REPO}  ·  " +
                   "branch: ${branchName() ?: '(not reported — assumed main)'}  ·  " +
                   "KOKLI_DEPLOY_HOST: ${env.DEPLOY_TO ? 'set' : 'not set'}  ·  ships: ${env.SHIP}  ·  " +
                   "image: ${env.IMAGE_NAME} (${env.REGISTRY ? 'via ' + env.REGISTRY : 'stays on this machine'})"

              // NEXT_PUBLIC_SITE_URL is compiled into the JavaScript the browser
              // downloads; it cannot be fixed at run time. An image for kokli.in
              // built with localhost in it would ship broken links and canonical
              // URLs to every patient — so refuse, rather than guess.
              if (env.SHIP == 'yes' && !env.KOKLI_SITE_URL?.trim()) {
                error('KOKLI_SITE_URL is not set. Add it beside KOKLI_DEPLOY_HOST in Manage Jenkins → ' +
                      'System → Global properties (e.g. https://kokli.in), then build again.')
              }

              // What THIS build tags its image as. Only a build that ships may
              // own `kokli:<commit>` — that is the tag the server runs. A branch
              // or pull request at the same commit would otherwise tag over the
              // live image, and its clean-up would then delete it. So
              // everything else gets a name of its own, unique to this build.
              env.IMAGE_REF = (env.SHIP == 'yes') ? "${env.IMAGE_NAME}:${env.IMAGE_TAG}"
                                                  : "kokli-ci:${env.IMAGE_TAG}-b${env.BUILD_NUMBER}-e${env.EXECUTOR_NUMBER}"
            }

            // Lint runs inside this build: the Dockerfile's `build` stage waits
            // for its `check` stage, so a lint error fails the build right here.
            //
            // --pull fetches the newest base images, so security fixes in Debian
            // reach production without anybody remembering to ask.
            sh '''
# Kokli's own builder — see ON A JENKINS SHARED WITH OTHER PEOPLE at the top.
# Made the first time it is needed; buildx starts its container when it is not
# running. memory-swap = memory: the host has no swap to give it anyway.
BUILDER=""
if docker buildx inspect kokli >/dev/null 2>&1 || docker buildx create --name kokli --driver docker-container --driver-opt memory=3g --driver-opt memory-swap=3g --driver-opt cpu-period=100000 --driver-opt cpu-quota=200000 >/dev/null; then
  BUILDER="--builder kokli"
else
  echo "WARNING: could not make Kokli's own buildx builder, so this builds with Docker's default one."
  echo "         That works, but the build has no memory cap, and its cache is shared with"
  echo "         everyone else's on this Docker, so nothing here prunes it."
fi

docker buildx build $BUILDER --load --pull --progress plain --platform "$BUILD_PLATFORM" --build-arg NEXT_PUBLIC_SITE_URL="$BUILD_SITE_URL" --build-arg KOKLI_VERSION="$IMAGE_TAG" -t "$IMAGE_REF" .
'''

            // ---------------------------------------------------------------
            //  A BUILT IMAGE CAN STILL BE AN IMAGE THAT CANNOT START
            // ---------------------------------------------------------------
            //  So start it — the real production server, `node server.js` —
            //  with throwaway secrets and NO database, and ask /api/health.
            //  The right answer is a 503 saying the database is unreachable,
            //  carrying this commit's id. Getting it proves the image boots,
            //  serves HTTP, runs the compiled routes, and knows which version it
            //  is. Any answer counts as "booted"; no answer within two minutes
            //  fails the build with the container's own log.
            //
            //  Every container and network this build starts carries the label
            //  kokli-ci=<this build>, so the clean-up in `post` finds them even
            //  when an abort or a timeout killed this shell before its trap ran.
            sh '''
# No --name: Docker picks one and we keep the id. A fixed name collides when two
# branch jobs (each with its own build numbers) run at once.
SMOKE="$(docker run -d --label "kokli-ci=$BUILD_TAG" --memory=1g --platform "$BUILD_PLATFORM" -e AUTH_SECRET=smoke-test-only-not-a-real-secret -e PLATFORM_ENCRYPTION_KEY=smoke-test-only-not-a-real-key -e DB_HOST=127.0.0.1 "$IMAGE_REF")"
trap 'docker rm -fv "$SMOKE" >/dev/null 2>&1 || true' EXIT

body=""
for i in $(seq 1 60); do
  body="$(docker exec "$SMOKE" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(t=>console.log(t)).catch(()=>process.exit(1))" 2>/dev/null || true)"
  [ -n "$body" ] && break
  sleep 2
done

echo "health endpoint answered: ${body:-nothing}"
if [ -z "$body" ] || ! printf '%s' "$body" | grep -q "$IMAGE_TAG"; then
  echo "The image did not boot and report version $IMAGE_TAG. Its log:"
  docker logs --tail 80 "$SMOKE" || true
  exit 1
fi
echo "image boots, serves, and knows it is $IMAGE_TAG"
'''

            // ---------------------------------------------------------------
            //  A BACKUP IS ONLY A BACKUP IF IT RESTORES
            // ---------------------------------------------------------------
            //  Every deploy begins with scripts/backup.js and scripts/migrate.js,
            //  run with THIS image. So prove here, against the MySQL production
            //  runs, that this image can build the real schema, apply every
            //  migration to it, back it up and restore the backup. It is what
            //  catches a dump tool that writes rows MySQL then refuses — the
            //  generated-column trap MariaDB's mysqldump fell into — and a
            //  migration that fails, before any patient record depends on it.
            //
            //  Nothing is bind-mounted: from inside the Jenkins container, a
            //  workspace path does not exist on the host. The grants arrive on
            //  stdin instead. -v on every removal: the MySQL image declares a
            //  data volume, and without -v each build left ~200 MB of it behind.
            sh '''
NET="kokli-ci-$BUILD_NUMBER-$EXECUTOR_NUMBER-$(date +%s)"
docker network create --label "kokli-ci=$BUILD_TAG" "$NET" >/dev/null
DB="$(docker run -d --label "kokli-ci=$BUILD_TAG" --network "$NET" --network-alias db --memory=1g -e MYSQL_ROOT_PASSWORD=ci-root -e MYSQL_DATABASE=physio_clinic -e MYSQL_USER=kokli -e MYSQL_PASSWORD=ci-kokli-password "$MYSQL_IMAGE" $MYSQL_FLAGS)"
trap 'docker rm -fv "$DB" >/dev/null 2>&1 || true; docker network rm "$NET" >/dev/null 2>&1 || true' EXIT

# The image runs a temporary server first, with networking off; the second
# "ready for connections" is the real one.
for i in $(seq 1 90); do
  if docker exec "$DB" mysqladmin ping -h 127.0.0.1 --silent >/dev/null 2>&1 && [ "$(docker logs "$DB" 2>&1 | grep -c 'ready for connections')" -ge 2 ]; then break; fi
  sleep 2
done
docker exec -i "$DB" sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' < deploy/kokli-db/init/01-grants.sql

docker run --rm --label "kokli-ci=$BUILD_TAG" --memory=1g --network "$NET" -e DB_HOST=db -e DB_USER=kokli -e DB_PASSWORD=ci-kokli-password -e DB_NAME=physio_clinic -e BACKUP_DIR=/tmp/backups "$IMAGE_REF" sh -c '
set -e
echo "-- the image keeps India time: offset $(node -p "new Date().getTimezoneOffset() * -1") minutes"
[ "$(node -p "new Date().getTimezoneOffset() * -1")" = 330 ]
node scripts/setup-db.js > /tmp/setup.log 2>&1 || { tail -30 /tmp/setup.log; exit 1; }
grep -q "Database ready" /tmp/setup.log || { tail -30 /tmp/setup.log; exit 1; }
echo "-- schema and seed created"
node scripts/migrate.js > /tmp/migrate.log 2>&1 || { tail -30 /tmp/migrate.log; exit 1; }
tail -3 /tmp/migrate.log
node scripts/migrate.js --pending
node scripts/backup.js
node scripts/backup.js --verify
'
echo "this image migrates the real schema, backs it up, and the backup restores"
'''

            // The compose files are the other half of a deploy; a typo in them
            // would otherwise first be found on the server. `config -q` parses
            // them — with the server's override merged in, as the server reads
            // them — without starting anything. External networks need not
            // exist for that. .env.local is named, so an empty one stands in.
            sh '''
if docker compose version >/dev/null 2>&1; then
  [ -f .env.local ] || : > .env.local
  docker compose -f docker-compose.yml -f deploy/server/docker-compose.override.yml config -q && echo "docker-compose.yml, with the server's override, is valid"
else
  echo "No Docker Compose plugin on this agent; docker-compose.yml not checked here."
fi
'''
          }
        }

        stage('Push to registry') {
          // Skipped when the image stays on this machine — the default. See
          // WHERE THE IMAGE GOES at the top.
          when { expression { return env.PUSH == 'yes' } }
          steps {
            // A throwaway Docker config directory for the login, deleted on the
            // way out: the token is used for this one push and is never left
            // in the Jenkins user's ~/.docker. --password-stdin keeps it off
            // the command line, where `ps` would show it.
            withCredentials([usernamePassword(
              credentialsId: 'ghcr-credentials',
              usernameVariable: 'GHCR_USER',
              passwordVariable: 'GHCR_TOKEN'
            )]) {
              sh '''
export DOCKER_CONFIG="$(mktemp -d)"
trap 'rm -rf "$DOCKER_CONFIG"' EXIT
printf '%s' "$GHCR_TOKEN" | docker login "$REGISTRY" -u "$GHCR_USER" --password-stdin
docker push "$IMAGE_NAME:$IMAGE_TAG"
echo "pushed $IMAGE_NAME:$IMAGE_TAG"
'''
            }
          }
        }
      }
      post {
        // Every build leaves things behind, and on Kokli's server the same disk
        // holds the production database — and other people's work, which none
        // of this touches: everything below is selected by Kokli's own labels
        // and names.
        //
        //  * This build's containers and network, if an abort or a timeout
        //    killed the shell before its trap ran (dash runs no EXIT trap when
        //    it is killed) — and any a build two hours ago left the same way.
        //  * This build's image — UNLESS it is about to be deployed from this
        //    machine's own Docker, in which case removing it here would delete
        //    the very image the deploy needs. The deploy keeps the last few
        //    shipped images itself.
        //  * Kokli images no tag points to any more.
        //  * Kokli's own build cache, down to 5 GB. The builder's base images
        //    stay warm within that; older commits' layers go first.
        always {
          sh '''
docker ps -aq --filter "label=kokli-ci=$BUILD_TAG" | xargs -r docker rm -fv >/dev/null 2>&1 || true
now=$(date +%s)
for id in $(docker ps -aq --filter label=kokli-ci); do
  created=$(date -d "$(docker inspect -f '{{.Created}}' "$id")" +%s 2>/dev/null || echo "$now")
  if [ $((now - created)) -gt 7200 ]; then docker rm -fv "$id" >/dev/null 2>&1 || true; fi
done
docker network ls -q --filter "label=kokli-ci=$BUILD_TAG" | xargs -r docker network rm >/dev/null 2>&1 || true
docker network prune -f --filter label=kokli-ci --filter until=2h >/dev/null 2>&1 || true

if [ -n "${IMAGE_REF:-}" ] && ! { [ "${SHIP:-}" = yes ] && [ "${PUSH:-}" = no ]; }; then
  docker image rm "$IMAGE_REF" >/dev/null 2>&1 || true
fi
docker image prune -f --filter label=org.opencontainers.image.title=kokli >/dev/null 2>&1 || true
if docker buildx inspect kokli >/dev/null 2>&1; then
  docker buildx prune --builder kokli -f --max-used-space 5gb >/dev/null 2>&1 || true
fi
'''
        }
      }
    }

    /* ===================================================================== */
    /*  2. THE FULL SUITE                                                    */
    /* ===================================================================== */
    // Opt-in — see THE FULL SUITE at the top. By default GitHub runs it, and
    // stage 3 waits for that result before anything is deployed. This is the
    // one stage that runs npm code in a Docker Pipeline container, which can
    // reach the host's Docker and Jenkins' home: meant for a Jenkins with a
    // machine of its own, not a shared one.
    stage('Full suite') {
      agent any
      when {
        beforeAgent true
        expression { return fullSuiteHere() }
      }
      steps {
        pinToTestedCommit()
        script {
          def memory = env.KOKLI_FULL_SUITE_MEMORY?.trim() ?: '8g'
          docker.image(env.MYSQL_IMAGE).withRun(
            '--memory=1g -e MYSQL_ROOT_PASSWORD=ci -e MYSQL_DATABASE=physio_clinic',
            env.MYSQL_FLAGS
          ) { db ->
            // The Node container SHARES the database container's network. That
            // is what makes 127.0.0.1:3306 reach MySQL and 127.0.0.1:3000 reach
            // our own server, exactly as the suites expect — no published
            // ports, and nothing of this left on the agent afterwards.
            //
            // TZ=Asia/Kolkata with MySQL's +05:30, as in production. The suite
            // ran UTC-against-UTC before, which agrees with itself and so could
            // never notice a time-zone bug.
            //
            // The memory cap: the dev server keeps every route it compiles, and
            // was still growing past 3.7 GB when measured.
            docker.image(env.NODE_IMAGE).inside("--network=container:${db.id} -u root:root --memory=${memory} --cpus=2 -e TZ=Asia/Kolkata") {
              try {
                // -------------------------------------------------------------
                //  *.localhost does NOT resolve on Linux
                // -------------------------------------------------------------
                //  macOS and browsers resolve any *.localhost to 127.0.0.1. Node
                //  on Debian does not, so every clinic subdomain the suites use
                //  has to be spelled out, or the tests fail with ENOTFOUND —
                //  which reads like a broken app rather than a missing hosts
                //  entry.
                //
                //  The heredoc bodies below start at column zero on purpose:
                //  <<'EOF' keeps leading whitespace, and a space before DB_HOST=
                //  is the kind of thing that costs an hour.
                sh '''
cat >> /etc/hosts <<'HOSTS'
127.0.0.1 aarogya.localhost isolationtest.localhost nope.localhost
127.0.0.1 acctest.localhost acctest2.localhost billtest.localhost
127.0.0.1 biztest.localhost cxltest.localhost journeytest.localhost
127.0.0.1 mailtest.localhost otptest.localhost realtest.localhost
127.0.0.1 revtest.localhost watest.localhost no-such-clinic.localhost
HOSTS
'''

                // Every integration secret is left unset on purpose. WhatsApp,
                // email and billing all fall back to printing to the terminal,
                // which is what makes the suite runnable without a single
                // third-party account. Nothing here is a real secret.
                sh '''
cat > .env.local <<'ENV'
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=ci
DB_NAME=physio_clinic
AUTH_SECRET=ci-secret-only-used-inside-this-job-abcdefghijklmnop
PLATFORM_DOMAIN=localhost
PLATFORM_PROTOCOL=http
PLATFORM_ENCRYPTION_KEY=ci-encryption-key-only-used-inside-this-job=
CRON_SECRET=ci-cron-secret
PORT=3000
ENV
'''

                // `npm ci` not `npm install`: it installs exactly the lockfile.
                sh 'npm ci --ignore-scripts'

                // MySQL starts accepting connections a few seconds after its
                // container does. Waiting here beats a flaky first suite.
                sh '''
for i in $(seq 1 60); do
  node -e "require('net').connect(3306,'127.0.0.1').on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))" && break
  sleep 2
done
'''

                sh 'npm run db:setup'

                sh '''
# localhost, as on GitHub's runners. With --network=container: this container
# would otherwise inherit MySQL's hostname, a hex id, and hand it to Next.
HOSTNAME=localhost npm run dev > dev.log 2>&1 &
for i in $(seq 1 90); do
  curl -sf http://localhost:3000/ >/dev/null && exit 0
  sleep 1
done
echo "server never came up:"; tail -60 dev.log; exit 1
'''

                // Warm every page so the dev server compiles each route and
                // writes its server actions into the manifest the suites read.
                sh '''
for p in / /login /register /forgot-password /admin /admin/services /admin/settings/branding /admin/settings/whatsapp /admin/billing /dashboard/profile /platform /platform/errors; do
  curl -s -o /dev/null -H 'Host: aarogya.localhost' "http://localhost:3000$p" || true
done
'''

                sh 'npm test'
              } finally {
                // What root created here — node_modules, .next, the logs — goes
                // back to the workspace's owner, so the Jenkins user can clean
                // it. Only those files: the checked-out ones keep their modes.
                sh 'find . -xdev -uid 0 -exec chown "$(stat -c %u:%g .)" {} + || true'
              }
            }
          }
        }
      }
      post {
        // The log is the only way to see WHY a suite failed once the containers
        // are gone.
        always {
          sh 'tail -120 dev.log || true'
          archiveArtifacts artifacts: 'dev.log', allowEmptyArchive: true
        }
      }
    }

    /* ===================================================================== */
    /*  3. GITHUB'S VERDICT                                                  */
    /* ===================================================================== */
    // Only a build that is about to ship waits, and only when the suite ran on
    // GitHub rather than here. No agent: a node — an executor — is taken only
    // for the second each question to GitHub takes, never for the minutes in
    // between. Other jobs on this Jenkins are not kept waiting by this one.
    stage("GitHub's verdict") {
      agent none
      when { expression { return shouldShip() && !fullSuiteHere() } }
      steps {
        script {
          if (!env.TESTED_COMMIT) { node { checkout scm; recordCommit() } }
          echo "Waiting for GitHub Actions' Full suite on ${env.GITHUB_REPO} at ${env.TESTED_COMMIT}"

          // One question per call. Exit codes: 0 passed, 1 failed, 2 still
          // running, 3 not started yet, 4 no answer, 5 the token was refused.
          def ask = '''
API="https://api.github.com/repos/$GITHUB_REPO/commits/$TESTED_COMMIT/check-runs?check_name=Full%20suite&filter=latest"
hdr="$(mktemp)"
out="$(mktemp)"
trap 'rm -f "$hdr" "$out"' EXIT
# The token goes to curl in a file, never on its command line, where any
# process in this container (other jobs' builds included) could read it.
echo "Authorization: Bearer $GH_TOKEN" > "$hdr"
code="$(curl -sS --max-time 20 -o "$out" -w '%{http_code}' -H @"$hdr" -H 'Accept: application/vnd.github+json' "$API" || true)"
if [ "$code" = 401 ]; then
  echo "GitHub refused the github-read credential (401): its token is wrong or has expired."
  exit 5
fi
if [ "$code" != 200 ]; then
  echo "  $(date +%H:%M:%S)  GitHub's API did not answer (HTTP ${code:-none}); asking again in a minute"
  head -c 300 "$out" 2>/dev/null || true
  echo
  exit 4
fi
body="$(cat "$out")"
total="$(printf '%s' "$body" | grep -o '"total_count": *[0-9]*' | head -1 | grep -o '[0-9]*$' || true)"
status="$(printf '%s' "$body" | grep -o '"status": *"[a-z_]*"' | head -1 | cut -d'"' -f4)"
conclusion="$(printf '%s' "$body" | grep -o '"conclusion": *"[a-z_]*"' | head -1 | cut -d'"' -f4)"
url="$(printf '%s' "$body" | grep -o '"html_url": *"[^"]*"' | head -1 | cut -d'"' -f4)"
if [ "${total:-0}" = 0 ]; then
  echo "  $(date +%H:%M:%S)  not started yet"
  exit 3
fi
if [ "$status" = completed ]; then
  if [ "$conclusion" = success ]; then
    echo "GitHub's Full suite passed on this commit: $url"
    exit 0
  fi
  echo "GitHub's Full suite did not pass on this commit (${conclusion:-unknown}). The failing assertions are on the run: $url"
  exit 1
fi
echo "  $(date +%H:%M:%S)  ${status:-in progress}"
exit 2
'''

          def verdict = 'waiting'
          def notStarted = 0
          for (int asked = 1; asked <= 31 && verdict == 'waiting'; asked++) {
            def rc = 4
            node {
              withCredentials([usernamePassword(credentialsId: 'github-read', usernameVariable: 'GH_USER', passwordVariable: 'GH_TOKEN')]) {
                rc = sh(script: ask, returnStatus: true)
              }
            }
            if (rc == 0) {
              verdict = 'passed'
            } else if (rc == 1) {
              verdict = 'failed'
            } else if (rc == 5) {
              verdict = 'refused'
            } else {
              notStarted = (rc == 3) ? notStarted + 1 : 0
              if (notStarted >= 10) {
                verdict = 'never started'
              } else if (asked < 31) {
                sleep(time: 60, unit: 'SECONDS')
              }
            }
          }
          if (verdict == 'failed') {
            error("GitHub's Full suite did not pass on this commit, so nothing is deployed.")
          }
          if (verdict == 'refused') {
            error('Fix the github-read credential (DEPLOYMENT.md §7c), then build this commit again.')
          }
          if (verdict == 'never started') {
            error('After 10 minutes GitHub has not started a Full suite for this commit. ' +
                  'Check that .github/workflows/ci.yml still runs on pushes to main.')
          }
          if (verdict != 'passed') {
            error("Gave up after 30 minutes without GitHub's verdict. Build this commit again once GitHub has finished.")
          }
        }
      }
    }

    /* ===================================================================== */
    /*  4. DEPLOY                                                            */
    /* ===================================================================== */
    stage('Deploy') {
      agent any
      when {
        beforeAgent true
        expression { return shouldShip() }
      }
      steps {
        // For docker-compose.yml: the version of it that belongs to this commit.
        pinToTestedCommit()

        // withCredentials, not sshagent: it needs no extra plugin, and it hands
        // over the USERNAME as well as the key. sshagent gives only the key, so
        // `ssh $host` would log in as whoever Jenkins runs as — which on most
        // installs is `jenkins`, and that account does not exist on the server.
        //
        // The registry credential is bound only when the image travels through
        // a registry; by default it does not exist and is not asked for.
        script {
          ensureImageEnv()
          def creds = [sshUserPrivateKey(credentialsId: 'kokli-deploy-key', keyFileVariable: 'SSH_KEY', usernameVariable: 'SSH_USER')]
          if (env.PUSH == 'yes') {
            creds.add(usernamePassword(credentialsId: 'ghcr-credentials', usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_TOKEN'))
          }
          withCredentials(creds) {
            // Every remote script body starts at column zero for the same reason
            // as the heredocs in stage 2. `remote` is a function rather than a
            // variable holding the ssh flags, so a key file in a path with a
            // space in it — a job named "Kokli CI" — still works.
            //
            // Each script sent to the server is ONE function, called on the
            // last line with its input taken from /dev/null. `bash -s` reads
            // its script from the same stdin its commands inherit, a byte at a
            // time; any command that reads stdin — `docker compose run` does,
            // by default — would swallow the rest of the script, and the deploy
            // would end half-way and "succeed". Defined first and called last,
            // the whole script is read before any of it runs.
            sh '''
remote() {
  ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes -o ServerAliveInterval=30 "$SSH_USER@$DEPLOY_TO" "$@"
}
send() {
  scp -q -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o BatchMode=yes "$1" "$SSH_USER@$DEPLOY_TO:$2"
}

# ---------------------------------------------------------------------------
#  1. Is the server ready? Every check names its own fix, because the first
#     deploy to a new server is exactly when these are missing.
# ---------------------------------------------------------------------------
remote bash -s <<'PREFLIGHT'
main() {
set -eu
cd ~
mkdir -p kokli/backups
command -v docker >/dev/null 2>&1 || { echo "ERROR: Docker is not installed on this server. See DEPLOYMENT.md 7a."; exit 1; }
docker info >/dev/null 2>&1 || { echo "ERROR: $(whoami) cannot use Docker. Run: sudo usermod -aG docker $(whoami) - then log out and in again."; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "ERROR: the Docker Compose plugin is missing. Run: sudo apt install docker-compose-plugin"; exit 1; }
command -v flock >/dev/null 2>&1 || { echo "ERROR: flock is missing. Run: sudo apt install util-linux"; exit 1; }
[ -f kokli/.env.local ] || { echo "ERROR: ~/kokli/.env.local does not exist. DEPLOYMENT.md 7a says what goes in it."; exit 1; }
[ "$(stat -c %u kokli/backups)" = 1000 ] || { echo "ERROR: ~/kokli/backups must belong to uid 1000, the user inside the container. Run: sudo chown 1000:1000 ~/kokli/backups"; exit 1; }
if [ -f kokli/docker-compose.override.yml ]; then
  for n in kokli-network kokli-internal; do
    docker network inspect "$n" >/dev/null 2>&1 || { echo "ERROR: Docker network $n is missing. Run deploy/server/bootstrap.sh - DEPLOYMENT.md 7a."; exit 1; }
  done
  if docker container inspect kokli-mysql >/dev/null 2>&1; then
    [ "$(docker container inspect -f '{{.State.Health.Status}}' kokli-mysql)" = healthy ] || { echo "ERROR: kokli-mysql is not healthy. On the server: docker logs kokli-mysql"; exit 1; }
  fi
  # The proxy reaches Kokli over kokli-network. That link lives in the proxy's
  # container, not in any file, so re-creating the proxy — an upgrade — drops
  # it, and every Kokli address answers 502. Put it back.
  if [ -f kokli/.proxy-container ]; then
    proxy="$(cat kokli/.proxy-container)"
    if ! docker container inspect "$proxy" >/dev/null 2>&1; then
      echo "WARNING: the proxy container $proxy, named in ~/kokli/.proxy-container, does not exist here."
    elif ! docker container inspect -f '{{range $k, $v := .NetworkSettings.Networks}} {{$k}} {{end}}' "$proxy" | grep -q ' kokli-network '; then
      docker network connect kokli-network "$proxy"
      echo "reconnected $proxy to kokli-network"
    fi
  fi
fi
echo "server is ready for a deploy"
}
main "$@" </dev/null
PREFLIGHT

# ---------------------------------------------------------------------------
#  2. This commit's compose files, beside the live ones as *.new. The deploy
#     checks them on the server and swaps them in with the image — and puts
#     the old ones back if it rolls back. The server has no git checkout: it
#     needs these and .env.local, the one file Jenkins never touches.
# ---------------------------------------------------------------------------
send docker-compose.yml kokli/docker-compose.yml.new
if remote test -f kokli/docker-compose.override.yml </dev/null; then
  send deploy/server/docker-compose.override.yml kokli/docker-compose.override.yml.new
fi

# ---------------------------------------------------------------------------
#  3. With a registry: let the server pull from it. Through stdin, so the token
#     is in no command line and no log; the deploy logs out again when done.
#     Without one there is nothing to do — the image is already there.
# ---------------------------------------------------------------------------
if [ "$PUSH" = yes ]; then
  printf '%s' "$GHCR_TOKEN" | remote "docker login $REGISTRY -u $GHCR_USER --password-stdin" >/dev/null
  echo "server logged in to $REGISTRY"
fi

# ---------------------------------------------------------------------------
#  4. The deploy itself. Its last line, KOKLI-DEPLOYED, is checked for below:
#     the only proof the script ran to its end. (Through tee, ssh's own exit
#     status is lost — the line is what counts.)
# ---------------------------------------------------------------------------
remote bash -s -- "$IMAGE_NAME:$IMAGE_TAG" "$IMAGE_TAG" "$REGISTRY" <<'REMOTE' | tee deploy-remote.log
main() {
set -euo pipefail
NEW="$1"
TAG="$2"
# Empty without a registry — and ssh drops an empty argument altogether, hence
# the default rather than a plain $3, which `set -u` would reject.
REGISTRY="${3:-}"
REPO="${NEW%:*}"
ROLLBACK="$REPO:rollback"
cd ~/kokli

# Any registry login above was only for the pull. Forget it on the way out,
# success or failure, so no registry token lives on this server.
trap 'if [ -n "$REGISTRY" ]; then docker logout "$REGISTRY" >/dev/null 2>&1 || true; fi' EXIT

# One at a time. The nightly backup and the weekly restore check take this
# same lock (the cron block bootstrap.sh installs): a deploy that stopped the
# container under a running backup would leave half a dump behind.
exec 9>>.kokli.lock
if ! flock -w 1800 9; then
  echo "ERROR: a backup, a restore check or another deploy has held ~/kokli/.kokli.lock for 30 minutes."
  echo "       Nothing was changed."
  exit 1
fi

# Healthy: answering, able to reach MySQL, and reporting the version asked for
# (none asked for: any version).
healthy() {
  local want="$1" body i
  for i in $(seq 1 45); do
    body="$(docker exec kokli node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.text()).then(t=>console.log(t)).catch(()=>process.exit(1))" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -q '"ok":true' && { [ -z "$want" ] || printf '%s' "$body" | grep -q "$want"; }; then
      return 0
    fi
    sleep 2
  done
  return 1
}

PREV="$(sed -n 's/^KOKLI_IMAGE=//p' .env 2>/dev/null || true)"
echo "live now:  ${PREV:-nothing yet - this is the first deploy}"
echo "deploying: $NEW"

# Built by this pipeline on this very Docker? Then it is already here.
if docker image inspect "$NEW" >/dev/null 2>&1; then
  echo "image is already on this server"
elif [ -n "$REGISTRY" ]; then
  docker pull --quiet "$NEW"
else
  echo "ERROR: $NEW is not on this server, and there is no registry to fetch it from."
  echo "       Without a registry, Jenkins and the app must share a machine. Otherwise set"
  echo "       KOKLI_IMAGE_REPO to a registry path - see WHERE THE IMAGE GOES in the Jenkinsfile."
  exit 1
fi
NEW_ID="$(docker image inspect -f '{{.Id}}' "$NEW")"

# A first deploy has no live compose file to back up with: this commit's
# becomes the live one at once — there is nothing running that it could break.
rm -f docker-compose.yml.prev docker-compose.override.yml.prev
for f in docker-compose.yml docker-compose.override.yml; do
  if [ ! -f "$f" ] && [ -f "$f.new" ]; then mv "$f.new" "$f"; fi
done

# This commit's compose files, checked against this server's own settings
# before anything depends on them.
files=(-f docker-compose.yml)
if [ -f docker-compose.yml.new ]; then files=(-f docker-compose.yml.new); fi
if [ -f docker-compose.override.yml.new ]; then files+=(-f docker-compose.override.yml.new)
elif [ -f docker-compose.override.yml ]; then files+=(-f docker-compose.override.yml); fi
if ! KOKLI_IMAGE="$NEW" docker compose "${files[@]}" config -q; then
  echo "ERROR: this commit's docker-compose.yml does not work with this server's settings (see above)."
  echo "       Nothing was changed."
  exit 1
fi

# A backup BEFORE anything changes. It costs seconds, and it is the difference
# between a bad deploy and a bad day. Taken with the NEW image, which also
# proves that image can reach MySQL before the old one is stopped: if this
# fails, the site is still up and nothing has been touched. Into a pool of its
# own (backups/predeploy, the newest ten), so a busy day of deploys never pushes
# the nightly dumps out of their thirty slots. Its own container name, so it
# can never collide with the `kokli` container serving patients right now.
echo "== backing up the database"
if ! KOKLI_IMAGE="$NEW" docker compose run --rm --no-deps -T --name "kokli-backup-$TAG-$$" -e BACKUP_DIR=/app/backups/predeploy -e BACKUP_KEEP=10 app node scripts/backup.js </dev/null; then
  echo "ERROR: the backup failed, so nothing was changed - ${PREV:-the current version} is still live."
  echo "       Most often the new container cannot reach MySQL: DB_HOST in ~/kokli/.env.local,"
  echo "       and DEPLOYMENT.md 7a for letting containers in."
  exit 1
fi

# The schema, brought up to what the new code expects — by the new image's own
# migrations, while the old version keeps serving. Migrations are additive by
# rule (scripts/migrate.js), so the old code works on the new schema too: now,
# and after a rollback.
echo "== applying database migrations"
if ! KOKLI_IMAGE="$NEW" docker compose run --rm --no-deps -T --name "kokli-migrate-$TAG-$$" app node scripts/migrate.js </dev/null; then
  echo "ERROR: a migration failed, so the new version was NOT started - ${PREV:-the current version} is still live."
  echo "       Statements that did apply stay applied and recorded: fix the migration and push again."
  echo "       The backup taken just before is the newest file in ~/kokli/backups/predeploy."
  exit 1
fi

# The image serving right now, pinned by its id under a tag of its own. A
# rebuild of the same commit takes over its old tag, so a name read from .env
# could point at the new image; this cannot.
RUNNING_ID="$(docker container inspect -f '{{.Image}}' kokli 2>/dev/null || true)"
if [ -n "$RUNNING_ID" ]; then docker tag "$RUNNING_ID" "$ROLLBACK"; fi

# The switch. .env is the file Compose reads by itself, so it now also tells
# anyone typing `docker compose ...` on this server which version is live.
for f in docker-compose.yml docker-compose.override.yml; do
  if [ -f "$f.new" ]; then
    cp -p "$f" "$f.prev"
    mv "$f.new" "$f"
  fi
done
echo "KOKLI_IMAGE=$NEW" > .env

# `up` is inside the `if` on purpose. By the time it fails — port 3000 still
# held by something else, say — it has already removed the old container.
# Left to `set -e`, the script would stop right there, with the site down and
# the rollback below never reached.
state=down
if docker compose up -d --no-build; then
  state=unhealthy
  if healthy "$TAG" && [ "$(docker container inspect -f '{{.Image}}' kokli 2>/dev/null || true)" = "$NEW_ID" ]; then
    state=healthy
  fi
fi

if [ "$state" != healthy ]; then
  if [ "$state" = unhealthy ]; then
    echo "ERROR: $NEW started but did not become healthy within 90 seconds. Its last lines:"
    docker compose logs --no-color --tail 80 app || true
  else
    echo "ERROR: $NEW could not be started at all - Docker's reason is just above."
  fi
  for f in docker-compose.yml docker-compose.override.yml; do
    if [ -f "$f.prev" ]; then mv "$f.prev" "$f"; fi
  done
  if [ -z "$RUNNING_ID" ]; then
    echo "Nothing to roll back to: no version was running before this one."
    exit 1
  fi
  echo "Rolling back to the image that was serving before ($ROLLBACK)"
  echo "KOKLI_IMAGE=$ROLLBACK" > .env
  if docker compose up -d --no-build --force-recreate && healthy ""; then
    echo "rolled back - the previous version is serving again"
  else
    echo "ERROR: the previous version did not come back healthy either. THE SITE IS DOWN."
    echo "       On the server: cd ~/kokli && docker compose logs app"
  fi
  exit 1
fi

echo "live: $NEW"
docker tag "$NEW" "$REPO:latest"

# Old Kokli images. The five most recently deployed stay, and so do :rollback
# (the one just replaced) and :latest — going back never needs a rebuild or a
# registry. Everything else under this repository name goes: builds that never
# went live, and versions more than five deploys old. Only this repository's
# images are listed, so nothing else on the server is touched, and `image rm`
# refuses any image a container is still using.
echo "$NEW" >> .deployed
tail -n 20 .deployed > .deployed.tmp && mv .deployed.tmp .deployed
keep="$(tail -n 5 .deployed)"
docker image ls "$REPO" --format '{{.Repository}}:{{.Tag}}' | while read -r img; do
  case "$img" in
    "$REPO:latest"|"$ROLLBACK"|*':<none>') continue ;;
  esac
  if echo "$keep" | grep -qxF -- "$img"; then continue; fi
  docker image rm "$img" >/dev/null 2>&1 || true
done
docker image prune -f --filter label=org.opencontainers.image.title=kokli >/dev/null 2>&1 || true
docker compose ps
echo "KOKLI-DEPLOYED $NEW"
}
main "$@" </dev/null
REMOTE

if ! grep -qxF "KOKLI-DEPLOYED $IMAGE_NAME:$IMAGE_TAG" deploy-remote.log; then
  echo "ERROR: the deploy on the server did not finish - its last lines are just above."
  exit 1
fi
'''

            // From the outside, the way a patient arrives: DNS, TLS, the proxy.
            // The server has just said it is healthy, so a failure here is in
            // front of the app, not in this deploy — the build turns yellow
            // (unstable) rather than red.
            def outside = sh(returnStatus: true, script: '''
if curl -sf --max-time 15 "$BUILD_SITE_URL/api/health" | grep -q "$IMAGE_TAG"; then
  echo "$BUILD_SITE_URL is serving $IMAGE_TAG"
else
  echo "The server itself reports $IMAGE_TAG live and healthy, but $BUILD_SITE_URL/api/health"
  echo "did not say so from here. What is wrong is in front of the app: DNS, the TLS"
  echo "certificate or the Nginx Proxy Manager host (DEPLOYMENT.md 7d)."
  exit 1
fi
''')
            if (outside != 0) {
              unstable("${env.IMAGE_TAG} is live on the server, but ${env.BUILD_SITE_URL} did not answer with it from outside.")
            }
          }
        }
      }
    }
  }

  post {
    success  { echo "Build ${env.BUILD_NUMBER} passed${shouldShip() ? ' and is live' : ''}." }
    unstable { echo "Build ${env.BUILD_NUMBER}: live on the server, but not reachable from outside — see the Deploy stage." }
    failure  { echo "Build ${env.BUILD_NUMBER} failed — the stage above has the reason." }
  }
}
