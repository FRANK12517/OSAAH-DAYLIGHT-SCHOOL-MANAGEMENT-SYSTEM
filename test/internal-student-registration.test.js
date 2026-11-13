import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalRoleKey, createAuthService } from '../src/auth.js';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';
import '../src/module-registry.js';
import { createInternalStudentRegistrationService } from '../src/internal-student-registration.js';

test('approved registration permission is assigned only to the four canonical school roles', async () => {
  const migration = await readFile(new URL('../schema/084_internal_student_registration.sql', import.meta.url), 'utf8');
  const registry = await readFile(new URL('../src/module-registry.js', import.meta.url), 'utf8');
  const grant = migration.match(/INSERT IGNORE INTO role_permissions \(role_id, permission_id\)[\s\S]*?WHERE r\.role_key IN \(([^)]+)\)/)?.[1];
  const roles = [...String(grant ?? '').matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(roles, ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'SCHOOL_ADMIN']);
  assert.equal(canonicalRoleKey('Administrator'), 'SCHOOL_ADMIN');
  assert.match(registry, /moduleKey: 'internal-student-registration'[\s\S]*?route: '\/admissions\/register'[\s\S]*?requiredPermission: 'admissions\.write', roles: \['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'\]/);
  assert.match(registry, /registerNavigationGroup\('ADMISSIONS', 'admissions\.read', \['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'\]/);
  assert.doesNotMatch(String(grant ?? ''), /REGIONAL|DISTRICT|NATIONAL|OFFICER/);
  for (const roleKey of roles) {
    const modules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['admissions.write']), roleKey, portal: 'school' }).flatMap((group) => group.modules);
    assert.ok(modules.some((module) => module.route === '/admissions/register' && module.requiredPermission === 'admissions.write'), `${roleKey} should see internal registration`);
  }
  const auth = createAuthService({ users: [], sessionSecret: 'internal-registration-role-test-secret' });
  const created = auth.createAdministrator({ fullName: 'Test Administrator', staffId: 'ADMIN-TEST' }, { id: 'proprietor-1', schoolId: 'school-1' });
  const login = auth.login({ username: created.administrator.username, password: created.temporaryPassword, portal: 'school', role: 'SCHOOL_ADMIN' });
  assert.equal(login.ok, true);
  assert.equal(auth.authenticate(login.token).permissions.has('admissions.write'), true);
});

test('single registration form confirms permanent index and provides a non-destructive full reset', async () => {
  const html = await readFile(new URL('../public/internal-registration.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/internal-registration.js', import.meta.url), 'utf8');
  assert.match(html, /Use this single form for first-time, transfer, and existing OsaaH students/);
  assert.match(html, /id="reset-registration-form"[^>]*>RESET FORM/);
  assert.match(script, /Hi \$\{fullStudentName\}, your permanent student ID is \$\{result\.permanentStudentId\}\./);
  assert.match(html, /IMPORTANT NOTICE[\s\S]*?For all admission categories, every registered student must have a permanent OSAAH Student ID/);
  assert.match(html, /I HAVE AN ID/);
  assert.match(html, /I DO NOT HAVE AN ID/);
  assert.match(html, /Enter Student ID Number/);
  assert.doesNotMatch(html, /<h2>Class Assignment<\/h2>/);
  assert.match(script, /PLEASE WRITE AND SAVE THE NAME AND PERMANENT ID OF THE REGISTERED STUDENT OR LOOK FOR IT IN THE CLASS DATABASE\./);
  assert.match(script, /form\.reset\(\)/);
  assert.match(script, /reservationToken\.value = ''/);
  assert.match(script, /if \(saving\) return/);
});

