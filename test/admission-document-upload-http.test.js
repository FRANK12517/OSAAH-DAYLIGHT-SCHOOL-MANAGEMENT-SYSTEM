import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.js';
import { createAdmissionDocumentStorage } from '../src/admission-document-storage.js';

test('admission documents upload private bytes, reload metadata, and download only through an authorized route', async () => {
  const files = new Map();
  const storage = createAdmissionDocumentStorage({ provider: {
    async put(pathname, bytes, options) { assert.equal(options.access, 'private'); files.set(pathname, Buffer.from(bytes)); return { pathname }; },
    async get(pathname, options) { assert.equal(options.access, 'private'); return files.has(pathname) ? { statusCode: 200, stream: Readable.from(files.get(pathname)) } : null; },
    async delete(pathname) { files.delete(pathname); }
  } });
  const auth = createAuthService();
  const parent = auth.login({ username: 'parent@example.com', password: 'Parent123!', portal: 'parent' });
  const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school' });
  const server = createServer(createApp({ auth, admissionDocumentStorage: storage }));
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  function request(path, { token = parent.token, method = 'GET', body = null, headers = {} } = {}) {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ port, path, method, headers: { Authorization: `Bearer ${token}`, ...headers } }, (res) => {
        const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject); if (body) req.write(body); req.end();
    });
  }
  try {
    const created = await request('/api/admission-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentSurname: 'Sample', studentFirstName: 'Applicant', gender: 'Female', classAppliedFor: 'JHS 1', academicYear: '2026', admissionTerm: 'TERM_1' }) });
    assert.equal(created.status, 201);
    const application = JSON.parse(created.body);
    const path = `/api/admission-applications/${encodeURIComponent(application.applicationNumber)}`;
    const bytes = Buffer.from('%PDF-1.7 sample document');
    const uploaded = await request(`${path}/documents`, { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/pdf', 'X-Document-Type': 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'X-Original-Name': 'birth.pdf' } });
    assert.equal(uploaded.status, 201);
    const document = JSON.parse(uploaded.body);
    assert.equal(document.uploadStatus, 'UPLOADED');
    assert.equal(Object.hasOwn(document, 'storageKey'), false);
    const reloaded = await request(path);
    assert.equal(reloaded.status, 200);
    assert.equal(Object.hasOwn(JSON.parse(reloaded.body).documents[0], 'fileReference'), false);
    const listed = await request(`${path}/documents`);
    assert.equal(listed.status, 200);
    assert.equal(/storageKey|fileReference/.test(listed.body.toString()), false);
    const denied = await request(`${path}/documents/${document.id}/download`, { token: teacher.token });
    assert.equal(denied.status, 403);
    const downloaded = await request(`${path}/documents/${document.id}/download`);
    assert.equal(downloaded.status, 200);
    assert.equal(downloaded.headers['cache-control'], 'private, no-store');
    assert.deepEqual(downloaded.body, bytes);
    const invalid = await request(`${path}/documents`, { method: 'POST', body: Buffer.from('<html>'), headers: { 'Content-Type': 'application/pdf', 'X-Document-Type': 'NHIS_CARD' } });
    assert.equal(invalid.status, 400);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
