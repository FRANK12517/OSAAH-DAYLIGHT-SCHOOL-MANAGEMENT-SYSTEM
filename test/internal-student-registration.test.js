import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalRoleKey, createAuthService } from '../src/auth.js';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';
import '../src/module-registry.js';
import { createInternalStudentRegistrationService } from '../src/internal-student-registration.js';

test('canonical student registration navigation is unique and restricted to leadership roles', async () => {
  const migration = await readFile(new URL('../schema/084_internal_student_registration.sql', import.meta.url), 'utf8');
  const registry = await readFile(new URL('../src/module-registry.js', import.meta.url), 'utf8');
  const grant = migration.match(/INSERT IGNORE INTO role_permissions \(role_id, permission_id\)[\s\S]*?WHERE r\.role_key IN \(([^)]+)\)/)?.[1];
  const roles = [...String(grant ?? '').matchAll(/'([A-Z_]+)'/g)].map((match) => match[1]);
  assert.deepEqual(roles, ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'SCHOOL_ADMIN']);
  assert.equal(canonicalRoleKey('Administrator'), 'SCHOOL_ADMIN');
  assert.match(registry, /moduleKey: 'admissions', moduleName: 'Student Registration'[\s\S]*?route: '\/admissions\/register'[\s\S]*?requiredPermission: 'admissions\.write', roles: \['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'\]/);
  assert.doesNotMatch(registry, /moduleKey: 'internal-student-registration'/);
  assert.match(registry, /registerNavigationGroup\('ADMISSIONS', 'admissions\.read', \['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'\]/);
  assert.doesNotMatch(String(grant ?? ''), /REGIONAL|DISTRICT|NATIONAL|OFFICER/);
  for (const roleKey of roles) {
    const modules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: new Set(['admissions.write']), roleKey, portal: 'school' }).flatMap((group) => group.modules);
    assert.equal(modules.filter((module) => module.route === '/admissions/register').length, 1, `${roleKey} should see one canonical registration route`);
  }
  const auth = createAuthService({ users: [], sessionSecret: 'internal-registration-role-test-secret' });
  const created = auth.createAdministrator({ fullName: 'Test Administrator', staffId: 'ADMIN-TEST' }, { id: 'proprietor-1', schoolId: 'school-1' });
  const login = auth.login({ username: created.administrator.username, password: created.temporaryPassword, portal: 'school', role: 'SCHOOL_ADMIN' });
  assert.equal(login.ok, true);
  assert.equal(auth.authenticate(login.token).permissions.has('admissions.write'), true);
});

