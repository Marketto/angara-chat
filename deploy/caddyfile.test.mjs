import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';

const caddyfileUrl = new URL('./Caddyfile', import.meta.url);
const deployScriptUrl = new URL('./deploy.sh', import.meta.url);

test('production edge permits only same-origin geolocation', async () => {
  const caddyfile = await readFile(caddyfileUrl, 'utf8');

  assert.match(
    caddyfile,
    /Permissions-Policy "camera=\(\), microphone=\(\), geolocation=\(self\)"/u,
  );
});

test('production edge limits request bodies to the API attachment maximum', async () => {
  const caddyfile = await readFile(caddyfileUrl, 'utf8');

  // Caddy's request_body limit applies to body bytes, not request headers.
  // Keep this exact value aligned with MAX_ATTACHMENT_BYTES in both apps.
  assert.match(caddyfile, /request_body\s*\{\s*max_size 8388608\s*\}/su);
});

test('deployment remounts the current Caddyfile after archive extraction', async () => {
  const deployScript = await readFile(deployScriptUrl, 'utf8');

  assert.match(
    deployScript,
    /docker compose up -d --force-recreate --no-deps caddy/u,
  );
});
