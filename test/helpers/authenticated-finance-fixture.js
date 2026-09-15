import { createHmac, scryptSync } from 'node:crypto';
import { createAuthService } from '../../src/auth.js';
import { createApp } from '../../src/server.mjs';

const hash = (password, salt) => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
const user = (id, username, password, roleKey, portal, schoolId, permissions) => ({ id, username, passwordHash: hash(password, `${id}-salt`), roleKey, portal, schoolId, permissions: new Set(permissions) });

export function createAuthenticatedFinanceFixture() {
  const schoolA = 'school-test-a', schoolB = 'school-test-b';
  const users = [
    user('test-accountant-a', 'accountant@test.local', 'AccountantTest123!', 'ACCOUNTANT_BURSAR', 'school', schoolA, ['fees.read', 'fees.write', 'finance.read']),
    user('test-teacher-a', 'teacher@test.local', 'TeacherTest123!', 'TEACHER', 'school', schoolA, ['students.read', 'academics.read']),
    user('test-parent-a', 'parent@test.local', 'ParentTest123!', 'PARENT', 'parent', schoolA, ['children.read']),
    user('test-accountant-b', 'accountant-b@test.local', 'AccountantBTest123!', 'ACCOUNTANT_BURSAR', 'school', schoolB, ['fees.read', 'fees.write', 'finance.read'])
  ];
  const rows = [{ id: 'collection-test-1', school_id: schoolA, collection_type: 'CANTEEN', collection_date: '2026-09-14', amount_received_minor: 10000 }, { id: 'collection-test-b', school_id: schoolB, collection_type: 'CANTEEN', amount_received_minor: 99000 }]; const corrections = [];
  const database = { async query(sql, params = []) { if (sql.includes('fee_collection_records')) return rows.filter((r) => r.school_id === params[0] && (!params[1] || r.id === params[1])); return []; }, async execute(sql, params = []) { if (sql.startsWith('INSERT INTO fee_collection_records')) rows.push({ id: params[0], school_id: params[1], collection_type: params[2], class_id: params[3], collection_date: params[4], expected_amount_minor: params[5], amount_received_minor: params[6], recorded_by: params[7], academic_year_id: params[9], term_id: params[10] }); if (sql.startsWith('UPDATE')) rows.find((r) => r.id === params[3]).amount_received_minor = params[0]; if (sql.includes('fee_collection_corrections')) corrections.push({ collectionId: params[2], schoolId: params[1], actorUserId: params[3], reason: params[4], before: params[5], after: params[6] }); return { affectedRows: 1 }; }, async transaction(work) { return work(this); } };
  const audit = []; const auditSink = (event) => audit.push(event); const auth = createAuthService({ users, audit: auditSink, sessionSecret: 'test-only-session-secret-0123456789012345' });
  const app = createApp({ auth, database });
  const accountantLogin = auth.login({ username: 'accountant@test.local', password: 'AccountantTest123!', portal: 'school' }); const teacherLogin = auth.login({ username: 'teacher@test.local', password: 'TeacherTest123!', portal: 'school' }); const parentLogin = auth.login({ username: 'parent@test.local', password: 'ParentTest123!', portal: 'parent' }); for (const login of [accountantLogin, teacherLogin, parentLogin]) if (!login.ok || typeof login.token !== 'string') throw new Error(`Fixture login failed: ${login.error}`); const tokens = { accountantToken: accountantLogin.token, teacherToken: teacherLogin.token, parentToken: parentLogin.token };
  return { app, auth, database, users, schoolA, schoolB, accountant: users[0], teacher: users[1], parent: users[2], ...tokens, audit, corrections, rows };
}
