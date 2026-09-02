import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { notify } from '../lib/notify.mjs';

test('notify POSTs JSON to the webhook', async () => {
  const seen = await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => { res.end('ok'); server.close(); resolve({ url: req.url, type: req.headers['content-type'], body: JSON.parse(body) }); });
    });
    server.listen(0, async () => {
      const { port } = server.address();
      await notify('hello world', { webhookUrl: `http://127.0.0.1:${port}/hook` });
    });
  });
  assert.equal(seen.url, '/hook');
  assert.equal(seen.type, 'application/json');
  assert.match(seen.body.text, /hello world/);
});
