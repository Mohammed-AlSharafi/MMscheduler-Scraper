// Helpers that keep a local clone of the repo on the configured target branch
// and commit the freshly transformed app JSON to it. Pushing to that branch is
// what updates the app data; when the target is `main` it also triggers the
// Netlify rebuild — the server runs the whole fetch -> transform -> deploy
// chain, so there is no raw-data branch or CI step any more.
import { existsSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Repo-relative path of the app's timetable data file this pipeline owns. The
// transform output replaces exactly this file, nothing else.
export const APP_JSON = 'mmscheduler/app/all_courses_updated_one_week_schedule_occ_separated.json';

const BOT_NAME = 'mmscheduler-data-bot';
const BOT_EMAIL = 'mmscheduler-data-bot@users.noreply.github.com';

export function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

// Ensure cloneDir is a clean working checkout of origin/<branch>, configured
// to commit as the data bot. The branch must already exist on the remote.
export function ensureClone({ cloneDir, remoteUrl, branch }) {
  if (!existsSync(path.join(cloneDir, '.git'))) {
    runGit(['clone', remoteUrl, cloneDir]);
    runGit(['config', 'user.name', BOT_NAME], cloneDir);
    runGit(['config', 'user.email', BOT_EMAIL], cloneDir);
  }
  // The configured GIT_REMOTE_URL is authoritative even when the working clone
  // predates a change of auth scheme (e.g. HTTPS token -> SSH deploy key): an
  // existing clone's .git/config would otherwise keep fetch/push pointed at the
  // old URL and silently ignore GIT_REMOTE_URL.
  runGit(['remote', 'set-url', 'origin', remoteUrl], cloneDir);
  runGit(['fetch', 'origin', branch], cloneDir);
  runGit(['checkout', '-f', branch], cloneDir);
  runGit(['reset', '--hard', `origin/${branch}`], cloneDir);
}

// Copy the freshly transformed app JSON over the tracked file and stage it.
// Returns true when it differs from the target branch tip. The base of
// comparison is explicitly origin/<branch> — never local HEAD, which could
// drift — and fetch.mjs calls this right after ensureClone, so origin/<branch>
// is fresh. No-op runs report false and no commit is made.
export function stageAppJson(cloneDir, sourceAppJson, branch) {
  const target = path.join(cloneDir, ...APP_JSON.split('/'));
  copyFileSync(sourceAppJson, target);
  runGit(['add', '--', APP_JSON], cloneDir);
  try {
    runGit(['diff', '--cached', '--quiet', `origin/${branch}`, '--', APP_JSON], cloneDir);
    return false;
  } catch {
    return true;
  }
}

// Commit the staged app JSON and push to <branch> (rebasing first so a
// concurrent push to that branch cannot clobber it).
export function commitAndPush(cloneDir, message, branch) {
  runGit(['commit', '-m', message], cloneDir);
  runGit(['pull', '--rebase', 'origin', branch], cloneDir);
  runGit(['push', 'origin', branch], cloneDir);
}
