import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { createExaminationService, TIMETABLE_CREATOR_ROLES } from '../src/examinations.js';
import { PROPRIETOR_PAGE_ALIASES, PROPRIETOR_SIDEBAR_ROUTES } from '../src/proprietor-sidebar-routes.js';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';
import '../src/module-registry.js';

const publicFile = (page) => new URL(`../public/${page.replace(/^\//, '')}`, import.meta.url);

test('broken academic links resolve to their intended existing module pages', async () => {
  const expected = {
    '/examinations/timetable': ['/exam-timetable.html', /Examination Timetable/],
    '/results/broadsheets': ['/reports-academic.html', /ACADEMIC PERFORMANCE REPORTS/],
    '/academics/classes': ['/academic-modules.html', /academic-classes/],
    '/results/report-cards': ['/results.html', /Student Result Slip/],
    '/academics/subjects/list': ['/subjects.html', /Subject Management/],
    '/results/promotions': ['/results.html', /Student Result Slip/],
    '/academics/curriculum': ['/academic-modules.html', /curriculum/],
    '/academics/lesson-plans': ['/academic-modules.html', /lesson-plans/],
    '/academics/assignments': ['/academic-modules.html', /academic-assignments/],
    '/academics/timetable': ['/academic-modules.html', /class teaching timetable/],
    '/academics/spreadsheets': ['/academic-modules.html', /spreadsheets/]
  };
  for (const [route, [page, marker]] of Object.entries(expected)) {
    assert.equal(PROPRIETOR_PAGE_ALIASES[route], page, route);
    await access(publicFile(page));
    assert.match(await readFile(publicFile(page), 'utf8'), marker, route);
  }
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/examinations/timetable'], PROPRIETOR_PAGE_ALIASES['/examinations/marks']);
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/results/broadsheets'], PROPRIETOR_PAGE_ALIASES['/results']);
  assert.notEqual(PROPRIETOR_PAGE_ALIASES['/academics/classes'], PROPRIETOR_PAGE_ALIASES['/academics/subjects']);
});

test('every proprietor route has a real render target and unique module identity', async () => {
  assert.equal(new Set(PROPRIETOR_SIDEBAR_ROUTES.map((item) => item.route)).size, PROPRIETOR_SIDEBAR_ROUTES.length);
  for (const item of PROPRIETOR_SIDEBAR_ROUTES) await access(publicFile(item.page));
});

test('exam timetable creation is restricted, conflict checked and publication scoped', () => {
  assert.deepEqual(TIMETABLE_CREATOR_ROLES, ['HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'SCHOOL_ADMIN']);
  const service = createExaminationService({ now: () => '2026-09-09T12:00:00.000Z' });
  const head = { id: 'head-1', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight' };
  const draft = service.saveTimetable({ academicYearId: '2026/2027', termId: 'First Term', classId: 'Primary 4', examination: 'End of Term', subjectId: 'Mathematics', date: '2026-12-01', startTime: '09:00', endTime: '10:00', venue: 'Room 4' }, head);
  assert.equal(draft.status, 'DRAFT');
  assert.equal(service.listTimetables({}, { roleKey: 'PROPRIETOR', schoolId: draft.schoolId }).length, 0);
  assert.equal(service.listTimetables({}, { portal: 'parent', children: [{ className: 'Primary 4' }], schoolId: draft.schoolId }).length, 0);
  assert.throws(() => service.saveTimetable({ ...draft, id: undefined, subjectId: 'English' }, { id: 'exam-1', roleKey: 'EXAMINATION_OFFICER' }), /permission/);
  assert.throws(() => service.saveTimetable({ ...draft, id: undefined, subjectId: 'English', startTime: '09:30', endTime: '10:30' }, head), { code: 'TIMETABLE_CONFLICT' });
  service.publishTimetable(draft.id, { id: 'admin-1', roleKey: 'SCHOOL_ADMIN' });
  assert.equal(service.listTimetables({}, { roleKey: 'PROPRIETOR', schoolId: draft.schoolId }).length, 1);
  assert.equal(service.listTimetables({}, { portal: 'parent', children: [{ className: 'Primary 4' }], schoolId: draft.schoolId }).length, 1);
  assert.equal(service.listTimetables({}, { portal: 'parent', children: [{ className: 'Primary 5' }], schoolId: draft.schoolId }).length, 0);
});

test('all school roles use canonical non-fallback routes for their visible navigation', () => {
  const rolePermissions = new Set(['*']);
  for (const roleKey of ['PROPRIETOR','HEADTEACHER','ASSISTANT_HEADTEACHER','SCHOOL_ADMIN','ACCOUNTANT_BURSAR','TEACHER','ADMISSIONS_OFFICER','HR_OFFICER','EXAMINATION_OFFICER']) {
    const modules = visibleSidebar({ modules: SIDEBAR_MODULES, permissions: rolePermissions, roleKey, portal: 'school' }).flatMap((group) => group.modules.flatMap((module) => [module, ...(module.children ?? [])]));
    for (const module of modules.filter((item) => !['dashboard','logout'].includes(item.moduleKey))) assert.ok(module.route.startsWith('/') && module.route !== '/', `${roleKey}:${module.moduleKey}`);
  }
});
