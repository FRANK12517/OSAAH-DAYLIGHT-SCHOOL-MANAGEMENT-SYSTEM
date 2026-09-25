import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import vm from 'node:vm';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { createApp } from '../src/server.mjs';
import { isPermanentStudentId } from '../src/permanent-student-id.js';
const { DatabaseSync } = await import('node:sqlite').catch(() => ({}));
const sqlTest = (name, fn) => test(name, { skip: !DatabaseSync && 'SQL integration requires Node 22+ (node:sqlite)' }, fn);
const schoolId = 'sch_default_01';
const actor = { id: 'head', schoolId, portal: 'school', roleKey: 'HEADTEACHER', permissions: new Set(['results.read']) };
const context = { classId: 'class-a', academicYear: '2026/2027', term: 'First Term' };
function fixture(legacy = false) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE classes(id TEXT PRIMARY KEY,name TEXT,${legacy ? 'level_id TEXT,display_order INTEGER' : 'school_id TEXT,level TEXT,department_id TEXT,created_at TEXT'});
    CREATE TABLE levels(id TEXT,school_id TEXT,name TEXT,display_order INTEGER);
    CREATE TABLE academic_years(id TEXT PRIMARY KEY,school_id TEXT,name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE terms(id TEXT PRIMARY KEY,academic_year_id TEXT,name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE students(id TEXT PRIMARY KEY,school_id TEXT,permanent_student_id TEXT,first_name TEXT,middle_name TEXT,last_name TEXT,is_test_record INTEGER,current_class_id TEXT);
    CREATE TABLE student_enrollments(id TEXT PRIMARY KEY,student_id TEXT,class_id TEXT,academic_year_id TEXT${legacy ? ',term_id TEXT,school_id TEXT' : ''});
    CREATE TABLE student_id_sequences(admission_year INTEGER,next_sequence INTEGER);
    INSERT INTO student_id_sequences VALUES(2026,126);
    INSERT INTO levels VALUES('level-a','${schoolId}','PRIMARY',1),('level-x','other-school','PRIMARY',1);
    INSERT INTO academic_years VALUES('year-a','${schoolId}','2026/2027','','',1),('year-b','${schoolId}','2025/2026','','',0),('year-x','other-school','2026/2027','','',1);
    INSERT INTO terms VALUES('term-a','year-a','First Term','','',1),('term-b','year-a','Second Term','','',0),('term-old','year-b','First Term','','',0),('term-x','year-x','Foreign Term','','',0);
    INSERT INTO students VALUES('durable-a','${schoolId}','OSAAH/2026/0001','Ama','Akua','Mensah',0,'class-b'),('durable-b','${schoolId}','OSAAH/2026/0002','Kojo',NULL,'Boateng',0,'class-b'),('durable-old','${schoolId}','OSAAH/2025/0015','Old',NULL,'Student',0,'class-a'),('durable-x','other-school','OSAAH/2026/0125','Foreign',NULL,'Student',0,'class-x');
    INSERT INTO student_enrollments(id,student_id,class_id,academic_year_id) VALUES('e1','durable-a','class-a','year-a'),('e2','durable-b','class-b','year-a'),('e3','durable-old','class-a','year-b'),('e4','durable-x','class-x','year-x'),('duplicate','durable-a','class-a','year-a'),('corrupt-foreign-student','durable-x','class-a','year-a'),('corrupt-foreign-year','durable-a','class-a','year-x');`);
  for (const [id, name, school] of [['class-a', 'Basic 1', schoolId], ['class-b', 'Basic 4', schoolId], ['class-empty', 'JHS 1', schoolId], ['class-x', 'Basic 1', 'other-school']]) db.prepare(legacy ? 'INSERT INTO classes(id,name,level_id,display_order) VALUES(?,?,?,0)' : 'INSERT INTO classes(id,name,school_id) VALUES(?,?,?)').run(id, name, legacy ? school === schoolId ? 'level-a' : 'level-x' : school);
  const calls = [];
  const database = { async query(sql, params = []) { calls.push({ sql, params }); try { return db.prepare(sql).all(...params); } catch (error) { if (/no such column/.test(error.message)) error.code = 'ER_BAD_FIELD_ERROR'; throw error; } }, execute() { throw Error('Student lookup must never write'); } };
  return { db, database, calls, service: createDurableAcademicService({ database, schoolId }) };
}

sqlTest('durable membership returns stored student name and Permanent Student ID in a minimal DTO', async () => {
  const { db, service } = fixture();
  try {
    const students = await service.resultStudents(context, actor);
    assert.deepEqual(students, [{ id: 'durable-a', permanentStudentId: 'OSAAH/2026/0001', name: 'Ama Akua Mensah', classId: 'class-a', academicYearId: 'year-a', isTestRecord: false }]);
    assert.equal(isPermanentStudentId(students[0].permanentStudentId), true);
  } finally { db.close(); }
});

sqlTest('canonical class and year determine membership, not current class or a name match', async () => {
  const { db, service } = fixture();
  try {
    assert.deepEqual((await service.resultStudents(context, actor)).map(s => s.id), ['durable-a']);
    assert.deepEqual((await service.resultStudents({ ...context, classId: 'class-b' }, actor)).map(s => s.id), ['durable-b']);
    assert.deepEqual((await service.resultStudents({ ...context, academicYear: 'year-b' }, actor)).map(s => s.id), ['durable-old']);
    assert.deepEqual(await service.resultStudents({ ...context, classId: 'class-empty' }, actor), []);
  } finally { db.close(); }
});

sqlTest('year-based production memberships are identical across valid terms; foreign periods are rejected', async () => {
  const { db, service } = fixture();
  try {
    assert.deepEqual(await service.resultStudents(context, actor), await service.resultStudents({ ...context, term: 'Second Term' }, actor));
    for (const bad of [{ term: 'term-x' }, { academicYear: 'year-x' }, { academicYear: '' }, { term: '' }, { classId: '' }]) await assert.rejects(service.resultStudents({ ...context, ...bad }, actor));
  } finally { db.close(); }
});

sqlTest('legacy term-specific membership honors term_id and retains year-wide rows', async () => {
  const { db, service } = fixture(true);
  try {
    db.exec("UPDATE student_enrollments SET term_id='term-a' WHERE id IN ('e1','duplicate'); INSERT INTO student_enrollments VALUES('legacy-second','durable-b','class-a','year-a','term-b',NULL)");
    assert.deepEqual((await service.resultStudents(context, actor)).map(s => s.id), ['durable-a']);
    assert.deepEqual((await service.resultStudents({ ...context, term: 'term-b' }, actor)).map(s => s.id), ['durable-b']);
    db.exec("INSERT INTO student_enrollments VALUES('legacy-yearwide','durable-old','class-a','year-a',NULL,NULL),('legacy-wrong-school','durable-old','class-b','year-a',NULL,'other-school')");
    assert.deepEqual(new Set((await service.resultStudents(context, actor)).map(s => s.id)), new Set(['durable-a', 'durable-old']));
    assert.deepEqual((await service.resultStudents({ ...context, classId: 'class-b' }, actor)).map(s => s.id), ['durable-b']);
  } finally { db.close(); }
});

sqlTest('Permanent Student IDs and allocation sequences are never rewritten or manufactured', async () => {
  const { db, service, calls } = fixture();
  try {
    db.exec("INSERT INTO students VALUES('no-permanent-id','sch_default_01',NULL,'Unassigned',NULL,'Identity',0,'class-a'); INSERT INTO student_enrollments VALUES('no-id-enrollment','no-permanent-id','class-a','year-a')");
    const before = db.prepare('SELECT id,permanent_student_id FROM students ORDER BY id').all();
    const results = await service.resultStudents(context, actor);
    assert.equal(results.find(s => s.id === 'no-permanent-id').permanentStudentId, null);
    assert.deepEqual(db.prepare('SELECT id,permanent_student_id FROM students ORDER BY id').all(), before);
    assert.equal(db.prepare('SELECT next_sequence FROM student_id_sequences').get().next_sequence, 126);
    assert.ok(calls.every(call => call.sql.startsWith('SELECT')));
    assert.ok(calls.every(call => !call.sql.includes('student_id_sequences')));
  } finally { db.close(); }
});

sqlTest('server-side tenant and teacher scope cannot be overridden by request parameters', async () => {
  const { db, service } = fixture();
  try {
    await assert.rejects(service.resultStudents(context, { ...actor, schoolId: 'other-school' }), { status: 403 });
    await assert.rejects(service.resultStudents({ ...context, classId: 'class-x', schoolId: 'other-school' }, actor), { status: 403 });
    assert.deepEqual((await service.resultStudents({ ...context, schoolId: 'other-school', studentId: 'durable-x' }, actor)).map(s => s.id), ['durable-a']);
    const teacher = { ...actor, roleKey: 'TEACHER', assignedClassIds: ['class-a'] };
    assert.equal((await service.resultStudents(context, teacher)).length, 1);
    await assert.rejects(service.resultStudents({ ...context, classId: 'class-b' }, teacher), { status: 403 });
    // Preserve Part 1's behavior when the existing session has no configured assignment list.
    assert.equal((await service.resultStudents(context, { ...teacher, assignedClassIds: [] })).length, 1);
    await assert.rejects(service.resultStudents(context, { ...actor, permissions: new Set(['students.read']) }), { status: 403 });
  } finally { db.close(); }
});

async function withServer(database, fn) {
  const roles = ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'];
  const auth = { authenticateAsync: async token => roles.includes(token) ? { ...actor, roleKey: token, permissions: new Set(token === 'PROPRIETOR' ? ['*'] : ['results.read']), assignedClassIds: token === 'TEACHER' ? ['class-a'] : [] } : token === 'forbidden' ? { ...actor, permissions: new Set(['students.read']) } : token === 'other-school' ? { ...actor, schoolId: token } : null };
  const app = createApp({ auth, database });
  const server = http.createServer((req, res) => { Promise.resolve(app(req, res)).catch(error => { res.writeHead(500); res.end(error.message); }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { await fn(async (token, query = context) => fetch(`http://127.0.0.1:${server.address().port}/api/academic/result-students?${new URLSearchParams(query)}`, { headers: { Authorization: `Bearer ${token}` } })); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

sqlTest('student endpoint succeeds for existing authorized Result Slip roles and preserves 401/403', async () => {
  const { db, database } = fixture();
  try {
    await withServer(database, async request => {
      for (const role of ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER']) {
        const response = await request(role);
        assert.equal(response.status, 200, role);
        assert.equal((await response.json()).students[0].permanentStudentId, 'OSAAH/2026/0001');
      }
      for (const [token, code] of [['invalid', 401], ['forbidden', 403], ['other-school', 403]]) assert.equal((await request(token)).status, code);
      assert.equal((await request('HEADTEACHER', { ...context, classId: 'class-x' })).status, 403);
      assert.equal((await request('TEACHER', { ...context, classId: 'class-b' })).status, 403);
      assert.deepEqual(await (await request('HEADTEACHER', { ...context, classId: 'class-empty' })).json(), { students: [] });
    });
  } finally { db.close(); }
});

test('unavailable database returns 503 instead of falling back to in-memory students', async () => {
  await withServer(null, async request => {
    const response = await request('HEADTEACHER');
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Unable to load students. Please try again.' });
  });
});

test('backend failure returns a safe 500 without raw SQL or private information', async () => {
  await withServer({ async query() { throw Error('SQL failure with private database details'); }, execute() {} }, async request => {
    const response = await request('HEADTEACHER');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: 'Unable to load students. Please try again.' });
  });
});

