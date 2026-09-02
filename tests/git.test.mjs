import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ensureClone, stageAppJson, commitAndPush, APP_JSON } from '../lib/git.mjs';

function git(args, cwd) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

// Seed a bare remote whose <branch> already contains the app JSON file.
function setup({ branch = 'main', initialJson = '{"v":1}' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maingit-'));
  const seed = path.join(root, 'seed');
  fs.mkdirSync(path.join(seed, path.dirname(APP_JSON)), { recursive: true });
  fs.writeFileSync(path.join(seed, APP_JSON), initialJson);
  git(['init', '-b', branch, seed]);
  git(['add', '-A'], seed);
  git(['commit', '-m', 'seed'], seed);
  const remote = path.join(root, 'remote.git');
  git(['init', '--bare', remote]);
  git(['remote', 'add', 'origin', remote], seed);
  git(['push', '-u', 'origin', branch], seed);
  const clone = path.join(root, 'clone');
  return { remote, clone, branch };
}

function seededAppJson(cwd) {
  return path.join(cwd, APP_JSON);
}

function tmpJson(content) {
  const p = path.join(os.tmpdir(), `app-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, content);
  return p;
}

test('ensureClone checks out origin/main with the app json present', () => {
  const { remote, clone, branch } = setup();
  ensureClone({ cloneDir: clone, remoteUrl: remote, branch });
  assert.equal(fs.existsSync(seededAppJson(clone)), true);
  assert.equal(fs.readFileSync(seededAppJson(clone), 'utf8'), '{"v":1}');
});

test('stageAppJson reports change and commitAndPush updates the remote', () => {
  const { remote, clone, branch } = setup();
  ensureClone({ cloneDir: clone, remoteUrl: remote, branch });
  const changed = tmpJson('{"v":2}');
  try {
    assert.equal(stageAppJson(clone, changed), true);
    commitAndPush(clone, 'update data', branch);
    git(['fetch', 'origin', branch], clone);
    const content = execFileSync('git', ['show', `origin/${branch}:${APP_JSON}`], { cwd: clone, encoding: 'utf8' });
    assert.equal(content, '{"v":2}');
  } finally {
    fs.rmSync(changed, { force: true });
  }
});

test('stageAppJson reports no change for identical content', () => {
  const { remote, clone, branch } = setup();
  ensureClone({ cloneDir: clone, remoteUrl: remote, branch });
  const same = tmpJson('{"v":1}');
  try {
    assert.equal(stageAppJson(clone, same), false);
  } finally {
    fs.rmSync(same, { force: true });
  }
});

test('works against a non-main target branch', () => {
  const { remote, clone, branch } = setup({ branch: 'release' });
  ensureClone({ cloneDir: clone, remoteUrl: remote, branch });
  const changed = tmpJson('{"v":9}');
  try {
    assert.equal(stageAppJson(clone, changed), true);
    commitAndPush(clone, 'update release', branch);
    git(['fetch', 'origin', branch], clone);
    const content = execFileSync('git', ['show', `origin/${branch}:${APP_JSON}`], { cwd: clone, encoding: 'utf8' });
    assert.equal(content, '{"v":9}');
  } finally {
    fs.rmSync(changed, { force: true });
  }
});
