import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { visibleSidebar, SIDEBAR_MODULES } from '../src/sidebar-registry.js';
import { createAuthService } from '../src/auth.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import '../src/module-registry.js';

const schoolId = 'school-osaah-daylight';

function modulesFor(actor) {
  return visibleSidebar({ modules: SIDEBAR_MODULES, roleKey: actor.roleKey, portal: 'school', permissions: actor.permissions })
    .flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
}

test('School Administrator sees Mock Score Entry only with the write permission', () => {
  const hidden = modulesFor({ roleKey: 'SCHOOL_ADMIN', permissions: new Set(['mock.scores.read']) });
  assert.equal(hidden.some((module) => module.moduleKey === 'mock-score-entry'), false);
  const visible = modulesFor({ roleKey: 'SCHOOL_ADMIN', permissions: new Set(['mock.scores.read', 'mock.scores.write']) });
  const entry = visible.find((module) => module.moduleKey === 'mock-score-entry');
  assert.equal(entry?.route, '/examinations/mock');
  assert.equal(entry?.requiredPermission, 'mock.scores.write');
});

test('Administrator provisioning grants Mock Score Entry read/write permissions', () => {
  const proprietor = { id: 'proprietor', username: 'proprietor@test', roleKey: 'PROPRIETOR', schoolId, permissions: new Set(['*']) };
  const auth = createAuthService({ users: [proprietor] });
  const created = auth.createAdministrator({ fullName: 'Mock Administrator', staffId: 'ADM-MOCK-001' }, proprietor);
  const login = auth.login({ username: created.administrator.username, password: created.temporaryPassword, portal: 'school', role: 'SCHOOL_ADMIN' });
  assert.equal(login.ok, true);
  const authenticated = auth.authenticate(login.token);
  assert.equal(authenticated.permissions.has('mock.scores.read'), true);
  assert.equal(authenticated.permissions.has('mock.scores.write'), true);
});

test('Administrator Mock Score Entry uses the existing JHS-only total-score contract', () => {
  const students = createStudentService();
  const subjects = createSubjectService();
  const results = createAcademicResultsService({ students, subjects });
  const administrator = { id: 'administrator', roleKey: 'SCHOOL_ADMIN', schoolId, permissions: new Set(['mock.scores.read', 'mock.scores.write']) };
  const student = students.createStudent({ firstName: 'Admin', surname: 'Mock', classId: 'JHS 1', admissionYearId: '2026' });
  const subject = subjects.list({ classId: 'JHS 1' }, administrator)[0];
  const saved = results.saveMockScore({ studentId: student.id, classId: 'JHS 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: 80 }, administrator);
  assert.equal(saved.totalScore, 80);
  assert.equal(saved.caScore, null);
  assert.equal(saved.examScore, null);
  assert.throws(() => results.saveMockScore({ studentId: student.id, classId: 'JHS 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', caScore: 20, examScore: 60 }, administrator), /Total Score \/ 100 only/);
  assert.throws(() => results.saveMockScore({ studentId: student.id, classId: 'Primary 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: 80 }, administrator), /JHS 1, JHS 2, and JHS 3/);
});

test('Administrator Mock Score Entry permission is additive and historical RBAC remains unchanged', async () => {
  const historical = await readFile(new URL('../schema/032_production_rbac_reconciliation.sql', import.meta.url), 'utf8');
  const forward = await readFile(new URL('../schema/072_school_admin_mock_score_entry_permission.sql', import.meta.url), 'utf8');
  const administratorBlock = historical.match(/FROM roles r JOIN permissions p ON p\.permission_key IN \([^;]+\)\nWHERE r\.role_key = 'SCHOOL_ADMIN';/s)?.[0] ?? '';
  assert.notEqual(administratorBlock, '');
  assert.doesNotMatch(administratorBlock, /mock\.scores\.(read|write)/);
  assert.match(forward, /mock\.scores\.read/);
  assert.match(forward, /mock\.scores\.write/);
  assert.doesNotMatch(forward, /DROP\s+(TABLE|COLUMN|DATABASE)/i);
});
