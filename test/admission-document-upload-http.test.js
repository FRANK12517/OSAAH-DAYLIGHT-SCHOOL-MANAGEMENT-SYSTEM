import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/server.mjs';

test('legacy admission document uploads are retired with JSON guidance to unified registration', async (t) => {
  const auth = { authenticateAsync: async () => ({ id: 'parent-1', roleKey: 'PARENT', portal: 'parent', schoolId: 'school-osaah-daylight', permissions: new Set() }) };
  const server = createServer(createApp({ auth }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections?.(); }));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/admission-applications/APP-OLD/documents`, { method: 'POST', headers: { 'Content-Type': 'application/pdf' }, body: '%PDF test' });
  assert.equal(response.status, 410);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  const result = await response.json();
  assert.equal(result.code, 'LEGACY_ADMISSION_WORKFLOW_RETIRED');
  assert.equal(result.registrationUrl, '/admissions/register');
});
