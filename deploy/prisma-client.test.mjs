import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const schema = readFileSync(new URL('../apps/api/prisma/schema.prisma', import.meta.url), 'utf8');
const databaseClient = readFileSync(new URL('../apps/api/src/db.ts', import.meta.url), 'utf8');
const apiPackage = readFileSync(new URL('../apps/api/package.json', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('Prisma Client uses a deterministic workspace path in clean container builds', () => {
  assert.match(schema, /output\s*=\s*"\.\.\/generated\/client"/u);
  assert.match(databaseClient, /from '\.\.\/generated\/client\/index\.js'/u);
  assert.match(apiPackage, /prisma generate --schema prisma\/schema\.prisma/u);
  assert.equal((dockerfile.match(/db:generate/gu) ?? []).length, 2);
});
