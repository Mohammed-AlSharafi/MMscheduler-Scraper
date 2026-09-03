// Run on the SERVER (daily cron). The whole pipeline in one script:
//   1. load the copied SSO session and download the raw TimeEdit data,
//   2. run cleaner.js + transform.py to produce the app-format JSON,
//   3. if that JSON differs from what is committed on the target branch
//      (GIT_TARGET_BRANCH), commit and push it — which triggers the Netlify
//      rebuild when the target is main.
// (The GitHub Action + raw-data branch are gone; this script owns everything.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
import { config } from './config.mjs';
import { BASE_URL, bouncedToSso, isLoggedIn, waitForLoggedIn } from './lib/session.mjs';
import { ensureClone, stageAppJson, commitAndPush, APP_JSON } from './lib/git.mjs';
import { notify } from './lib/notify.mjs';
import { probeSession, reauthenticate } from './lib/reauth.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RAW_DIR = path.join(config.dataDir, '.raw'); // raw downloads (plain dir)
const REPO_DIR = path.join(config.dataDir, '.repo'); // git clone of the repo at target branch
const WORK_DIR = path.join(config.dataDir, '.work'); // cleaner/transform scratch
const LOGS_DIR = path.join(config.dataDir, 'logs');
const STORAGE_STATE = path.join(config.dataDir, 'storageState.json');
const COURSE_RAW = 'course_events_with_details.json';
const LECTURER_RAW = 'lecturer_data.json';

