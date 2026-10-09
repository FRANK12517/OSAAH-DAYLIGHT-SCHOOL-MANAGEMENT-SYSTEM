import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionEnrollmentService } from '../src/admission-enrollment.js';

const application = () => ({ id: 'app-1', application_number: 'APP-1', school_id: 'school-1', status: 'ACCEPTED', student_id: null, permanent_student_id: null, parent_email: 'parent@example.test', academic_year_id: '2026', class_id: 'class-1', applicant_data: JSON.stringify({ studentFirstName: 'Ama', studentSurname: 'Mensah', gender: 'Female', dateOfBirth: '2018-01-02', primaryGuardianPrimaryPhone: '0240000000' }) });

function adapter({ failOn = null, initialApplication = application(), authorized = true } = {}) {
  const state = { application: structuredClone(initialApplication), sequence: 1, existingIds: [], students: [], profiles: [], enrollments: [], links: [], audits: [], calls: [] };
  const api = {
    async query(sql, params = []) {
      state.calls.push(['query', sql, params]);
      if (sql.includes('FROM admission_applications')) return state.application ? [structuredClone(state.application)] : [];
      if (sql.includes("FROM students WHERE id LIKE")) return state.students.length ? [{ id: state.students.at(-1).id }] : [];
      if (sql.includes('FROM student_id_sequences')) return [{ next_sequence: state.sequence }];
      if (sql.includes('permanent_student_id LIKE')) return state.existingIds.map((permanent_student_id) => ({ permanent_student_id }));
      if (sql.includes('FROM student_profiles WHERE student_id LIKE')) return state.existingIds.map((student_id) => ({ student_id }));
      if (sql.includes('JOIN user_roles') && sql.includes("r.role_key='PARENT'")) return [{ id: 'parent-1', email: 'parent@example.test', phone: '0240000000', username: 'parent@example.test' }];
      if (sql.includes("FROM roles WHERE school_id=? AND role_key='PARENT'")) return [{ id: 'role-parent-1' }];
      if (sql.includes('FROM users WHERE school_id=')) return [{ id: 'parent-1' }];
      if (sql.includes('SELECT s.id AS id,s.id AS studentId') && sql.includes('JOIN users pu')) return authorized ? [{ id: 'student-1', studentId: 'student-1', student_id: 'student-1', permanentStudentId: 'OSAAH/2026/0001', permanent_student_id: 'OSAAH/2026/0001', studentProfileId: 'profile-1', student_profile_id: 'profile-1', classId: 'class-1', class_id: 'class-1', firstName: 'Ama', lastName: 'Mensah', className: 'Primary 1' }] : [];
      if (sql.includes('SELECT e.class_id AS classId')) return authorized ? [{ classId: params[5], termId: params[6] }] : [];
      if (sql.includes('SELECT * FROM students WHERE id=')) return state.students.filter((row) => row.id === params[0] && row.permanent_student_id === params[1]);
      if (sql.includes('JOIN student_profiles')) return authorized ? [{ student_id: 'STD-000001', permanent_student_id: params[4], student_profile_id: 'profile-1', class_id: 'class-1' }] : [];
      return [];
    },
    async execute(sql, params = []) {
      state.calls.push(['execute', sql, params]);
      if (failOn && sql.includes(failOn)) throw new Error('private database detail');
      if (sql.startsWith('UPDATE student_id_sequences')) state.sequence = params[0];
      if (sql.startsWith('INSERT INTO students ')) state.students.push({ id: params[0], permanent_student_id: params[1], school_id: params[2], is_test_record: params[13] });
      if (sql.startsWith('INSERT INTO student_profiles ')) state.profiles.push({ id: params[0], student_master_id: params[1], student_id: params[2], permanent_student_id: params[3] });
      if (sql.startsWith('INSERT INTO student_enrollments ')) state.enrollments.push({ id: params[0], student_id: params[1] });
      if (sql.startsWith('INSERT INTO parent_student_links ')) state.links.push({ parent_user_id: params[0], student_id: params[1], permanent_student_id: params[2] });
      if (sql.startsWith('UPDATE admission_applications ')) Object.assign(state.application, { student_id: params[0], permanent_student_id: params[1], stage: params[2] });
      if (sql.startsWith('INSERT INTO audit_logs ')) state.audits.push(params);
      return { affectedRows: 1 };
    },
    async transaction(work) {
      const snapshot = structuredClone(state);
      try { return await work(api); } catch (error) { for (const key of Object.keys(state)) state[key] = snapshot[key]; throw error; }
    }
  };
  return { api, state };
}

