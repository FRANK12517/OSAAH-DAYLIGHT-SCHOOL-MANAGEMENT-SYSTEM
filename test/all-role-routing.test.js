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
    '/results/broadsheets': ['/academic-modules.html', /Academic Module/],
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

test('administrative and academic oversight children use distinct canonical routes', () => {
  const expected = {
    'school-profile': '/settings/profile', 'academic-calendar': '/communication/calendar',
    academics: '/academics', 'attendance-dashboard': '/attendance', examinations: '/examinations',
    'sporting-activities': '/sporting-activities', 'student-attendance': '/attendance/students',
    'marks-entry': '/examinations/marks', 'staff-attendance': '/attendance/staff', results: '/results',
    'attendance-reports': '/attendance/reports', promotion: '/promotion', 'mock-score-entry': '/examinations/mock',
    'subject-management': '/academics/subjects', 'mock-results': '/results/mock', 'subject-register': '/academics/subject-register',
    'academic-years': '/academics/years', 'attendance-alerts': '/attendance/alerts', 'exam-timetable': '/examinations/timetable',
    'academic-terms': '/academics/terms', spreadsheets: '/academics/spreadsheets', 'academic-classes': '/academics/classes',
    broadsheets: '/results/broadsheets', 'report-cards': '/results/report-cards', 'academic-subjects': '/academics/subjects/list',
    'promotion-results': '/results/promotions', 'teacher-assignments': '/academics/teacher-assignments', curriculum: '/academics/curriculum',
    'lesson-plans': '/academics/lesson-plans', 'academic-assignments': '/academics/assignments', timetable: '/academics/timetable'
  };
  const routes = new Map(PROPRIETOR_SIDEBAR_ROUTES.map((item) => [item.moduleKey, item.route]));
  for (const [moduleKey, route] of Object.entries(expected)) assert.equal(routes.get(moduleKey), route, moduleKey);
  assert.equal(new Set(Object.values(expected)).size, Object.keys(expected).length);
  assert.equal(PROPRIETOR_PAGE_ALIASES['/results/broadsheets'], '/academic-modules.html');
  assert.equal(PROPRIETOR_PAGE_ALIASES['/attendance/reports'], '/reports-academic.html');
});

test('finance, staff, and student management children retain canonical route identity', () => {
  const expected = {
    fees: '/fees', finance: '/finance', invoices: '/fees/invoices', 'finance-reports': '/finance/reports',
    'fee-structure': '/fees/structure', 'fee.scholarships': '/fees/scholarships', 'admission-fee-management': '/fees/admission-structures',
    'student-fees': '/fees/students', income: '/finance/income', payments: '/fees/payments', expenses: '/finance/expenses',
    receipts: '/fees/receipts', cashbook: '/finance/cashbook', arrears: '/fees/arrears', budgets: '/finance/budgets',
    discounts: '/fees/discounts', 'fee-statements': '/fees/statements', 'staff-directory': '/staff', teachers: '/staff/teachers',
    hr: '/staff/hr', leave: '/staff/leave', 'staff-attendance-hr': '/staff/attendance', qualifications: '/staff/qualifications-licences',
    performance: '/staff/performance', 'staff.professional-development': '/staff/professional-development',
    'qualifications-licences': '/staff/qualifications', 'ntc-records': '/staff/ntc-records', appraisals: '/staff/appraisal',
    'hr-documents': '/staff/documents', 'student-profiles': '/students', admissions: '/admissions', 'student-search': '/students/search',
    'admission-prospectus': '/admissions/prospectus', 'student-directory': '/students/directory', 'admission-enquiries': '/admissions/enquiries',
    'student-ids': '/students/ids', 'admission-applications': '/admissions/applications', 'student-transfers': '/students/transfers',
    'admission-review': '/admissions/review', 'student-alumni': '/students/alumni', 'admission-offers': '/admissions/offers',
    'admission-enrollment': '/admissions/enrollment'
  };
  const routes = new Map(PROPRIETOR_SIDEBAR_ROUTES.map((item) => [item.moduleKey, item.route]));
  for (const [moduleKey, route] of Object.entries(expected)) assert.equal(routes.get(moduleKey), route, moduleKey);
  assert.equal(new Set(Object.values(expected)).size, Object.keys(expected).length);
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
