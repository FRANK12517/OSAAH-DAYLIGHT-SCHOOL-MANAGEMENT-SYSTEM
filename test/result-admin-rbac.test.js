import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('result publishers receive scoped publication grants and school admins can manage access blocks', async () => {
  const [migration, auth, server, durableAcademic, blocking, fallback, html, client] = await Promise.all([
    readFile(new URL('../schema/091_result_publication_rbac.sql', import.meta.url), 'utf8'),
    readFile(new URL('../src/auth.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/server.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/durable-academic.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/durable-result-blocking.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/academic-results.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/results.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/result-view.js', import.meta.url), 'utf8')
  ]);
  assert.match(migration, /results\.publish/);
  for (const role of ['SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER']) assert.match(migration, new RegExp(role));
  assert.match(auth, /SCHOOL_ADMIN: \['results\.read', 'results\.generate', 'results\.publish'\]/);
  assert.match(auth, /results\.generate', 'results\.publish', 'results\.print'/);
  assert.match(server, /pathname === '\/api\/academic\/results\/publish'.*canAccess\(user, 'results\.publish'\)/);
  assert.match(server, /'TEACHER', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'/);
  assert.match(server, /'PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER'/);
  assert.match(durableAcademic, /assignedClassIds[\s\S]*has\(String\(classId\)\)/);
  assert.match(blocking, /BLOCK_ROLES = new Set\(\['TEACHER', 'SCHOOL_ADMIN'/);
  assert.match(fallback, /'TEACHER', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'/);
  assert.match(html, /pointer-events:auto/);
  assert.match(html, /onclick="window\.handlePublishResultClick\(\)"/);
  assert.match(client, /window\.handlePublishResultClick = async function\(\)/);
});
