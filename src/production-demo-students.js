import { randomUUID } from 'node:crypto';
import { TEST_PARENT_STUDENT_IDS } from './test-parent-fixture.js';
import { CORE_LEVELS } from './students.js';
import { normalizeGhanaPhone } from './ghana-phone.js';
import { gradeForTotal } from './grading.js';
import { tidbInsertIfAbsent } from './tidb-conflict.js';

const DEMOS = Object.freeze([
  { permanentStudentId: TEST_PARENT_STUDENT_IDS[0], admissionNumber: 'DEMO-OSAAH-001', firstName: 'OSAAH Demo', lastName: 'Student One' },
  { permanentStudentId: TEST_PARENT_STUDENT_IDS[1], admissionNumber: 'DEMO-OSAAH-002', firstName: 'OSAAH Demo', lastName: 'Student Two' }
]);
const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, status = 409) => { throw Object.assign(new Error(message), { code, status }); };
const active = (value) => String(value ?? 'ACTIVE').trim().toUpperCase() === 'ACTIVE';
const MOCK_LABEL = '1st Mock';
const JHS_CLASSES = new Set(['JHS 1', 'JHS 2', 'JHS 3']);

async function planMockScores(database, { schoolId }) {
  const contexts = rows(await database.query(`SELECT y.id AS academicYearId,y.name AS academicYear,
      t.id AS termId,t.name AS term
    FROM academic_years y JOIN terms t ON t.academic_year_id=y.id
    WHERE y.school_id=? AND y.is_current=TRUE AND t.is_current=TRUE`, [schoolId]));
  if (contexts.length !== 1) fail('DEMO_CURRENT_ACADEMIC_CONTEXT_INVALID', 'Exactly one current academic year and term are required before sample mock scores can be provisioned.');
  const context = contexts[0];
  const plans = [];
  for (const [classIndex, classRow] of rows(await database.query('SELECT id,name FROM classes WHERE school_id=? AND status=\'ACTIVE\'', [schoolId])).entries()) {
    if (!JHS_CLASSES.has(String(classRow.name).trim())) continue;
    const subjects = rows(await database.query(`SELECT s.id,s.name
      FROM subject_class_assignments a JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      WHERE a.school_id=? AND a.class_id=? AND (a.academic_year_id=? OR a.academic_year_id IS NULL)
        AND a.active=TRUE AND s.is_active=TRUE AND s.is_scoring=TRUE
      ORDER BY s.name,s.id`, [schoolId, classRow.id, context.academicYearId]));
    if (!subjects.length) fail('DEMO_MOCK_SUBJECTS_UNAVAILABLE', `No active scoring subjects are configured for ${classRow.name}.`);
    for (const [studentIndex, demo] of DEMOS.entries()) {
      for (const [subjectIndex, subject] of subjects.entries()) {
        // Stable, varied demonstration values; grades come from the production
        // grading scale and repeated provisioning never rewrites existing rows.
        const totalScore = 65 + ((studentIndex * 7 + classIndex * 3 + subjectIndex * 5) % 28);
        const [grade, remark] = gradeForTotal(totalScore, { classId: classRow.name, examination: 'MOCK' });
        const existing = rows(await database.query(`SELECT r.id,r.total_score AS totalScore
          FROM academic_score_records r JOIN student_profiles sp ON sp.id=r.student_id AND sp.school_id=r.school_id
          WHERE r.school_id=? AND r.record_type='MOCK' AND r.mock_label=? AND r.academic_year_id=?
            AND r.term_id=? AND r.class_id=? AND r.subject_id=?
            AND (sp.student_master_id=? OR sp.student_id=?) LIMIT 2`, [schoolId, MOCK_LABEL, context.academicYearId, context.termId, classRow.id, subject.id, demo.permanentStudentId, demo.permanentStudentId]));
        if (existing.length > 1) fail('DEMO_MOCK_SCORE_DUPLICATE', 'Duplicate demonstration mock scores require review before provisioning.');
        plans.push({ ...context, classId: classRow.id, className: classRow.name, studentIndex, permanentStudentId: demo.permanentStudentId, subjectId: subject.id, subjectName: subject.name, mockLabel: MOCK_LABEL, totalScore, grade, remark, existing: existing[0] ?? null });
      }
    }
  }
  if (!plans.length) fail('DEMO_MOCK_CLASSES_UNAVAILABLE', 'No active JHS 1, JHS 2, or JHS 3 classes are configured.');
  return plans;
}