function databaseFixture() {
  const state = { sequences: new Map(), reservations: [], students: [], profiles: [], guardians: [], health: [], enrollments: [], parentAccounts: [{ id: 'parent-1', email: 'kwame@example.test', phone: '+233241234567', username: '+233241234567' }], parentLinks: [], classes: [{ id: 'class-kg1', name: 'KG1', school_id: 'school-1' }], periods: [{ academicYearId: 'year-2026', academicYearName: '2026/2027', academicYearStartsOn: '2026-09-01', termId: 'term-1' }] };
  let tail = Promise.resolve();
  const query = async (sql, params = []) => {
    if (sql.includes('SELECT next_sequence FROM student_id_sequences')) return [{ next_sequence: state.sequences.get(Number(params[0])) }];
    if (sql.includes('SELECT permanent_student_id FROM students WHERE permanent_student_id LIKE')) return state.students.filter((row) => String(row.permanent_student_id ?? '').startsWith(String(params[0]).replace('%', ''))).map((row) => ({ permanent_student_id: row.permanent_student_id }));
    if (sql.includes('SELECT student_id FROM student_profiles WHERE student_id LIKE')) return state.profiles.filter((row) => String(row.student_id ?? '').startsWith(String(params[0]).replace('%', ''))).map((row) => ({ student_id: row.student_id }));
    if (sql.includes('SELECT permanent_student_id FROM student_id_reservations')) return state.reservations.filter((row) => row.admission_year === Number(params[0])).map((row) => ({ permanent_student_id: row.permanent_student_id }));
    if (sql.includes('SELECT * FROM student_id_reservations')) return state.reservations.filter((row) => row.reservation_token === params[0]);
    if (sql.includes('masterPermanentStudentId') && sql.includes('FROM students s WHERE s.school_id=?')) return state.students.filter((row) => row.school_id === params[0] && row.is_test_record !== true && (sql.includes('s.permanent_student_id=?') ? row.permanent_student_id === params[1] || row.admission_number === params[2] || state.profiles.some((profile) => profile.school_id === row.school_id && profile.student_master_id === row.id && profile.student_id === params[3]) : sql.includes('LOWER(s.first_name)') ? row.first_name.toLowerCase() === String(params[1]).toLowerCase() && row.last_name.toLowerCase() === String(params[2]).toLowerCase() && row.date_of_birth === params[3] : row.id === params[1])).map((row) => ({ studentId: row.id, masterPermanentStudentId: row.permanent_student_id, admissionNumber: row.admission_number, firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name, dateOfBirth: row.date_of_birth, currentClassId: row.current_class_id, gender: row.gender, studentStatus: row.student_status }));
    if (sql.includes('SELECT id AS profileId,student_id AS profileStudentId')) return state.profiles.filter((row) => row.school_id === params[0] && row.student_master_id === params[1]).map((row) => ({ profileId: row.id, profileStudentId: row.student_id, profileClassId: row.class_id, profileFirstName: row.first_name, profileMiddleName: row.middle_name, profileLastName: row.surname, profileDateOfBirth: row.date_of_birth }));
    if (sql.includes('SELECT id,student_id AS permanentStudentId,class_id AS classId FROM student_profiles')) return state.profiles.filter((row) => row.school_id === params[0] && row.student_master_id === params[1]).map((row) => ({ id: row.id, permanentStudentId: row.student_id, classId: row.class_id }));
    if (sql.includes('SELECT permanent_student_id AS permanentStudentId FROM students WHERE school_id=? AND id=?')) return state.students.filter((row) => row.school_id === params[0] && row.id === params[1]).map((row) => ({ permanentStudentId: row.permanent_student_id }));
    if (sql.includes('SELECT id AS studentId,permanent_student_id AS permanentStudentId,admission_number AS admissionNumber')) return state.students.filter((row) => row.school_id === params[0] && (sql.includes('OR admission_number=?') ? (row.permanent_student_id === params[1] || row.admission_number === params[2]) : row.id === params[1]) && row.is_test_record !== true).map((row) => ({ studentId: row.id, permanentStudentId: row.permanent_student_id, admissionNumber: row.admission_number, firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name, dateOfBirth: row.date_of_birth, currentClassId: row.current_class_id, gender: row.gender, studentStatus: row.student_status }));
    if (sql.includes('SELECT id AS studentId,permanent_student_id AS permanentStudentId,first_name AS firstName,last_name AS lastName FROM students WHERE id=')) return state.students.filter((row) => row.id === params[0] && row.school_id === params[1]).map((row) => ({ studentId: row.id, permanentStudentId: row.permanent_student_id, firstName: row.first_name, lastName: row.last_name }));
    if (sql.includes('SELECT id,name FROM classes')) return state.classes.filter((row) => row.id === params[0] && row.school_id === params[1]);
    if (sql.includes('SELECT y.id AS academicYearId')) return state.periods.filter((row) => row.academicYearId === params[1] && row.termId === params[2]);
    if (sql.includes('SELECT id FROM students WHERE school_id=? AND LOWER')) return state.students.filter((row) => row.school_id === params[0] && row.full_name.toLocaleLowerCase() === params[1] && row.date_of_birth === params[2]).map((row) => ({ id: row.id }));
    if (sql.includes('SELECT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName')) {
      return state.students.filter((row) => row.school_id === params[0] && row.permanent_student_id === params[1]).map((row) => {
        const profile = state.profiles.find((item) => item.student_master_id === row.id);
        return { studentId: row.id, permanentStudentId: row.permanent_student_id, firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name, dateOfBirth: row.date_of_birth, currentClassId: row.current_class_id, profileId: profile?.id, profileClassId: profile?.class_id };
      });
    }
    if (sql.includes('SELECT s.id AS studentId') && sql.includes('FROM students s') && sql.includes('permanent_student_id=?')) {
      return state.students.filter((row) => row.school_id === params[0] && row.permanent_student_id === params[1]).map((row) => {
        const profile = state.profiles.find((item) => item.student_master_id === row.id);
        return { studentId: row.id, permanentStudentId: row.permanent_student_id, firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name, dateOfBirth: row.date_of_birth, profileId: profile?.id, classId: profile?.class_id };
      });
    }
    if (sql.includes('SELECT id FROM student_family_contacts') && sql.includes('EMERGENCY_CONTACT')) return state.guardians.filter((row) => row.student_id === params[0] && row.contact_type === 'EMERGENCY_CONTACT');
    if (sql.includes('SELECT id FROM student_family_contacts')) return state.guardians.filter((row) => row.student_id === params[0] && row.contact_type === 'PRIMARY_GUARDIAN');
    if (sql.includes('SELECT student_id FROM student_health_records')) return state.health.filter((row) => row.student_id === params[0]).map((row) => ({ student_id: row.student_id }));
    if (sql.includes('SELECT DISTINCT u.id,u.email,u.phone,u.username FROM users u')) return state.parentAccounts;
    if (sql.includes('SELECT parent_user_id FROM parent_student_links')) return state.parentLinks.filter((row) => row.parent_user_id === params[0] && row.student_id === params[1]).map((row) => ({ parent_user_id: row.parent_user_id }));
    if (sql.includes('SELECT id FROM student_enrollments')) return state.enrollments.filter((row) => row.school_id === params[0] && row.student_id === params[1] && row.academic_year_id === params[2] && row.term_id === params[3] && row.is_current === 1).map((row) => ({ id: row.id }));
    throw new Error(`Unexpected query: ${sql}`);
  };
  const execute = async (sql, params = []) => {
    const count = (sql.match(/\?/g) ?? []).length;
    assert.equal(count, params.length, `SQL bind count mismatch in ${sql}`);
    if (sql.startsWith('INSERT INTO student_id_sequences')) { state.sequences.set(Number(params[0]), 1); return; }
    if (sql.startsWith('UPDATE student_id_sequences')) { state.sequences.set(Number(params[2]), Number(params[0])); return; }
    if (sql.startsWith('INSERT INTO student_id_reservations')) { state.reservations.push({ id: params[0], reservation_token: params[1], permanent_student_id: params[2], admission_year: params[3], sequence_number: params[4], reservation_status: 'RESERVED', reserved_by: params[5], created_at: params[6] }); return; }
    if (sql.startsWith('INSERT INTO students ')) { state.students.push({ id: params[0], permanent_student_id: params[1], school_id: params[2], admission_number: params[3], current_class_id: params[4], first_name: params[5], middle_name: params[6], last_name: params[7], full_name: params[8], gender: params[9], date_of_birth: params[10], parent_guardian_name: params[11], parent_phone: params[12], admission_type: params[14], student_status: params[15] }); return; }
    if (sql.startsWith('INSERT INTO student_profiles')) { state.profiles.push({ id: params[0], student_master_id: params[1], student_id: params[2], school_id: params[3], class_id: params[5], first_name: params[7], middle_name: params[8], surname: params[9], date_of_birth: params[11], home_address: params[13], previous_school: params[15] }); return; }
    if (sql.startsWith('UPDATE student_id_reservations')) { const row = state.reservations.find((item) => item.id === params[2]); Object.assign(row, { reservation_status: 'CONSUMED', student_id: params[0], consumed_at: params[1] }); return; }
    if (sql.startsWith('UPDATE students SET permanent_student_id=')) { const row = state.students.find((item) => item.id === params[3]); Object.assign(row, { permanent_student_id: params[0] }); return; }
    if (sql.startsWith('UPDATE students SET current_class_id=')) { const row = state.students.find((item) => item.id === params[3]); Object.assign(row, { current_class_id: params[0] }); return; }
    if (sql.startsWith('UPDATE student_profiles SET student_id=')) { const row = state.profiles.find((item) => item.id === params[3]); Object.assign(row, { student_id: params[0] }); return; }
    if (sql.startsWith('UPDATE student_profiles SET class_id=')) { const row = state.profiles.find((item) => item.id === params[3]); Object.assign(row, { class_id: params[0] }); return; }
    if (sql.startsWith('UPDATE students SET current_class_id=')) { const row = state.students.find((item) => item.id === params[10]); Object.assign(row, { current_class_id: params[0], first_name: params[1], middle_name: params[2], last_name: params[3], full_name: params[4], gender: params[5], date_of_birth: params[6], parent_guardian_name: params[7], parent_phone: params[8] }); return; }
    if (sql.startsWith('UPDATE student_profiles SET class_id=')) { const row = state.profiles.find((item) => item.id === params[11]); Object.assign(row, { class_id: params[0], first_name: params[1], middle_name: params[2], surname: params[3], home_address: params[7] }); return; }
    if (sql.startsWith('UPDATE student_family_contacts SET full_name=')) { const row = state.guardians.find((item) => item.id === params[8]); Object.assign(row, { full_name: params[0], telephone: params[2], email: params[4], occupation: params[5], national_id: params[6] }); return; }
    if (sql.startsWith('UPDATE student_health_records SET')) { const row = state.health.find((item) => item.student_id === params[5]); Object.assign(row, { allergies: params[0], conditions: params[1], medications: params[2] }); return; }
    if (sql.startsWith('INSERT INTO student_family_contacts')) { state.guardians.push({ id: params[0], student_id: params[1], contact_type: 'PRIMARY_GUARDIAN', full_name: params[2], telephone: params[4], email: params[6], occupation: params[7], national_id: params[8], created_at: params[9], updated_at: params[10] }); return; }
    if (sql.startsWith('INSERT INTO student_health_records')) { state.health.push({ student_id: params[0], allergies: params[1], conditions: params[2], medications: params[3] }); return; }
    if (sql.startsWith('INSERT INTO student_enrollments')) { state.enrollments.push({ id: params[0], student_id: params[1], school_id: params[2], class_id: params[3], academic_year_id: params[4], term_id: params[5], is_current: 1 }); return; }
    if (sql.startsWith('INSERT INTO parent_student_links')) { state.parentLinks.push({ parent_user_id: params[0], student_id: params[1], permanent_student_id: params[2], telephone: params[3] }); return; }
    if (sql.startsWith('UPDATE student_enrollments SET is_current=0')) { for (const row of state.enrollments) if (row.school_id === params[0] && row.student_id === params[1] && row.is_current === 1 && (row.academic_year_id !== params[2] || row.term_id !== params[3])) row.is_current = 0; return; }
    if (sql.startsWith("UPDATE student_enrollments SET class_id=")) { const row = state.enrollments.find((item) => item.id === params[2]); Object.assign(row, { class_id: params[0] }); return; }
    throw new Error(`Unexpected execute: ${sql}`);
  };
  const database = {
    query,
    transaction: async (callback) => {
      let release;
      const prior = tail;
      tail = new Promise((resolve) => { release = resolve; });
      await prior;
      try { return await callback({ query, execute }); } finally { release(); }
    }
  };
  return { database, state };
}

