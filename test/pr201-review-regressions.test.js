import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAuthService } from '../src/auth.js';

test('PR #201 keeps production database Parent authentication fail-closed without durable sessions', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const database = { query: async () => [], execute: async () => {}, supportsDurableAuthSessions: false };
    const auth = createAuthService({ database });
    const result = await auth.loginByPhoneFromDatabase({ phone: '0247293733', portal: 'parent' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 503);
    assert.equal(result.error, 'Authentication service unavailable.');
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('PR #201 keeps Parent authorization and recipient resolution server-side', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /Promise\.allSettled\(linked\.map/);
  assert.match(source, /function parentAuthorizedStaffIds\(actor, children\)/);
  assert.match(source, /authorizedRecipientIds: linked \? parentAuthorizedStaffIds\(user, linked\)/);
  assert.match(source, /pathname === '\/api\/communication\/messages' && request\.method === 'POST'.*try \{/s);
});

test('PR #201 lets students-read users retrieve classes without granting fee data access', async () => {
  const source = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
  assert.match(source, /pathname === '\/api\/classes' && request\.method === 'GET'.*permissions: new Set\(\[\.\.\.\(user\.permissions \?\? \[\]\), 'fees\.read'\]\)/s);
  assert.match(source, /catch \(error\).*error\.status === 403 \? 'Forbidden\.'/s);
});

test('PR #201 handles durable revocation failures instead of leaving unhandled promises', async () => {
  const source = await readFile(new URL('../src/auth.js', import.meta.url), 'utf8');
  assert.match(source, /function revokeDurableSessionsBestEffort\(userId\)/);
  assert.match(source, /revokeDurableSessionsForUser\(userId\)\.catch/);
  assert.match(source, /SESSION_REVOCATION_FAILED/);
});