const studentA = { id: 'durable-a', permanentStudentId: 'OSAAH/2026/0001', name: 'Ama Akua Mensah', classId: 'class-a', academicYearId: 'year-a', isTestRecord: false };
const studentB = { id: 'durable-b', permanentStudentId: 'OSAAH/2026/0002', name: 'Kojo Boateng', classId: 'class-b', academicYearId: 'year-a', isTestRecord: false };
const optionPayload = { classes: [{ id: 'class-a', name: 'Basic 1' }, { id: 'class-b', name: 'Basic 4' }, { id: 'class-empty', name: 'JHS 1' }], academicYears: [{ id: 'year-a', name: '2026/2027', isCurrent: 1 }, { id: 'year-b', name: '2025/2026', isCurrent: 0 }], terms: [{ id: 'term-a', academicYearId: 'year-a', name: 'First Term' }, { id: 'term-b', academicYearId: 'year-a', name: 'Second Term' }, { id: 'term-old', academicYearId: 'year-b', name: 'First Term' }], students: [{ id: 'in-memory-decoy', name: 'Must never appear', classId: 'class-a' }] };
const response = (students) => ({ ok: true, json: async () => ({ students }) });
const flush = () => new Promise(resolve => setImmediate(resolve));
function element(value = '') {
  return { value, disabled: false, hidden: false, textContent: '', handlers: {}, _html: '', addEventListener(name, fn) { this.handlers[name] = fn; }, set innerHTML(html) { this._html = html; this.value = /<option value="([^"]*)"/.exec(html)?.[1] ?? ''; }, get innerHTML() { return this._html; } };
}
async function browser(lookup = async url => response(url.searchParams.get('classId') === 'class-a' ? [studentA] : url.searchParams.get('classId') === 'class-b' ? [studentB] : [])) {
  const fields = { academicYear: element('2026/2027'), term: element('First Term'), classId: element(), studentId: element(), permanentStudentId: element(), sampleMode: { checked: false } };
  const button = element(), status = element(), host = element(), retry = element(), retryStudents = element(), years = element();
  host.querySelectorAll = () => [];
  const form = { ...element(), elements: fields, querySelector: () => button };
  const requests = [];
  const ctx = vm.createContext({ document: { querySelector: selector => ({ '#result-context': form, '#status': status, '#result': host, '#retry-options': retry, '#retry-students': retryStudents, '#result-academic-years': years })[selector] }, URLSearchParams, AbortController, setTimeout, clearTimeout, FormData: class { constructor() { return Object.entries(fields).filter(([name]) => name !== 'sampleMode').map(([name, el]) => [name, el.value]); } }, fetch: async (url, init) => {
    requests.push({ url, init });
    if (url === '/api/academic/options') return { ok: true, json: async () => structuredClone(optionPayload) };
    if (url.startsWith('/api/academic/result-students?')) return lookup(new URL(url, 'http://local'), init);
    return { ok: true, json: async () => ({ result: {} }) };
  } });
  vm.runInContext(readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8'), ctx);
  await flush();
  return { ctx, fields, button, status, host, retryStudents, form, requests, async chooseClass(value) { fields.classId.value = value; await fields.classId.handlers.change(); }, selectStudent(id) { fields.studentId.value = id; fields.studentId.handlers.change(); } };
}
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

 test('student single-select renders name and real Permanent Student ID, preserving both submitted identities', async () => {
  const page = await browser();
  await page.chooseClass('class-a');
  assert.match(page.fields.studentId.innerHTML, /value="durable-a">Ama Akua Mensah — OSAAH\/2026\/0001/);
  assert.doesNotMatch(page.fields.studentId.innerHTML, /in-memory-decoy/);
  assert.equal(page.fields.studentId.value, '', 'do not automatically select a student');
  assert.equal(page.button.disabled, true);
  page.selectStudent('durable-a');
  assert.equal(page.fields.permanentStudentId.value, 'OSAAH/2026/0001');
  assert.equal(page.button.disabled, false);
  vm.runInContext('render = () => {}', page.ctx);
  await page.form.handlers.submit({ preventDefault() {} });
  const submitted = new URL(page.requests.at(-1).url, 'http://local').searchParams;
  assert.equal(submitted.get('studentId'), 'durable-a');
  assert.equal(submitted.get('permanentStudentId'), 'OSAAH/2026/0001');
  const html = readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  assert.match(html, /<select name="studentId" required disabled>/);
  assert.doesNotMatch(html, /<select name="studentId"[^>]*multiple/);
});

for (const [field, value] of [['classId', 'class-b'], ['academicYear', '2025/2026'], ['term', 'Second Term']]) test(`changing ${field} immediately clears student, result, sample and assessment state`, async () => {
  const pending = deferred();
  let count = 0;
  const page = await browser(async () => ++count === 1 ? response([studentA]) : pending.promise);
  await page.chooseClass('class-a');
  page.selectStudent('durable-a');
  page.host.hidden = false;
  page.host.innerHTML = '<div data-assessment="conduct">Old GES assessment and result</div>';
  page.fields.sampleMode.checked = true;
  page.status.textContent = 'Old student validation';
  page.fields[field].value = value;
  const load = page.fields[field].handlers.change();
  assert.equal(page.fields.studentId.value, '');
  assert.equal(page.fields.permanentStudentId.value, '');
  assert.equal(page.fields.studentId.disabled, true);
  assert.doesNotMatch(page.fields.studentId.innerHTML, /Ama|durable-a/);
  assert.equal(page.host.innerHTML, '');
  assert.equal(page.host.hidden, true);
  assert.equal(page.fields.sampleMode.checked, false);
  assert.equal(page.status.textContent, 'Loading students...');
  assert.equal(page.button.disabled, true);
  const request = new URL(page.requests.at(-1).url, 'http://local').searchParams;
  assert.equal(request.get(field === 'classId' ? 'classId' : field), value);
  pending.resolve(response(field === 'classId' ? [studentB] : []));
  await load;
});

test('editing the year clears a selected student immediately before input blur', async () => {
  const page = await browser();
  await page.chooseClass('class-a'); page.selectStudent('durable-a');
  page.fields.academicYear.value = '202';
  await page.fields.academicYear.handlers.input();
  assert.equal(page.fields.studentId.value, '');
  assert.equal(page.button.disabled, true);
  assert.equal(page.fields.term.value, '');
});

test('late previous-class success cannot overwrite the current class response', async () => {
  const a = deferred(), b = deferred();
  const page = await browser(url => url.searchParams.get('classId') === 'class-a' ? a.promise : b.promise);
  const first = page.chooseClass('class-a');
  const oldSignal = page.requests.at(-1).init.signal;
  const second = page.chooseClass('class-b');
  assert.equal(oldSignal.aborted, true);
  b.resolve(response([studentB])); await second;
  a.resolve(response([studentA])); await first;
  assert.match(page.fields.studentId.innerHTML, /Kojo Boateng/);
  assert.doesNotMatch(page.fields.studentId.innerHTML, /Ama/);
});

test('late failure cannot replace a newer success with an error or retry control', async () => {
  const a = deferred();
  const page = await browser(url => url.searchParams.get('classId') === 'class-a' ? a.promise : response([studentB]));
  const first = page.chooseClass('class-a');
  await page.chooseClass('class-b');
  a.reject(Error('old failure')); await first;
  assert.match(page.fields.studentId.innerHTML, /Kojo/);
  assert.equal(page.retryStudents.hidden, true);
  assert.equal(page.status.textContent, '');
});

test('empty class gives an explicit disabled empty state', async () => {
  const page = await browser(); await page.chooseClass('class-empty');
  assert.match(page.fields.studentId.innerHTML, /No students found for the selected class\./);
  assert.equal(page.fields.studentId.disabled, true);
  assert.equal(page.button.disabled, true);
});

test('failed class load clears previous students and retry succeeds after recovery', async () => {
  let broken = false;
  const page = await browser(url => broken ? Promise.reject(Error('Backend unavailable')) : response(url.searchParams.get('classId') === 'class-a' ? [studentA] : [studentB]));
  await page.chooseClass('class-a'); page.selectStudent('durable-a');
  broken = true; await page.chooseClass('class-b');
  assert.equal(page.fields.studentId.value, '');
  assert.match(page.fields.studentId.innerHTML, /Unable to load students\. Please try again\./);
  assert.doesNotMatch(page.fields.studentId.innerHTML, /Ama/);
  assert.equal(page.retryStudents.hidden, false);
  broken = false; await page.retryStudents.handlers.click();
  assert.match(page.fields.studentId.innerHTML, /Kojo/);
  assert.equal(page.retryStudents.hidden, true);
  assert.equal(page.fields.studentId.value, '');
});

test('malformed or wrong-class response is rejected without displaying its students', async () => {
  for (const result of [null, [studentB]]) {
    const page = await browser(async () => response(result));
    await page.chooseClass('class-a');
    assert.match(page.status.textContent, /Unable to load students/);
    assert.equal(page.fields.studentId.disabled, true);
    assert.doesNotMatch(page.fields.studentId.innerHTML, /Kojo/);
  }
});

test('student names are escaped and missing Permanent Student IDs are not fabricated', async () => {
  const page = await browser(async () => response([{ ...studentA, name: '<img src=x onerror=alert(1)>', permanentStudentId: null }]));
  await page.chooseClass('class-a');
  assert.match(page.fields.studentId.innerHTML, /&lt;img/);
  assert.doesNotMatch(page.fields.studentId.innerHTML, /<img|OSAAH\//);
  page.selectStudent('durable-a');
  assert.equal(page.fields.permanentStudentId.value, '');
});

test('student lookup timeout ends loading and enables retry', async () => {
  const page = await browser(async () => new Promise(() => {}));
  page.ctx.setTimeout = fn => setTimeout(fn, 1);
  await page.chooseClass('class-a');
  assert.match(page.status.textContent, /Unable to load students/);
  assert.equal(page.retryStudents.hidden, false);
  assert.equal(page.fields.studentId.disabled, true);
});

test('a result response from a previous context cannot restore cleared student-specific state', async () => {
  const page = await browser();
  await page.chooseClass('class-a'); page.selectStudent('durable-a');
  const result = deferred(); const originalFetch = page.ctx.fetch;
  page.ctx.fetch = (url, init) => url.startsWith('/api/academic/result?') ? result.promise : originalFetch(url, init);
  vm.runInContext('render = () => { host.hidden = false; host.innerHTML = "STALE RESULT"; }', page.ctx);
  const generating = page.form.handlers.submit({ preventDefault() {} });
  await page.chooseClass('class-b');
  result.resolve({ ok: true, json: async () => ({ result: {} }) }); await generating;
  assert.equal(page.host.hidden, true);
  assert.equal(page.host.innerHTML, '');
});

for (const operation of ['saveResult', 'publishResult']) test(`late ${operation} response cannot restore state after a context change`, async () => {
  const page = await browser();
  await page.chooseClass('class-a'); page.selectStudent('durable-a');
  const pending = deferred(); const originalFetch = page.ctx.fetch;
  page.ctx.fetch = (url, init) => url.startsWith('/api/academic/results/') ? pending.promise : originalFetch(url, init);
  vm.runInContext('render = () => { host.hidden = false; host.innerHTML = "STALE RESULT"; }', page.ctx);
  const action = vm.runInContext(`${operation}({ studentId: 'durable-a', studentIndexNumber: 'OSAAH/2026/0001', classId: 'class-a', academicYear: '2026/2027', term: 'First Term' }, { disabled: false })`, page.ctx);
  await page.chooseClass('class-b');
  pending.resolve({ ok: true, json: async () => ({}) }); await action;
  assert.equal(page.host.hidden, true);
  assert.equal(page.host.innerHTML, '');
  assert.equal(page.status.textContent, '');
});