test('registration must save first and only then expose permanent ID generation', async () => {
  const html = await readFile(new URL('../public/internal-registration.html', import.meta.url), 'utf8');
  const script = await readFile(new URL('../public/internal-registration.js', import.meta.url), 'utf8');
  assert.match(html, /Use this single form for first-time, transfer, and existing OsaaH students/);
  assert.match(html, /id="reset-registration-form"[^>]*>RESET FORM/);
  assert.match(html, /Submit and save registration first/);
  assert.equal((html.match(/type="submit"/g) ?? []).length, 1);
  const submitter = html.match(/<button class="primary-button" type="submit">([^<]+)<\/button>/)?.[1];
  assert.equal(submitter, 'Submit and Save Registration');
  assert.match(html, /<button class="primary-button" type="submit">Submit and Save Registration<\/button>[\s\S]*?id="generate-student-id"/);
  assert.doesNotMatch(html.slice(html.indexOf('<h2>IMPORTANT NOTICE</h2>'), html.indexOf('</form>')), /type="submit"/);
  assert.match(html, /id="generate-student-id"[^>]*disabled/);
  assert.match(script, /registeredStudentId = result\.studentId/);
  assert.match(script, /body: JSON\.stringify\(\{ studentId: registeredStudentId \}\)/);
  assert.doesNotMatch(script, /reservationToken/);
  assert.match(html, /IMPORTANT NOTICE[\s\S]*?For all admission categories, every registered student must have a permanent OSAAH Student ID/);
  assert.match(html, /I HAVE AN ID/);
  assert.match(html, /I DO NOT HAVE AN ID/);
  assert.match(html, /Enter Student ID Number/);
  assert.match(html, /name="academicYearId" required/);
  assert.match(html, /name="termId" required/);
  assert.match(script, /localStorage\.setItem\(draftKey/);
  assert.match(script, /localStorage\.setItem\(draftKey/);
  assert.match(script, /Select an academic year and one valid term/);
  assert.doesNotMatch(html, /<h2>Class Assignment<\/h2>/);
  assert.match(script, /Registration saved and confirmed/);
  assert.match(script, /form\.reset\(\)/);
  assert.match(script, /registrationToken\.value = ''/);
  assert.match(script, /if \(saving\) return/);
});

function databaseFixture() {
  const state = { sequences: new Map(), reservations: [], students: [], profiles: [], guardians: [], health: [], enrollments: [], parentAccounts: [{ id: 'parent-1', email: 'kwame@example.test', phone: '+233241234567', username: '+233241234567' }], parentLinks: [], roles: [{ id: 'role-parent', school_id: 'school-1', role_key: 'PARENT' }], userRoles: [], classes: [{ id: 'class-kg1', name: 'KG1', school_id: 'school-1' }], periods: [{ academicYearId: 'year-2026', academicYearName: '2026/2027', academicYearStartsOn: '2026-09-01', termId: 'term-1', termName: '1st Term' }] };
  let tail = Promise.resolve();
  const query = async (sql, params = []) => {
    if (sql.includes('SELECT next_sequence FROM student_id_sequences')) return [{ next_sequence: state.sequences.get(Number(params[0])) }];
    if (sql.includes("SELECT id FROM student_id_reservations WHERE student_id=? AND reservation_status='CONSUMED'")) return state.reservations.filter((row) => row.student_id === params[0] && row.reservation_status === 'CONSUMED').map((row) => ({ id: row.id }));
    if (sql.includes('SELECT admission_year FROM student_id_sequences')) return state.sequences.has(Number(params[0])) ? [{ admission_year: Number(params[0]) }] : [];
    if (sql.includes('SELECT s.id AS studentId,s.school_id AS schoolId,s.permanent_student_id AS permanentStudentId') && sql.includes('LEFT JOIN student_profiles')) { const student = state.students.find((row) => row.id === params[0] && row.school_id === params[1]); if (!student) return []; return state.profiles.filter((profile) => profile.school_id === params[1] && profile.student_master_id === student.id).map((profile) => ({ studentId: student.id, schoolId: student.school_id, permanentStudentId: student.permanent_student_id, firstName: student.first_name, middleName: student.middle_name, lastName: student.last_name, admissionNumber: student.admission_number, profileId: profile.id, profileStudentId: profile.student_id, profileLegacyPermanentStudentId: profile.permanent_student_id })); }
    if (sql.includes('SELECT id AS studentId,school_id AS schoolId,permanent_student_id AS permanentStudentId') && sql.includes('admission_number=?')) { const student = state.students.find((row) => row.school_id === params[0] && row.admission_number === params[1]); return student ? [{ studentId: student.id, schoolId: student.school_id, permanentStudentId: student.permanent_student_id, firstName: student.first_name, middleName: student.middle_name, lastName: student.last_name, dateOfBirth: student.date_of_birth, parentPhone: student.parent_phone, classId: student.current_class_id }] : []; }
    if (sql.includes('SELECT id AS studentId,school_id AS schoolId,permanent_student_id AS permanentStudentId') && sql.includes('WHERE school_id=? AND id=? LIMIT 1 FOR UPDATE')) { const student = state.students.find((row) => row.school_id === params[0] && row.id === params[1]); return student ? [{ studentId: student.id, schoolId: student.school_id, permanentStudentId: student.permanent_student_id, firstName: student.first_name, middleName: student.middle_name, lastName: student.last_name }] : []; }
    if (sql.includes('SELECT id AS studentId,school_id AS schoolId,permanent_student_id AS permanentStudentId') && sql.includes('LIMIT 1 FOR UPDATE')) { const student = state.students.find((row) => row.id === params[0] && row.school_id === params[1]); return student ? [{ studentId: student.id, schoolId: student.school_id, permanentStudentId: student.permanent_student_id, admissionNumber: student.admission_number }] : []; }
    if (sql.includes('SELECT id AS studentId,school_id AS schoolId,permanent_student_id AS permanentStudentId') && sql.includes('FROM students WHERE school_id=? AND id=? LIMIT 1 FOR UPDATE')) { const student = state.students.find((row) => row.school_id === params[0] && row.id === params[1]); return student ? [{ studentId: student.id, schoolId: student.school_id, permanentStudentId: student.permanent_student_id, firstName: student.first_name, middleName: student.middle_name, lastName: student.last_name }] : []; }
    if (sql.includes('SELECT id AS studentId,school_id AS schoolId,permanent_student_id AS permanentStudentId') && sql.includes('FROM students WHERE school_id=? AND id=? LIMIT 1')) { const student = state.students.find((row) => row.school_id === params[0] && row.id === params[1]); return student ? [{ studentId: student.id, schoolId: student.school_id, permanentStudentId: student.permanent_student_id, firstName: student.first_name, middleName: student.middle_name, lastName: student.last_name }] : []; }
    if (sql.includes('SELECT id AS profileId,student_id AS permanentStudentId,permanent_student_id AS legacyPermanentStudentId FROM student_profiles')) return state.profiles.filter((row) => row.school_id === params[0] && row.student_master_id === params[1]).map((row) => ({ profileId: row.id, permanentStudentId: row.student_id, legacyPermanentStudentId: row.permanent_student_id }));
    if (sql.includes('SELECT id AS profileId,student_id AS profileStudentId,permanent_student_id AS profilePermanentStudentId')) return state.profiles.filter((row) => row.school_id === params[0] && row.student_master_id === params[1]).map((row) => ({ profileId: row.id, profileStudentId: row.student_id, profilePermanentStudentId: row.permanent_student_id, profileClassId: row.class_id, profileFirstName: row.first_name, profileMiddleName: row.middle_name, profileLastName: row.surname, profileDateOfBirth: row.date_of_birth }));
    if (sql.includes('SELECT permanent_student_id AS permanentStudentId FROM students') && sql.includes('permanent_student_id IS NOT NULL')) return state.students.filter((row) => row.school_id === params[0] && row.permanent_student_id).map((row) => ({ permanentStudentId: row.permanent_student_id }));
    if (sql.includes('SELECT student_id AS permanentStudentId,permanent_student_id AS legacyPermanentStudentId FROM student_profiles')) return state.profiles.filter((row) => row.school_id === params[0] && (row.student_id || row.permanent_student_id)).map((row) => ({ permanentStudentId: row.student_id, legacyPermanentStudentId: row.permanent_student_id }));
    if (sql.includes('SELECT permanent_student_id AS legacyPermanentStudentId FROM student_profiles') && sql.includes('permanent_student_id IS NOT NULL')) return state.profiles.filter((row) => row.school_id === params[0] && row.permanent_student_id).map((row) => ({ legacyPermanentStudentId: row.permanent_student_id }));
    if (sql.includes('SELECT id FROM students WHERE school_id=? AND permanent_student_id=?')) return state.students.filter((row) => row.school_id === params[0] && row.permanent_student_id === params[1]).map((row) => ({ id: row.id }));
    if (sql.includes('SELECT id FROM students WHERE permanent_student_id=?')) return state.students.filter((row) => row.permanent_student_id === params[0]).map((row) => ({ id: row.id }));
    if (sql.includes('SELECT student_master_id AS studentId FROM student_profiles WHERE student_id=? OR permanent_student_id=?')) return state.profiles.filter((row) => row.student_id === params[0] || row.permanent_student_id === params[1]).map((row) => ({ studentId: row.student_master_id }));
    if (sql.includes('SELECT id FROM student_id_reservations') && sql.includes('sequence_number=?')) return state.reservations.filter((row) => row.admission_year === Number(params[0]) && row.sequence_number === Number(params[1]) && row.student_id == null && row.reservation_status === 'RESERVED').map((row) => ({ id: row.id }));
    if (sql.includes('SELECT s.permanent_student_id AS permanentStudentId,sp.student_id AS profileStudentId')) { const student = state.students.find((row) => row.school_id === params[0] && row.id === params[1]), profile = state.profiles.find((row) => row.school_id === params[0] && row.student_master_id === params[1] && row.id === params[2]); return student && profile ? [{ permanentStudentId: student.permanent_student_id, profileStudentId: profile.student_id, profileLegacyPermanentStudentId: profile.permanent_student_id }] : []; }
    if (sql.includes('SELECT permanent_student_id FROM students WHERE permanent_student_id LIKE')) return state.students.filter((row) => String(row.permanent_student_id ?? '').startsWith(String(params[0]).replace('%', ''))).map((row) => ({ permanent_student_id: row.permanent_student_id }));
    if (sql.includes('SELECT student_id FROM student_profiles WHERE student_id LIKE')) return state.profiles.filter((row) => String(row.student_id ?? '').startsWith(String(params[0]).replace('%', ''))).map((row) => ({ student_id: row.student_id }));
    if (sql.includes('SELECT permanent_student_id FROM student_id_reservations')) return state.reservations.filter((row) => row.admission_year === Number(params[0])).map((row) => ({ permanent_student_id: row.permanent_student_id }));
    if (sql.includes('masterPermanentStudentId') && sql.includes('FROM students s WHERE s.school_id=?')) return state.students.filter((row) => row.school_id === params[0] && row.is_test_record !== true && (sql.includes('s.permanent_student_id=?') ? row.permanent_student_id === params[1] || row.admission_number === params[2] || state.profiles.some((profile) => profile.school_id === row.school_id && profile.student_master_id === row.id && (profile.student_id === params[3] || profile.permanent_student_id === params[4])) : sql.includes('LOWER(s.first_name)') ? row.first_name.toLowerCase() === String(params[1]).toLowerCase() && row.last_name.toLowerCase() === String(params[2]).toLowerCase() && row.date_of_birth === params[3] : row.id === params[1])).map((row) => ({ studentId: row.id, masterPermanentStudentId: row.permanent_student_id, admissionNumber: row.admission_number, firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name, dateOfBirth: row.date_of_birth, currentClassId: row.current_class_id, gender: row.gender, studentStatus: row.student_status }));
    if (sql.includes('SELECT id,student_id AS permanentStudentId,permanent_student_id AS legacyPermanentStudentId,class_id AS classId FROM student_profiles')) return state.profiles.filter((row) => row.school_id === params[0] && row.student_master_id === params[1]).map((row) => ({ id: row.id, permanentStudentId: row.student_id, legacyPermanentStudentId: row.permanent_student_id, classId: row.class_id }));
    if (sql.includes('SELECT id,student_id AS permanentStudentId,permanent_student_id AS legacyPermanentStudentId,class_id AS classId FROM student_profiles')) return state.profiles.filter((row) => row.school_id === params[0] && row.student_master_id === params[1]).map((row) => ({ id: row.id, permanentStudentId: row.student_id, legacyPermanentStudentId: row.permanent_student_id, classId: row.class_id }));
    if (sql.includes('SELECT id AS profileId,student_id AS profileStudentId,permanent_student_id AS profileLegacyPermanentStudentId')) return state.profiles.filter((row) => row.school_id === params[0] && row.student_master_id === params[1]).map((row) => ({ profileId: row.id, profileStudentId: row.student_id, profileLegacyPermanentStudentId: row.permanent_student_id, profileClassId: row.class_id, profileFirstName: row.first_name, profileMiddleName: row.middle_name, profileLastName: row.surname, profileDateOfBirth: row.date_of_birth }));
    if (sql.includes('SELECT id,student_id AS permanentStudentId,class_id AS classId FROM student_profiles')) return state.profiles.filter((row) => row.school_id === params[0] && row.student_master_id === params[1]).map((row) => ({ id: row.id, permanentStudentId: row.student_id, classId: row.class_id }));
    if (sql.includes('SELECT permanent_student_id AS permanentStudentId FROM students WHERE school_id=? AND id=?')) return state.students.filter((row) => row.school_id === params[0] && row.id === params[1]).map((row) => ({ permanentStudentId: row.permanent_student_id }));
    if (sql.includes('SELECT id AS studentId,permanent_student_id AS permanentStudentId,admission_number AS admissionNumber')) return state.students.filter((row) => row.school_id === params[0] && (sql.includes('OR admission_number=?') ? (row.permanent_student_id === params[1] || row.admission_number === params[2]) : row.id === params[1]) && row.is_test_record !== true).map((row) => ({ studentId: row.id, permanentStudentId: row.permanent_student_id, admissionNumber: row.admission_number, firstName: row.first_name, middleName: row.middle_name, lastName: row.last_name, dateOfBirth: row.date_of_birth, currentClassId: row.current_class_id, gender: row.gender, studentStatus: row.student_status }));
    if (sql.includes('SELECT id AS studentId,permanent_student_id AS permanentStudentId,first_name AS firstName,last_name AS lastName FROM students WHERE id=')) return state.students.filter((row) => row.id === params[0] && row.school_id === params[1]).map((row) => ({ studentId: row.id, permanentStudentId: row.permanent_student_id, firstName: row.first_name, lastName: row.last_name }));
    if (sql.includes('SELECT id,name FROM classes')) return state.classes.filter((row) => row.id === params[0] && row.school_id === params[1]);
    if (sql.includes('SELECT name FROM classes')) return state.classes.filter((row) => row.id === params[0] && row.school_id === params[1]).map((row) => ({ name: row.name }));
    if (sql.includes('SELECT y.id AS academicYearId')) return state.periods.filter((row) => row.academicYearId === params[1] && row.termId === params[2]);
    if (sql.includes('SELECT s.id FROM students s WHERE s.school_id=?')) { const phoneCount = (params.length - 5) / 2, phones = params.slice(5, 5 + phoneCount); return state.students.filter((row) => row.school_id === params[0] && String(row.first_name ?? '').toLowerCase() === String(params[1]).toLowerCase() && String(row.middle_name ?? '').toLowerCase() === String(params[2]).toLowerCase() && String(row.last_name ?? '').toLowerCase() === String(params[3]).toLowerCase() && row.date_of_birth === params[4] && phones.includes(String(row.parent_phone ?? '').replace(/\D/g, ''))).map((row) => ({ id: row.id })); }
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
    if (sql.includes("SELECT id FROM roles WHERE school_id=? AND role_key='PARENT'")) return state.roles.filter((role) => role.school_id === params[0] && role.role_key === 'PARENT');
    if (sql.includes('SELECT parent_user_id FROM parent_student_links')) return state.parentLinks.filter((row) => row.parent_user_id === params[0] && row.student_id === params[1]).map((row) => ({ parent_user_id: row.parent_user_id }));
    if (sql.includes('SELECT id FROM student_enrollments')) return state.enrollments.filter((row) => row.school_id === params[0] && row.student_id === params[1] && row.academic_year_id === params[2] && row.term_id === params[3] && row.is_current === 1).map((row) => ({ id: row.id }));
    throw new Error(`Unexpected query: ${sql}`);
  };
  const execute = async (sql, params = []) => {
    const count = (sql.match(/\?/g) ?? []).length;
    assert.equal(count, params.length, `SQL bind count mismatch in ${sql}`);
    if (sql.startsWith('INSERT INTO student_id_sequences')) { if (!state.sequences.has(Number(params[0]))) state.sequences.set(Number(params[0]), 1); return; }
    if (sql.startsWith('UPDATE student_id_sequences')) { state.sequences.set(Number(params[2]), Number(params[0])); return; }
    if (sql.startsWith('INSERT INTO student_id_reservations')) { state.reservations.push({ id: params[0], reservation_token: params[1], permanent_student_id: params[2], admission_year: params[3], sequence_number: params[4], reservation_status: 'CONSUMED', student_id: params[5], reserved_by: params[6], created_at: params[7], consumed_at: params[8] }); return; }
    if (sql.startsWith('INSERT INTO users ')) { state.parentAccounts.push({ id: params[0], school_id: params[1], username: params[2], email: params[3], phone: params[4], status: 'ACTIVE' }); return; }
    if (sql.startsWith('INSERT INTO user_roles ')) { state.userRoles.push({ id: params[0], user_id: params[1], role_id: params[2], created_at: params[3] }); return; }
    if (sql.startsWith('INSERT INTO students ')) { state.students.push({ id: params[0], permanent_student_id: null, school_id: params[1], admission_number: params[2], current_class_id: params[3], first_name: params[4], middle_name: params[5], last_name: params[6], full_name: params[7], gender: params[8], date_of_birth: params[9], parent_guardian_name: params[10], parent_phone: params[11], admission_type: params[13], student_status: params[14] }); return; }
    if (sql.startsWith('INSERT INTO student_profiles') && sql.includes('VALUES (?,?,NULL')) { state.profiles.push({ id: params[0], student_master_id: params[1], student_id: null, permanent_student_id: null, school_id: params[2], admission_number: params[3], class_id: params[4], first_name: params[6], middle_name: params[7], surname: params[8], date_of_birth: params[10], home_address: params[12], previous_school: params[14] }); return; }
    if (sql.startsWith('INSERT INTO student_profiles') && sql.includes('student_id,permanent_student_id')) { state.profiles.push({ id: params[0], student_master_id: params[1], student_id: params[2], permanent_student_id: params[3], school_id: params[4], admission_number: params[5], class_id: params[6], first_name: params[8], middle_name: params[9], surname: params[10], date_of_birth: params[12], home_address: params[14], previous_school: params[16] }); return; }
    if (sql.startsWith('INSERT INTO student_profiles')) { state.profiles.push({ id: params[0], student_master_id: params[1], student_id: params[2], permanent_student_id: null, school_id: params[3], admission_number: params[4], class_id: params[5], first_name: params[7], middle_name: params[8], surname: params[9], date_of_birth: params[11], home_address: params[13], previous_school: params[15] }); return; }
    if (sql.startsWith('UPDATE student_id_reservations')) { const row = state.reservations.find((item) => item.id === params[2]); Object.assign(row, { reservation_status: 'CONSUMED', student_id: params[0], consumed_at: params[1] }); return; }
    if (sql.startsWith('UPDATE students SET permanent_student_id=?,admission_number=')) { const row = state.students.find((item) => item.school_id === params[3] && item.id === params[4]); if (row) Object.assign(row, { permanent_student_id: params[0], admission_number: row.admission_number.startsWith('REG-') ? params[1] : row.admission_number }); return; }
    if (sql.startsWith('UPDATE students SET permanent_student_id=')) { const row = state.students.find((item) => item.id === params[3]); if (row) Object.assign(row, { permanent_student_id: params[0] }); return; }
    if (sql.startsWith('UPDATE student_profiles SET student_id=?,permanent_student_id=?,admission_number=')) { for (const row of state.profiles.filter((item) => item.school_id === params[4] && item.student_master_id === params[5])) Object.assign(row, { student_id: params[0], permanent_student_id: params[1], admission_number: row.admission_number.startsWith('REG-') ? params[2] : row.admission_number }); return; }
    if (sql.startsWith('UPDATE student_profiles SET student_id=?,admission_number=')) { for (const row of state.profiles.filter((item) => item.school_id === params[3] && item.student_master_id === params[4])) Object.assign(row, { student_id: params[0], admission_number: row.admission_number.startsWith('REG-') ? params[1] : row.admission_number }); return; }
    if (sql.startsWith('UPDATE parent_student_links SET permanent_student_id=')) { for (const row of state.parentLinks.filter((item) => item.permanent_student_id == null)) row.permanent_student_id = params[0]; return; }
    if (sql.startsWith('UPDATE students SET current_class_id=')) { const row = state.students.find((item) => item.id === params[3]); Object.assign(row, { current_class_id: params[0] }); return; }
    if (sql.startsWith('UPDATE student_profiles SET student_id=COALESCE')) { const row = state.profiles.find((item) => item.id === params[4]); Object.assign(row, { student_id: row.student_id ?? params[0], permanent_student_id: row.permanent_student_id ?? params[1] }); return; }
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

const saveRegistration = (service, overrides = {}) => service.register(input(overrides), { schoolId: 'school-1', actorId: 'staff-1' });

test('permanent ID generation is rejected before a student registration is saved', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-11T10:00:00.000Z' });
  await assert.rejects(() => service.assignPermanentId({ studentId: 'missing', schoolId: 'school-1', actorId: 'staff-1' }), { code: 'REGISTERED_STUDENT_NOT_FOUND' });
  assert.equal(state.students.length, 0);
  assert.equal(state.reservations.length, 0);
  assert.equal(state.sequences.size, 0);
});

test('saved registration receives the first database ID and repeated generation returns it', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const saved = await saveRegistration(service, { registrationToken: 'registration-token-0001' });
  assert.equal(saved.registered, true);
  assert.equal(saved.permanentStudentId, null);
  assert.equal(state.students.length, 1);
  assert.equal(state.students[0].permanent_student_id, null);
  assert.equal(state.reservations.length, 0);
  const assigned = await service.assignPermanentId({ studentId: saved.studentId, schoolId: 'school-1', actorId: 'staff-1' });
  const repeated = await service.assignPermanentId({ studentId: saved.studentId, schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(assigned.permanentStudentId, 'OSAA/2026/001');
  assert.equal(repeated.permanentStudentId, assigned.permanentStudentId);
  assert.equal(state.students[0].permanent_student_id, assigned.permanentStudentId);
  assert.equal(state.profiles[0].student_id, assigned.permanentStudentId);
  assert.equal(state.parentLinks[0].permanent_student_id, assigned.permanentStudentId);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.reservations[0].reservation_status, 'CONSUMED');
});

test('abandoned reservations and stale counters do not skip unused committed numbers', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  state.sequences.set(2026, 6);
  state.reservations.push({ id: 'orphan-5', reservation_token: 'old-reservation-token', permanent_student_id: 'OSAAH/2026/005', admission_year: 2026, sequence_number: 5, reservation_status: 'RESERVED', student_id: null });
  const saved = await saveRegistration(service, { registrationToken: 'registration-token-0002' });
  assert.equal(state.sequences.get(2026), 6, 'saving a student must not consume an ID number');
  const assigned = await service.assignPermanentId({ studentId: saved.studentId, schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(assigned.permanentStudentId, 'OSAA/2026/001');
  assert.equal(state.reservations[0].permanent_student_id, 'OSAAH/2026/005', 'an abandoned historical reservation is retained for audit');
});

test('registration rejects unsupported terms before creating student records', async () => {
  const { database, state } = databaseFixture();
  state.periods[0].termName = 'Summer Term';
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z' });
  await assert.rejects(() => saveRegistration(service, { registrationToken: 'registration-token-term' }), { code: 'ACADEMIC_TERM_INVALID' });
  assert.equal(state.students.length, 0);
});

test('failed registration attempts do not consume the first permanent ID', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z' });
  state.periods[0].termName = 'Summer Term';
  await assert.rejects(() => saveRegistration(service, { registrationToken: 'registration-token-failed' }), { code: 'ACADEMIC_TERM_INVALID' });
  state.periods[0].termName = '1st Term';
  const saved = await saveRegistration(service, { registrationToken: 'registration-token-after-failure' });
  assert.equal((await service.assignPermanentId({ studentId: saved.studentId, schoolId: 'school-1', actorId: 'staff-1' })).permanentStudentId, 'OSAA/2026/001');
});

test('registration retry with the same token returns the committed student without duplicating it', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z' });
  const first = await saveRegistration(service, { registrationToken: 'registration-token-idempotent' });
  const retry = await saveRegistration(service, { registrationToken: 'registration-token-idempotent' });
  assert.equal(retry.studentId, first.studentId);
  assert.equal(retry.created, false);
  assert.equal(state.students.length, 1);
  assert.equal(state.enrollments.length, 1);
});

test('concurrent permanent ID assignments for distinct saved students remain unique', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const first = await saveRegistration(service, { registrationToken: 'registration-token-distinct-1' });
  const second = await saveRegistration(service, { registrationToken: 'registration-token-distinct-2', firstName: 'Kofi', lastName: 'Boateng' });
  const results = await Promise.all([first, second].map((student) => service.assignPermanentId({ studentId: student.studentId, schoolId: 'school-1', actorId: 'staff-1' })));
  assert.deepEqual(results.map((item) => item.permanentStudentId).sort(), ['OSAA/2026/001', 'OSAA/2026/002']);
  assert.equal(new Set(state.students.map((student) => student.permanent_student_id)).size, 2);
});

test('duplicate child checks require matching name, birth date, and parent phone', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  await saveRegistration(service, { registrationToken: 'registration-token-duplicate-1' });
  state.students[0].parent_phone = '0241234567';
  await assert.rejects(() => saveRegistration(service, { registrationToken: 'registration-token-duplicate-2' }), { code: 'POSSIBLE_DUPLICATE_STUDENT' });
  const separateChild = await saveRegistration(service, { parentPhone: '0201234567', registrationToken: 'registration-token-duplicate-3' });
  assert.equal(separateChild.created, true);
  assert.equal(state.students.length, 2);
});