function concurrentEnrollmentAdapter() {
  const state = { applications: [application(), { ...application(), id: 'app-2', application_number: 'APP-2', applicant_data: JSON.stringify({ studentFirstName: 'Kojo', studentSurname: 'Mensah', gender: 'Male', dateOfBirth: '2018-03-04', primaryGuardianPrimaryPhone: '0240000000' }) }], sequence: 1, students: [], profiles: [], enrollments: [], links: [], audits: [] };
  let transactionTail = Promise.resolve();
  const api = {
    async query(sql, params = []) {
      if (sql.includes('FROM admission_applications')) return state.applications.filter((item) => item.id === params[0] || item.application_number === params[1]).map((item) => structuredClone(item));
      if (sql.includes("FROM students WHERE id LIKE")) return state.students.length ? [{ id: state.students.at(-1).id }] : [];
      if (sql.includes('FROM student_id_sequences')) return [{ next_sequence: state.sequence }];
      if (sql.includes('permanent_student_id LIKE')) return state.students.map((item) => ({ permanent_student_id: item.permanent_student_id }));
      if (sql.includes('FROM student_profiles WHERE student_id LIKE')) return state.profiles.map((item) => ({ student_id: item.student_id }));
      if (sql.includes("r.role_key='PARENT'")) return [{ id: 'parent-1', email: 'parent@example.test', phone: '0240000000', username: '0240000000' }];
      if (sql.includes("role_key='PARENT'")) return [{ id: 'role-parent-1' }];
      if (sql.includes('FROM users WHERE school_id=')) return [{ id: 'parent-1' }];
      if (sql.includes('SELECT * FROM students WHERE id=')) return state.students.filter((row) => row.id === params[0] && row.permanent_student_id === params[1]);
      return [];
    },
    async execute(sql, params = []) {
      if (sql.startsWith('UPDATE student_id_sequences')) state.sequence = params[0];
      if (sql.startsWith('INSERT INTO students ')) state.students.push({ id: params[0], permanent_student_id: params[1], school_id: params[2], admission_number: params[4] });
      if (sql.startsWith('INSERT INTO student_profiles ')) state.profiles.push({ id: params[0], student_master_id: params[1], student_id: params[2], permanent_student_id: params[3] });
      if (sql.startsWith('INSERT INTO student_enrollments ')) state.enrollments.push({ id: params[0], student_id: params[1] });
      if (sql.startsWith('INSERT INTO parent_student_links ')) state.links.push({ parent_user_id: params[0], student_id: params[1] });
      if (sql.startsWith('UPDATE admission_applications ')) Object.assign(state.applications.find((item) => item.id === params[4]), { student_id: params[0], permanent_student_id: params[1], stage: params[2] });
      if (sql.startsWith('INSERT INTO audit_logs ')) state.audits.push(params);
      return { affectedRows: 1 };
    },
    async transaction(work) {
      const previous = transactionTail; let release; transactionTail = new Promise((resolve) => { release = resolve; }); await previous;
      const snapshot = structuredClone(state);
      try { return await work(api); } catch (error) { for (const key of Object.keys(state)) state[key] = snapshot[key]; throw error; }
      finally { release(); }
    }
  };
  return { api, state };
}

test('accepted admission atomically creates the master, profile, enrollment and parent link once', async () => {
  const { api, state } = adapter(); let next = 0;
  const service = createAdmissionEnrollmentService({ database: api, clock: () => '2026-09-13T00:00:00.000Z', idFactory: () => `uuid-${++next}` });
  const first = await service.enroll({ applicationId: 'app-1', applicationNumber: 'APP-1', actorId: 'reviewer-1' });
  assert.equal(first.student.id, 'STD-000001');
  assert.equal(first.student.permanentStudentId, 'OSAAH/2026/001');
  assert.equal(state.students.length, 1);
  assert.equal(state.students[0].is_test_record, 0);
  assert.deepEqual(state.profiles[0], { id: 'uuid-1', student_master_id: 'STD-000001', student_id: 'OSAAH/2026/001', permanent_student_id: 'OSAAH/2026/001' });
  assert.equal(state.enrollments[0].student_id, 'STD-000001');
  assert.deepEqual(state.links[0], { parent_user_id: 'parent-1', student_id: 'uuid-1', permanent_student_id: 'OSAAH/2026/001' });
  assert.equal(state.audits.length, 1);
  const retried = await service.enroll({ applicationId: 'app-1', applicationNumber: 'APP-1', actorId: 'reviewer-1' });
  assert.equal(retried.created, false);
  assert.equal(state.students.length, 1);
  assert.equal(state.sequence, 2);
});

test('a forced midway failure rolls back every enrollment record and hides database details', async () => {
  const { api, state } = adapter({ failOn: 'INSERT INTO student_enrollments' });
  const service = createAdmissionEnrollmentService({ database: api, idFactory: () => 'uuid' });
  await assert.rejects(() => service.enroll({ applicationId: 'app-1' }), (error) => error.code === 'ENROLLMENT_FAILED' && !error.message.includes('private'));
  assert.deepEqual([state.students.length, state.profiles.length, state.enrollments.length, state.links.length], [0, 0, 0, 0]);
  assert.equal(state.application.student_id, null);
  assert.equal(state.sequence, 1);
});

test('pending and rejected applications never receive a student identifier', async () => {
  for (const status of ['PENDING', 'REJECTED']) {
    const row = application(); row.status = status; const { api, state } = adapter({ initialApplication: row });
    const service = createAdmissionEnrollmentService({ database: api });
    await assert.rejects(() => service.enroll({ applicationId: row.id }), { code: 'APPLICATION_NOT_ELIGIBLE' });
    assert.equal(state.students.length, 0);
  }
});