async function insertMissingMockScores(database, { schoolId, actorUserId, plans, timestamp, idFactory }) {
  let inserted = 0, preserved = 0;
  for (const plan of plans) {
    if (plan.existing) { preserved += 1; continue; }
    const profile = rows(await database.query(`SELECT id FROM student_profiles
      WHERE school_id=? AND (student_master_id=? OR student_id=?) LIMIT 2`, [schoolId, plan.permanentStudentId, plan.permanentStudentId]));
    if (profile.length !== 1) fail('DEMO_MOCK_PROFILE_INVALID', 'A unique demonstration student profile is required before score provisioning.');
    const added = await tidbInsertIfAbsent(database, {
      insertSql: `INSERT INTO academic_score_records
        (id,school_id,record_type,mock_label,academic_year_id,term_id,class_id,student_id,subject_id,
         ca_score,ca_max,examination_score,examination_max,total_score,grade,remark,entered_by,updated_at)
        VALUES (?,?, 'MOCK', ?,?,?,?,?,?,0,0,?,100,?,?,?,?,?)`,
      insertParameters: [idFactory(), schoolId, plan.mockLabel, plan.academicYearId, plan.termId, plan.classId, profile[0].id, plan.subjectId, plan.totalScore, plan.totalScore, plan.grade, plan.remark, actorUserId, timestamp],
      conflictSql: `SELECT r.id FROM academic_score_records r
        WHERE r.school_id=? AND r.record_type='MOCK' AND r.mock_label=? AND r.academic_year_id=?
          AND r.term_id=? AND r.class_id=? AND r.student_id=? AND r.subject_id=? LIMIT 1`,
      conflictParameters: [schoolId, plan.mockLabel, plan.academicYearId, plan.termId, plan.classId, profile[0].id, plan.subjectId]
    });
    if (added) inserted += 1;
    else preserved += 1;
  }
  return { inserted, preserved };
}

async function assertDemoAssignmentScope(database, { schoolId, studentId, classId }) {
  const matching = rows(await database.query(`SELECT s.id AS studentId,c.id AS classId
    FROM students s
    JOIN classes c ON c.id=? AND c.school_id=?
    WHERE s.id=? AND s.school_id=?
    FOR UPDATE`, [classId, schoolId, studentId, schoolId]));
  if (matching.length !== 1) fail('DEMO_ASSIGNMENT_TENANT_CONFLICT', 'A demonstration student and class must belong to the same school before assignment.');
}

