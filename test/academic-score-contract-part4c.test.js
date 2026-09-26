import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { createApp } from '../src/server.mjs';

const schoolId = 'sch_default_01';
const teacher = { id: 'teacher-a', schoolId, roleKey: 'TEACHER', permissions: new Set(['marks.write', 'results.read']), assignedClassIds: ['class-a'], assignedSubjectIds: ['subject-a'] };
const context = { studentId: 'student-a', classId: 'class-a', academicYear: '2026/2027', term: 'First Term' };

async function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE schools(id VARCHAR(191) PRIMARY KEY);
    CREATE TABLE levels(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),name TEXT,display_order INTEGER);
    CREATE TABLE classes(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),level_id VARCHAR(191),name TEXT,display_order INTEGER);
    CREATE TABLE academic_years(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE terms(id VARCHAR(191) PRIMARY KEY,academic_year_id VARCHAR(191),name TEXT,starts_on TEXT,ends_on TEXT,is_current INTEGER);
    CREATE TABLE subjects(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),name TEXT);
    CREATE TABLE class_subjects(id VARCHAR(191) PRIMARY KEY,class_id VARCHAR(191),subject_id VARCHAR(191),teacher_id VARCHAR(191));
    CREATE TABLE students(id VARCHAR(191) PRIMARY KEY,school_id VARCHAR(191),permanent_student_id VARCHAR(191),first_name TEXT,middle_name TEXT,last_name TEXT,gender TEXT,is_test_record INTEGER,current_class_id VARCHAR(191));
    CREATE TABLE student_enrollments(id VARCHAR(191) PRIMARY KEY,student_id VARCHAR(191),class_id VARCHAR(191),academic_year_id VARCHAR(191));
    CREATE TABLE academic_score_records(id VARCHAR(191) PRIMARY KEY,student_id VARCHAR(191),score DECIMAL(6,2));
    INSERT INTO academic_score_records VALUES('legacy-score','profile-a',72);
    INSERT INTO schools VALUES('${schoolId}'),('school-b');
    INSERT INTO levels VALUES('level-a','${schoolId}','PRIMARY',1),('level-b','school-b','PRIMARY',1);
    INSERT INTO classes VALUES('class-a','${schoolId}','level-a','Basic 1',1),('class-b','${schoolId}','level-a','Basic 2',2),('foreign-class','school-b','level-b','Basic 1',1);
    INSERT INTO academic_years VALUES('year-a','${schoolId}','2026/2027','','',1),('year-b','${schoolId}','2025/2026','','',0),('year-x','school-b','2026/2027','','',1);
    INSERT INTO terms VALUES('term-a','year-a','First Term','','',1),('term-b','year-a','Second Term','','',0),('term-old','year-b','First Term','','',0),('term-x','year-x','First Term','','',1);
    INSERT INTO subjects VALUES('subject-a','${schoolId}','English Language'),('subject-x','school-b','Foreign Subject');
    INSERT INTO class_subjects VALUES('map-a','class-a','subject-a','teacher-a'),('map-b','class-b','subject-a','teacher-a');
    INSERT INTO students VALUES('student-a','${schoolId}','OSAAH/2026/0001','Ama','Akua','Mensah','Female',0,'class-b'),('student-b','${schoolId}','OSAAH/2026/0002','Kojo',NULL,'Boateng','Male',0,'class-a'),('foreign-student','school-b','OSAAH/2026/9001','Foreign',NULL,'Student','Male',0,'foreign-class'),('sample-student','${schoolId}','TEST-OSAAH-0001','Sample',NULL,'Learner','Female',1,'class-a');
    INSERT INTO student_enrollments VALUES('enroll-a','student-a','class-a','year-a'),('enroll-b','student-b','class-a','year-a'),('enroll-old','student-a','class-b','year-b'),('enroll-x','foreign-student','foreign-class','year-x'),('enroll-sample','sample-student','class-a','year-a');`);
  for (const id of ['students','student_enrollments','class_subjects','classes','academic_years','terms','subjects']) db.exec(`CREATE TABLE IF NOT EXISTS ${id}_preserved (id TEXT PRIMARY KEY); INSERT INTO ${id}_preserved VALUES ('keep-${id}');`);
  const migration = [
    await readFile(new URL('../schema/055_canonical_academic_scores.sql', import.meta.url), 'utf8'),
    await readFile(new URL('../schema/056_canonical_ges_assessments.sql', import.meta.url), 'utf8')
  ].join('\n');
  const database = {
    async query(sql, params = []) {
      try { return db.prepare(sql).all(...params); }
      catch (error) { if (/no such table/.test(error.message)) error.code = 'ER_NO_SUCH_TABLE'; else if (/no such column/.test(error.message)) error.code = 'ER_BAD_FIELD_ERROR'; throw error; }
    },
    async execute(sql, params = []) { return db.prepare(sql).run(...params); },
    async transaction(work) { db.exec('BEGIN'); try { const result = await work(database); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  };
  return { db, migration, database };
}

test('canonical score migration is additive, idempotent and retains existing records', async () => {
  const { db, migration } = await fixture();
  try {
    for (const existing of ['students','student_enrollments','class_subjects','classes','academic_years','terms','subjects']) db.exec(`INSERT INTO ${existing}(id) VALUES ('existing-${existing}')`);
    db.exec(migration);
    db.exec(migration);
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='canonical_academic_scores'").get();
    assert.equal(table.name, 'canonical_academic_scores');
    const columns = db.prepare('PRAGMA table_info(canonical_academic_scores)').all().map((row) => row.name);
    assert.deepEqual(columns, ['id','school_id','student_id','class_id','academic_year_id','term_id','subject_id','class_score','exam_score','total_score','created_at','updated_at']);
    const foreignKeys = db.prepare('PRAGMA foreign_key_list(canonical_academic_scores)').all().map((row) => row.table);
    assert.deepEqual(new Set(foreignKeys), new Set(['schools','students','classes','academic_years','terms','subjects']));
    for (const existing of ['students','student_enrollments','class_subjects','classes','academic_years','terms','subjects']) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${existing}_preserved`).get().n, 1);
    assert.equal(db.prepare('SELECT score FROM academic_score_records WHERE id=?').get('legacy-score').score, 72);
    assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE|RENAME)\b/i);
  } finally { db.close(); }
});

