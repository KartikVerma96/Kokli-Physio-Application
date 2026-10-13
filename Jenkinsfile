// =============================================================================
//  Jenkins pipeline — the same gate as .github/workflows/ci.yml
// =============================================================================
//  Two kinds of check, then a deploy:
//
//    1. LINT AND BUILD   fast, and enough to catch most mistakes
//    2. FULL SUITE       a real MySQL and a real server, because that is the
//                        only way this suite means anything: it signs in as
//                        four different roles over HTTP and asserts that one
//                        clinic cannot reach another's data. Mocking that would
//                        prove nothing.
//    3. DOCKER IMAGE     builds the Dockerfile, so it cannot quietly rot
//    4. DEPLOY           only from main, and only once the rest have passed
//
//  THE IMAGE IS BUILT, NOT DEPLOYED
//  --------------------------------
//  The deploy below is still the pm2 one from DEPLOYMENT.md: the server runs
//  the app directly and MySQL natively beside it. The image stage exists so the
//  Dockerfile is exercised on every build rather than discovered to be broken
//  on the day somebody needs it. Switching the deploy to run that image is a
//  separate decision — it would need Docker on the server and a registry.
//
//  WHAT THE AGENT NEEDS
//  --------------------
//    * Docker, and the "Docker Pipeline" plugin. Node and MySQL both run as
//      containers, so the agent needs neither installed and the build cannot be
//      broken by whichever Node version happens to be on the machine.
//    * For the deploy stage only:
//        - an SSH credential with id `kokli-deploy-key` (Jenkins → Credentials
//          → SSH Username with private key)
//        - a global environment variable DEPLOY_HOST holding the server's
//          address (Manage Jenkins → System → Global properties)
//      With no DEPLOY_HOST the deploy stage skips itself rather than failing,
//      so this file is useful from the very first build, before any server
//      exists.
//    * Optional: a global environment variable SITE_URL (e.g. https://kokli.in).
//      It becomes NEXT_PUBLIC_SITE_URL in the image, which is compiled into the
//      JavaScript the browser downloads and so cannot be set at run time. Unset,
//      the image is built for localhost — fine for a build that is only proving
//      the Dockerfile still works.
//
//  WHY THE DEV SERVER AND NOT THE PRODUCTION BUILD
//  -----------------------------------------------
//  The suites invoke server actions directly, and they find each action's id in
//  .next/dev/server/server-reference-manifest.json — a file only the dev server
//  writes. `next build` does not produce it.
// =============================================================================