async function inspect(database, { schoolId, parentPhone, expectedDatabase, migrationChecksum, actorUserId }) {
  const target = rows(await database.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
  if (!target || target !== expectedDatabase) fail('DEMO_DATABASE_TARGET_MISMATCH', 'Connected database does not match the explicitly expected database.');
  const migration = rows(await database.query('SELECT version,name,checksum FROM schema_migrations WHERE version=?', [84]))[0];
  if (migration?.name !== '084_demo_student_class_assignments.sql' || migration?.checksum !== migrationChecksum) fail('DEMO_MIGRATION_NOT_APPLIED', 'Verified migration 084 is not recorded with the repository checksum.');

  const canonicalPhone = normalizeGhanaPhone(parentPhone);
  if (!canonicalPhone) fail('DEMO_PARENT_PHONE_INVALID', 'A valid Ghana parent phone is required.');
  const accounts = rows(await database.query(`SELECT u.id,u.phone,u.username,u.status,r.role_key AS roleKey
    FROM users u LEFT JOIN user_roles ur ON ur.user_id=u.id
    LEFT JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id
    WHERE u.school_id=? AND (u.phone IN (?,?,?) OR u.username IN (?,?,?))`, [schoolId, canonicalPhone, canonicalPhone.slice(1), `0${canonicalPhone.slice(4)}`, canonicalPhone, canonicalPhone.slice(1), `0${canonicalPhone.slice(4)}`]));
  const matching = accounts.filter((user) => normalizeGhanaPhone(user.phone) === canonicalPhone || normalizeGhanaPhone(user.username) === canonicalPhone);
  const parents = [...new Map(matching.filter((user) => user.roleKey === 'PARENT' && active(user.status)).map((user) => [user.id, user])).values()];
  if (parents.length !== 1) fail('DEMO_PARENT_ACCOUNT_NOT_UNIQUE', 'Exactly one active Parent account must match the supplied phone in this school.');
  let actor = null;
  if (actorUserId) {
    const actorRows = rows(await database.query(`SELECT u.id,u.status,r.id AS roleId,r.role_key AS roleKey FROM users u
      JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id
      WHERE u.id=? AND u.school_id=? AND r.role_key IN ('PROPRIETOR','SCHOOL_ADMIN')`, [actorUserId, schoolId]));
    const allowedActors = [...new Map(actorRows.filter((item) => active(item.status)).map((item) => [item.id, item])).values()];
    if (allowedActors.length !== 1) fail('DEMO_RESTORE_ACTOR_INVALID', 'The recorded actor must be one active Proprietor or School Admin in this school.');
    actor = allowedActors[0];
  }
  // Migration 084 has individual foreign keys for school, student, and class.
  // Check their tenant relationship in the same transaction as provisioning;
  // independent foreign keys alone do not guarantee that all three share a school.
  const crossSchoolAssignment = rows(await database.query(`SELECT d.school_id AS assignmentSchoolId,
      d.student_id AS studentId,d.class_id AS classId,
      s.school_id AS studentSchoolId,c.school_id AS classSchoolId
    FROM demo_student_class_assignments d
    LEFT JOIN students s ON s.id=d.student_id
    LEFT JOIN classes c ON c.id=d.class_id
    WHERE s.permanent_student_id IN (?,?)
      AND (s.id IS NULL OR c.id IS NULL OR d.school_id<>s.school_id OR d.school_id<>c.school_id)
    LIMIT 1`, TEST_PARENT_STUDENT_IDS));
  if (crossSchoolAssignment.length) fail('DEMO_ASSIGNMENT_TENANT_CONFLICT', 'A permanent demonstration class assignment crosses school boundaries and requires review.');

  const classes = rows(await database.query('SELECT id,name,school_id AS schoolId FROM classes WHERE school_id=? AND status=\'ACTIVE\'', [schoolId]));
  if (classes.some((item) => String(item.schoolId ?? item.school_id ?? '') !== schoolId)) fail('DEMO_CLASS_TENANT_CONFLICT', 'The active class catalogue contains a class outside the requested school.');
  const byName = new Map(classes.map((item) => [String(item.name).trim().toLowerCase(), item]));
  const missingClasses = CORE_LEVELS.filter((name) => !byName.has(name.toLowerCase()));
  if (missingClasses.length) fail('DEMO_CLASS_CATALOG_INCOMPLETE', 'The school does not have the complete canonical class catalogue.');
  const canonicalClasses = CORE_LEVELS.map((name) => byName.get(name.toLowerCase()));

  const existingStudents = rows(await database.query('SELECT id,school_id AS schoolId,permanent_student_id AS permanentStudentId,admission_number AS admissionNumber,first_name AS firstName,last_name AS lastName,student_status AS studentStatus,is_test_record AS isTestRecord FROM students WHERE school_id=? AND (permanent_student_id IN (?,?) OR admission_number IN (?,?)) FOR UPDATE', [schoolId, ...TEST_PARENT_STUDENT_IDS, ...DEMOS.map((item) => item.admissionNumber)]));
  for (const existing of existingStudents) {
    if (String(existing.schoolId ?? existing.school_id ?? '') !== schoolId) fail('DEMO_STUDENT_TENANT_CONFLICT', 'A reserved demonstration student is outside the requested school.');
    const expected = DEMOS.find((item) => item.permanentStudentId === existing.permanentStudentId);
    if (!expected || Number(existing.isTestRecord) !== 1 || !active(existing.studentStatus) || existing.admissionNumber !== expected.admissionNumber || existing.firstName !== expected.firstName || existing.lastName !== expected.lastName) fail('DEMO_STUDENT_ID_CONFLICT', 'A reserved demonstration identity already exists with conflicting data.');
  }
  const studentByPermanentId = new Map(existingStudents.map((item) => [item.permanentStudentId, item]));
  const profiles = [];
  const links = [];
  const assignments = [];
  for (const demo of DEMOS) {
    const student = studentByPermanentId.get(demo.permanentStudentId);
    if (!student) continue;
    const matches = rows(await database.query('SELECT id,student_master_id AS studentMasterId,student_id AS studentId,enrollment_status AS enrollmentStatus FROM student_profiles WHERE school_id=? AND student_master_id=? FOR UPDATE', [schoolId, student.id]));
    if (matches.length > 1 || matches.some((item) => item.studentId !== demo.permanentStudentId || !active(item.enrollmentStatus))) fail('DEMO_STUDENT_PROFILE_CONFLICT', 'A reserved demonstration student has a conflicting profile.');
    if (matches.length) profiles.push({ ...demo, studentId: student.id, profileId: matches[0].id });
  }
  for (const profile of profiles) {
    const linkRows = rows(await database.query('SELECT parent_user_id AS parentUserId,link_status AS linkStatus FROM parent_student_links WHERE student_id=? FOR UPDATE', [profile.profileId]));
    if (linkRows.some((link) => link.parentUserId !== parents[0].id)) fail('DEMO_PARENT_LINK_CONFLICT', 'A demonstration student is already linked to a different Parent account.');
    if (linkRows.some((link) => link.linkStatus !== 'ACTIVE')) fail('DEMO_PARENT_LINK_REVOKED', 'An existing Parent link is inactive and requires review.');
    if (linkRows.length > 1) fail('DEMO_PARENT_LINK_CONFLICT', 'A duplicate Parent link exists for a demonstration student.');
    if (linkRows.length) links.push(profile.permanentStudentId);
    const assignmentRows = rows(await database.query('SELECT class_id AS classId FROM demo_student_class_assignments WHERE school_id=? AND student_id=? FOR UPDATE', [schoolId, profile.studentId]));
    if (assignmentRows.some((item) => !canonicalClasses.some((classRow) => classRow.id === item.classId))) fail('DEMO_CLASS_ASSIGNMENT_CONFLICT', 'A demonstration student has an assignment outside the canonical class list.');
    assignments.push({ permanentStudentId: profile.permanentStudentId, count: assignmentRows.length, expected: canonicalClasses.length });
  }
  return { databaseName: target, parentUserId: parents[0].id, actor, canonicalClasses, existingStudents, profiles, links, assignments, missingStudents: DEMOS.filter((item) => !studentByPermanentId.has(item.permanentStudentId)) };
}

export async function provisionPermanentDemoStudents(database, {
  schoolId,
  parentPhone,
  expectedDatabase,
  migrationChecksum,
  actorUserId = null,
  apply = false,
  approval = null,
  backupReference = null,
  clock = () => new Date().toISOString(),
  idFactory = randomUUID
} = {}) {
  if (database?.dialect !== 'tidb' || typeof database?.query !== 'function' || typeof database?.execute !== 'function') fail('DEMO_TIDB_REQUIRED', 'The permanent demonstration student workflow requires the TiDB adapter.');
  if (!schoolId || !expectedDatabase || !migrationChecksum) fail('DEMO_SCOPE_REQUIRED', 'School, expected database, and migration checksum are required.');
  if (apply && (approval !== 'PRODUCTION_DEMO_RESTORE_APPROVED' || !String(backupReference ?? '').trim() || !actorUserId)) fail('DEMO_APPLY_GUARD_REQUIRED', 'Apply requires the explicit production approval token, backup reference, and accountable actor ID.');

  const run = async (tx) => {
    const state = await inspect(tx, { schoolId, parentPhone, expectedDatabase, migrationChecksum, actorUserId });
    const scorePlans = await planMockScores(tx, { schoolId });
    const plannedMockScoreCount = scorePlans.filter((plan) => !plan.existing).length;
    if (!apply) return { mode: 'DRY_RUN', databaseName: state.databaseName, studentCount: DEMOS.length, existingStudentCount: state.existingStudents.length, parentAccountMatched: true, classCount: state.canonicalClasses.length, assignmentCount: state.assignments.reduce((sum, row) => sum + row.count, 0), mockScoreContext: { academicYear: scorePlans[0].academicYear, term: scorePlans[0].term, mockLabel: MOCK_LABEL }, mockScoreCount: scorePlans.length, mockScoresToInsert: plannedMockScoreCount, mockScoresAlreadyPresent: scorePlans.length - plannedMockScoreCount, writesPerformed: false };
    const timestamp = clock();
    const students = new Map(state.existingStudents.map((item) => [item.permanentStudentId, item]));
    for (const demo of DEMOS) {
      let student = students.get(demo.permanentStudentId);
      if (!student) {
        const studentId = idFactory();
        await tx.execute(`INSERT INTO students (id,school_id,permanent_student_id,admission_number,current_class_id,first_name,middle_name,last_name,full_name,gender,admission_type,student_status,parent_phone,is_test_record,created_at,updated_at)
          VALUES (?,?,?,?,NULL,?,NULL,?,?,'NOT_SPECIFIED','DEMONSTRATION','ACTIVE',?,TRUE,?,?)`, [studentId, schoolId, demo.permanentStudentId, demo.admissionNumber, demo.firstName, demo.lastName, `${demo.firstName} ${demo.lastName}`, normalizeGhanaPhone(parentPhone), timestamp, timestamp]);
        student = { id: studentId, permanentStudentId: demo.permanentStudentId };
      }
      let profile = rows(await tx.query('SELECT id FROM student_profiles WHERE school_id=? AND student_master_id=? LIMIT 1 FOR UPDATE', [schoolId, student.id]))[0];
      if (!profile) {
        const profileId = idFactory();
        await tx.execute(`INSERT INTO student_profiles (id,student_master_id,student_id,school_id,class_id,admission_number,admission_date,first_name,surname,gender,qr_code,enrollment_status,created_at,updated_at)
          VALUES (?,?,?, ?,NULL,?,NULL,?,?,'NOT_SPECIFIED',?,'ACTIVE',?,?)`, [profileId, student.id, demo.permanentStudentId, schoolId, demo.admissionNumber, demo.firstName, demo.lastName, `osaah:student:${profileId}`, timestamp, timestamp]);
        profile = { id: profileId };
      }
      const link = rows(await tx.query('SELECT link_status AS linkStatus FROM parent_student_links WHERE parent_user_id=? AND student_id=? LIMIT 1 FOR UPDATE', [state.parentUserId, profile.id]))[0];
      if (!link) await tx.execute(`INSERT INTO parent_student_links (parent_user_id,student_id,permanent_student_id,telephone,relationship,relationship_type,link_status,created_at,updated_at)
        VALUES (?,?,?,?,'Parent','PARENT','ACTIVE',?,?)`, [state.parentUserId, profile.id, demo.permanentStudentId, normalizeGhanaPhone(parentPhone), timestamp, timestamp]);
      for (const classRow of state.canonicalClasses) {
        await assertDemoAssignmentScope(tx, { schoolId, studentId: student.id, classId: classRow.id });
        await tx.execute(`INSERT IGNORE INTO demo_student_class_assignments (school_id,student_id,class_id,created_by,created_at) VALUES (?,?,?,?,?)`, [schoolId, student.id, classRow.id, actorUserId, timestamp]);
      }
    }
    const scoreResult = await insertMissingMockScores(tx, { schoolId, actorUserId, plans: scorePlans, timestamp, idFactory });
    await tx.execute('INSERT INTO audit_logs (id,school_id,user_id,role_id,action,entity,entity_id,new_value,occurred_at) VALUES (?,?,?,?,?,?,?,?,?)', [idFactory(), schoolId, actorUserId, state.actor.roleId, 'DEMO_STUDENTS_RESTORED', 'DemonstrationStudents', null, JSON.stringify({ studentCount: DEMOS.length, classAssignmentCount: DEMOS.length * state.canonicalClasses.length, parentLinkCount: DEMOS.length, mockScoreCount: scorePlans.length, academicYearId: scorePlans[0].academicYearId, termId: scorePlans[0].termId, mockLabel: MOCK_LABEL }), timestamp]);
    const verified = await inspect(tx, { schoolId, parentPhone, expectedDatabase, migrationChecksum, actorUserId });
    if (verified.missingStudents.length || verified.existingStudents.length !== DEMOS.length || verified.profiles.length !== DEMOS.length || verified.links.length !== DEMOS.length || verified.assignments.length !== DEMOS.length || verified.assignments.some((item) => item.count !== state.canonicalClasses.length)) {
      fail('DEMO_RESTORE_POSTCONDITION_FAILED', 'The transaction did not produce both verified Parent-linked students with every canonical class assignment.');
    }
    const persistedMockScoreCount = rows(await tx.query(`SELECT COUNT(*) AS scoreCount
      FROM academic_score_records r JOIN student_profiles sp ON sp.id=r.student_id AND sp.school_id=r.school_id
      JOIN students s ON (sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id) AND s.school_id=r.school_id
      JOIN classes c ON c.id=r.class_id AND c.school_id=r.school_id
      WHERE r.school_id=? AND s.permanent_student_id IN (?,?) AND s.is_test_record=TRUE
        AND c.name IN ('JHS 1','JHS 2','JHS 3') AND r.record_type='MOCK' AND r.mock_label=?
        AND r.academic_year_id=? AND r.term_id=?`, [schoolId, ...TEST_PARENT_STUDENT_IDS, MOCK_LABEL, scorePlans[0].academicYearId, scorePlans[0].termId]))[0]?.scoreCount ?? 0;
    if (Number(persistedMockScoreCount) < scorePlans.length) fail('DEMO_MOCK_SCORE_POSTCONDITION_FAILED', 'Not all demonstration mock scores were persisted.');
    return { mode: 'APPLIED', databaseName: verified.databaseName, studentCount: DEMOS.length, parentAccountMatched: true, classCount: verified.canonicalClasses.length, assignmentsPerStudent: state.canonicalClasses.length, mockScoreContext: { academicYear: scorePlans[0].academicYear, term: scorePlans[0].term, mockLabel: MOCK_LABEL }, mockScoreCount: scorePlans.length, mockScoresInserted: scoreResult.inserted, mockScoresPreserved: scoreResult.preserved, mockScoresPersisted: Number(persistedMockScoreCount), writesPerformed: true, postconditionsVerified: true };
  };
  if (!apply) return run(database);
  if (typeof database.transaction !== 'function') fail('DEMO_TRANSACTION_REQUIRED', 'Apply requires transactional TiDB writes.');
  return database.transaction(run);
}
