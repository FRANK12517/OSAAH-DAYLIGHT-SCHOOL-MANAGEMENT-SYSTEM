import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSubjectService } from '../src/subjects.js';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { calculateClassPositions, calculateStudentResult } from '../src/result-calculation.js';
import { defaultSubjectsForClass } from '../src/default-subject-catalog.js';

const schoolId = 'school-osaah-daylight';
const manager = { id: 'admin-1', roleKey: 'SCHOOL_ADMIN', schoolId, permissions: new Set(['subjects.manage', 'subjects.read', 'academics.read', 'marks.write']) };
const teacher = { id: 'teacher-1', roleKey: 'TEACHER', schoolId, assignedClassIds: ['class-kg-1'], permissions: new Set(['subjects.read', 'academics.read', 'marks.write']) };
const targetClasses = [
  ['class-kg-1', 'KG 1'], ['class-kg-2', 'KG 2'],
  ...Array.from({ length: 6 }, (_, i) => [`class-basic-${i + 1}`, `Basic ${i + 1}`]),
  ...Array.from({ length: 3 }, (_, i) => [`class-jhs-${i + 1}`, `JHS ${i + 1}`])
];
const classes = [['class-nursery-1', 'Nursery 1'], ['class-nursery-2', 'Nursery 2'], ...targetClasses].map(([id, name]) => ({ id, name }));
const years = [{ id: 'year-2026', name: '2026/2027' }, { id: 'year-2027', name: '2027/2028' }];
const terms = years.flatMap(({ id }) => [1, 2, 3].map((n) => ({ id: `${id}-term-${n}`, academicYearId: id, name: ['First', 'Second', 'Third'][n - 1] + ' Term' })));

