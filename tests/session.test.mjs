import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLoggedIn, bouncedToSso } from '../lib/session.mjs';

function stubPage(url, passwordVisible) {
  return {
    url: () => url,
    locator: () => ({ first: () => ({ isVisible: async () => passwordVisible }) }),
  };
}

function stubPageWithWaitForURL(bounces) {
  return {
    url: () => 'https://cloud.timeedit.net/my_um/web/students/',
    waitForURL: async () => {
      if (bounces) return;
      throw new Error('Timeout waiting for navigation');
    },
  };
}

test('logged in when on students page with no password field', async () => {
  const page = stubPage('https://cloud.timeedit.net/my_um/web/students/', false);
  assert.equal(await isLoggedIn(page), true);
});

test('not logged in when redirected to an SSO origin', async () => {
  const page = stubPage('https://sso.example.com/login', true);
  assert.equal(await isLoggedIn(page), false);
});

test('not logged in when a password field is visible on the students page', async () => {
  const page = stubPage('https://cloud.timeedit.net/my_um/web/students/', true);
  assert.equal(await isLoggedIn(page), false);
});

test('bouncedToSso true when the page redirects to the SSO', async () => {
  const page = stubPageWithWaitForURL(true);
  assert.equal(await bouncedToSso(page, 5000), true);
});

test('bouncedToSso false when the page stays on the students page (already logged in)', async () => {
  const page = stubPageWithWaitForURL(false);
  assert.equal(await bouncedToSso(page, 5000), false);
});
