# mmscheduler_scraper — operating manual

Standalone project for the daily mmscheduler timetable refresh. It fetches raw
TimeEdit data, cleans and transforms it into the app format, and — only when the
data actually changed — commits and pushes the result to a git branch of the
mmscheduler repo (`main` by default), which triggers the Netlify rebuild. It is
meant to run on a server, either directly or as a Docker image invoked once a
day by the host's cron.

```
[Your machine]   npm run auth  →  log into UM SSO once  →  storageState.json
[Server (daily)] node fetch.mjs  →  fetch raw → cleaner + transform → push app JSON to target branch if changed
[Netlify]        on push to main:  rebuild with new JSON (URL unchanged)
```

The browser fetch is the only step that must run with a live session cookie;
everything else (clean, transform, git push) runs in the same script. There is
no GitHub Action and no `raw-data` branch — this project owns the whole pipeline.

## How it works

`node fetch.mjs` does the whole pipeline in one run:

1. Downloads `lecturer_data.json` and `course_events_with_details.json` from
   TimeEdit in a headless browser (`scripts/fetch-courses-page.js` crawls the
   ~29k course objects concurrently and keeps the ~2.5k with events).
2. Runs `cleaner.js` (node) then `transform.py` (python3) to produce the
   app-format JSON.
3. If that JSON differs from what is committed on the target branch, commits it
   as `mmscheduler-data-bot` and pushes.

Scratch state (`.raw`, `.repo`, `.work`, `logs/`, `storageState.json`) lives in
`DATA_DIR` (default: the project directory). Only the small app JSON is pushed
to git; the multi-hundred-MB raw data never leaves the server.

## Run it locally (dev / one-off)

Prerequisites: Node ≥ 20, Python 3, git.

```bash
npm install
npx playwright install chromium      # or: npx playwright install --with-deps chromium
cp .env.example .env                 # fill in GIT_REMOTE_URL etc.
npm run auth                          # on YOUR machine: UM SSO login → storageState.json
node fetch.mjs --dry-run              # fetch + transform + change detection, no push
node fetch.mjs                        # real run (pushes only when the data changed)
```

Tests: `npm test` (node `node:test` + python `unittest`).

## Run it in Docker (server, host-cron)

Build the image (Node + Python + Playwright's chromium are baked in):

```bash
docker build -t mmscheduler-scraper .
```

On the server, keep a data directory that holds `.env` and `storageState.json`
(the SSO session from `npm run auth`, uploaded once and re-uploaded when it
expires):

```
/srv/mmscheduler-scraper/data/
├── .env                 # GIT_REMOTE_URL, GIT_TARGET_BRANCH, NOTIFY_WEBHOOK_URL, ...
└── storageState.json    # uploaded from your machine
```

Run it once (the container runs the pipeline and exits; `.raw/.repo/.work/logs`
persist in the data dir because it is mounted at `DATA_DIR`):

```bash
docker run --rm \
  --env-file /srv/mmscheduler-scraper/data/.env \
  -v /srv/mmscheduler-scraper/data:/data \
  mmscheduler-scraper
```

`--dry-run` works too: append `--dry-run` to the `docker run` command.

#### Auth for the git push: PAT vs deploy key

- **Personal access token (HTTPS):** a fine-grained PAT with `Contents: read
  and write` on the repo, embedded in `GIT_REMOTE_URL` (above). Simplest — no
  extra mounts; the image already ships everything.
- **Deploy key (SSH):** repo-scoped, no personal token. Requires admin on the
  repo to add the public key (Settings → Deploy keys → “Allow write access”).
  Generate a keypair on the server, then mount the private key into the
  container and tell git to use it:

  ```bash
  ssh-keygen -t ed25519 -f ~/.ssh/mmscheduler_deploy -N "" -C "mmscheduler-scraper"
  # add ~/.ssh/mmscheduler_deploy.pub to the repo's Deploy keys (admin), write access
  ssh -T -i ~/.ssh/mmscheduler_deploy git@github.com   # expect "Hi <repo>! ..."
  ```

  ```bash
  docker run --rm \
    --env-file /srv/mmscheduler-scraper/data/.env \
    -v /srv/mmscheduler-scraper/data:/data \
    -v /home/USER/.ssh/mmscheduler_deploy:/deploy_key:ro \
    -e GIT_SSH_COMMAND="ssh -i /deploy_key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
    mmscheduler-scraper
  ```

  and set `GIT_REMOTE_URL=git@github.com:Muhd-Mairaj/mmscheduler.git` in `.env`.

### Host cron

```cron
17 4 * * * cd /srv/mmscheduler-scraper && docker run --rm --env-file data/.env -v "$PWD/data":/data mmscheduler-scraper >> data/logs/cron.log 2>&1
```

The `logs/` directory must exist before the first cron tick or the redirect will
fail; the first manual `docker run` creates it.

## Configuration (`.env`)

See `.env.example` for every variable. The important ones:

- `GIT_REMOTE_URL` (required) — the mmscheduler repo. Either auth over HTTPS
  with a personal access token embedded, e.g.
  `https://x-access-token:PAT@github.com/Muhd-Mairaj/mmscheduler.git`, **or**
  over SSH with a repo deploy key, `git@github.com:Muhd-Mairaj/mmscheduler.git`
  (then the key must be available to git — see below).
- `GIT_TARGET_BRANCH` — branch the app JSON is pushed to (default `main`; must
  already exist on `origin`). Point it at a scratch branch to test without
  triggering a Netlify deploy. `fetch.mjs` fails fast if the branch lacks the
  app data file.
- `NOTIFY_WEBHOOK_URL` — optional webhook that receives failure/success notes.
- `DATA_DIR` — where scratch/logs/`storageState.json` live (Docker mounts this).
- Course-fetch tuning (`COURSE_CONCURRENCY`, etc.) — see `.env.example`.

## Rollout checklist

1. **Auth** — on your machine: `npm run auth`, log in through UM SSO, confirm
   `storageState.json` is produced (non-empty cookies).
2. **First server run** — `node fetch.mjs --dry-run` (or the Docker equivalent)
   to confirm downloads + transform + change detection; then a real run and
   confirm the `Update timetable data` commit lands on the target branch.
3. **Enable cron** — only after step 2 succeeds, add the cron line above.

## Re-auth flow

On a "Session expired" alert, repeat the auth step on your machine and
re-upload `storageState.json`. The persistent SSO cookie silently re-auths for
months between interactive logins.