pipeline {
  // No global agent: each stage asks for what it needs, so an executor is never
  // held while nothing is running.
  agent none

  options {
    timestamps()
    // A pipeline that hangs forever holds an agent and tells you nothing.
    timeout(time: 40, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '30'))
    disableConcurrentBuilds()
  }

  environment {
    // Pinned to the major version in package.json's `engines`.
    NODE_IMAGE  = 'node:24-bookworm'
    MYSQL_IMAGE = 'mysql:9'
  }

  stages {
    /* ===================================================================== */
    /*  1. LINT AND BUILD                                                    */
    /* ===================================================================== */
    stage('Lint and build') {
      agent {
        docker {
          image 'node:24-bookworm'
          // root so npm may write its cache inside the container. The workspace
          // itself is mounted from the agent either way.
          args '-u root:root'
        }
      }
      environment {
        // A build needs these to exist, but never uses their values here.
        PLATFORM_ENCRYPTION_KEY = 'ci-placeholder-key-not-used-for-anything'
        AUTH_SECRET             = 'ci-placeholder-secret-not-used-for-anything'
      }
      steps {
        // `npm ci` not `npm install`: it installs exactly the lockfile, so CI
        // can never quietly test a different dependency version from the one
        // that gets deployed.
        sh 'npm ci'
        sh 'npx eslint .'
        sh 'npm run build'
      }
      post {
        // Everything above ran as root inside the container. Without this the
        // Jenkins user cannot delete its own workspace on the next build.
        always { sh 'chmod -R a+rwX . || true' }
      }
    }

    /* ===================================================================== */
    /*  2. THE FULL SUITE                                                    */
    /* ===================================================================== */
    stage('Full suite') {
      agent any
      steps {
        script {
          docker.image(env.MYSQL_IMAGE).withRun(
            '-e MYSQL_ROOT_PASSWORD=ci -e MYSQL_DATABASE=physio_clinic'
          ) { db ->
            // The Node container SHARES the database container's network. That
            // is what makes 127.0.0.1:3306 reach MySQL and 127.0.0.1:3000 reach
            // our own server, exactly as the suites expect — no published
            // ports, and nothing of this left on the agent afterwards.
            docker.image(env.NODE_IMAGE).inside("--network=container:${db.id} -u root:root") {

              // ---------------------------------------------------------------
              //  *.localhost does NOT resolve on Linux
              // ---------------------------------------------------------------
              //  macOS and browsers resolve any *.localhost to 127.0.0.1. Node
              //  on Debian does not, so every clinic subdomain the suites use
              //  has to be spelled out, or the tests fail with ENOTFOUND — which
              //  reads like a broken app rather than a missing hosts entry.
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

              sh 'npm ci'

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
npm run dev > dev.log 2>&1 &
for i in $(seq 1 90); do
  curl -sf http://localhost:3000/ >/dev/null && exit 0
  sleep 1
done
echo "server never came up:"; tail -60 dev.log; exit 1
'''

              // Warm every page so the dev server compiles each route and writes
              // its server actions into the manifest the suites read.
              sh '''
for p in / /login /register /forgot-password /admin /admin/services \
         /admin/settings/branding /admin/settings/whatsapp /admin/billing \
         /dashboard/profile /platform /platform/errors; do
  curl -s -o /dev/null -H 'Host: aarogya.localhost' "http://localhost:3000$p" || true
done
'''

              sh 'npm test'

              // Same reason as the stage above: root wrote these files.
              sh 'chmod -R a+rwX . || true'
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
    /*  3. THE DOCKER IMAGE                                                  */
    /* ===================================================================== */
    stage('Docker image') {
      agent any
      steps {
        script {
          // Tagged with the build number and the commit, because "latest" tells
          // you nothing on the day you need to know what is running.
          def sha = sh(script: 'git rev-parse --short HEAD', returnStdout: true).trim()
          def image = docker.build(
            "kokli:${env.BUILD_NUMBER}",
            "--build-arg NEXT_PUBLIC_SITE_URL=${env.SITE_URL ?: 'http://localhost:3000'} ."
          )
          image.tag(sha)

          // A built image can still be an image that cannot start. This asks the
          // runtime stage to load the server's own entry point — no database, no
          // port, just "does this thing hold together".
          sh "docker run --rm --entrypoint node kokli:${env.BUILD_NUMBER} -e \"require('next'); require('./lib/videoToken'); console.log('image ok')\""
        }
      }
      post {
        // Every build leaves an image behind. Keep the tagged ones, drop the
        // layers nothing points at any more, or the agent fills up in a month.
        always { sh 'docker image prune -f || true' }
      }
    }

    /* ===================================================================== */
    /*  4. DEPLOY                                                            */
    /* ===================================================================== */
    stage('Deploy') {
      agent any
      when {
        beforeAgent true
        allOf {
          branch 'main'
          // No server configured yet? Then there is nothing to deploy to, and a
          // red build would be a lie.
          expression { return env.DEPLOY_HOST?.trim() }
        }
      }
      steps {
        sshagent(credentials: ['kokli-deploy-key']) {
          // NO MIGRATIONS. `npm run db:migrate` is deliberately left to a human:
          // a schema change on a database holding medical records should be run
          // by somebody who is watching, with a backup taken minutes earlier.
          // See DEPLOYMENT.md.
          sh '''
ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 "$DEPLOY_HOST" bash -s <<'REMOTE'
set -euo pipefail
cd ~/kokli

# A backup BEFORE anything changes. It costs seconds, and it is the difference
# between a bad deploy and a bad day.
npm run backup

git fetch --all
git reset --hard origin/main

npm ci --omit=dev --ignore-scripts
npm ci
npm run build

# `reload` not `restart`: pm2 starts the new process, waits for it to listen, and
# only then stops the old one. A restart drops every in-progress request and
# every live video call.
pm2 reload kokli --update-env
pm2 save

sleep 3
curl -sf http://localhost:3000/ >/dev/null \
  || { echo "health check failed after deploy"; pm2 logs kokli --lines 40 --nostream; exit 1; }
echo "deployed $(git rev-parse --short HEAD)"
REMOTE
'''
        }
      }
    }
  }

  post {
    success { echo "Build ${env.BUILD_NUMBER} passed." }
    failure { echo "Build ${env.BUILD_NUMBER} failed — the stage above has the reason." }
  }
}
