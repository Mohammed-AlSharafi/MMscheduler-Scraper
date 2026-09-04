# mmscheduler scraper

This program updates the timetable data for the mmscheduler website.

Each time it runs, it does three jobs:

1. Downloads the newest timetable data from TimeEdit (the UM website).
2. Cleans the data and turns it into the format the app uses.
3. Saves the new data to the app repo, but only if it changed.

If the data is the same as last time, it does nothing. So we never make a
useless commit.

You host this on your own server. The examples below use a working folder at
`~/docker/mmscheduler-scraper/` on that server and a git key at
`~/.ssh/mmscheduler_deploy`. You can pick other names; just use the same ones
in every command.

## The two secrets

The program needs two secret things to work. You make both yourself, once,
and they live in the working folder on the server.

**1. GitHub access**, a key called `mmscheduler_deploy`.

The scraper saves the timetable data to a git repo, so that repo has to accept
pushes from the scraper. Make a keypair for it on the server:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/mmscheduler_deploy -N "" -C "mmscheduler-scraper"
```

Add the public key to the repo that should receive the data, with write
access. On GitHub: repo Settings → Deploy keys → "Add deploy key", paste the
contents of `~/.ssh/mmscheduler_deploy.pub`, and tick "Allow write access".
You need admin rights on that repo to do this.

Then tell the scraper which repo to push to. In the working folder, make the
`.env` file from the example and fill it in:

```bash
cd ~/docker/mmscheduler-scraper
cp .env.example .env
```

In `.env`, set the repo over SSH:

```
GIT_REMOTE_URL=git@github.com:YOUR_USERNAME/YOUR_APP_REPO.git
```

(An HTTPS URL with a token also works; see `.env.example`.)

**2. Your UM login**, a file called `storageState.json`.

It lets the program open TimeEdit as you. To make it:

1. On YOUR computer, go to this project folder and run `npm run auth`.
2. A browser opens. Log in with UM SSO.
3. When it is done, it saves a file called `storageState.json`.
4. Copy that file to the working folder on the server, next to `.env`.

This file lasts about 3 months. When the server sends a "Session expired"
message, do this again.

## Build the Docker image

On the server, build the image once:

```bash
cd ~/docker/mmscheduler-scraper
docker build -t mmscheduler-scraper .
```

## Run it once (by hand)

SSH into the server, then run:

```bash
cd ~/docker/mmscheduler-scraper
docker run --rm --env-file .env --user "$(id -u):$(id -g)" \
  -v "$PWD":/data \
  -v ~/.ssh/mmscheduler_deploy:/deploy_key:ro \
  mmscheduler-scraper
```

The whole working folder is mounted at `/data`, which is where the program
keeps its scratch files, logs and `storageState.json`. Running as your own
user id means the files it writes on the server belong to you.

One run takes about 25 minutes. The logs tell you what happened:

```bash
cat ~/docker/mmscheduler-scraper/cron.log
ls ~/docker/mmscheduler-scraper/logs/
```

## Run it on a schedule

The scraper does not care what day or time it runs. You choose the schedule
with cron, on the machine where the files and the Docker image live. To edit
your crontab:

```bash
crontab -e
```

A line that runs it once a day at 4:17 AM looks like this:

```
17 4 * * * cd "$HOME/docker/mmscheduler-scraper" && docker run --rm --env-file .env --user "$(id -u):$(id -g)" -v "$PWD":/data -v "$HOME/.ssh/mmscheduler_deploy":/deploy_key:ro mmscheduler-scraper >> cron.log 2>&1
```

Change the five fields at the start to run it as often as you like (twice a
day, hourly, weekly, whatever fits). To see what is already scheduled:

```bash
crontab -l
```

## Which branch gets the new data

`.env` also has a line that picks which branch of the app repo receives the
data:

```
GIT_TARGET_BRANCH=main
```

`main` is the default. Pushing to it makes Netlify rebuild the website, so it
is the right choice for the live site. To test without touching the live
site, point the line at a scratch branch instead. The branch must already
exist on the repo and contain the app data file.

## Credits

This project builds on
[um-timetable-sdk](https://github.com/damnitjoshua/um-timetable-sdk), an
open-source JavaScript toolkit by
[damnitjoshua](https://github.com/damnitjoshua) for pulling Universiti Malaya
timetable data out of TimeEdit. In particular:

- the in-page fetchers in `steps/fetch/` (`lecturer.js`, and the course
  fetcher that replaces the SDK's `main.js` crawl),
- and the data-cleaning logic in `steps/clean.mjs`,

are based on the SDK.
