import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionEnrollmentService } from '../src/admission-enrollment.js';

const application = () => ({ id: 'app-1', application_number: 'APP-1', school_id: 'school-1', status: 'ACCEPTED', student_id: null, permanent_student_id: null, parent_email: 'parent@example.test', applicant_data: JSON.stringify({ admissionDate: '2026-09-13', academicYearId: 'year-2026', termId: 'term-1', classAssigned: 'class-1', studentFirstName: 'Ama', studentSurname: 'Mensah', gender: 'Female', dateOfBirth: '2018-01-02', primaryGuardianEmail: 'parent@example.test', primaryGuardianFullName: 'Guardian Mensah', primaryGuardianPrimaryPhone: '0240000000' }) });

function adapter({ failOn = null, initialApplication = application(), authorized = true, sequenceSchema = 'valid' } = {}) {
  const state = { application: structuredClone(initialApplication), sequence: 1, existingIds: [], students: [], profiles: [], enrollments: [], links: [], familyContacts: [], audits: [], calls: [] };
  const api = {
    async query(sql, params = []) {
      state.calls.push(['query', sql, params]);
      if (sql.includes('information_schema.TABLES') && sql.includes('student_id_sequences')) return [{ ENGINE: sequenceSchema === 'wrong-engine' ? 'MyISAM' : 'InnoDB' }];
      if (sql.includes('information_schema.COLUMNS') && sql.includes('student_id_sequences')) return [
        { COLUMN_NAME: 'admission_year', COLUMN_TYPE: 'smallint', IS_NULLABLE: 'NO', COLUMN_KEY: 'PRI' },
        { COLUMN_NAME: 'next_sequence', COLUMN_TYPE: sequenceSchema === 'valid' ? 'int unsigned' : 'bigint', IS_NULLABLE: 'NO', COLUMN_KEY: '' },
        { COLUMN_NAME: 'updated_at', COLUMN_TYPE: 'datetime', IS_NULLABLE: 'NO', COLUMN_KEY: '' }
      ];
      if (sql.includes('information_schema.STATISTICS') && sql.includes('student_id_sequences')) return sequenceSchema === 'valid' ? [{ INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, COLUMN_NAME: 'admission_year', SEQ_IN_INDEX: 1 }] : sequenceSchema === 'composite-key' ? [{ INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, COLUMN_NAME: 'admission_year', SEQ_IN_INDEX: 1 }, { INDEX_NAME: 'PRIMARY', NON_UNIQUE: 0, COLUMN_NAME: 'school_id', SEQ_IN_INDEX: 2 }] : [];
      if (sql.includes('FROM admission_applications')) return state.application ? [structuredClone(state.application)] : [];
      if (sql.includes('FROM student_id_sequences')) return [{ next_sequence: state.sequence }];
      if (sql.includes('SELECT permanent_student_id FROM students WHERE school_id=')) return state.existingIds.filter((id) => id.startsWith('OSAAH/2026/')).map((permanent_student_id) => ({ permanent_student_id }));
      if (sql.includes('SELECT student_id,permanent_student_id FROM student_profiles')) return state.existingIds.filter((id) => id.startsWith('OSAAH/2026/')).map((id) => ({ student_id: id, permanent_student_id: null }));
      if (sql.includes("JOIN user_roles") && sql.includes("r.role_key='PARENT'")) return params[1] ? [{ id: 'parent-1' }] : [];
      if (sql.includes('FROM users WHERE school_id=')) return [{ id: 'parent-1' }];
      if (sql.includes('SELECT * FROM students WHERE id=')) return state.students.filter((row) => row.id === params[0] && row.permanent_student_id === params[1]);
      if (sql.includes('JOIN student_profiles')) return authorized ? [{ student_id: 'STD-000001', permanent_student_id: params[4], student_profile_id: 'profile-1', class_id: 'class-1' }] : [];
      return [];
    },
    async execute(sql, params = []) {
      state.calls.push(['execute', sql, params]);
      if (failOn && sql.includes(failOn)) throw new Error('private database detail');
      if (sql.startsWith('UPDATE student_id_sequences')) state.sequence = params[0];
      if (sql.startsWith('INSERT INTO students ')) state.students.push({ id: params[0], permanent_student_id: params[1], school_id: params[2] });
      if (sql.startsWith('INSERT INTO student_profiles ')) state.profiles.push({ id: params[0], student_master_id: params[11], student_id: params[12] });
      if (sql.startsWith('INSERT INTO student_enrollments ')) state.enrollments.push({ id: params[0], student_id: params[1] });
      if (sql.startsWith('INSERT INTO student_family_contacts ')) state.familyContacts.push({ id: params[0], student_id: params[1], full_name: params[3] });
      if (sql.startsWith('INSERT INTO parent_student_links ')) state.links.push({ parent_user_id: params[0], student_id: params[1], relationship: params[2] });
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

test('accepted admission atomically creates the master, profile, enrollment and parent link once', async () => {
  const { api, state } = adapter(); let next = 0;
  const service = createAdmissionEnrollmentService({ database: api, clock: () => '2026-09-13T00:00:00.000Z', idFactory: () => `uuid-${++next}` });
  const first = await service.enroll({ applicationId: 'app-1', applicationNumber: 'APP-1', actorId: 'reviewer-1' });
  assert.equal(first.student.id, 'uuid-1');
  assert.equal(first.student.permanentStudentId, 'OSAAH/2026/0001');
  assert.equal(state.students.length, 1);
  assert.deepEqual(state.profiles[0], { id: 'uuid-2', student_master_id: 'uuid-1', student_id: 'OSAAH/2026/0001' });
  assert.equal(state.enrollments[0].student_id, 'uuid-1');
  assert.deepEqual(state.links[0], { parent_user_id: 'parent-1', student_id: 'uuid-2', relationship: 'Guardian' });
  assert.equal(state.audits.length, 1);
  const sequenceWrites = state.calls.filter(([kind, sql]) => kind === 'execute' && sql.includes('student_id_sequences'));
  assert.equal(sequenceWrites[0][2][2], '2026-09-13 00:00:00');
  assert.equal(sequenceWrites[1][2][1], '2026-09-13 00:00:00');
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

test('durable enrollment refuses an unverified sequence schema before allocating an ID', async () => {
  for (const sequenceSchema of ['unexpected', 'composite-key', 'wrong-engine']) {
    const { api, state } = adapter({ sequenceSchema });
    const service = createAdmissionEnrollmentService({ database: api, idFactory: () => 'uuid' });
    await assert.rejects(() => service.enroll({ applicationId: 'app-1' }), { code: 'STUDENT_ID_SEQUENCE_UNVERIFIED' });
    assert.equal(state.students.length, 0);
    assert.equal(state.profiles.length, 0);
  }
});

test('allocator reconciles stale yearly counters and parent email is optional when guardian contact is stored', async () => {
  const row = application(); row.parent_email = null; row.applicant_data = JSON.stringify({ ...JSON.parse(row.applicant_data), primaryGuardianEmail: null });
  const { api, state } = adapter({ initialApplication: row }); state.sequence = 1; state.existingIds = ['OSAAH/2026/0007'];
  const service = createAdmissionEnrollmentService({ database: api, clock: () => '2026-09-13T00:00:00.000Z', idFactory: () => 'uuid' });
  const result = await service.enroll({ applicationId: state.application.id });
  assert.equal(result.student.permanentStudentId, 'OSAAH/2026/0008');
  assert.equal(state.familyContacts.length, 1);
  assert.equal(state.familyContacts[0].full_name, 'Guardian Mensah');
  assert.equal(state.links.length, 0);
  assert.equal(state.sequence, 9);
});

test('durable enrollment rejects a non-accepted application before writing or allocating an ID', async () => {
  const row = application(); row.status = 'SUBMITTED'; const { api, state } = adapter({ initialApplication: row });
  await assert.rejects(() => createAdmissionEnrollmentService({ database: api }).enroll({ applicationId: row.id }), { code: 'APPLICATION_NOT_ELIGIBLE' });
  assert.equal(state.students.length, 0);
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
