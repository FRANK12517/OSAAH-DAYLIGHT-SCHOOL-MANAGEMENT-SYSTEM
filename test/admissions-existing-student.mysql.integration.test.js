import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import mysql from 'mysql2/promise';
import { createAdmissionEnrollmentService } from '../src/admission-enrollment.js';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { createDurableAdmissionsService } from '../src/durable-admissions.js';
import { createExistingStudentLinkingService } from '../src/existing-student-linking.js';

const sourceUrl = process.env.OSAAH_MYSQL_TEST_URL;
const schoolId = 'it-school-1';
const actor = { id: 'it-headteacher', portal: 'school', roleKey: 'HEADTEACHER', schoolId };
const now = '2026-10-11 00:00:00';
const documents = ['PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD', 'LAST_ACADEMIC_REPORT', 'ADMISSION_RECEIPT'];

function connectionConfig(url, database) {
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ...(database ? { database } : {}),
    ssl: false,
    waitForConnections: true,
    connectionLimit: 6,
    queueLimit: 0
  };
}

async function createDisposableSchema(admin, name) {
  await admin.query(`CREATE DATABASE \`${name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
  await admin.changeUser({ database: name });
  const ddl = [
    `CREATE TABLE students (
      id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, user_id VARCHAR(64) NULL,
      admission_number VARCHAR(64) NOT NULL, permanent_student_id VARCHAR(100) NULL,
      current_class_id VARCHAR(64) NULL, admission_date DATE NULL, admission_type VARCHAR(32) NULL,
      parent_guardian_name VARCHAR(255) NULL, parent_phone VARCHAR(50) NULL,
      first_name VARCHAR(100) NOT NULL, middle_name VARCHAR(100) NULL, last_name VARCHAR(100) NOT NULL,
      full_name VARCHAR(255) NULL, gender VARCHAR(32) NOT NULL DEFAULT 'NOT_SPECIFIED',
      date_of_birth DATE NULL, student_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
      is_test_record TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
      UNIQUE KEY uq_students_school_admission (school_id, admission_number),
      UNIQUE KEY uq_students_school_permanent (school_id, permanent_student_id),
      KEY ix_students_permanent (permanent_student_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE student_profiles (
      id VARCHAR(64) PRIMARY KEY, student_master_id VARCHAR(64) NOT NULL, student_id VARCHAR(100) NULL,
      school_id VARCHAR(64) NOT NULL, admission_number VARCHAR(64) NOT NULL,
      first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL, gender VARCHAR(32) NULL,
      date_of_birth DATE NULL, class_id VARCHAR(64) NULL, stream_id VARCHAR(64) NULL, admission_date DATE NULL,
      enrollment_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', created_at DATETIME NOT NULL,
      KEY ix_profile_master (school_id, student_master_id),
      KEY ix_profile_student_id (student_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE classes (
      id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, name VARCHAR(100) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE'
    ) ENGINE=InnoDB`,
    `CREATE TABLE academic_years (
      id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, name VARCHAR(64) NOT NULL,
      UNIQUE KEY uq_year_school_name (school_id, name)
    ) ENGINE=InnoDB`,
    `CREATE TABLE student_enrollments (
      id VARCHAR(64) PRIMARY KEY, student_id VARCHAR(64) NOT NULL, school_id VARCHAR(64) NOT NULL,
      class_id VARCHAR(64) NOT NULL, academic_year_id VARCHAR(64) NOT NULL, term_id VARCHAR(64) NULL,
      enrollment_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', is_current TINYINT(1) NOT NULL DEFAULT 1,
      enrolled_at DATETIME NULL, KEY ix_enrollment_link (school_id, student_id, academic_year_id, class_id, term_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE admission_applications (
      id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, application_number VARCHAR(100) NOT NULL,
      enquiry_request_id VARCHAR(100) NULL, stage VARCHAR(32) NOT NULL, applicant_data LONGTEXT NOT NULL,
      student_id VARCHAR(64) NULL, permanent_student_id VARCHAR(100) NULL,
      created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL,
      UNIQUE KEY uq_application_number (school_id, application_number),
      UNIQUE KEY uq_enquiry_request (school_id, enquiry_request_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE audit_logs (
      id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, user_id VARCHAR(64) NULL,
      action VARCHAR(100) NOT NULL, entity VARCHAR(100) NOT NULL, entity_id VARCHAR(64) NULL,
      new_value LONGTEXT NULL, occurred_at DATETIME NULL, details LONGTEXT NULL, created_at DATETIME NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE users (
      id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, username VARCHAR(100) NOT NULL,
      email VARCHAR(255) NULL, phone VARCHAR(50) NULL, password_hash VARCHAR(255) NULL, full_name VARCHAR(255) NULL,
      role VARCHAR(32) NULL, status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE', created_at DATETIME NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE parent_student_links (
      parent_user_id VARCHAR(64) NOT NULL, student_id VARCHAR(64) NOT NULL,
      permanent_student_id VARCHAR(100) NULL, telephone VARCHAR(50) NULL, relationship VARCHAR(64) NULL,
      relationship_type VARCHAR(64) NULL, link_status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
      created_at DATETIME NOT NULL, updated_at DATETIME NULL, PRIMARY KEY(parent_user_id, student_id)
    ) ENGINE=InnoDB`,
    `CREATE TABLE student_class_history (
      id VARCHAR(64) PRIMARY KEY, student_id VARCHAR(64) NOT NULL, class_id VARCHAR(64) NOT NULL,
      academic_year_id VARCHAR(64) NOT NULL, reason VARCHAR(100) NOT NULL, effective_at DATETIME NOT NULL
    ) ENGINE=InnoDB`,
    `CREATE TABLE roles (id VARCHAR(64) PRIMARY KEY, school_id VARCHAR(64) NOT NULL, role_key VARCHAR(64) NOT NULL) ENGINE=InnoDB`,
    `CREATE TABLE user_roles (id VARCHAR(64) PRIMARY KEY, user_id VARCHAR(64) NOT NULL, role_id VARCHAR(64) NOT NULL, created_at DATETIME NOT NULL) ENGINE=InnoDB`
  ];
  for (const statement of ddl) await admin.query(statement);
}

function fullApplicationInput(admissionType) {
  return {
    studentSurname: `Student-${admissionType}`,
    studentFirstName: 'Test',
    dateOfBirth: '2016-04-05',
    gender: 'Female',
    hometown: 'Accra',
    region: 'Greater Accra',
    nationality: 'Ghanaian',
    classAppliedFor: 'class-primary-2',
    className: 'Primary 2',
    residentialAddress: 'Test address',
    digitalAddress: 'GA-000-0000',
    nearestLandmark: 'Test landmark',
    primaryGuardianFullName: 'Test Guardian',
    primaryGuardianRelationship: 'Parent',
    primaryGuardianPrimaryPhone: '0241234567',
    academicYear: '2026/2027',
    academicYearId: 'year-2026',
    admissionTerm: 'TERM_1',
    termId: 'term-1',
    admissionType
  };
}

test('existing-student and admissions safeguards use real disposable MySQL transactions', { skip: !sourceUrl }, async (t) => {
  const parsedUrl = new URL(sourceUrl);
  assert.equal(parsedUrl.protocol, 'mysql:', 'OSAAH_MYSQL_TEST_URL must use mysql://');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(parsedUrl.hostname), 'Refusing to run destructive schema setup against a non-loopback host.');
  assert.ok(parsedUrl.username, 'OSAAH_MYSQL_TEST_URL must specify a disposable local MySQL user.');

  const schemaName = `osaah_it_${process.pid}_${randomBytes(4).toString('hex')}`;
  const admin = await mysql.createConnection(connectionConfig(parsedUrl));
  let database;
  try {
    await createDisposableSchema(admin, schemaName);
    const schemaUrl = new URL(sourceUrl);
    schemaUrl.pathname = `/${schemaName}`;
    database = createDatabaseAdapter({
      environment: { DATABASE_URL: schemaUrl.toString() },
      // The repository adapter keeps its real mysql2 driver/transaction implementation;
      // TLS is disabled only for this disposable loopback MySQL instance.
      poolFactory: () => mysql.createPool(connectionConfig(parsedUrl, schemaName))
    });
    const migrationSql = await readFile(new URL('../schema/027_student_id_sequences.sql', import.meta.url), 'utf8');
    await database.transaction((tx) => tx.executeMigrationSql(migrationSql, { version: 27, migrationName: '027_student_id_sequences.sql' }));

    await database.execute('INSERT INTO classes (id,school_id,name,status) VALUES (?,?,?,?)', ['class-primary-2', schoolId, 'Primary 2', 'ACTIVE']);
    await database.execute('INSERT INTO classes (id,school_id,name,status) VALUES (?,?,?,?)', ['class-primary-3', schoolId, 'Primary 3', 'ACTIVE']);
    await database.execute('INSERT INTO classes (id,school_id,name,status) VALUES (?,?,?,?)', ['class-other', 'it-school-2', 'Primary 2', 'ACTIVE']);
    await database.execute('INSERT INTO academic_years (id,school_id,name) VALUES (?,?,?)', ['year-2026', schoolId, '2026/2027']);
    await database.execute('INSERT INTO users (id,school_id,username,status) VALUES (?,?,?,?)', ['parent-1', schoolId, 'parent@example.test', 'ACTIVE']);
    await database.execute('UPDATE users SET phone=? WHERE id=?', ['0241234567', 'parent-1']);
    await database.execute('INSERT INTO roles (id,school_id,role_key) VALUES (?,?,?)', ['role-parent', schoolId, 'PARENT']);
    await database.execute('INSERT INTO user_roles (id,user_id,role_id,created_at) VALUES (?,?,?,?)', ['user-role-parent', 'parent-1', 'role-parent', now]);
    await database.execute('INSERT INTO students (id,school_id,admission_number,permanent_student_id,first_name,last_name,full_name,gender,date_of_birth,student_status,is_test_record,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ['student-existing', schoolId, 'ADM-001', 'OSAAH/2022/004', 'Ama', 'Mensah', 'Ama Mensah', 'Female', '2014-02-03', 'ACTIVE', 0, now, now]);
    await database.execute('INSERT INTO students (id,school_id,admission_number,permanent_student_id,first_name,last_name,full_name,gender,date_of_birth,student_status,is_test_record,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ['student-duplicate', schoolId, 'ADM-001B', 'OSAAH/2021/002', 'Ama', 'Mensah', 'Ama Mensah', 'Female', '2014-02-03', 'ACTIVE', 0, now, now]);
    await database.execute('INSERT INTO student_profiles (id,student_master_id,student_id,school_id,admission_number,first_name,last_name,gender,date_of_birth,class_id,enrollment_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', ['profile-existing', 'student-existing', 'OSAAH/2022/004', schoolId, 'ADM-001', 'Ama', 'Mensah', 'Female', '2014-02-03', 'class-primary-2', 'ACTIVE', now]);
    await database.execute('INSERT INTO student_enrollments (id,student_id,school_id,class_id,academic_year_id,term_id,enrollment_status,is_current,enrolled_at) VALUES (?,?,?,?,?,?,?,?,?)', ['enrollment-existing', 'student-existing', schoolId, 'class-primary-2', 'year-2026', 'term-1', 'ACTIVE', 1, now]);
    await database.execute('INSERT INTO parent_student_links (parent_user_id,student_id,relationship,telephone,created_at) VALUES (?,?,?,?,?)', ['parent-1', 'profile-existing', 'Parent', '0241234567', now]);
    await database.execute('INSERT INTO student_class_history (id,student_id,class_id,academic_year_id,reason,effective_at) VALUES (?,?,?,?,?,?)', ['history-existing', 'profile-existing', 'class-primary-2', 'year-2026', 'PROMOTION', now]);
    await database.execute('INSERT INTO admission_applications (id,school_id,application_number,stage,applicant_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', ['app-existing', schoolId, 'APP-ALREADY-001', 'DRAFT', JSON.stringify({ admissionType: 'ALREADY_ENROLLED', studentFirstName: 'Ama', studentSurname: 'Mensah', dateOfBirth: '2014-02-03' }), now, now]);
    await database.execute('INSERT INTO admission_applications (id,school_id,application_number,stage,applicant_data,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', ['app-unresolved', schoolId, 'APP-ALREADY-002', 'DRAFT', JSON.stringify({ admissionType: 'ALREADY_ENROLLED', studentFirstName: 'Different', studentSurname: 'Person', dateOfBirth: '2015-01-01' }), now, now]);

    const linking = createExistingStudentLinkingService({ database, schoolId, clock: () => now, idFactory: (() => { let n = 0; return () => `link-${++n}`; })() });
    const preview = await linking.preview({ permanentStudentId: 'OSAAH/2022/004' }, actor);
    assert.equal(preview.student.id, 'student-existing');
    assert.equal(preview.student.healthInsuranceNumber, undefined);
    assert.equal(preview.student.enrollment.classId, 'class-primary-2');
    await assert.rejects(() => linking.link({ permanentStudentId: 'OSAAH/2022/004', classId: 'class-primary-2', academicYearId: 'year-2026' }, actor), { code: 'IDENTITY_CONFIRMATION_REQUIRED' });

    await assert.rejects(() => linking.preview({ firstName: 'Ama', lastName: 'Mensah', dateOfBirth: '2014-02-03' }, actor), { code: 'AMBIGUOUS_IDENTITY', status: 409 });
    await assert.rejects(() => linking.preview({ studentId: 'student-existing' }, { ...actor, roleKey: 'TEACHER' }), { code: 'LINKING_FORBIDDEN', status: 403 });
    await assert.rejects(() => linking.preview({ studentId: 'student-existing' }, { ...actor, schoolId: 'it-school-2' }), { code: 'LINKING_FORBIDDEN', status: 403 });
    await assert.rejects(() => linking.preview({ studentId: 'student-not-in-school' }, actor), { code: 'STUDENT_NOT_FOUND', status: 404 });

    const existingLink = await linking.link({ permanentStudentId: 'OSAAH/2022/004', confirmedStudentId: 'student-existing', confirmIdentity: true, applicationNumber: 'APP-ALREADY-001', classId: 'class-primary-2', academicYearId: 'year-2026', termId: 'term-1' }, actor);
    assert.equal(existingLink.student.permanentStudentId, 'OSAAH/2022/004');
    assert.equal(existingLink.createdProfile, false);
    assert.equal(existingLink.createdEnrollment, false);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM students WHERE id=?', ['student-existing']))[0].count), 1);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_profiles WHERE student_master_id=?', ['student-existing']))[0].count), 1);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id=?', ['student-existing']))[0].count), 1);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM parent_student_links WHERE student_id=?', ['profile-existing']))[0].count), 1);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_class_history WHERE student_id=?', ['profile-existing']))[0].count), 1);
    const linkedApp = (await database.query('SELECT student_id,permanent_student_id,stage FROM admission_applications WHERE application_number=?', ['APP-ALREADY-001']))[0];
    assert.deepEqual(linkedApp, { student_id: 'student-existing', permanent_student_id: 'OSAAH/2022/004', stage: 'ENROLLMENT' });
    const repeatedLink = await linking.link({ permanentStudentId: 'OSAAH/2022/004', confirmedStudentId: 'student-existing', confirmIdentity: true, applicationNumber: 'APP-ALREADY-001', classId: 'class-primary-2', academicYearId: 'year-2026', termId: 'term-1' }, actor);
    assert.equal(repeatedLink.createdEnrollment, false);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id=?', ['student-existing']))[0].count), 1);
    await assert.rejects(() => linking.link({ permanentStudentId: 'OSAAH/2022/004', confirmedStudentId: 'student-existing', confirmIdentity: true, classId: 'class-primary-3', academicYearId: 'year-2026', termId: 'term-1' }, actor), { code: 'CURRENT_ENROLLMENT_CONFLICT', status: 409 });
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id=?', ['student-existing']))[0].count), 1);

    await assert.rejects(() => linking.link({ permanentStudentId: 'OSAAH/2022/004', confirmedStudentId: 'student-existing', confirmIdentity: true, applicationNumber: 'APP-ALREADY-002', classId: 'class-primary-2', academicYearId: 'year-2026', termId: 'term-1' }, actor), { code: 'APPLICATION_IDENTITY_CONFLICT', status: 409 });
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM audit_logs WHERE action=?', ['EXISTING_STUDENT_LINKED']))[0].count), 2);

    const durableAdmissions = createDurableAdmissionsService({ database, schoolId, clock: () => now, idFactory: (() => { let n = 0; return () => `app-${++n}`; })() });
    const existingApp = await durableAdmissions.createApplication(fullApplicationInput('ALREADY_ENROLLED'), actor);
    const admissionsWriteCount = Number((await database.query('SELECT COUNT(*) AS count FROM admission_applications WHERE application_number=?', [existingApp.applicationNumber]))[0].count);
    const existingAppSnapshot = (await database.query('SELECT stage,applicant_data,student_id,permanent_student_id FROM admission_applications WHERE application_number=?', [existingApp.applicationNumber]))[0];
    await assert.rejects(() => durableAdmissions.updateApplication(existingApp.applicationNumber, { admissionType: 'TRANSFER' }, actor), { status: 409 });
    for (const transition of [
      () => durableAdmissions.submitApplication(existingApp.applicationNumber, actor),
      () => durableAdmissions.attachDocument(existingApp.applicationNumber, { documentType: 'NHIS_CARD', storageKey: 'private/test.pdf' }, actor),
      () => durableAdmissions.reviewDocument(existingApp.applicationNumber, 'missing-document', { status: 'APPROVED' }, actor),
      () => durableAdmissions.reviewApplication(existingApp.applicationNumber, { status: 'UNDER_REVIEW', assessmentDate: '2026-10-09', assessmentScore: 90, assessmentRemarks: 'Test' }, actor),
      () => durableAdmissions.acceptOffer(existingApp.applicationNumber, actor),
      () => durableAdmissions.attachStudent(existingApp.applicationNumber, { id: 'unrelated-student', permanentStudentId: 'OSAAH/2026/999' }, actor)
    ]) await assert.rejects(transition, { code: 'EXISTING_STUDENT_LINK_REQUIRED', status: 409 });
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM admission_applications WHERE application_number=?', [existingApp.applicationNumber]))[0].count), admissionsWriteCount);
    assert.deepEqual((await database.query('SELECT stage,applicant_data,student_id,permanent_student_id FROM admission_applications WHERE application_number=?', [existingApp.applicationNumber]))[0], existingAppSnapshot);

    const enrollmentService = createAdmissionEnrollmentService({ database, clock: () => now });
    await assert.rejects(() => enrollmentService.enroll({ applicationId: existingApp.id }), { code: 'EXISTING_STUDENT_LINK_REQUIRED', status: 409 });
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM students'))[0].count), 2);

    const existingIdProfileOnly = 'OSAAH/2021/015';
    await database.execute('INSERT INTO students (id,school_id,admission_number,permanent_student_id,first_name,last_name,full_name,gender,date_of_birth,student_status,is_test_record,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ['student-profile-id', schoolId, 'ADM-003', null, 'Kojo', 'Owusu', 'Kojo Owusu', 'Male', '2013-06-07', 'ACTIVE', 0, now, now]);
    await database.execute('INSERT INTO student_profiles (id,student_master_id,student_id,school_id,admission_number,first_name,last_name,gender,date_of_birth,class_id,enrollment_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', ['profile-id-only', 'student-profile-id', existingIdProfileOnly, schoolId, 'ADM-003', 'Kojo', 'Owusu', 'Male', '2013-06-07', 'class-primary-2', 'ACTIVE', now]);
    const profileIdPreview = await linking.preview({ firstName: 'Kojo', lastName: 'Owusu', dateOfBirth: '2013-06-07' }, actor);
    assert.equal(profileIdPreview.student.id, 'student-profile-id');
    assert.equal(profileIdPreview.student.dateOfBirth, '2013-06-07');
    const profileIdLink = await linking.link({ permanentStudentId: existingIdProfileOnly, confirmedStudentId: 'student-profile-id', confirmIdentity: true, classId: 'class-primary-2', academicYearId: 'year-2026', termId: 'term-1' }, actor);
    assert.equal(profileIdLink.student.permanentStudentId, existingIdProfileOnly);
    assert.equal((await database.query('SELECT permanent_student_id FROM students WHERE id=?', ['student-profile-id']))[0].permanent_student_id, existingIdProfileOnly);

    await database.execute('INSERT INTO students (id,school_id,admission_number,permanent_student_id,first_name,last_name,full_name,gender,date_of_birth,student_status,is_test_record,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ['student-no-id', schoolId, 'ADM-002', null, 'Kofi', 'Boateng', 'Kofi Boateng', 'Male', '2012-08-09', 'ACTIVE', 0, now, now]);
    const newStudentPreview = await linking.preview({ admissionNumber: 'ADM-002' }, actor);
    const newStudentPayload = { admissionNumber: 'ADM-002', confirmedStudentId: newStudentPreview.student.id, confirmIdentity: true, historicalAdmissionYear: '2020', classId: 'class-primary-2', academicYearId: 'year-2026', termId: 'term-1' };
    await assert.rejects(() => linking.link({ ...newStudentPayload, classId: 'class-missing' }, actor), { code: 'CLASS_NOT_FOUND', status: 409 });
    assert.equal((await database.query('SELECT permanent_student_id FROM students WHERE id=?', ['student-no-id']))[0].permanent_student_id, null);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_profiles WHERE student_master_id=?', ['student-no-id']))[0].count), 0);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_id_sequences WHERE admission_year=?', [2020]))[0].count), 0, 'the sequence row created by the failed transaction must roll back');

    const concurrent = await Promise.all([linking.link(newStudentPayload, actor), linking.link(newStudentPayload, actor)]);
    assert.equal(concurrent[0].student.permanentStudentId, 'OSAAH/2020/001');
    assert.equal(concurrent[1].student.permanentStudentId, 'OSAAH/2020/001');
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_profiles WHERE student_master_id=?', ['student-no-id']))[0].count), 1);
    assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id=? AND academic_year_id=? AND class_id=? AND term_id=?', ['student-no-id', 'year-2026', 'class-primary-2', 'term-1']))[0].count), 1);
    assert.equal(Number((await database.query('SELECT next_sequence FROM student_id_sequences WHERE admission_year=?', [2020]))[0].next_sequence), 2);

    await database.execute('INSERT INTO students (id,school_id,admission_number,permanent_student_id,first_name,last_name,full_name,gender,date_of_birth,student_status,is_test_record,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', ['student-blank-id', schoolId, 'ADM-004', '', 'Esi', 'Quaye', 'Esi Quaye', 'Female', '2014-05-10', 'ACTIVE', 0, now, now]);
    const blankIdPreview = await linking.preview({ admissionNumber: 'ADM-004' }, actor);
    const blankIdLink = await linking.link({ admissionNumber: 'ADM-004', confirmedStudentId: blankIdPreview.student.id, confirmIdentity: true, historicalAdmissionYear: '2018', classId: 'class-primary-2', academicYearId: 'year-2026', termId: 'term-1' }, actor);
    assert.equal(blankIdLink.student.permanentStudentId, 'OSAAH/2018/001');
    assert.equal((await database.query('SELECT permanent_student_id FROM students WHERE id=?', ['student-blank-id']))[0].permanent_student_id, 'OSAAH/2018/001');

    let regularEnrollmentSequence = 1;
    for (const admissionType of ['TRANSFER', 'FIRST_TIME']) {
      const application = await durableAdmissions.createApplication(fullApplicationInput(admissionType), actor);
      for (const documentType of documents) await durableAdmissions.attachDocument(application.applicationNumber, { documentType, storageKey: `private/${application.id}/${documentType}.pdf` }, actor);
      const submitted = await durableAdmissions.submitApplication(application.applicationNumber, actor);
      assert.equal(submitted.status, 'SUBMITTED');
      for (const document of submitted.documents) await durableAdmissions.reviewDocument(application.applicationNumber, document.id, { status: 'APPROVED' }, actor);
      const assessed = await durableAdmissions.reviewApplication(application.applicationNumber, { status: 'UNDER_REVIEW', assessmentDate: '2026-10-09', assessmentScore: 90, assessmentRemarks: 'Integration interview complete.' }, actor);
      assert.equal(assessed.status, 'UNDER_REVIEW');
      const accepted = await durableAdmissions.reviewApplication(application.applicationNumber, { status: 'ACCEPTED', classAssigned: 'class-primary-2', decisionReason: 'Integration test approval.' }, actor);
      assert.equal(accepted.status, 'ACCEPTED');
      assert.equal((await durableAdmissions.acceptOffer(application.applicationNumber, actor)).workflow.currentStage, 'REGISTRATION');
      const enrolled = await enrollmentService.enroll({ applicationId: application.id, actorId: actor.id });
      assert.equal(enrolled.created, true);
      assert.equal(enrolled.student.permanentStudentId, `OSAAH/2026/${String(regularEnrollmentSequence++).padStart(3, '0')}`);
      assert.equal(enrolled.student.schoolId, schoolId);
      assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_profiles WHERE student_master_id=?', [enrolled.student.id]))[0].count), 1);
      assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM student_enrollments WHERE student_id=? AND school_id=? AND class_id=? AND academic_year_id=? AND is_current=1', [enrolled.student.id, schoolId, 'class-primary-2', 'year-2026']))[0].count), 1);
      assert.equal(Number((await database.query('SELECT COUNT(*) AS count FROM parent_student_links WHERE parent_user_id=? AND student_id=? AND link_status=?', ['parent-1', enrolled.profileId, 'ACTIVE']))[0].count), 1);
      assert.equal((await database.query('SELECT stage,student_id,permanent_student_id FROM admission_applications WHERE id=?', [application.id]))[0].stage, 'ENROLLMENT');
    }

    await t.test('transactional DB is MySQL 8 and the real migration created the ID sequence table', async () => {
      const version = (await database.query('SELECT VERSION() AS version'))[0].version;
      assert.match(version, /^8\./);
      const schema = (await database.query('SELECT DATABASE() AS name'))[0].name;
      assert.equal(schema, schemaName);
      assert.equal(Number((await database.query("SELECT COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_id_sequences'"))[0].count), 1);
    });
  } finally {
    await database?.close().catch(() => {});
    await admin.query(`DROP DATABASE IF EXISTS \`${schemaName}\``).catch(() => {});
    await admin.end().catch(() => {});
  }
});
