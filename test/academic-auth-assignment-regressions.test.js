import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scryptSync } from 'node:crypto';
import test from 'node:test';
import { createAuthService } from '../src/auth.js';
import { createAssignmentService } from '../src/assignments.js';
import { resolveRouteContract } from '../src/sidebar-route-contract.js';

const schoolId = 'school-osaah-daylight';
const password = 'Role-password-123!';
const hash = (salt) => `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;

test('database login selects the requested role and scopes permissions to that role', async () => {
  const rows = [
    { id: 'multi-1', schoolId, username: 'multi@example.test', email: 'multi@example.test', passwordHash: hash('multi-salt'), status: 'ACTIVE', roleKey: 'TEACHER', oversightRank: 40, permissionKey: 'marks.write' },
    { id: 'multi-1', schoolId, username: 'multi@example.test', email: 'multi@example.test', passwordHash: hash('multi-salt'), status: 'ACTIVE', roleKey: 'HEADTEACHER', oversightRank: 80, permissionKey: 'results.publish' },
    { id: 'multi-1', schoolId, username: 'multi@example.test', email: 'multi@example.test', passwordHash: hash('multi-salt'), status: 'ACTIVE', roleKey: 'HEADTEACHER', oversightRank: 80, permissionKey: 'academics.read' }
  ];
  const database = { async query(sql) { return sql.includes('FROM users u') ? rows : []; }, async execute() {} };
  const auth = createAuthService({ database, sessionSecret: 'role-selection-regression-session-secret-123' });
  const defaultLogin = await auth.loginFromDatabase({ username: 'multi@example.test', password, portal: 'school' });
  assert.equal(defaultLogin.user.roleKey, 'HEADTEACHER');
  assert.equal(auth.authenticate(defaultLogin.token).roleKey, 'HEADTEACHER');
  assert.equal(auth.authenticate(defaultLogin.token).permissions.has('academics.read'), true);
  assert.equal(auth.authenticate(defaultLogin.token).permissions.has('results.publish'), true);
  assert.equal(auth.authenticate(defaultLogin.token).permissions.has('marks.write'), false);
  const teacherLogin = await auth.loginFromDatabase({ username: 'multi@example.test', password, portal: 'school', role: 'TEACHER' });
  assert.equal(teacherLogin.user.roleKey, 'TEACHER');
  assert.deepEqual([...auth.authenticate(teacherLogin.token).permissions], ['marks.write']);
  assert.equal(auth.authenticate(teacherLogin.token).roleKey, 'TEACHER');
  assert.equal(auth.authenticate(teacherLogin.token).permissions.has('results.publish'), false);
});

test('assignment retrieval remains school- and teacher-class-scoped', async () => {
  const service = createAssignmentService({ classes: ['Primary 1', 'Primary 2'], subjects: { list: () => [{ id: 'math', name: 'Mathematics' }] } });
  const teacher = { id: 'teacher-1', roleKey: 'TEACHER', schoolId, assignedClassIds: ['Primary 1'] };
  const created = await service.create({ academicYearId: 'year-1', termId: 'term-1', classId: 'Primary 1', subjectId: 'math', title: 'Fractions', recipientScope: 'CLASS' }, teacher);
  assert.equal((await service.listForStaff(teacher, { classId: 'Primary 1' })).length, 1);
  await assert.rejects(() => service.listForStaff(teacher, { classId: 'Primary 2' }), /outside your teacher assignment/);
  assert.equal((await service.listForStaff({ ...teacher, roleKey: 'HEADTEACHER' }, { classId: 'Primary 2' })).length, 0);
  assert.equal(created.status, 'DRAFT');
});

test('assignment class aliases remain authorized while subjects stay class-scoped', async () => {
  const service = createAssignmentService({ classes: ['KG1'], subjects: { list: ({ classId }) => classId === 'KG1' ? [{ id: 'phonics' }] : [] } });
  const teacher = { id: 'teacher-kg', roleKey: 'TEACHER', schoolId, assignedClassIds: ['KG 1'] };
  const created = await service.create({ classId: 'KG1', subjectId: 'phonics', title: 'Letter sounds' }, teacher);
  assert.equal(created.classId, 'KG1');
  await assert.rejects(() => service.create({ classId: 'KG1', subjectId: 'math', title: 'Numbers' }, teacher), /Subject is not configured/);
});

test('durable assignments require an active subject registration for the selected class', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM classes')) return [{ id: 'class-kg1', name: 'KG 1' }];
      if (sql.includes('FROM subjects s JOIN subject_class_assignments')) return [];
      return [];
    },
    async execute() {}
  };
  const service = createAssignmentService({ database, classes: [], schoolId });
  const teacher = { id: 'teacher-durable', roleKey: 'TEACHER', schoolId, assignedClassIds: ['class-kg1'] };
  await assert.rejects(() => service.create({ classId: 'class-kg1', subjectId: 'subject-math', title: 'Fractions' }, teacher), /Subject is not configured/);
});

test('attendance route metadata has distinct student, staff, and alert API contracts', () => {
  assert.deepEqual(resolveRouteContract({ moduleKey: 'student-attendance', route: '/attendance' }).apiDependencies, ['/api/attendance/register']);
  assert.deepEqual(resolveRouteContract({ moduleKey: 'staff-attendance', route: '/staff/attendance' }).apiDependencies, ['/api/attendance/staff']);
  assert.deepEqual(resolveRouteContract({ moduleKey: 'attendance-alerts', route: '/attendance/alerts' }).apiDependencies, ['/api/attendance/alerts']);
});

test('academic modules page uses live academic, subject, student, and assignment endpoints', async () => {
  const html = await readFile(new URL('../public/academic-modules.html', import.meta.url), 'utf8');
  for (const endpoint of ['/api/academic/options', '/api/subjects', '/api/academic/result-students', '/api/assignments']) assert.match(html, new RegExp(endpoint.replaceAll('/', '\\/')));
  assert.match(html, /Save Assignment/);
  assert.doesNotMatch(html, /Coming Soon|static academic data/i);
});