const input = (overrides = {}) => ({
  admissionType: 'FIRST_TIME', firstName: 'Ama', middleName: 'Akua', lastName: 'Mensah', dateOfBirth: '2018-01-02', gender: 'Female',
  classId: 'class-kg1', academicYearId: 'year-2026', termId: 'term-1', homeAddress: 'Bogoso', nationality: 'Ghanaian',
  parentName: 'Kwame Mensah', parentPhone: '0241234567', parentEmail: 'kwame@example.test', occupation: 'Teacher', parentNationalId: 'GHA-123', parentAddress: 'Bogoso',
  allergies: 'Peanuts', medicalConditions: 'Asthma', medications: 'Inhaler', emergencyContactName: 'Adwoa Mensah', emergencyPhone: '0241234568', ...overrides
});

test('permanent ID reservations serialize concurrent clicks and never reuse abandoned numbers', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-11T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const [first, second] = await Promise.all([service.reserve({ actorId: 'staff-1' }), service.reserve({ actorId: 'staff-2' })]);
  assert.deepEqual([first.permanentStudentId, second.permanentStudentId], ['OSAAH/2026/001', 'OSAAH/2026/002']);
  assert.equal(new Set(state.reservations.map((row) => row.permanent_student_id)).size, 2);
  const third = await service.reserve({ actorId: 'staff-1' });
  assert.equal(third.permanentStudentId, 'OSAAH/2026/003');
});