test('concurrent admissions serialize annual sequence allocation without duplicate permanent IDs', async () => {
  const { api, state } = concurrentEnrollmentAdapter(); let next = 0;
  const service = createAdmissionEnrollmentService({ database: api, clock: () => '2026-09-13T00:00:00.000Z', idFactory: () => `concurrent-${++next}` });
  const [first, second] = await Promise.all([
    service.enroll({ applicationId: 'app-1', applicationNumber: 'APP-1', actorId: 'headteacher-1' }),
    service.enroll({ applicationId: 'app-2', applicationNumber: 'APP-2', actorId: 'assistant-1' })
  ]);
  assert.deepEqual(new Set([first.student.permanentStudentId, second.student.permanentStudentId]), new Set(['OSAAH/2026/001', 'OSAAH/2026/002']));
  assert.equal(new Set(state.students.map((item) => item.permanent_student_id)).size, 2);
  assert.equal(state.enrollments.length, 2);
  assert.equal(state.sequence, 3);
});

test('permanent Student ID allocation advances past legacy four-digit IDs when the counter is stale', async () => {
  const { api, state } = adapter(); state.existingIds = ['OSAAH/2026/0007']; state.sequence = 1;
  const service = createAdmissionEnrollmentService({ database: api });
  const result = await service.enroll({ applicationId: 'app-1' });
  assert.equal(result.student.permanentStudentId, 'OSAAH/2026/008');
  assert.equal(state.sequence, 9);
});

test('parent portal resolution requires an active parent/profile authorization link', async () => {
  const allowed = adapter({ authorized: true });
  const service = createAdmissionEnrollmentService({ database: allowed.api });
  const child = await service.authorizeParentStudent({ parentUserId: 'parent-1', permanentStudentId: 'OSAAH/2026/0001', schoolId: 'school-1' });
  assert.equal(child.student_id, 'STD-000001');
  const denied = adapter({ authorized: false });
  await assert.rejects(() => createAdmissionEnrollmentService({ database: denied.api }).authorizeParentStudent({ parentUserId: 'unrelated', permanentStudentId: 'OSAAH/2026/0001', schoolId: 'school-1' }), { code: 'PARENT_STUDENT_FORBIDDEN' });
  const query = denied.state.calls.find((call) => call[0] === 'query')[1];
  assert.match(query, /parent_student_links/);
  assert.match(query, /parent_user_id=\?/);
});

test('Parent child list selects only linked active students from the authenticated school', async () => {
  const { api, state } = adapter({ authorized: true });
  const service = createAdmissionEnrollmentService({ database: api });
  const children = await service.listParentStudents({ parentUserId: 'parent-1', schoolId: 'school-1' });
  assert.equal(children.length, 1);
  assert.equal(children[0].permanentStudentId, 'OSAAH/2026/0001');
  assert.equal(children[0].lastName, 'Mensah');
  const [, sql, params] = state.calls.find((call) => call[0] === 'query' && call[1].includes('SELECT s.id AS id,s.id AS studentId') && call[1].includes('JOIN users pu'));
  assert.deepEqual(params, ['school-1', 'parent-1', 'school-1']);
  assert.match(sql, /parent_student_links/);
  assert.match(sql, /psl\.parent_user_id=\?/);
  assert.match(sql, /pu\.school_id=\?/);
  assert.match(sql, /s\.last_name AS lastName/);
  assert.doesNotMatch(sql, /s\.surname/);
  const denied = adapter({ authorized: false });
  assert.deepEqual(await createAdmissionEnrollmentService({ database: denied.api }).listParentStudents({ parentUserId: 'other-parent', schoolId: 'school-1' }), []);
});

test('Parent historical class authorization binds child relationship, school, year, term, and class', async () => {
  const { api, state } = adapter({ authorized: true });
  const service = createAdmissionEnrollmentService({ database: api });
  assert.equal(await service.parentEnrolledInClass({ parentUserId: 'parent-1', schoolId: 'school-1', permanentStudentId: 'OSAAH/2026/0001', academicYearId: 'year-2025', termId: 'term-2', classId: 'class-old' }), true);
  const [, sql, params] = state.calls.find((call) => call[0] === 'query' && call[1].includes('SELECT e.class_id AS classId'));
  assert.deepEqual(params, ['school-1', 'parent-1', 'school-1', 'OSAAH/2026/0001', 'year-2025', 'class-old', 'term-2']);
  assert.match(sql, /psl\.parent_user_id=\?/);
  assert.match(sql, /e\.academic_year_id=\?/);
  assert.match(sql, /e\.term_id=\?/);
  assert.match(sql, /e\.class_id=\?/);
  assert.equal(await createAdmissionEnrollmentService({ database: adapter({ authorized: false }).api }).parentEnrolledInClass({ parentUserId: 'other-parent', schoolId: 'school-1', permanentStudentId: 'OSAAH/2026/0001', academicYearId: 'year-2025', termId: 'term-2', classId: 'class-old' }), false);
});
