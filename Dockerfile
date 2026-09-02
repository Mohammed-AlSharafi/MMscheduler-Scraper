# mmscheduler_scraper — the daily UM timetable refresh pipeline.
#
# A run-once image: the host schedules it (e.g. cron runs
# `docker run --rm ... mmscheduler_scraper`), the container runs
# `node fetch.mjs`, and exits. Config comes from --env-file (GIT_REMOTE_URL
# etc.); scratch, logs and storageState.json live on a volume mounted at
# DATA_DIR so state survives between runs.

FROM mcr.microsoft.com/playwright:v1.62.1-noble

# python3 runs transform.py; git is needed to clone/push the target repo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 git \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install npm deps. Playwright is pinned to 1.62.1, the same version the base
# image ships its chromium for, so no browser download is needed.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Scratch, logs, and storageState.json live on the mounted DATA_DIR volume.
ENV DATA_DIR=/data

ENTRYPOINT ["node", "fetch.mjs"]
