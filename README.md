# mmscheduler scraper

This program updates the timetable data for the mmscheduler website.

Every day it does three jobs:

1. Downloads the newest timetable data from TimeEdit (the UM website).
2. Cleans the data and turns it into the format the app uses.
3. Saves the new data to the mmscheduler git repo — but only if it changed.

If the data is the same as last time, it does nothing. So we never make a
useless commit.

## Where it lives

- The server is: `mnajib@192.168.100.26`
- The program is in: `~/docker/mmscheduler-scraper/` on that server
- The code is on GitHub: `Mohammed-AlSharafi/mmscheduler_scraper`

## The two secrets

The program needs two secret things to work:

**1. Your UM login** — a file called `storageState.json`.

It lets the program open TimeEdit as you. To make it:

1. On YOUR computer, go to this project folder and run `npm run auth`.
2. A browser opens. Log in with UM SSO.
3. When it is done, it saves a file called `storageState.json`.
4. Copy that file to the server, into `~/docker/mmscheduler-scraper/`.

This file lasts about 3 months. When the server sends a "Session expired"
message, do this again.

**2. The GitHub key** — a file called `mmscheduler_deploy`.

It lets the program save the data to the mmscheduler repo. It is already set
up on the server. You should not need to touch it.

## Run it once (by hand)

SSH into the server, then run:

```bash
cd ~/docker/mmscheduler-scraper
docker run --rm --user 1000:1000 --env-file .env \
  -v "$PWD":/data \
  -v ~/.ssh/mmscheduler_deploy:/deploy_key:ro \
  mmscheduler-scraper
```

One run takes about 25 minutes. The logs tell you what happened:

```bash
cat ~/docker/mmscheduler-scraper/cron.log
ls ~/docker/mmscheduler-scraper/logs/
```

## It runs by itself

The server has a cron job that runs the program every day at 4:17 AM. To see
all the cron jobs:

```bash
crontab -l
```

The line looks like this:

```
17 4 * * * cd /home/mnajib/docker/mmscheduler-scraper && docker run --rm --user 1000:1000 --env-file .env -v /home/mnajib/docker/mmscheduler-scraper:/data -v /home/mnajib/.ssh/mmscheduler_deploy:/deploy_key:ro mmscheduler-scraper >> /home/mnajib/docker/mmscheduler-scraper/cron.log 2>&1
```

## Which branch gets the new data

The `.env` file on the server has a line that picks the git branch:

```
GIT_TARGET_BRANCH=data-pipeline-test
```

Right now it is set to `data-pipeline-test`. That is a test branch. The real
website is **not** updated from it.

To update the real website, change that line to `main`:

```
GIT_TARGET_BRANCH=main
```

Pushing to `main` makes Netlify rebuild the website.

## Get updates to this program

When the code changes on GitHub, update the copy on the server:

```bash
cd ~/docker/mmscheduler-scraper
git pull
docker build -t mmscheduler-scraper .
```

The last command rebuilds the program with the new code. The next daily run
will use it.

## What the main file does

`node fetch.mjs` is the whole pipeline:

```
download raw data  →  clean it  →  push it to git (only if it changed)
```