test('permanent ID reservation uses backend calendar year and ignores academic-year input', async () => {
  const { database } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z' });
  const reservation = await service.reserve({ actorId: 'staff-1', year: 2027 });
  assert.equal(reservation.admissionYear, 2026);
  assert.equal(reservation.permanentStudentId, 'OSAAH/2026/001');
});

test('registration persists pupil, parent, health and canonical class enrollment together', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-11T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const reservation = await service.reserve({ actorId: 'staff-1' });
  const result = await service.register(input({ reservationToken: reservation.reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.permanentStudentId, 'OSAAH/2026/001');
  assert.equal(result.className, 'KG1');
  assert.equal(result.created, true);
  assert.equal(state.students.length, 1);
  assert.equal(state.profiles[0].student_id, result.permanentStudentId);
  assert.equal(state.profiles[0].home_address, 'Bogoso');
  assert.equal(state.guardians[0].email, 'kwame@example.test');
  assert.equal(state.guardians[0].occupation, 'Teacher');
  assert.equal(state.guardians[0].national_id, 'GHA-123');
  assert.equal(state.health[0].allergies, 'Peanuts');
  assert.equal(state.health[0].conditions, 'Asthma');
  assert.deepEqual(state.parentLinks, [{ parent_user_id: 'parent-1', student_id: state.profiles[0].id, permanent_student_id: result.permanentStudentId, telephone: '+233241234567' }]);
  assert.equal(state.enrollments[0].class_id, 'class-kg1');
  assert.equal(state.enrollments[0].academic_year_id, 'year-2026');
  assert.equal(state.reservations[0].reservation_status, 'CONSUMED');
  const retry = await service.register(input({ reservationToken: reservation.reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(retry.created, false);
  assert.equal(state.students.length, 1);
});

test('existing student category verifies identity and preserves permanent ID', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-11T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const reservation = await service.reserve({ actorId: 'staff-1' });
  const created = await service.register(input({ reservationToken: reservation.reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  const existingId = await service.findExistingStudent(created.permanentStudentId, 'school-1');
  assert.equal(existingId.firstName, 'Ama');
  const result = await service.register(input({ admissionType: 'ALREADY_ENROLLED', reservationToken: '', existingPermanentStudentId: created.permanentStudentId, classId: 'class-kg1' }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.permanentStudentId, created.permanentStudentId);
  assert.equal(result.created, false);
  assert.equal(state.students.length, 1);
  assert.equal(state.reservations[0].permanent_student_id, created.permanentStudentId);
});

test('existing student without an ID receives a backend ID on the same record and remains enrolled once', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const initialReservation = await service.reserve({ actorId: 'staff-1' });
  const original = await service.register(input({ reservationToken: initialReservation.reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  const student = state.students[0], profile = state.profiles[0];
  student.permanent_student_id = null;
  profile.student_id = null;
  const match = await service.findExistingStudent({ firstName: 'Ama', lastName: 'Mensah', dateOfBirth: '2018-01-02' }, 'school-1');
  assert.equal(match.studentId, student.id);
  assert.equal(match.permanentStudentId, null);
  const reservation = await service.reserve({ actorId: 'staff-1' });
  const result = await service.register(input({ admissionType: 'ALREADY_ENROLLED', existingIdChoice: 'NO_ID', existingStudentId: student.id, reservationToken: reservation.reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.permanentStudentId, 'OSAAH/2026/002');
  assert.equal(result.created, false);
  assert.equal(state.students.length, 1);
  assert.equal(student.id, original.student.studentId);
  assert.equal(student.permanent_student_id, result.permanentStudentId);
  assert.equal(profile.student_id, result.permanentStudentId);
  assert.equal(state.enrollments.length, 1);
  assert.equal(state.reservations[1].reservation_status, 'CONSUMED');
});

test('existing student permanent ID assignment is conditional and confirmed from the database', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const original = await service.register(input({ reservationToken: (await service.reserve({ actorId: 'staff-1' })).reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  const student = state.students[0], profile = state.profiles[0];
  student.permanent_student_id = null;
  profile.student_id = null;
  const reservation = await service.reserve({ actorId: 'staff-1' });
  const result = await service.register(input({ admissionType: 'ALREADY_ENROLLED', existingIdChoice: 'NO_ID', existingStudentId: student.id, reservationToken: reservation.reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.student.studentId, original.student.studentId);
  assert.equal(result.permanentStudentId, 'OSAAH/2026/002');
  assert.equal(student.permanent_student_id, result.permanentStudentId);
  assert.equal(profile.student_id, result.permanentStudentId);
});

test('an entered existing ID is preserved without creating an ID reservation', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const reservation = await service.reserve({ actorId: 'staff-1' });
  await service.register(input({ reservationToken: reservation.reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  const existingId = state.students[0].permanent_student_id;
  const result = await service.register(input({ admissionType: 'ALREADY_ENROLLED', existingIdChoice: 'HAVE_ID', existingStudentId: state.students[0].id, existingPermanentStudentId: existingId }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.permanentStudentId, existingId);
  assert.equal(state.students.length, 1);
  assert.equal(state.reservations.length, 1);
});

test('an existing ID stored only in the linked profile resolves to the existing master record', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z' });
  const reservation = await service.reserve({ actorId: 'staff-1' });
  await service.register(input({ reservationToken: reservation.reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  const student = state.students[0], profile = state.profiles[0], existingId = profile.student_id;
  student.permanent_student_id = null;
  const found = await service.findExistingStudent({ permanentStudentId: existingId }, 'school-1');
  assert.equal(found.studentId, student.id);
  assert.equal(found.permanentStudentId, existingId);
  const result = await service.register(input({ admissionType: 'ALREADY_ENROLLED', existingIdChoice: 'HAVE_ID', existingStudentId: student.id, existingPermanentStudentId: existingId }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.permanentStudentId, existingId);
  assert.equal(student.permanent_student_id, existingId);
  assert.equal(state.students.length, 1);
  assert.equal(state.reservations.length, 1);
});

test('transfer admissions use the same reserved-ID registration path and retain the previous school', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-11T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const reservation = await service.reserve({ actorId: 'staff-1' });
  const result = await service.register(input({ admissionType: 'TRANSFER', previousSchool: 'Bogoso Basic School', reservationToken: reservation.reservationToken }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.permanentStudentId, 'OSAAH/2026/001');
  assert.equal(result.created, true);
  assert.equal(state.students[0].admission_type, 'TRANSFER');
  assert.equal(state.profiles[0].previous_school, 'Bogoso Basic School');
  assert.equal(state.parentLinks.length, 1);
});