function fakeDatabase() {
  const subjects = [], assignments = [];
  for (const name of ['English Language', 'Mathematics', 'Science', 'Social Studies', 'Religious and Moral Education', 'Computing', 'Creative Arts', 'French']) {
    const id = `nursery-subject-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    subjects.push({ id, schoolId, code: `N_${name.slice(0, 5).toUpperCase()}`, name, subjectType: ['Computing', 'Creative Arts', 'French'].includes(name) ? 'ELECTIVE' : 'CORE', isScoring: 1, isActive: 1 });
    for (const classId of ['class-nursery-1', 'class-nursery-2']) assignments.push({ id: `nursery-${classId}-${id}`, schoolId, subjectId: id, classId, academicYearId: null, active: 1 });
  }
  const nurseryBefore = assignments.map((row) => ({ ...row }));
  const calls = [];
  const className = (id) => classes.find((row) => row.id === id)?.name;
  return {
    subjects, assignments, nurseryBefore, calls,
    async query(sql, p = []) {
      calls.push({ sql, params: p });
      if (sql.includes('SELECT c.id,c.name FROM classes c WHERE c.school_id=?')) return classes;
      if (sql.includes('SELECT id,name FROM classes WHERE school_id=?')) return classes.filter((row) => row.id === p[1]);
      if (sql.includes('FROM academic_years')) return years.filter((row) => !p[1] || row.id === p[1] || row.name === p[2]);
      if (sql.includes('FROM terms t JOIN academic_years')) return terms.filter((row) => row.academicYearId === p[1] && (row.id === p[2] || row.name === p[3]));
      if (sql.includes('SELECT id FROM subjects WHERE school_id=? AND code=?')) return subjects.filter((row) => row.schoolId === p[0] && row.code === p[1]).map(({ id }) => ({ id }));
      if (sql.includes('SELECT id FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?) AND id<>?')) return subjects.filter((row) => row.schoolId === p[0] && row.name.toLowerCase() === p[1].toLowerCase() && row.id !== p[2]).map(({ id }) => ({ id }));
      if (sql.includes('SELECT id FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?)')) return subjects.filter((row) => row.schoolId === p[0] && row.name.toLowerCase() === p[1].toLowerCase()).map(({ id }) => ({ id }));
      if (sql.includes('SELECT id,code,name,subject_type AS subjectType,is_scoring AS isScoring,is_active AS isActive FROM subjects WHERE school_id=? AND LOWER(name)=LOWER(?)')) return subjects.filter((row) => row.schoolId === p[0] && row.name.toLowerCase() === p[1].toLowerCase());
      if (sql.includes('SELECT id,code,name,subject_type AS subjectType,is_scoring AS isScoring FROM subjects WHERE id=?')) return subjects.filter((row) => row.id === p[0] && row.schoolId === p[1]);
      if (sql.includes('SELECT id,code,name,department_id AS departmentId,subject_type AS subjectType,is_scoring AS isScoring,is_active AS isActive,assessment_components_json AS assessmentComponentsJson FROM subjects')) return subjects.filter((row) => row.schoolId === p[0]).map((row) => ({ ...row, isActive: row.isActive ?? 1 }));
      if (sql.includes('SELECT a.subject_id AS subjectId,a.class_id AS classId,a.active,c.name AS className')) return assignments.filter((row) => row.schoolId === p[0]).map((row) => ({ subjectId: row.subjectId, classId: row.classId, className: className(row.classId), active: row.active }));
      if (sql.includes('SELECT a.active,c.name AS className FROM subject_class_assignments')) return assignments.filter((row) => row.schoolId === p[0] && row.subjectId === p[1]).map((row) => ({ active: row.active, className: className(row.classId) }));
      if (sql.includes('SELECT a.id,a.class_id AS classId,c.name AS className FROM subject_class_assignments')) return assignments.filter((row) => row.schoolId === p[0] && row.subjectId === p[1]).map((row) => ({ id: row.id, classId: row.classId, className: className(row.classId) }));
      if (sql.includes('SELECT id,active FROM subject_class_assignments') && sql.includes('academic_year_id IS NULL')) return assignments.filter((row) => row.schoolId === p[0] && row.subjectId === p[1] && row.classId === p[2] && row.academicYearId === null);
      if (sql.includes('SELECT id,active FROM subject_class_assignments WHERE')) return assignments.filter((row) => row.schoolId === p[0] && row.subjectId === p[1] && row.classId === p[2] && row.academicYearId === p[3]);
      if (sql.includes('SELECT id FROM subject_class_assignments WHERE')) return assignments.filter((row) => row.schoolId === p[0] && row.subjectId === p[1] && row.classId === p[2] && (p[3] == null ? row.academicYearId == null : row.academicYearId === p[3])).map(({ id }) => ({ id }));
      if (sql.includes('FROM subject_class_assignments a JOIN subjects s')) return assignments.filter((a) => a.schoolId === p[0] && a.classId === p[1] && subjects.find((s) => s.id === a.subjectId)?.isActive !== 0 && (p[2] === undefined || a.academicYearId === null || a.academicYearId === p[2])).map((a) => ({ ...subjects.find((s) => s.id === a.subjectId), classId: a.classId, className: className(a.classId), academicYearId: a.academicYearId, configurationVersion: a.configurationVersion, assignmentActive: a.active }));
      if (sql.includes('SELECT id,name FROM subjects WHERE id=? AND school_id=?')) return subjects.filter((row) => row.id === p[0] && row.schoolId === p[1]).map(({ id, name }) => ({ id, name }));
      return [];
    },
    async execute(sql, p = []) {
      calls.push({ sql, params: p });
      if (sql.startsWith('INSERT INTO subjects')) {
        if (!subjects.some((row) => row.id === p[0] || (row.schoolId === p[1] && row.code === p[3]))) subjects.push({ id: p[0], schoolId: p[1], code: p[3], name: p[4], subjectType: p[5], isScoring: p[6], assessmentComponentsJson: p[7], isActive: 1 });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('INSERT INTO subject_class_assignments')) {
        const inactiveOverride = sql.includes('VALUES (?,?,?,?,?,0,?,?,?)');
        if (!assignments.some((row) => row.id === p[0])) assignments.push({ id: p[0], schoolId: p[1], subjectId: p[2], classId: p[3], academicYearId: p.length >= 9 || inactiveOverride ? p[4] : null, active: inactiveOverride ? 0 : p.length >= 9 ? p[5] : 1, configurationVersion: inactiveOverride ? p[5] : p.length >= 9 ? p[6] : p[4] });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE subjects SET is_active=0') || sql.startsWith('UPDATE subjects SET is_active=1')) {
        const row = subjects.find((subject) => subject.id === p[1] && subject.schoolId === p[2]);
        if (row) row.isActive = sql.includes('is_active=0') ? 0 : 1;
        return { affectedRows: row ? 1 : 0 };
      }
      if (sql.startsWith('UPDATE subjects SET name=')) {
        const row = subjects.find((subject) => subject.id === p[5] && subject.schoolId === p[6]);
        if (row) Object.assign(row, { name: p[0], code: p[1], subjectType: p[2], isScoring: p[3] });
        return { affectedRows: row ? 1 : 0 };
      }
      if (sql.startsWith('UPDATE subject_class_assignments')) {
        if (sql.includes('SET active=0')) {
          const matching = assignments.filter((row) => row.schoolId === p[1] && row.subjectId === p[2]);
          matching.forEach((row) => { row.active = 0; });
          return { affectedRows: matching.length };
        }
        const idIndex = p.length === 5 ? 3 : p.length === 4 ? 2 : 2;
        const schoolIndex = p.length === 5 ? 4 : p.length === 4 ? 3 : 3;
        const row = assignments.find((assignment) => assignment.id === p[idIndex] && assignment.schoolId === p[schoolIndex]);
        if (row) { row.active = p.length === 5 ? p[0] : 1; row.configurationVersion = p.length === 5 ? p[1] : p[0]; }
        return { affectedRows: row ? 1 : 0 };
      }
      return { affectedRows: 1 };
    }
  };
}

test('catalog defines the requested subjects for KG, both Primary bands, and JHS while preserving Nursery', () => {
  const nursery = ['English Language', 'Mathematics', 'Science', 'Social Studies', 'Religious and Moral Education', 'Computing', 'Creative Arts', 'French'];
  for (const cls of ['Nursery 1', 'Nursery 2']) assert.deepEqual(defaultSubjectsForClass(cls).map((s) => s.name), nursery);
  assert.deepEqual(defaultSubjectsForClass('Nursery 1').filter((s) => s.mandatory).map((s) => s.name), nursery.slice(0, 5));
  assert.deepEqual(defaultSubjectsForClass('KG1').map((s) => s.name), ['Language and Literacy', 'Numeracy', 'Our World, Our People', 'Creative Arts']);
  assert.deepEqual(defaultSubjectsForClass('Basic 1').filter((s) => s.mandatory).map((s) => s.name), ['English Language', 'Mathematics', 'Science', 'History']);
  assert.deepEqual(defaultSubjectsForClass('Basic 4').filter((s) => s.mandatory).map((s) => s.name), ['English Language', 'Mathematics', 'Integrated Science', 'History']);
  assert.deepEqual(defaultSubjectsForClass('JHS 2').filter((s) => s.mandatory).map((s) => s.name), ['English Language', 'Mathematics', 'Integrated Science', 'Social Studies']);
  for (const cls of ['Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5', 'Basic 6']) assert.ok(defaultSubjectsForClass(cls).some((s) => s.name === 'Physical Education' && !s.isScoring));
});

test('KG has four 100-mark parent subjects, component labels, and highest-total ranking without Best Six', () => {
  const subjects = defaultSubjectsForClass('KG1');
  assert.deepEqual(subjects.map((s) => s.assessmentComponents), [['Phonics & Word Building', 'Oral Language & Listening', 'Pre-Writing & Penmanship'], ['Number Operations', 'Geometry & Spatial Awareness', 'Data & Sorting'], ['Personal & Social Development', 'Ghanaian Values & Science'], ['Visual Arts', 'Performing Arts & Movement']]);
  assert.ok(subjects.every((s) => s.maximumMarks === 100 && s.mandatory && s.isScoring));
  const result = calculateStudentResult(subjects.map((s, i) => ({ subjectId: `${i}`, subjectName: s.name, totalScore: [100, 80, 70, 60][i], subjectType: 'CORE', isScoring: true })), { classId: 'KG1' });
  assert.equal(result.totalScore, 310); assert.equal(result.aggregate, null);
  const positions = calculateClassPositions([{ studentId: 'top', totalScore: 310 }, { studentId: 'next', totalScore: 300 }], { classId: 'KG1' });
  assert.equal(positions.get('top'), '1st'); assert.equal(positions.get('next'), '2nd');
});

test('memory configuration protects mandatory subjects and marks lower/upper PE non-scoring', () => {
  const service = createSubjectService(); const admin = { schoolId, roleKey: 'SCHOOL_ADMIN', permissions: new Set(['subjects.manage']) };
  assert.equal(service.list({ classId: 'KG1' }, admin).length, 4);
  assert.throws(() => service.deactivate(service.list({ classId: 'KG1' }, admin)[0].id, admin), /Mandatory core/);
  for (const cls of ['Primary 1', 'Primary 4']) {
    const pe = service.list({ classId: cls }, admin).find((subject) => subject.name === 'Physical Education');
    assert.equal(pe.isScoring, false); assert.equal(pe.subjectType, 'NON_SCORING');
  }
  assert.ok(service.list({ classId: 'JHS 1' }, admin).some((s) => s.name === 'Ghanaian Language'));
});

test('TiDB defaults are idempotent, preserve Nursery assignments, and cascade across all 13 classes, three terms and academic years', async () => {
  const db = fakeDatabase(); const service = createDurableAcademicService({ database: db, schoolId });
  const first = await service.configureDefaultSubjects(manager); const second = await service.configureDefaultSubjects(manager);
  assert.equal(first.classesConfigured, 13); assert.equal(first.nurseryPreserved, true); assert.ok(first.assignmentsCreated > 0); assert.equal(second.assignmentsCreated, 0); assert.deepEqual(db.assignments.filter((a) => a.classId.includes('nursery')), db.nurseryBefore);
  assert.ok(db.assignments.filter((a) => !a.classId.includes('nursery')).every((a) => a.configurationVersion === '1'));
  for (const yearId of ['year-2026', 'year-2027']) for (const cls of classes) for (const termNo of [1, 2, 3]) {
    const response = await service.subjectCascade({ academicYearId: yearId, termId: `${yearId}-term-${termNo}`, classId: cls.id }, manager);
    const expected = cls.name.startsWith('Nursery') ? 8 : cls.name.startsWith('KG') ? 4 : cls.name.startsWith('Basic 1') || cls.name.startsWith('Basic 2') || cls.name.startsWith('Basic 3') ? 7 : 9;
    assert.equal(response.subjects.length, expected, `${cls.name}, term ${termNo}`);
    assert.ok(response.subjects.every((subject) => subject.isScoring !== false));
    const mandatoryNames = defaultSubjectsForClass(cls.name).filter((subject) => subject.mandatory && subject.isScoring !== false).map((subject) => subject.name);
    assert.deepEqual(response.subjects.filter((subject) => subject.mandatory).map((subject) => subject.name), mandatoryNames, `${cls.name}, ${yearId}, term ${termNo}: mandatory catalogue`);
  }
  for (const termNo of [1, 2, 3]) assert.equal((await service.subjectCascade({ academicYearId: 'year-2026', termId: `year-2026-term-${termNo}`, classId: 'class-kg-1' }, teacher)).subjects.length, 4);
  assert.equal((await service.subjectCascade({ academicYearId: 'year-2027', termId: 'year-2027-term-1', classId: 'class-kg-1' }, teacher)).subjects.length, 4);
  const upper = await service.listSubjects({ classId: 'class-basic-4', academicYearId: 'year-2026' }, manager);
  assert.equal(upper.find((s) => s.name === 'Physical Education').isScoring, false);
  assert.ok(!upper.some((s) => s.name === 'French'));
  const french = db.subjects.find((s) => s.name === 'French');
  await service.assignSubject({ subjectId: french.id, classId: 'class-basic-4', academicYearId: 'year-2026' }, manager);
  assert.ok((await service.subjectCascade({ academicYearId: 'year-2026', termId: 'year-2026-term-1', classId: 'class-basic-4' }, manager)).subjects.some((s) => s.id === french.id));
  assert.ok(!(await service.subjectCascade({ academicYearId: 'year-2027', termId: 'year-2027-term-1', classId: 'class-basic-4' }, manager)).subjects.some((s) => s.id === french.id));
});

test('Nursery CORE defaults cannot be deactivated or made non-scoring through durable APIs', async () => {
  const db = fakeDatabase(); const service = createDurableAcademicService({ database: db, schoolId });
  await service.configureDefaultSubjects(manager);
  const english = db.subjects.find((subject) => subject.name === 'English Language');
  await assert.rejects(() => service.deactivateSubject(english.id, manager), /Mandatory core/);
  await assert.rejects(() => service.updateSubject(english.id, { isScoring: false }, manager), /Mandatory core/);
  await assert.rejects(() => service.deactivateSubjectAssignment({ subjectId: english.id, classId: 'class-nursery-1', academicYearId: 'year-2026' }, manager), /Mandatory core/);
});

test('Nursery default configuration repairs a missing assignment and restores an inactive CORE assignment', async () => {
  const db = fakeDatabase(); const service = createDurableAcademicService({ database: db, schoolId });
  const english = db.subjects.find((subject) => subject.name === 'English Language');
  const inactiveCore = db.assignments.find((assignment) => assignment.classId === 'class-nursery-1' && assignment.subjectId === english.id);
  inactiveCore.active = 0;
  const arts = db.subjects.find((subject) => subject.name === 'Creative Arts');
  const artsAssignment = db.assignments.findIndex((assignment) => assignment.classId === 'class-nursery-2' && assignment.subjectId === arts.id);
  db.assignments.splice(artsAssignment, 1);
  const result = await service.configureDefaultSubjects(manager);
  assert.equal(result.classesConfigured, 13);
  assert.equal(result.mandatoryAssignmentsRestored, 1);
  assert.ok(result.assignmentsCreated > 0);
  assert.equal(inactiveCore.active, 1);
  assert.ok(db.assignments.some((assignment) => assignment.classId === 'class-nursery-2' && assignment.subjectId === arts.id && assignment.active === 1));
});

test('server-side cascade rejects invalid years/terms and out-of-scope classes; defaults require manager permission', async () => {
  const db = fakeDatabase(); const service = createDurableAcademicService({ database: db, schoolId });
  const before = [db.subjects.length, db.assignments.length];
  await assert.rejects(() => service.configureDefaultSubjects({ ...manager, permissions: new Set(['subjects.read']) }), /Forbidden/);
  assert.deepEqual([db.subjects.length, db.assignments.length], before);
  await assert.rejects(() => service.subjectCascade({ academicYearId: 'missing', termId: 'term-1', classId: 'class-kg-1' }, manager), /Academic year not found/);
  await assert.rejects(() => service.subjectCascade({ academicYearId: 'year-2026', termId: 'year-2027-term-1', classId: 'class-kg-1' }, manager), /Term not found/);
  await assert.rejects(() => service.subjectCascade({ academicYearId: 'year-2026', termId: 'year-2026-term-1', classId: 'class-jhs-1' }, teacher), /outside your assignment/);
  assert.equal(db.calls.some(({ sql }) => /INSERT INTO subjects|INSERT INTO subject_class_assignments/.test(sql)), false);
});

test('durable Subject Configuration allows year-scoped elective registration and archives history without weakening mandatory subjects', async () => {
  const db = fakeDatabase(); const service = createDurableAcademicService({ database: db, schoolId });
  await service.configureDefaultSubjects(manager);
  const english = db.subjects.find((s) => s.name === 'English Language');
  await assert.rejects(() => service.deactivateSubject(english.id, manager), /Mandatory core/);
  await assert.rejects(() => service.updateSubject(english.id, { isScoring: false }, manager), /Mandatory core/);
  await assert.rejects(() => service.deactivateSubjectAssignment({ subjectId: english.id, classId: 'class-basic-1', academicYearId: 'year-2026' }, manager), /Mandatory core/);
  const rme = db.subjects.find((s) => s.name === 'Religious and Moral Education');
  const disabled = await service.deactivateSubjectAssignment({ subjectId: rme.id, classId: 'class-basic-1', academicYearId: '2026/2027' }, manager);
  assert.equal(disabled.active, false); assert.equal(disabled.configurationVersion, 1);
  assert.ok(!(await service.subjectCascade({ academicYearId: 'year-2026', termId: 'year-2026-term-1', classId: 'class-basic-1' }, manager)).subjects.some((s) => s.id === rme.id));
  assert.ok((await service.subjectCascade({ academicYearId: 'year-2027', termId: 'year-2027-term-1', classId: 'class-basic-1' }, manager)).subjects.some((s) => s.id === rme.id));
  const robotics = await service.createSubject({ name: 'Robotics', code: 'ROB', subjectType: 'ELECTIVE' }, manager);
  const registered = await service.assignSubject({ subjectId: robotics.id, classId: 'class-basic-1', academicYearId: '2026/2027' }, manager);
  assert.equal(registered.academicYearId, 'year-2026'); assert.equal(registered.configurationVersion, 1);
  assert.ok((await service.subjectCascade({ academicYearId: 'year-2026', termId: 'year-2026-term-1', classId: 'class-basic-1' }, manager)).subjects.some((s) => s.id === robotics.id));
  assert.ok(!(await service.subjectCascade({ academicYearId: 'year-2027', termId: 'year-2027-term-1', classId: 'class-basic-1' }, manager)).subjects.some((s) => s.id === robotics.id));
  const archived = await service.deactivateSubject(robotics.id, manager);
  assert.equal(archived.historicalRecordsPreserved, true);
  assert.ok(!(await service.subjectCatalog(manager)).some((s) => s.id === robotics.id));
  assert.equal((await service.subjectCatalog(manager, { includeInactive: true })).find((s) => s.id === robotics.id).active, false);
});

test('subject metadata migration is additive, TiDB-repeat-safe, and does not destroy records', async () => {
  const sql = await readFile(new URL('../schema/065_subject_assessment_components.sql', import.meta.url), 'utf8');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS assessment_components_json JSON NULL/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS is_active TINYINT\(1\) NOT NULL DEFAULT 1/i);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS configuration_version VARCHAR\(32\) NULL/i);
  assert.doesNotMatch(sql, /\bDROP\s+(TABLE|COLUMN|DATABASE)\b/i);
});
