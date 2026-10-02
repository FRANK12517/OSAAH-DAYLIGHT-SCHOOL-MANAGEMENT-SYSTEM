import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../src/auth.js';

const SCHOOL_ID = 'school-osaah-daylight';

function createFakeDatabase({ failAt = null } = {}) {
  let state = {
    schools: [{ id: SCHOOL_ID }],
    roles: [
      { id: 'role-teacher', school_id: SCHOOL_ID, role_key: 'TEACHER', oversight_rank: 40 },
      { id: 'role-headteacher', school_id: SCHOOL_ID, role_key: 'HEADTEACHER', oversight_rank: 80 },
      { id: 'role-accountant', school_id: SCHOOL_ID, role_key: 'ACCOUNTANT_BURSAR', oversight_rank: 30 }
    ],
    levels: [{ id: 'level-primary', school_id: SCHOOL_ID }],
    classes: [{ id: 'primary-4', level_id: 'level-primary' }],
    subjects: [{ id: 'mathematics', school_id: SCHOOL_ID }],
    users: [], staff: [], profiles: [], userRoles: [], assignments: [], sessions: []
  };

  function queryFor(store, sql, params = []) {
    if (sql.includes('FROM schools')) return store.schools.filter((row) => row.id === params[0]);
    if (sql.includes('FROM users WHERE LOWER(COALESCE(email')) return store.users.filter((row) => row.email.toLowerCase() === params[0]);
    if (sql.includes('FROM users WHERE school_id=? AND LOWER(username)')) return store.users.filter((row) => row.school_id === params[0] && row.username.toLowerCase() === params[1]);
    if (sql.includes('FROM staff WHERE school_id=? AND staff_number=?')) return store.staff.filter((row) => row.school_id === params[0] && row.staff_number === params[1]).map((row) => ({ id: row.id, userId: row.user_id }));
    if (sql.includes('FROM staff_profiles WHERE staff_id=? OR employee_id=?')) return store.profiles.filter((row) => row.staff_id === params[0] || row.employee_id === params[1]).map((row) => ({ id: row.id }));
    if (sql.includes('FROM roles') && sql.includes('WHERE role_key=?')) return store.roles.filter((row) => row.role_key === params[0] && (row.school_id === params[1] || row.school_id == null)).sort((a, b) => (a.school_id === params[1] ? -1 : 1) - (b.school_id === params[1] ? -1 : 1)).map((row) => ({ id: row.id, roleKey: row.role_key })).slice(0, 1);
    if (sql.includes('FROM classes c JOIN levels l')) return store.classes.filter((row) => row.id === params[0] && store.levels.some((level) => level.id === row.level_id && level.school_id === params[1])).map((row) => ({ id: row.id }));
    if (sql.includes('FROM subjects WHERE id=?')) return store.subjects.filter((row) => row.id === params[0] && row.school_id === params[1]).map((row) => ({ id: row.id }));
    if (sql.includes('JOIN staff_profiles sp ON sp.id=s.id') && sql.includes('JOIN user_roles ur') && sql.includes('WHERE u.id=? AND u.school_id=?')) {
      const [roleKey, userId, schoolId] = params;
      return store.users.filter((user) => user.id === userId && user.school_id === schoolId && user.status === 'ACTIVE').flatMap((user) => {
        const staff = store.staff.find((item) => item.user_id === user.id && item.school_id === schoolId);
        const profile = store.profiles.find((item) => item.id === staff?.id && item.school_id === schoolId);
        const role = store.roles.find((item) => item.role_key === roleKey && store.userRoles.some((link) => link.user_id === user.id && link.role_id === item.id));
        return staff && profile && role ? [{ id: user.id }] : [];
      });
    }
    if (sql.includes('FROM users u') && sql.includes('LEFT JOIN user_roles ur')) {
      const [email, username] = params;
      return store.users.filter((user) => user.email.toLowerCase() === email || user.username.toLowerCase() === username).flatMap((user) => {
        const links = store.userRoles.filter((link) => link.user_id === user.id);
        return links.flatMap((link) => {
          const role = store.roles.find((item) => item.id === link.role_id);
          return role ? [{ id: user.id, schoolId: user.school_id, username: user.username, email: user.email, passwordHash: user.password_hash, status: user.status, roleKey: role.role_key, oversightRank: role.oversight_rank, permissionKey: null }] : [];
        });
      });
    }
    if (sql.includes('FROM auth_sessions s JOIN users u')) {
      const [tokenHash, currentTime] = params;
      return store.sessions.filter((session) => session.token_hash === tokenHash && !session.revoked_at && session.expires_at > currentTime).flatMap((session) => {
        const user = store.users.find((row) => row.id === session.user_id && row.status === 'ACTIVE');
        return store.userRoles.filter((link) => link.user_id === user?.id).flatMap((link) => {
          const role = store.roles.find((item) => item.id === link.role_id);
          return role ? [{ sessionId: session.id, userId: user.id, schoolId: user.school_id, expiresAt: session.expires_at, username: user.username, email: user.email, roleKey: role.role_key, oversightRank: role.oversight_rank, permissionKey: null }] : [];
        });
      });
    }
    if (sql.includes('SELECT DISTINCT sa.class_id AS classId')) {
      const [userId, schoolId] = params;
      const staff = store.staff.find((item) => item.user_id === userId && item.school_id === schoolId);
      return store.assignments.filter((item) => item.staff_id === staff?.id).map((item) => ({ classId: item.class_id, subjectId: item.subject_id }));
    }
    if (sql.includes('SELECT s.id AS id, s.staff_number AS staffId')) {
      const byUser = sql.includes('s.user_id=? AND s.school_id=?');
      const [first, second] = params;
      return store.staff.filter((staff) => byUser ? staff.user_id === first && staff.school_id === second : staff.school_id === first).flatMap((staff) => {
        const user = store.users.find((row) => row.id === staff.user_id && row.school_id === staff.school_id);
        const profile = store.profiles.find((row) => row.id === staff.id && row.school_id === staff.school_id);
        const roleLinks = store.userRoles.filter((link) => link.user_id === user?.id);
        const assignments = store.assignments.filter((row) => row.staff_id === staff.id);
        return roleLinks.flatMap((link) => {
          const role = store.roles.find((row) => row.id === link.role_id && row.school_id === staff.school_id && ['TEACHER', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACCOUNTANT_BURSAR'].includes(row.role_key));
          return role ? (assignments.length ? assignments.map((assignment) => ({ id: staff.id, staffId: staff.staff_number, firstName: staff.first_name, lastName: staff.last_name, username: user.username, email: user.email, accountStatus: user.status, createdAt: user.created_at, fullName: profile.full_name, phone: profile.phone, roleKey: role.role_key, assignedClassId: assignment.class_id, assignedSubjectId: assignment.subject_id })) : [{ id: staff.id, staffId: staff.staff_number, firstName: staff.first_name, lastName: staff.last_name, username: user.username, email: user.email, accountStatus: user.status, createdAt: user.created_at, fullName: profile.full_name, phone: profile.phone, roleKey: role.role_key, assignedClassId: null, assignedSubjectId: null }]) : [];
        });
      });
    }
    if (sql.includes('FROM staff s JOIN users u ON u.id=s.user_id AND u.school_id=s.school_id') && sql.includes('WHERE s.user_id=?')) return store.staff.filter((row) => row.user_id === params[0] && row.school_id === params[1] && store.users.some((user) => user.id === row.user_id && user.school_id === row.school_id)).map((row) => ({ id: row.id }));
    if (sql.includes('SELECT id FROM staff WHERE user_id=? AND school_id=?')) return store.staff.filter((row) => row.user_id === params[0] && row.school_id === params[1]).map((row) => ({ id: row.id }));
    if (sql.includes('SELECT r.role_key AS roleKey FROM user_roles')) return store.userRoles.filter((row) => row.user_id === params[0]).map((link) => store.roles.find((role) => role.id === link.role_id)).filter(Boolean).map((role) => ({ roleKey: role.role_key }));
    if (sql.includes('SELECT u.username FROM staff s JOIN users u')) return store.staff.filter((row) => row.user_id === params[0] && row.school_id === params[1]).map((staff) => ({ username: store.users.find((user) => user.id === staff.user_id)?.username }));
    if (sql.includes('SELECT u.id,u.school_id AS schoolId')) return [];
    return [];
  }

  function executeFor(store, sql, params = []) {
    if (failAt && sql.startsWith(failAt)) throw new Error('injected persistence failure');
    if (sql.startsWith('INSERT INTO users')) {
      const [id, school_id, username, email, password_hash, status, created_at, updated_at] = params;
      store.users.push({ id, school_id, username, email, password_hash, status, created_at, updated_at });
      return { affectedRows: 1 };
    }
    if (sql.startsWith('INSERT INTO staff (')) {
      const [id, school_id, user_id, staff_number, first_name, last_name, created_at, updated_at] = params;
      store.staff.push({ id, school_id, user_id, staff_number, first_name, last_name, created_at, updated_at });
      return { affectedRows: 1 };
    }
    if (sql.startsWith('INSERT INTO staff_profiles')) {
      const [id, school_id, staff_id, employee_id, full_name, phone, role_key, created_at, updated_at] = params;
      store.profiles.push({ id, school_id, staff_id, employee_id, full_name, phone, role_key, created_at, updated_at });
      return { affectedRows: 1 };
    }
    if (sql.startsWith('INSERT INTO user_roles')) {
      store.userRoles.push({ user_id: params[0], role_id: params[1], created_at: params[2] });
      return { affectedRows: 1 };
    }
    if (sql.startsWith('INSERT INTO staff_assignments')) {
      store.assignments.push({ id: params[0], staff_id: params[1], subject_id: params[2], class_id: params[3], created_at: params[4] });
      return { affectedRows: 1 };
    }
    if (sql.startsWith('INSERT INTO auth_sessions')) {
      store.sessions.push({ id: params[0], user_id: params[1], school_id: params[2], token_hash: params[3], created_at: params[4], expires_at: params[5], revoked_at: null, last_used_at: params[7] });
      return { affectedRows: 1 };
    }
    if (sql.startsWith('DELETE ur FROM user_roles ur JOIN roles r')) {
      const [userId, schoolId] = params;
      store.userRoles = store.userRoles.filter((link) => {
        if (link.user_id !== userId) return true;
        const role = store.roles.find((item) => item.id === link.role_id);
        return role && role.school_id !== schoolId && role.school_id != null;
      });
      return { affectedRows: 1 };
    }
    if (sql.startsWith('UPDATE staff_profiles SET role_key=')) {
      const profile = store.profiles.find((row) => row.id === params[2] && row.school_id === params[3]);
      if (profile) { profile.role_key = params[0]; profile.updated_at = params[1]; }
      return { affectedRows: profile ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE users SET status=')) {
      const user = store.users.find((row) => row.id === params[2] && row.school_id === params[3]);
      if (user) { user.status = params[0]; user.updated_at = params[1]; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.startsWith('UPDATE users SET password_hash=')) {
      const user = store.users.find((row) => row.id === params[2] && row.school_id === params[3]);
      if (user) { user.password_hash = params[0]; user.updated_at = params[1]; return { affectedRows: 1 }; }
      return { affectedRows: 0 };
    }
    if (sql.startsWith('UPDATE auth_sessions SET last_used_at=')) {
      const session = store.sessions.find((row) => row.id === params[1] && !row.revoked_at);
      if (session) session.last_used_at = params[0];
      return { affectedRows: session ? 1 : 0 };
    }
    if (sql.startsWith('UPDATE auth_sessions SET revoked_at=')) {
      for (const session of store.sessions) {
        if (sql.includes('token_hash=?') ? session.token_hash === params[1] : session.user_id === params[1] && session.school_id === params[2]) session.revoked_at = params[0];
      }
      return { affectedRows: 1 };
    }
    throw new Error(`Unimplemented fake execute: ${sql}`);
  }

  const database = {
    supportsDurableAuthSessions: true,
    async query(sql, params) { return queryFor(state, sql, params); },
    async execute(sql, params) { return executeFor(state, sql, params); },
    async transaction(callback) {
      const working = structuredClone(state);
      const tx = { query: (sql, params) => queryFor(working, sql, params), execute: (sql, params) => executeFor(working, sql, params) };
      const result = await callback(tx);
      state = working;
      return result;
    },
    snapshot() { return structuredClone(state); },
    setUsername(userId, username) { const user = state.users.find((row) => row.id === userId); if (user) user.username = username; }
  };
  return database;
}

const actor = { id: 'school-admin', schoolId: SCHOOL_ID };
const newTeacher = { fullName: 'Frank Abban', staffId: 'OSAAH-STAFF-001', email: 'abbanfrank348@gmail.com', primaryRole: 'CLASSROOM_TEACHER', assignedClassId: 'primary-4', assignedSubjectId: 'mathematics' };

test('staff provisioning commits linked durable records and a new auth service can authenticate after restart', async () => {
  const database = createFakeDatabase();
  const provisioning = createAuthService({ database });
  const created = await provisioning.registerStaff(newTeacher, actor);
  assert.equal(created.staff.roleKey, 'TEACHER');
  assert.equal(created.staff.accountStatus, 'ACTIVE');
  assert.deepEqual(created.staff.assignedClassIds, ['primary-4']);
  assert.deepEqual(created.staff.assignedSubjectIds, ['mathematics']);
  assert.ok(created.temporaryPassword);
  assert.equal(Object.hasOwn(created.staff, 'passwordHash'), false);

  const stored = database.snapshot();
  assert.equal(stored.users.length, 1);
  assert.equal(stored.staff.length, 1);
  assert.equal(stored.profiles.length, 1);
  assert.equal(stored.userRoles.length, 1);
  assert.equal(stored.assignments.length, 1);
  assert.equal(stored.users[0].school_id, SCHOOL_ID);
  assert.equal(stored.users[0].email, newTeacher.email);
  assert.notEqual(stored.users[0].password_hash, created.temporaryPassword);
  assert.equal(stored.staff[0].user_id, stored.users[0].id);

  const restartedAuth = createAuthService({ database });
  const login = await restartedAuth.loginFromDatabase({ username: newTeacher.email, password: created.temporaryPassword, portal: 'school' });
  assert.equal(login.ok, true);
  assert.equal(login.user.roleKey, 'TEACHER');
  assert.equal(login.redirectTo, '/academics');
  assert.deepEqual(login.user.assignedClassIds, ['primary-4']);
  assert.deepEqual(login.user.assignedSubjectIds, ['mathematics']);
  assert.equal(database.snapshot().sessions.length, 2);
  assert.ok(database.snapshot().sessions[0].revoked_at);
  const restored = await restartedAuth.authenticateAsync(login.token);
  assert.deepEqual(restored.assignedClassIds, ['primary-4']);
  assert.deepEqual(restored.assignedSubjectIds, ['mathematics']);

  const listed = await restartedAuth.listStaff(SCHOOL_ID);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].email, newTeacher.email);
  assert.deepEqual(listed[0].assignedClassIds, ['primary-4']);
});

test('durable staff provisioning rejects duplicate email and Staff ID without creating duplicate records', async () => {
  const database = createFakeDatabase();
  const auth = createAuthService({ database });
  await auth.registerStaff(newTeacher, actor);
  await assert.rejects(auth.registerStaff({ ...newTeacher, staffId: 'OSAAH-STAFF-002' }, actor), { code: 'DUPLICATE_EMAIL' });
  await assert.rejects(auth.registerStaff({ ...newTeacher, email: 'another.teacher@example.com' }, actor), { code: 'DUPLICATE_STAFF_ID' });
  const stored = database.snapshot();
  assert.equal(stored.users.length, 1);
  assert.equal(stored.staff.length, 1);
});

test('durable staff provisioning rolls back all related inserts when a later write fails', async () => {
  const database = createFakeDatabase({ failAt: 'INSERT INTO user_roles' });
  const auth = createAuthService({ database });
  await assert.rejects(auth.registerStaff(newTeacher, actor), /injected persistence failure/);
  const stored = database.snapshot();
  assert.equal(stored.users.length, 0);
  assert.equal(stored.staff.length, 0);
  assert.equal(stored.profiles.length, 0);
  assert.equal(stored.userRoles.length, 0);
  assert.equal(stored.assignments.length, 0);
});

test('durable login accepts the stored username as well as the email address', async () => {
  const database = createFakeDatabase();
  const auth = createAuthService({ database });
  const created = await auth.registerStaff(newTeacher, actor);
  const user = database.snapshot().users[0];
  database.setUsername(user.id, 'OSAAH-STAFF-0042');
  const login = await createAuthService({ database }).loginFromDatabase({ username: 'OSAAH-STAFF-0042', password: created.temporaryPassword, portal: 'school' });
  assert.equal(login.ok, true);
  assert.equal(login.user.roleKey, 'TEACHER');
});

test('durable staff disable and credential reset persist status and replace the accepted credential', async () => {
  const database = createFakeDatabase();
  const auth = createAuthService({ database });
  const created = await auth.registerStaff(newTeacher, actor);
  assert.equal(await auth.setAccountStatus(created.staff.id, false, SCHOOL_ID), true);
  assert.equal(database.snapshot().users[0].status, 'DISABLED');
  assert.equal((await createAuthService({ database }).loginFromDatabase({ username: newTeacher.email, password: created.temporaryPassword, portal: 'school' })).ok, false);

  assert.equal(await auth.setAccountStatus(created.staff.id, true, SCHOOL_ID), true);
  const replacement = await auth.resetStaffCredentials(created.staff.id, SCHOOL_ID);
  assert.ok(replacement.temporaryPassword);
  const restartedAuth = createAuthService({ database });
  assert.equal((await restartedAuth.loginFromDatabase({ username: newTeacher.email, password: created.temporaryPassword, portal: 'school' })).ok, false);
  assert.equal((await restartedAuth.loginFromDatabase({ username: replacement.username, password: replacement.temporaryPassword, portal: 'school' })).ok, true);
});


test('durable role changes update canonical role assignment and an incomplete database adapter never falls back to memory', async () => {
  const database = createFakeDatabase();
  const auth = createAuthService({ database });
  const created = await auth.registerStaff(newTeacher, actor);
  const changed = await auth.changeStaffRole(created.staff.id, 'HEADTEACHER', SCHOOL_ID);
  assert.equal(changed.previousRole, 'TEACHER');
  assert.equal(changed.newRole, 'HEADTEACHER');
  assert.equal(changed.staff.roleKey, 'HEADTEACHER');
  const stored = database.snapshot();
  assert.equal(stored.userRoles.length, 1);
  assert.equal(stored.roles.find((role) => role.id === stored.userRoles[0].role_id).role_key, 'HEADTEACHER');
  assert.equal(await auth.changeStaffRole('missing-user', 'TEACHER', SCHOOL_ID), null);

  const incomplete = createAuthService({ database: { query: async () => [] } });
  assert.throws(() => incomplete.registerStaff(newTeacher, actor), /Durable staff provisioning is unavailable/);
});
