import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp } from '../src/server.mjs';

function request(port, token) {
  return fetch(`http://127.0.0.1:${port}/api/subjects`, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

test('createApp scopes Subjects to the resolved school and still rejects another tenant', async () => {
  const schoolId = 'sch_default_01';
  const proprietor = {
    id: 'qa-proprietor',
    roleKey: 'PROPRIETOR',
    portal: 'school',
    schoolId,
    permissions: new Set(['subjects.read', 'academics.read'])
  };
  const actors = new Map([
    ['valid-proprietor', proprietor],
    ['other-tenant-proprietor', { ...proprietor, id: 'other-tenant-proprietor', schoolId: 'sch_other_02' }]
  ]);
  const auth = { authenticateAsync: async (token) => actors.get(token) ?? null };
  const previousSchoolId = process.env.OSAAH_SCHOOL_ID;
  process.env.OSAAH_SCHOOL_ID = schoolId;
  let app;
  try {
    app = createApp({ auth });
  } finally {
    if (previousSchoolId === undefined) delete process.env.OSAAH_SCHOOL_ID;
    else process.env.OSAAH_SCHOOL_ID = previousSchoolId;
  }

  const server = http.createServer((incoming, outgoing) => {
    Promise.resolve(app(incoming, outgoing)).catch((error) => {
      const status = error.message === 'Forbidden.' ? 403 : 500;
      outgoing.writeHead(status, { 'Content-Type': 'application/json' });
      outgoing.end(JSON.stringify({ error: error.message }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server.address().port, 'valid-proprietor');
    assert.equal(response.status, 200, 'authorized request for the resolved tenant must succeed');
    const body = await response.json();
    assert.ok(Array.isArray(body.subjects), 'successful response must contain the Subjects result');
    assert.ok(body.subjects.every((subject) => subject.schoolId === schoolId), 'returned subjects must belong to the resolved tenant');

    const crossTenantResponse = await request(server.address().port, 'other-tenant-proprietor');
    assert.equal(crossTenantResponse.status, 403, 'a request from another tenant must remain forbidden');
    assert.deepEqual(await crossTenantResponse.json(), { error: 'Forbidden.' });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
