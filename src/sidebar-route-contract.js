const VIEW_BY_MODULE = Object.freeze({
  academics: 'academics-overview', 'academic-years': 'academic-years', 'academic-terms': 'academic-terms', 'academic-classes': 'academic-classes', 'academic-subjects': 'academic-subjects', 'teacher-assignments': 'teacher-assignments', curriculum: 'curriculum', 'lesson-plans': 'lesson-plans', 'academic-assignments': 'academic-assignments', timetable: 'academic-timetable', 'exam-timetable': 'exam-timetable', examinations: 'examinations', 'attendance-dashboard': 'attendance-overview', 'student-attendance': 'student-attendance-register', 'staff-attendance': 'staff-attendance-register', 'attendance-reports': 'attendance-reporting', 'attendance-reports-management': 'attendance-reporting',
  fees: 'fees-overview', finance: 'finance-overview', invoices: 'invoices-receipts', 'fee-structure': 'fee-structure', 'admission-fee-management': 'admission-fee-structures', 'fee-setup': 'fee-setup', 'extra-classes': 'extra-classes', 'extra-classes-collections': 'extra-classes', canteen: 'canteen', 'canteen-collections': 'canteen', 'collection-reports': 'collection-reports', 'student-fees': 'student-fees', payments: 'payments', receipts: 'fee-receipts', 'finance-receipts': 'finance-receipts', 'finance-reports': 'finance-reports', income: 'income', expenses: 'expenses', cashbook: 'cashbook', budgets: 'budgets', arrears: 'arrears', discounts: 'discounts', 'fee-statements': 'fee-statements',
  'staff-directory': 'staff-directory', teachers: 'teachers-register', hr: 'staff-hr', leave: 'leave-management', 'staff-attendance-hr': 'staff-attendance-register', qualifications: 'qualifications-licences', performance: 'staff-performance', 'staff.professional-development': 'professional-development', 'qualifications-licences': 'qualifications', 'ntc-records': 'ntc-records', appraisals: 'staff-appraisal', 'hr-documents': 'hr-documents',
  'student-profiles': 'student-profiles', 'student-search': 'student-search', 'student-directory': 'student-directory', 'student-ids': 'student-ids', 'student-transfers': 'student-transfers', 'student-alumni': 'student-alumni',
  reports: 'reports-overview', 'academic-reports': 'academic-reports', 'attendance-reports-management': 'attendance-reports', 'financial-reports': 'financial-reports', 'enrollment-reports': 'enrollment-reports', 'staff-reports': 'staff-reports', 'operational-reports': 'operational-reports', 'management-dashboard': 'management-dashboard',
  'user-guide': 'user-guide', 'about-developer': 'about-developer', copyright: 'copyright'
});

function componentFor(module) {
  const key = module.moduleKey ?? '';
  const route = module.route ?? '';
  if (key === 'class-database') return '/class-database.html';
  if (key === 'completed-class-database') return '/completed-class-database.html';
  if (key === 'student-attendance') return '/attendance.html';
  if (key === 'staff-attendance' || key === 'staff-attendance-hr') return '/staff-attendance.html';
  if (key === 'attendance-reports' || key === 'attendance-reports-management') return '/reports-academic.html';
  if (key === 'exam-timetable' || key === 'timetable') return key === 'exam-timetable' ? '/exam-timetable.html' : '/academic-modules.html';
  if (route.startsWith('/finance/') || route.startsWith('/fees/')) return route === '/fees/setup' ? '/fee-setup.html' : route.startsWith('/fees/collections/extra-classes') ? '/collections.html' : route.startsWith('/fees/collections/canteen') ? '/canteen.html' : route.startsWith('/fees/collections/reports') ? '/collection-reports.html' : '/finance-canonical.html';
  if (route.startsWith('/academics/')) return route === '/academics/subjects' || route === '/academics/subjects/list' ? '/subjects.html' : route === '/academics/subject-register' ? '/subject-register.html' : '/academic-modules.html';
  if (route.startsWith('/staff/')) return route === '/staff/leave' ? '/leave.html' : route === '/staff/attendance' ? '/staff-attendance.html' : '/staff-canonical.html';
  if (route.startsWith('/reports/')) return key === 'financial-reports' ? '/reports-financial.html' : key === 'academic-reports' || key === 'attendance-reports-management' ? '/reports-academic.html' : '/reports-canonical.html';
  if (route.startsWith('/students/')) return '/student-canonical.html';
  if (route.startsWith('/communication/')) return '/communication.html';
  if (route.startsWith('/about-developer')) return '/about-developer.html';
  if (route.startsWith('/copyright')) return '/copyright.html';
  return route === '/' ? '/index.html' : '/operations-canonical.html';
}

function apiFor(module) {
  const route = module.route ?? '';
  if (module.moduleKey === 'class-database') return ['/api/class-database/options', '/api/class-database'];
  if (module.moduleKey === 'completed-class-database') return ['/api/class-database/completed/options', '/api/class-database/completed'];
  if (route.startsWith('/finance') || route.startsWith('/fees')) return ['/api/fees/obligations', '/api/reports/financial'];
  if (route.startsWith('/attendance')) return ['/api/attendance/students'];
  if (route.startsWith('/staff')) return ['/api/attendance/staff'];
  if (route.startsWith('/reports')) return ['/api/reports/academic'];
  if (route.startsWith('/students')) return ['/api/students'];
  return [];
}

export function resolveRouteContract(module = {}) {
  const moduleKey = module.navigationKey ?? module.moduleKey ?? module.moduleId ?? module.route;
  return Object.freeze({
    navigationKey: module.navigationKey ?? module.moduleKey ?? module.moduleId,
    route: module.route ?? '/',
    exactView: module.exactView ?? VIEW_BY_MODULE[moduleKey] ?? moduleKey,
    component: module.component ?? componentFor(module),
    apiDependencies: Object.freeze(module.apiDependencies ?? apiFor(module)),
    sharedRoute: Boolean(module.allowSharedRoute)
  });
}

export function routeContractForNavigation(navigationKey, modules = []) {
  const module = modules.find((item) => (item.navigationKey ?? item.moduleKey ?? item.moduleId) === navigationKey);
  return module ? resolveRouteContract(module) : null;
}
