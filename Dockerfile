# mmscheduler_scraper — the daily UM timetable refresh pipeline.
#
# A run-once image: the host schedules it (e.g. cron runs
# `docker run --rm ... mmscheduler_scraper`), the container runs
# `node fetch.mjs`, and exits. Config comes from --env-file (GIT_REMOTE_URL
# etc.); scratch, logs and storageState.json live on a volume mounted at
# DATA_DIR so state survives between runs.

FROM mcr.microsoft.com/playwright:v1.62.1-noble

# python3 runs transform.py. git + openssh-client are needed to clone/push the
# target repo — over HTTPS with a token in GIT_REMOTE_URL, or over SSH with a
# mounted deploy key (see the README's Docker section).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 git openssh-client \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install npm deps. Playwright is pinned to 1.62.1, the same version the base
# image ships its chromium for, so no browser download is needed.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Scratch, logs, and storageState.json live on the mounted DATA_DIR volume.
ENV DATA_DIR=/data

# Git auth: the deploy-key setup mounts the private key at /deploy_key and this
# tells git to use it. Only consulted for SSH remotes (git@github.com:...); an
# HTTPS GIT_REMOTE_URL (PAT in the URL) is unaffected. Override with
# `-e GIT_SSH_COMMAND=...` if your key lives elsewhere.
ENV GIT_SSH_COMMAND="ssh -i /deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"

ENTRYPOINT ["node", "fetch.mjs"]
