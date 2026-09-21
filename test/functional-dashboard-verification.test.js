import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createApp } from '../src/server.mjs';
import { createAuthService } from '../src/auth.js';

async function http(server, path, token) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const request = fetch(`http://127.0.0.1:${address.port}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    request.then(async (response) => resolve({ status: response.status, body: await response.text() })).catch(reject);
  });
}

test('Class Database exposes canonical year and class controls and complete identity fields', async () => {
  const page = await readFile(new URL('../public/class-database.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/class-database.js', import.meta.url), 'utf8');
  assert.match(page, /name="academicYear"[^>]*id="academicYear"/);
  assert.match(page, /name="classId"[^>]*id="classId"/);
  for (const field of ['Permanent Student ID', 'Name of Student', 'Gender', 'Name of Parent/Guardian', 'Registered Parent Phone Number', 'Class', 'Academic Year']) assert.match(page, new RegExp(field));
  assert.match(script, /api\('\/api\/class-database\?'/);
  assert.match(script, /item\.permanentStudentId/);
  assert.match(script, /item\.academicYear/);
});

test('Class Database options use database academic years and canonical classes', async () => {
  const auth = createAuthService();
  const login = auth.login({ username: 'bursar@osaah.edu.gh', password: 'Bursar123!', portal: 'school' });
  const database = { query: async (sql) => {
    if (sql.includes('FROM academic_years')) return [{ id: 'y-2024', name: '2024/2025' }, { id: 'y-2026', name: '2026/2027' }];
    if (sql.includes('FROM terms')) return [];
    if (sql.includes('FROM fee_structures')) return [];
    if (sql.includes('FROM classes c')) return [];
    return [];
  } };
  const server = createServer(createApp({ auth, database, aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const result = await http(server, '/api/class-database/options', login.token);
    assert.equal(result.status, 200);
    const body = JSON.parse(result.body);
    assert.deepEqual(body.academicYears, ['2024/2025', '2026/2027']);
    assert.equal(body.classes.length, 13);
    assert.deepEqual(body.classes, ['Nursery 1', 'Nursery 2', 'KG1', 'KG2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3']);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('collection forms use canonical option selectors and never expose raw Class ID inputs', async () => {
  const page = await readFile(new URL('../public/collections.html', import.meta.url), 'utf8');
  assert.match(page, /id="academicYearId"/);
  assert.match(page, /id="termId"/);
  assert.match(page, /id="classId"/);
  assert.doesNotMatch(page, /<label>Class ID<input/);
  assert.match(page, /api\/fee-setup\/options/);
  assert.match(page, /api\/fees\/collections/);
});

test('Class Database remains authenticated and rejects public access', async () => {
  const server = createServer(createApp({ aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const response = await http(server, '/api/class-database/options');
    assert.equal(response.status, 401);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
