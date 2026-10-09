import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdmissionDocumentStorage, createVercelPrivateBlobProvider } from '../src/admission-document-storage.js';

function memoryProvider() {
  const files = new Map(), calls = [];
  return {
    files, calls,
    async put(pathname, body, options) { calls.push(['put', pathname, options]); files.set(pathname, Buffer.from(body)); return { pathname }; },
    async get(pathname, options) { calls.push(['get', pathname, options]); return files.has(pathname) ? { statusCode: 200, stream: files.get(pathname) } : null; },
    async delete(pathname) { calls.push(['delete', pathname]); files.delete(pathname); }
  };
}

test('admission document storage saves actual bytes privately with scoped opaque keys', async () => {
  const provider = memoryProvider();
  const storage = createAdmissionDocumentStorage({ provider, idFactory: () => 'opaque-id' });
  const uploaded = await storage.upload({ bytes: Buffer.from('%PDF-1.7 bytes'), mimeType: 'application/pdf', documentType: 'BIRTH_CERTIFICATE_OR_GHANA_CARD', schoolId: 'school-1', applicationId: 'application-1', originalName: '../birth\ncard.pdf' });
  assert.equal(uploaded.storageKey, 'school-1/admissions/application-1/birth_certificate_or_ghana_card/opaque-id.pdf');
  assert.equal(uploaded.originalName, 'birthcard.pdf');
  assert.deepEqual(provider.calls[0][2], { access: 'private', contentType: 'application/pdf' });
  assert.deepEqual(provider.files.get(uploaded.storageKey), Buffer.from('%PDF-1.7 bytes'));
  const result = await storage.download(uploaded.storageKey);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(provider.calls[1][2], { access: 'private' });
  assert.equal(await storage.download('../private.pdf'), null);
});

test('admission document storage validates type, size, and canonical school/application scope', async () => {
  const storage = createAdmissionDocumentStorage({ provider: memoryProvider(), maxBytes: 4 });
  const base = { bytes: Buffer.from('data'), mimeType: 'application/pdf', documentType: 'NHIS_CARD', schoolId: 'school-1', applicationId: 'application-1' };
  await assert.rejects(storage.upload({ ...base, mimeType: 'text/html' }), /PDF, JPEG, or PNG/);
  await assert.rejects(storage.upload({ ...base, bytes: Buffer.alloc(5) }), /may not exceed|between 1 byte/);
  await assert.rejects(storage.upload({ ...base, documentType: 'UNKNOWN' }), /Unsupported/);
  const scopedStorage = createAdmissionDocumentStorage({ provider: memoryProvider() });
  await assert.rejects(scopedStorage.upload({ ...base, bytes: Buffer.from('%PDF-1.7'), schoolId: '../other' }), /scope/);
});

test('document replacement writes new bytes before removing the prior private object', async () => {
  const provider = memoryProvider();
  const storage = createAdmissionDocumentStorage({ provider, idFactory: (() => { let id = 0; return () => `file-${++id}`; })() });
  const base = { bytes: Buffer.from([0xff, 0xd8, 0xff, 0x01]), mimeType: 'image/jpeg', documentType: 'PASSPORT_PHOTOGRAPHS', schoolId: 'school-1', applicationId: 'application-2' };
  const first = await storage.upload(base);
  const replacement = await storage.replace({ ...base, bytes: Buffer.from([0xff, 0xd8, 0xff, 0x02]), previousKey: first.storageKey });
  assert.notEqual(replacement.storageKey, first.storageKey);
  assert.equal(provider.files.has(first.storageKey), false);
  assert.deepEqual(provider.files.get(replacement.storageKey), Buffer.from([0xff, 0xd8, 0xff, 0x02]));
  assert.deepEqual(provider.calls.slice(-2).map((call) => call[0]), ['put', 'delete']);
});

test('Vercel Blob adapter always requests private access for put and get', async () => {
  const calls = [];
  const provider = createVercelPrivateBlobProvider({
    put: async (...args) => { calls.push(['put', ...args]); return { pathname: args[0] }; },
    get: async (...args) => { calls.push(['get', ...args]); return null; },
    del: async (key) => calls.push(['del', key])
  });
  await provider.put('private/key.pdf', Buffer.from('pdf'), { access: 'public' });
  await provider.get('private/key.pdf', { access: 'public' });
  assert.equal(calls[0][3].access, 'private');
  assert.deepEqual(calls[1][2], { access: 'private', useCache: false });
});
