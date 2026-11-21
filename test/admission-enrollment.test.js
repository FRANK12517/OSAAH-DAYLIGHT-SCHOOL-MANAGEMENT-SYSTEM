import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionEnrollmentService } from '../src/admission-enrollment.js';
import { normalizeGhanaPhone } from '../src/ghana-phone.js';

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
      if (sql.startsWith('INSERT INTO student_profiles ')) state.profiles.push({ id: params[0], student_master_id: params[1], student_id: params[2] });
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

function phoneLinkAdapter() {
  const state = {
    account: { phone: '+233241234567', username: '+233241234567' },
    students: [
      { id: 'master-1', school_id: 'school-1', permanent_student_id: 'OSAAH/2026/0001', parent_phone: '024 123-4567', student_status: 'ACTIVE', is_test_record: false, profile_id: 'profile-1', student_id: 'OSAAH/2026/0001', class_id: 'kg1', first_name: 'Ama', last_name: 'Mensah' },
      { id: 'master-2', school_id: 'school-1', permanent_student_id: 'OSAAH/2026/0002', parent_phone: null, student_status: 'ACTIVE', is_test_record: false, profile_id: 'profile-2', student_id: 'OSAAH/2026/0002', class_id: 'kg1', first_name: 'Kojo', last_name: 'Mensah', guardian_phone: '+233 (24) 123-4567' },
      { id: 'master-other-school', school_id: 'school-2', permanent_student_id: 'OSAAH/2026/0003', parent_phone: '0241234567', student_status: 'ACTIVE', is_test_record: false, profile_id: 'profile-3', student_id: 'OSAAH/2026/0003', class_id: 'kg1', first_name: 'Other', last_name: 'School' },
      { id: 'master-inactive', school_id: 'school-1', permanent_student_id: 'OSAAH/2026/0004', parent_phone: '0241234567', student_status: 'INACTIVE', is_test_record: false, profile_id: 'profile-4', student_id: 'OSAAH/2026/0004', class_id: 'kg1', first_name: 'Inactive', last_name: 'Student' }
    ],
    contacts: [{ student_id: 'profile-2', telephone: '+233 (24) 123-4567', alternative_phone: null }],
    links: [], calls: []
  };
  const api = {
    async query(sql, params = []) {
      state.calls.push({ sql, params });
      if (sql.includes('SELECT phone,username FROM users')) return params[0] === 'parent-1' && params[1] === 'school-1' ? [state.account] : [];
      if (sql.includes('information_schema.COLUMNS')) return [
        ...['parent_phone', 'registered_parent_phone', 'student_status', 'is_test_record', 'permanent_student_id'].map((columnName) => ({ tableName: 'students', columnName })),
        ...['student_id', 'telephone', 'alternative_phone'].map((columnName) => ({ tableName: 'student_family_contacts', columnName }))
      ];
      if (sql.includes('SELECT DISTINCT s.id AS id,s.permanent_student_id')) {
        const schoolId = params[0], requestedId = sql.includes('s.permanent_student_id=?') ? params.at(-2) : null;
        const phoneValues = params.slice(1, -1);
        return state.students.filter((student) => {
          if (student.school_id !== schoolId || student.student_status !== 'ACTIVE' || student.is_test_record || requestedId && student.permanent_student_id !== requestedId) return false;
          const profile = { enrollment_status: 'ACTIVE' };
          if (profile.enrollment_status !== 'ACTIVE') return false;
          return [student.parent_phone, student.registered_parent_phone, student.guardian_phone, ...state.contacts.filter((contact) => contact.student_id === student.profile_id).flatMap((contact) => [contact.telephone, contact.alternative_phone])]
            .some((phone) => { const normalized = normalizeGhanaPhone(phone); return normalized && phoneValues.includes(normalized.slice(1)) || normalized && phoneValues.includes(`0${normalized.slice(4)}`); });
        }).map((student) => ({ id: student.id, permanentStudentId: student.permanent_student_id, studentProfileId: student.profile_id }));
      }
      if (sql.includes('SELECT parent_user_id FROM parent_student_links WHERE parent_user_id=? AND student_id=?')) return state.links.filter((link) => link.parent_user_id === params[0] && link.student_id === params[1]).map((link) => ({ parent_user_id: link.parent_user_id }));
      if (sql.includes('JOIN users pu') && sql.includes('FROM parent_student_links psl')) return state.links.filter((link) => link.parent_user_id === params[1] && link.link_status === 'ACTIVE').map((link) => {
        const student = state.students.find((item) => item.profile_id === link.student_id && item.school_id === params[0] && item.school_id === params[2]);
        return student ? { id: student.id, studentId: student.id, student_id: student.id, permanentStudentId: student.permanent_student_id, permanent_student_id: student.permanent_student_id, studentProfileId: student.profile_id, student_profile_id: student.profile_id, classId: student.class_id, class_id: student.class_id, firstName: student.first_name, lastName: student.last_name, className: 'KG 1' } : null;
      }).filter(Boolean);
      if (sql.includes('JOIN parent_student_links psl') && sql.includes('s.permanent_student_id=?')) {
        const student = state.students.find((item) => item.permanent_student_id === params.at(-1) && item.school_id === params[3]);
        const linked = state.links.some((link) => link.parent_user_id === params[1] && link.student_id === student?.profile_id && link.link_status === params[2]);
        return student && linked ? [{ id: student.id, studentId: student.id, student_id: student.id, permanentStudentId: student.permanent_student_id, permanent_student_id: student.permanent_student_id, gender: 'Female', studentStatus: student.student_status, studentProfileId: student.profile_id, student_profile_id: student.profile_id, classId: student.class_id, class_id: student.class_id }] : [];
      }
      return [];
    },
    async execute(sql, params = []) {
      state.calls.push({ sql, params });
      if (sql.startsWith('INSERT INTO parent_student_links')) {
        if (state.links.some((link) => link.parent_user_id === params[0] && link.student_id === params[1])) throw Object.assign(new Error('duplicate link'), { code: 'ER_DUP_ENTRY' });
        state.links.push({ parent_user_id: params[0], student_id: params[1], permanent_student_id: params[2], telephone: params[3], link_status: params[6] });
      }
      return { affectedRows: 1 };
    },
    async transaction(work) { return work(api); }
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
      if (sql.startsWith('INSERT INTO student_profiles ')) state.profiles.push({ id: params[0], student_master_id: params[1], student_id: params[2] });
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

test('legacy enrollment service cannot create students outside unified registration', async () => {
  const { api, state } = adapter();
  const service = createAdmissionEnrollmentService({ database: api });
  await assert.rejects(() => service.enroll({ applicationId: 'app-1' }), { code: 'LEGACY_ADMISSION_WORKFLOW_RETIRED', status: 410 });
  assert.equal(state.students.length, 0);
  assert.equal(state.application.student_id, null);
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
  assert.doesNotMatch(sql, /student_enrollments|sp\.enrollment_status/);
  const denied = adapter({ authorized: false });
  assert.deepEqual(await createAdmissionEnrollmentService({ database: denied.api }).listParentStudents({ parentUserId: 'other-parent', schoolId: 'school-1' }), []);
});

test('Parent lookup repairs existing links from normalized guardian phones without crossing school or status boundaries', async () => {
  const { api, state } = phoneLinkAdapter();
  const service = createAdmissionEnrollmentService({ database: api });
  const children = await service.listParentStudents({ parentUserId: 'parent-1', schoolId: 'school-1' });
  assert.deepEqual(children.map((child) => child.permanentStudentId).sort(), ['OSAAH/2026/0001', 'OSAAH/2026/0002']);
  assert.equal(state.links.length, 2);
  assert.ok(state.links.every((link) => link.telephone === '+233241234567' && link.link_status === 'ACTIVE'));
  assert.equal(state.links.some((link) => link.permanent_student_id === 'OSAAH/2026/0003' || link.permanent_student_id === 'OSAAH/2026/0004'), false);
  const matching = state.calls.find(({ sql }) => sql.includes('SELECT DISTINCT s.id AS id,s.permanent_student_id'));
  assert.match(matching.sql, /student_family_contacts fc ON fc\.student_id=sp\.id/);
  assert.match(matching.sql, /s\.school_id=\?/);
  assert.match(matching.sql, /sp\.enrollment_status/);
  assert.match(matching.sql, /NOT EXISTS \(SELECT 1 FROM parent_student_links existing_link/);
  assert.ok(matching.params.includes('school-1'));
  const again = await service.listParentStudents({ parentUserId: 'parent-1', schoolId: 'school-1' });
  assert.equal(again.length, 2);
  assert.equal(state.links.length, 2, 'repeated lookup is idempotent');
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
