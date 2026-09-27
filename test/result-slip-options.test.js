import test from 'node:test';
import assert from 'node:assert/strict';
// Node 22+ supplies SQLite; the application and frontend tests still support Node 20.
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
const sqlTest = (name, fn) => test(name, { skip: !DatabaseSync && 'SQL integration requires Node 22+ (node:sqlite)' }, fn);
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import http from 'node:http';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { createApp } from '../src/server.mjs';

const schoolId = 'sch_default_01';
const actor = { id: 'result-reader', schoolId, portal: 'school', roleKey: 'HEADTEACHER', permissions: new Set(['results.read']) };
const names = ['Nursery', 'KG 1', 'KG 2', ...Array.from({ length: 6 }, (_, i) => `Basic ${i + 1}`), 'JHS 1', 'JHS 2', 'JHS 3'];
function fixture(legacy = false) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE academic_years(id TEXT,school_id TEXT,name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE terms(id TEXT,academic_year_id TEXT,name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE levels(id TEXT,school_id TEXT,name TEXT,display_order INTEGER);
    CREATE TABLE classes(id TEXT,${legacy ? 'level_id TEXT,display_order INTEGER' : 'school_id TEXT,level TEXT,department_id TEXT,created_at TEXT'},name TEXT);
    INSERT INTO academic_years VALUES('year-a','${schoolId}','2026/2027','2026-09-01','2027-07-01',1),('year-b','other-school','2027/2028','','',1);
    INSERT INTO terms VALUES('term-a','year-a','First Term','','',1),('term-b','year-b','Other Term','','',1);
    INSERT INTO levels VALUES('level-a','${schoolId}','PRIMARY',1),('level-b','other-school','PRIMARY',1);`);
  for (let i = 0; i < names.length; i++) db.prepare(legacy ? 'INSERT INTO classes(id,level_id,display_order,name) VALUES(?,?,?,?)' : 'INSERT INTO classes(id,school_id,level,name) VALUES(?,?,?,?)').run(`canonical-${i}`, legacy ? 'level-a' : schoolId, legacy ? i : 'PRIMARY', names[i]);
  db.prepare(legacy ? 'INSERT INTO classes(id,level_id,name) VALUES(?,?,?)' : 'INSERT INTO classes(id,school_id,name) VALUES(?,?,?)').run('foreign-class', legacy ? 'level-b' : 'other-school', 'JHS 3');
  const calls = [];
  const database = { async query(sql, params = []) { calls.push({ sql, params }); try { return db.prepare(sql).all(...params); } catch (error) { if (/no such column/.test(error.message)) error.code = 'ER_BAD_FIELD_ERROR'; throw error; } }, async execute() { throw Error('Options must never write'); } };
  return { db, database, calls };
}

sqlTest('reproduces the old options SQL failure against the recorded production class schema', () => {
  const { db } = fixture();
  assert.throws(() => db.prepare('SELECT c.id,c.name,COALESCE(c.sort_order,c.display_order,0) AS displayOrder,l.name AS levelName FROM classes c JOIN levels l ON l.id=c.level_id WHERE l.school_id=? AND COALESCE(c.status,"ACTIVE")="ACTIVE" ORDER BY displayOrder,c.id'), /no such column/);
  db.close();
});
for (const legacy of [false, true]) sqlTest(`options execute against ${legacy ? 'legacy' : 'production'} schema, preserve IDs, isolate school`, async () => {
  const { db, database } = fixture(legacy);
  try {
    const service = createDurableAcademicService({ database, schoolId });
    const data = await service.options(actor);
    assert.equal(data.classes.length, 12);
    assert.deepEqual(new Set(data.classes.map(c => c.id)), new Set(names.map((_, i) => `canonical-${i}`)));
    assert.deepEqual(data.academicYears.map(y => y.id), ['year-a']);
    assert.deepEqual(data.terms.map(t => t.id), ['term-a']);
    await assert.rejects(service.options({ ...actor, schoolId: 'other-school' }), /Forbidden/);
    await assert.rejects(service.options({ ...actor, permissions: new Set() }), /Forbidden/);
    assert.deepEqual((await service.options({ ...actor, roleKey: 'TEACHER', assignedClassIds: ['canonical-2'] })).classes.map(c => c.id), ['canonical-2']);
  } finally { db.close(); }
});

sqlTest('academic options HTTP endpoint returns 200 and retains 401/403 and tenant checks', async () => {
  const { db, database, calls } = fixture();
  const auth = { authenticateAsync: async token => token === 'allowed' ? actor : token === 'denied' ? { ...actor, permissions: new Set() } : token === 'foreign' ? { ...actor, schoolId: 'other-school' } : null };
  const app = createApp({ auth, database });
  const server = http.createServer((req, res) => { Promise.resolve(app(req, res)).catch(error => { res.writeHead(500); res.end(error.message); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/academic/options?schoolId=other-school`;
    const response = await fetch(url, { headers: { Authorization: 'Bearer allowed' } });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).classes.length, 12);
    const before = calls.length;
    for (const [token, code] of [['missing', 401], ['denied', 403], ['foreign', 403]]) assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token}` } })).status, code);
    assert.equal(calls.length, before, 'unauthorized calls must not query data');
  } finally { await new Promise(resolve => server.close(resolve)); db.close(); }
});

test('database failures are propagated without permissive fallback', async () => {
  let count = 0;
  const service = createDurableAcademicService({ schoolId, database: { async query(sql) { if (sql.includes('classes')) { count++; throw Object.assign(Error('Database unavailable'), { code: 'ECONNREFUSED' }); } return []; }, execute() {} } });
  await assert.rejects(service.options(actor), /Database unavailable/);
  assert.equal(count, 1);
});

function element(initialValue = '') {
  return { value: initialValue, disabled: false, hidden: false, textContent: '', handlers: {}, _html: '', addEventListener(name, fn) { this.handlers[name] = fn; }, set innerHTML(html) { this._html = html; this.value = /<option value="([^"]*)"/.exec(html)?.[1] ?? ''; }, get innerHTML() { return this._html; } };
}
async function browser(payload, mode = 'ok') {
  const fields = { classId: element(), studentId: element(), permanentStudentId: element(), academicYear: element('2026/2027'), term: element('First Term'), sampleMode: { ...element(), checked: false } };
  const button = element(), status = element(), retry = element(), retryStudents = element(), years = element(), host = element();
  const form = { ...element(), elements: fields, querySelector: () => button };
  const requests = [];
  const context = vm.createContext({ document: { querySelector: selector => ({ '#result-context': form, '#status': status, '#result': host, '#retry-options': retry, '#retry-students': retryStudents, '#result-academic-years': years })[selector] }, AbortController, clearTimeout, setTimeout: mode === 'timeout' ? (fn) => setTimeout(fn, 1) : setTimeout, URLSearchParams, FormData: class { constructor() { return Object.entries(fields).filter(([key]) => key !== 'sampleMode').map(([key, field]) => [key, field.value]); } }, fetch: async (url, init) => { requests.push({ url, init }); if (mode === 'timeout') return new Promise(() => {}); return { ok: mode !== 'failure', json: async () => mode === 'failure' ? { error: 'Unable to load academic options. Please try again.' } : url.includes('/options') ? structuredClone(payload) : url.includes('/result-students?') ? { students: payload.students ?? [] } : { result: {} } }; } });
  vm.runInContext(readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8'), context);
  await new Promise(resolve => setTimeout(resolve, 20));
  return { context, fields, button, status, retry, form, requests };
}

test('Result Slip shows all 12 labels with canonical values, is single select and submits the selected ID', async () => {
  const classes = names.map((name, i) => ({ id: `canonical-${i}`, name }));
  const view = await browser({ classes, students: [{ id: 'student-a', name: 'Test student', permanentStudentId: 'OSAAH/2026/0001', classId: 'canonical-4' }] });
  assert.deepEqual([...view.fields.classId.innerHTML.matchAll(/<option value="canonical-\d+">([^<]+)<\/option>/g)].map(m => m[1]), names);
  const html = readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  assert.match(html, /<select name="classId" required disabled>/);
  assert.doesNotMatch(html, /<select name="classId"[^>]*multiple/);
  view.fields.classId.value = 'canonical-4';
  await view.fields.classId.handlers.change();
  view.fields.studentId.value = 'student-a';
  view.fields.studentId.handlers.change();
  assert.equal(view.fields.studentId.value, 'student-a');
  assert.equal(view.button.disabled, false);
  vm.runInContext('render = () => {}', view.context);
  await view.form.handlers.submit({ preventDefault() {} });
  assert.equal(new URL(view.requests.at(-1).url, 'http://local').searchParams.get('classId'), 'canonical-4');
});

test('missing optional students leaves classes and periods usable without a parsing exception', async () => {
  const view = await browser({ classes: names.map((name, i) => ({ id: `canonical-${i}`, name })), academicYears: [{ id: 'year-a', name: '2026/2027', isCurrent: 1 }], terms: [{ id: 'term-a', academicYearId: 'year-a', name: 'First Term', isCurrent: 1 }] });
  assert.equal(view.fields.classId.disabled, false);
  assert.equal(view.fields.term.value, 'First Term');
  assert.equal(view.button.disabled, true);
  assert.match(view.status.textContent, /Choose a class to load students/);
});

test('legacy string options retain backend IDs and requested display labels', async () => {
  const legacy = ['Nursery 1', 'Nursery 2', 'KG1', 'KG2', ...Array.from({ length: 6 }, (_, i) => `Primary ${i + 1}`), 'JHS 1', 'JHS 2', 'JHS 3'];
  const view = await browser({ classes: legacy, students: [] });
  assert.match(view.fields.classId.innerHTML, /value="Primary 1">Basic 1/);
  assert.match(view.fields.classId.innerHTML, /value="Nursery 1">Nursery/);
  assert.equal([...view.fields.classId.innerHTML.matchAll(/<option/g)].length, 13, '12 classes plus placeholder');
  assert.equal(view.fields.academicYear.value, '2026/2027');
  assert.equal(view.fields.term.value, 'First Term');
});
for (const mode of ['failure', 'timeout']) test(`options ${mode} ends loading with a retry and safe disabled controls`, async () => {
  const view = await browser({}, mode);
  assert.match(view.fields.classId.innerHTML, /Classes unavailable/);
  assert.equal(view.fields.classId.disabled, true);
  assert.equal(view.retry.hidden, false);
  assert.equal(view.button.disabled, true);
  assert.doesNotMatch(view.status.textContent, /Loading/);
});

test('empty and malformed options show explicit states', async () => {
  const empty = await browser({ classes: [], students: [] });
  assert.match(empty.fields.classId.innerHTML, /No classes configured/);
  const invalid = await browser({ classes: {} });
  assert.match(invalid.status.textContent, /Invalid academic options/);
  assert.equal(invalid.retry.hidden, false);
});

test('extended class schema honors inactive records without requiring extension columns', async () => {
  let sql;
  const service = createDurableAcademicService({ schoolId, database: { async query(query) { if (!query.includes('classes')) return []; sql = query; return [{ id: 'active', name: 'Basic 1', school_id: schoolId, status: 'ACTIVE', sort_order: 4 }, { id: 'inactive', name: 'Basic 2', school_id: schoolId, status: 'INACTIVE' }, { id: 'foreign', name: 'Basic 3', school_id: 'other-school' }]; }, execute() { throw Error('No writes'); } } });
  assert.deepEqual((await service.options(actor)).classes.map(c => c.id), ['active']);
  assert.doesNotMatch(sql, /level_id|sort_order|display_order|status/);
});

test('retry recovers the dropdown after a failed request', async () => {
  const view = await browser({}, 'failure');
  view.context.fetch = async () => ({ ok: true, json: async () => ({ classes: names.map((name, i) => ({ id: `canonical-${i}`, name })), students: [] }) });
  await view.retry.handlers.click();
  assert.equal(view.retry.hidden, true);
  assert.equal(view.fields.classId.disabled, false);
  assert.match(view.fields.classId.innerHTML, /value="canonical-11">JHS 3/);
});