test('students with the same name but different birth dates are not merged', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z' });
  await saveRegistration(service, { registrationToken: 'registration-token-similar-1' });
  const differentChild = await saveRegistration(service, { registrationToken: 'registration-token-similar-2', dateOfBirth: '2018-01-03' });
  assert.equal(differentChild.created, true);
  assert.equal(state.students.length, 2);
});

test('simultaneous matching registrations serialize and create only one student', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const outcomes = await Promise.allSettled([
    saveRegistration(service, { registrationToken: 'registration-token-concurrent-1' }),
    saveRegistration(service, { registrationToken: 'registration-token-concurrent-2' })
  ]);
  assert.equal(outcomes.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((item) => item.status === 'rejected' && item.reason.code === 'POSSIBLE_DUPLICATE_STUDENT').length, 1);
  assert.equal(state.students.length, 1);
});

test('new parent contact is linked to a school-scoped phone-only Parent Portal account', async () => {
  const { database, state } = databaseFixture();
  state.parentAccounts = [];
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const result = await saveRegistration(service, { registrationToken: 'registration-token-parent' });
  const parent = state.parentAccounts[0];
  assert.equal(result.created, true);
  assert.equal(parent.username, '+233241234567');
  assert.equal(parent.phone, '+233241234567');
  assert.equal(state.userRoles[0].user_id, parent.id);
  assert.equal(state.userRoles[0].role_id, 'role-parent');
  assert.equal(state.parentLinks[0].parent_user_id, parent.id);
  assert.equal(state.parentLinks[0].telephone, '+233241234567');
  assert.equal(state.parentLinks[0].permanent_student_id, null);
  const assigned = await service.assignPermanentId({ studentId: result.studentId, schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(state.parentLinks[0].permanent_student_id, assigned.permanentStudentId);
});

test('registration persists pupil, parent, health and canonical class enrollment together', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-11T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const result = await saveRegistration(service, { registrationToken: 'registration-token-persist' });
  assert.equal(result.permanentStudentId, null);
  assert.equal(result.className, 'KG1');
  assert.equal(result.created, true);
  assert.equal(state.students.length, 1);
  assert.equal(state.profiles[0].student_id, null);
  assert.equal(state.profiles[0].home_address, 'Bogoso');
  assert.equal(state.guardians[0].email, 'kwame@example.test');
  assert.equal(state.guardians[0].occupation, 'Teacher');
  assert.equal(state.guardians[0].national_id, 'GHA-123');
  assert.equal(state.health[0].allergies, 'Peanuts');
  assert.equal(state.health[0].conditions, 'Asthma');
  assert.deepEqual(state.parentLinks, [{ parent_user_id: 'parent-1', student_id: state.profiles[0].id, permanent_student_id: null, telephone: '+233241234567' }]);
  assert.equal(state.enrollments[0].class_id, 'class-kg1');
  assert.equal(state.enrollments[0].academic_year_id, 'year-2026');
  assert.equal(state.reservations.length, 0);
  const retry = await saveRegistration(service, { registrationToken: 'registration-token-persist' });
  assert.equal(retry.created, false);
  assert.equal(state.students.length, 1);
});

test('existing student category verifies identity and preserves permanent ID', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-11T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const created = await saveRegistration(service, { registrationToken: 'registration-token-existing' });
  const assigned = await service.assignPermanentId({ studentId: created.studentId, schoolId: 'school-1', actorId: 'staff-1' });
  created.permanentStudentId = assigned.permanentStudentId;
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
  const original = await saveRegistration(service, { registrationToken: 'registration-token-existing-no-id' });
  const student = state.students[0], profile = state.profiles[0];
  student.permanent_student_id = null;
  profile.student_id = null;
  const match = await service.findExistingStudent({ firstName: 'Ama', lastName: 'Mensah', dateOfBirth: '2018-01-02' }, 'school-1');
  assert.equal(match.studentId, student.id);
  assert.equal(match.permanentStudentId, null);
  const result = await service.register(input({ admissionType: 'ALREADY_ENROLLED', existingIdChoice: 'NO_ID', existingStudentId: student.id }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.permanentStudentId, null);
  assert.equal(result.created, false);
  assert.equal(state.students.length, 1);
  assert.equal(student.id, original.student.studentId);
  assert.equal(state.enrollments.length, 1);
  const assigned = await service.assignPermanentId({ studentId: student.id, schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(assigned.permanentStudentId, 'OSAA/2026/001');
  assert.equal(student.permanent_student_id, assigned.permanentStudentId);
  assert.equal(profile.student_id, assigned.permanentStudentId);
});

test('existing student permanent ID assignment is conditional and confirmed from the database', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const original = await saveRegistration(service, { registrationToken: 'registration-token-existing-no-id-2' });
  const student = state.students[0], profile = state.profiles[0];
  student.permanent_student_id = null;
  profile.student_id = null;
  const result = await service.register(input({ admissionType: 'ALREADY_ENROLLED', existingIdChoice: 'NO_ID', existingStudentId: student.id }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.student.studentId, original.student.studentId);
  assert.equal(result.permanentStudentId, null);
  const assigned = await service.assignPermanentId({ studentId: student.id, schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(assigned.permanentStudentId, 'OSAA/2026/001');
  assert.equal(student.permanent_student_id, assigned.permanentStudentId);
  assert.equal(profile.student_id, assigned.permanentStudentId);
});

test('an entered existing ID is preserved without creating an ID reservation', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z', idFactory: (() => { let n = 0; return () => `id-${++n}`; })() });
  const registered = await saveRegistration(service, { registrationToken: 'registration-token-existing-valid-id' });
  await service.assignPermanentId({ studentId: registered.studentId, schoolId: 'school-1', actorId: 'staff-1' });
  const existingId = state.students[0].permanent_student_id;
  const result = await service.register(input({ admissionType: 'ALREADY_ENROLLED', existingIdChoice: 'HAVE_ID', existingStudentId: state.students[0].id, existingPermanentStudentId: existingId }), { schoolId: 'school-1', actorId: 'staff-1' });
  assert.equal(result.permanentStudentId, existingId);
  assert.equal(state.students.length, 1);
  assert.equal(state.reservations.length, 1);
});

test('an existing ID stored only in the linked profile resolves to the existing master record', async () => {
  const { database, state } = databaseFixture();
  const service = createInternalStudentRegistrationService({ database, clock: () => '2026-11-12T10:00:00.000Z' });
  const registered = await saveRegistration(service, { registrationToken: 'registration-token-profile-id' });
  await service.assignPermanentId({ studentId: registered.studentId, schoolId: 'school-1', actorId: 'staff-1' });
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
  const result = await saveRegistration(service, { admissionType: 'TRANSFER', previousSchool: 'Bogoso Basic School', registrationToken: 'registration-token-transfer' });
  assert.equal(result.permanentStudentId, null);
  assert.equal(result.created, true);
  assert.equal(state.students[0].admission_type, 'TRANSFER');
  assert.equal(state.profiles[0].previous_school, 'Bogoso Basic School');
  assert.equal(state.parentLinks.length, 1);
  assert.equal((await service.assignPermanentId({ studentId: result.studentId, schoolId: 'school-1', actorId: 'staff-1' })).permanentStudentId, 'OSAA/2026/001');
});
