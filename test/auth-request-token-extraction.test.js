import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

function request(server, path, headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path, headers }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

test('auth routes preserve full cookie values and accept case-insensitive bearer schemes', async () => {
  const auth = createAuthService({ sessionSecret: 'test-only-session-secret-with-at-least-32-characters' });
  const receivedTokens = [];
  auth.authenticateAsync = async (token) => { receivedTokens.push(token); return null; };
  const server = createServer(createApp({ auth, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const cookieStatus = await request(server, '/api/auth/session', { Cookie: 'other=value; osaah_session=token=with=padding' });
    assert.equal(cookieStatus, 401);
    assert.equal(receivedTokens[0], 'token=with=padding');

    const bearerStatus = await request(server, '/api/auth/session', { Authorization: 'bearer test-bearer-token' });
    assert.equal(bearerStatus, 401);
    assert.equal(receivedTokens[1], 'test-bearer-token');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