// Params handed to the in-page fetch-courses-page.js (it cannot read .env).
const coursePageConfig = {
  baseUrl: config.baseUrl,
  pageSize: config.coursePageSize,
  maxObjects: config.courseMaxObjects,
  concurrency: config.courseConcurrency,
  pageConcurrency: config.coursePageConcurrency,
  retries: config.courseRetries,
};
const SCRIPTS = [
  { script: 'scripts/lecturer.js', filename: LECTURER_RAW, timeoutMs: config.lecturerTimeoutMs, pageConfig: null },
  // fetch-courses-page.js replaces the SDK main.js crawl: it enumerates ~29k
  // course objects concurrently but only pulls details + reservation HTML for
  // the ~2.5k that have events. A full run is ~25 min, hence the long timeout.
  { script: 'scripts/fetch-courses-page.js', filename: COURSE_RAW, timeoutMs: config.courseTimeoutMs, pageConfig: coursePageConfig },
];
const RETRIES = config.scriptRetries;
const DRY_RUN = process.argv.includes('--dry-run');
const remoteUrl = config.gitRemoteUrl;

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(' ')}`;
  console.log(line);
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, `${new Date().toISOString().slice(0, 10)}.log`), line + '\n');
  rotateLogs();
}

function rotateLogs(keep = config.logKeepDays) {
  const files = fs.readdirSync(LOGS_DIR).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) {
    fs.rmSync(path.join(LOGS_DIR, f));
  }
}

async function runScript(page, { script, filename, timeoutMs, pageConfig }) {
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const downloadPromise = page.waitForEvent('download', { timeout: timeoutMs });
      if (pageConfig) {
        await page.evaluate((cfg) => { window.__MMS_CONFIG__ = cfg; }, pageConfig);
      }
      await page.addScriptTag({ path: path.join(__dirname, script) });
      const download = await downloadPromise;
      await download.saveAs(path.join(RAW_DIR, filename));
      log(`downloaded ${filename}`);
      return;
    } catch (err) {
      log(`attempt ${attempt}/${RETRIES} failed for ${filename}: ${err.message}`);
      if (attempt === RETRIES) throw err;
      await page.reload({ waitUntil: 'domcontentloaded' });
    }
  }
}

// cleaner.js reads the two raw files and writes timetable_data.json into cwd;
// transform.py reads ./timetable_data.json and writes the app JSON to appOut.
function runTransform() {
  const appOut = path.join(WORK_DIR, 'app_output.json');
  fs.mkdirSync(WORK_DIR, { recursive: true });
  execFileSync(
    'node',
    [path.join(__dirname, 'cleaner.js'), path.join(RAW_DIR, COURSE_RAW), path.join(RAW_DIR, LECTURER_RAW)],
    { cwd: WORK_DIR, stdio: 'inherit' },
  );
  execFileSync('python3', [path.join(__dirname, 'transform.py'), appOut], { cwd: WORK_DIR, stdio: 'inherit' });
  return appOut;
}

async function main() {
  if (!remoteUrl) throw new Error('GIT_REMOTE_URL not set (see .env)');
  if (!fs.existsSync(STORAGE_STATE)) {
    throw new Error('storageState.json missing. Run auth.mjs on your machine and upload it.');
  }

  // One-time migration: .raw used to be a git clone of the raw-data branch.
  if (fs.existsSync(path.join(RAW_DIR, '.git'))) {
    fs.rmSync(RAW_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(RAW_DIR, { recursive: true });

  ensureClone({ cloneDir: REPO_DIR, remoteUrl, branch: config.targetBranch });
  // Fail fast: the target branch must contain the app data file, or the fetch
  // below is wasted and the final write errors. (E.g. GIT_TARGET_BRANCH
  // pointing at the old raw-data branch, which has no mmscheduler/app/.)
  if (!fs.existsSync(path.join(REPO_DIR, ...APP_JSON.split('/')))) {
    throw new Error(
      `GIT_TARGET_BRANCH '${config.targetBranch}' does not contain ${APP_JSON}. ` +
        'Set GIT_TARGET_BRANCH to a branch that has the app data (e.g. main).',
    );
  }
  log('repo ready');

  const browser = await chromium.launch({
    headless: true,
    // TE Auth (TimeEdit's login script) does not boot for a default headless
    // client, so the run uses a normal Chrome UA with the automation flag off.
    // Harmless for the data fetch; required for the silent re-auth below.
    args: ['--disable-blink-features=AutomationControlled'],
  });
  try {
    const context = await browser.newContext({
      storageState: STORAGE_STATE,
      userAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });

    // Establish a live TimeEdit session up front. The TimeEdit session cookie is
    // short-lived; once stale (e.g. the previous run was hours ago) the data
    // APIs answer 412 with no silent recovery unless we drive the login. Probe
    // one object endpoint; if it 412s, run the headless re-auth, which uses the
    // persistent Entra cookie for a silent sign-in (see lib/reauth.mjs).
    {
      const sessionPage = await context.newPage();
      sessionPage.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error') log(`[page] ${text}`);
      });
      await sessionPage.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
      const bounced = await bouncedToSso(sessionPage, config.sessionBounceMs);
      if (bounced || !(await isLoggedIn(sessionPage))) {
        try {
          await waitForLoggedIn(sessionPage, config.sessionReauthMs);
        } catch {
          throw new Error('Session expired: TimeEdit redirected to SSO. Re-run auth.mjs on your machine and re-upload storageState.json.');
        }
      }
      if (!(await probeSession(sessionPage))) {
        log('TimeEdit session stale; attempting silent re-auth');
        if (!(await reauthenticate(context))) {
          throw new Error(
            'Session expired: silent re-auth failed. Re-run auth.mjs on your machine and re-upload storageState.json.',
          );
        }
        log('re-auth OK; TimeEdit session refreshed');
      }
      await sessionPage.close();
      await context.storageState({ path: STORAGE_STATE });
    }

    for (const entry of SCRIPTS) {
      const page = await context.newPage();
      // Surface the in-page fetch's progress + failures (per-phase timing,
      // per-task errors) so concurrency tuning and outages are visible in the
      // log. lecturer.js batch chatter is filtered out.
      page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' || text.startsWith('course fetch:') || text.startsWith('task ')) {
          log(`[page] ${text}`);
        }
      });
      await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: config.navigationTimeoutMs });
      // Wait out the initial SSO redirect so a momentary pre-redirect URL isn't
      // mistaken for a valid session. With a valid session there is no bounce,
      // so this waits a short grace period and proceeds.
      const bounced = await bouncedToSso(page, config.sessionBounceMs);
      if (bounced || !(await isLoggedIn(page))) {
        // The page left the students page. When the short-lived TimeEdit token
        // dies, this is usually a silent single-sign-on re-auth (the persistent
        // ESTSAUTHPERSISTENT cookie) rather than a real expiry — give it a
        // grace period to come back to the students page before declaring the
        // session dead, exactly as a normal browser would.
        try {
          await waitForLoggedIn(page, config.sessionReauthMs);
        } catch {
          throw new Error('Session expired: TimeEdit redirected to SSO. Re-run auth.mjs on your machine and re-upload storageState.json.');
        }
      }
      await runScript(page, entry);
      await page.close();
    }
    // Persist any refreshed session (e.g. after a silent SSO re-auth) so the
    // next run starts with a fresh token instead of re-bouncing.
    await context.storageState({ path: STORAGE_STATE });
    await browser.close();
  } catch (err) {
    await browser.close().catch(() => {});
    log(`FAILED: ${err.message}`);
    await notify(`Timetable fetch FAILED: ${err.message}`, { level: 'error' });
    process.exit(1);
  }

  log('raw data downloaded; running cleaner + transform');
  const appOut = runTransform();

  const changed = stageAppJson(REPO_DIR, appOut, config.targetBranch);
  if (!changed) {
    log('app data unchanged; nothing to push');
    await notify('Timetable refresh: raw data fetched, app data unchanged');
    process.exit(0);
  }

  log('app data changed');
  if (DRY_RUN) {
    log('dry-run: skipping commit + push');
    process.exit(0);
  }

  commitAndPush(REPO_DIR, `Update timetable data ${new Date().toISOString().slice(0, 10)}`, config.targetBranch);
  log(`pushed ${config.targetBranch}`);
  const deployNote = config.targetBranch === 'main' ? ' (Netlify redeploying)' : '';
  await notify(`Timetable data changed; pushed to ${config.targetBranch}${deployNote}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