test('Score Entry saves master student identity and repeated saves update the unique academic scope', async () => {
  const { db, migration, database } = await fixture();
  try {
    db.exec(migration);
    let nextId = 0;
    const service = createDurableAcademicService({ database, schoolId, idFactory: () => `score-${++nextId}`, clock: () => '2026-09-26T00:00:00.000Z' });
    const first = await service.saveScore({ ...context, subjectId: 'subject-a', caScore: 41.25, examScore: 38.5 }, teacher);
    const updated = await service.saveScore({ ...context, subjectId: 'subject-a', caScore: 42, examScore: 39 }, teacher);
    assert.equal(first.studentId, 'student-a');
    assert.equal(first.permanentStudentId, 'OSAAH/2026/0001');
    assert.equal(updated.id, first.id);
    assert.equal(updated.totalScore, 81);
    const records = db.prepare('SELECT * FROM canonical_academic_scores').all();
    assert.equal(records.length, 1);
    assert.equal(records[0].student_id, 'student-a');
    assert.equal(records[0].class_score, 42);
    assert.equal(records[0].exam_score, 39);
    assert.equal(records[0].total_score, 81);
    const secondTerm = await service.saveScore({ ...context, term: 'Second Term', subjectId: 'subject-a', caScore: 40, examScore: 40 }, teacher);
    assert.notEqual(secondTerm.id, first.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_academic_scores').get().n, 2);
  } finally { db.close(); }
});

test('Score Entry enforces school, student, class, year, term, subject and teacher scope', async () => {
  const { db, migration, database } = await fixture();
  try {
    db.exec(migration);
    const service = createDurableAcademicService({ database, schoolId });
    const bad = [
      { ...context, studentId: 'foreign-student' },
      { ...context, studentId: 'sample-student' },
      { ...context, classId: 'foreign-class' },
      { ...context, classId: 'class-b' },
      { ...context, academicYear: 'year-x' },
      { ...context, academicYear: 'year-b' },
      { ...context, term: 'term-x' },
      { ...context, subjectId: 'subject-x' }
    ];
    for (const input of bad) await assert.rejects(service.saveScore({ ...input, subjectId: input.subjectId ?? 'subject-a', caScore: 1, examScore: 2 }, teacher));
    await assert.rejects(service.saveScore({ ...context, subjectId: 'subject-a', caScore: 1, examScore: 2 }, { ...teacher, permissions: new Set(['results.read']) }), /Forbidden/);
    await assert.rejects(service.saveScore({ ...context, subjectId: 'subject-a', caScore: 1, examScore: 2 }, { ...teacher, assignedSubjectIds: ['subject-x'] }), /Forbidden/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_academic_scores').get().n, 0);
  } finally { db.close(); }
});

test('real Result Slip reads the same historical canonical record and does not use sample or memory fallbacks', async () => {
  const { db, migration, database } = await fixture();
  try {
    db.exec(migration);
    const service = createDurableAcademicService({ database, schoolId });
    const saved = await service.saveScore({ ...context, subjectId: 'subject-a', caScore: 42, examScore: 39 }, teacher);
    const assignedTeacher = { ...teacher, assignedClassIds: ['class-a', 'class-b'] };
    const historical = await service.saveScore({ ...context, classId: 'class-b', academicYear: '2025/2026', subjectId: 'subject-a', caScore: 41, examScore: 40 }, assignedTeacher);
    const result = await service.result(context, teacher);
    assert.equal(result.studentId, 'student-a');
    assert.equal(result.studentIndexNumber, 'OSAAH/2026/0001');
    assert.equal(result.className, 'Basic 1');
    assert.equal(result.isSample, false);
    assert.equal(result.subjects.length, 1);
    assert.equal(result.subjects[0].id, saved.id);
    assert.equal(result.subjects[0].caScore, 42);
    assert.equal(result.subjects[0].examScore, 39);
    assert.equal(result.totalScore, 81);
    const historicSlip = await service.result({ ...context, classId: 'class-b', academicYear: '2025/2026' }, assignedTeacher);
    assert.equal(historicSlip.className, 'Basic 2');
    assert.equal(historicSlip.academicYear, '2025/2026');
    assert.equal(historicSlip.subjects[0].id, historical.id);
    await assert.rejects(service.result({ ...context, term: 'Second Term' }, teacher), (error) => error.status === 404 && /No result scores/.test(error.message));
    await assert.rejects(service.result({ ...context, sample: 'true' }, teacher), (error) => error.status === 403);
  } finally { db.close(); }
});

test('authenticated HTTP Score Entry and Generate Result share the durable record without publishing or notifying', async () => {
  const { db, migration, database } = await fixture();
  try {
    db.exec(migration);
    const app = createApp({ database, auth: { authenticateAsync: async (token) => token === 'valid' ? teacher : null } });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const root = `http://127.0.0.1:${server.address().port}`;
      const headers = { Authorization: 'Bearer valid', 'Content-Type': 'application/json' };
      const saved = await fetch(`${root}/api/academic/scores`, { method: 'POST', headers, body: JSON.stringify({ ...context, subjectId: 'subject-a', caScore: 43, examScore: 37 }) });
      assert.equal(saved.status, 201);
      const saveDto = await saved.json();
      const loaded = await fetch(`${root}/api/academic/result?${new URLSearchParams(context)}`, { headers });
      assert.equal(loaded.status, 200);
      const slip = (await loaded.json()).result;
      assert.equal(slip.studentId, saveDto.studentId);
      assert.equal(slip.studentIndexNumber, 'OSAAH/2026/0001');
      assert.equal(slip.subjects[0].id, saveDto.id);
      assert.equal(slip.subjects[0].caScore, 43);
      assert.equal(slip.subjects[0].examScore, 37);
      assert.equal(slip.totalScore, 80);
      assert.equal(slip.isSample, false);
      const broadsheet = await fetch(`${root}/api/academic/broadsheet?${new URLSearchParams({ classId: context.classId, academicYear: context.academicYear, term: context.term })}`, { headers });
      assert.equal(broadsheet.status, 200);
      const [broadsheetRow] = (await broadsheet.json()).rows;
      assert.equal(broadsheetRow.studentId, slip.studentId);
      assert.equal(broadsheetRow.permanentStudentId, slip.studentIndexNumber);
      assert.equal(broadsheetRow.totalScore, slip.totalScore);
      assert.equal(broadsheetRow.classPosition, slip.classPosition);
      const pdf = await fetch(`${root}/api/academic/result/pdf?${new URLSearchParams(context)}`, { headers });
      assert.equal(pdf.status, 200);
      assert.match(pdf.headers.get('content-type'), /application\/pdf/);
      assert.equal(Buffer.from(await pdf.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
      const sampleFlag = await fetch(`${root}/api/academic/result?${new URLSearchParams({ ...context, sample: 'true' })}`, { headers });
      assert.equal(sampleFlag.status, 403);
      const sampleWrite = await fetch(`${root}/api/academic/scores`, { method: 'POST', headers, body: JSON.stringify({ ...context, subjectId: 'subject-a', caScore: 1, examScore: 1, isSample: true }) });
      assert.equal(sampleWrite.status, 403);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM canonical_academic_scores').get().n, 1);
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('result_publications','sms_outbox')").get().n, 0);
    } finally { await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  } finally { db.close(); }
});
