// The authoritative Proprietor navigation contract. Every item gets a stable,
// unique URL while reusing an existing page implementation.
const group = (category, page, entries) => entries.map(([moduleKey, moduleName, route], index) => ({
  moduleKey, moduleName, category, route, page, displayOrder: index + 1
}));

export const PROPRIETOR_SIDEBAR_ROUTES = Object.freeze([
  ...group('ADMINISTRATIVE', '/index.html', [
    ['settings', 'School Settings', '/settings'], ['users', 'Users & Roles', '/users'],
    ['multi-school-panel', 'Multi-School Panel', '/settings/multi-school'],
    ['official-documents', 'Official Documents', '/official-documents'],
    ['public-website', 'Public School Website', '/website'],
    ['administrator-management', 'Administrator Management', '/administrator-management'],
    ['signature-management', 'Result Signatures', '/settings/result-signatures']
  ]).map((item) => ({ ...item, page: ({
    'official-documents': '/official-documents.html', 'public-website': '/website.html',
    'administrator-management': '/administrator-management.html', 'signature-management': '/result-signatures.html'
  })[item.moduleKey] ?? item.page })),
  ...group('ACADEMICS', '/subjects.html', [
    ['academics', 'Academics', '/academics'], ['attendance-dashboard', 'Attendance Dashboard', '/attendance'],
    ['examinations', 'Examinations', '/examinations'], ['sporting-activities', 'Sporting Activities', '/sporting-activities'],
    ['student-attendance', 'Student Attendance', '/attendance/students'], ['marks-entry', 'Marks Entry', '/examinations/marks'],
    ['staff-attendance', 'Staff Attendance', '/attendance/staff'], ['results', 'Results & Reports', '/results'],
    ['attendance-reports', 'Attendance Reports', '/attendance/reports'], ['promotion', 'Promotion', '/promotion'],
    ['mock-score-entry', 'Mock Score Entry', '/examinations/mock'], ['subject-management', 'Subject Management', '/academics/subjects'],
    ['mock-results', 'Mock Results', '/results/mock'], ['subject-register', 'Subject Register', '/academics/subject-register'],
    ['academic-years', 'Academic Years', '/academics/years'], ['attendance-alerts', 'Attendance Alerts', '/attendance/alerts'],
    ['exam-timetable', 'Exam Timetable', '/examinations/timetable'], ['academic-terms', 'Terms', '/academics/terms'],
    ['spreadsheets', 'Spreadsheets', '/academics/spreadsheets'], ['academic-classes', 'Classes', '/academics/classes'],
    ['report-cards', 'Report Cards', '/results/report-cards'], ['academic-subjects', 'Subjects', '/academics/subjects/list'],
    ['promotion-results', 'Promotion Results', '/results/promotions'], ['teacher-assignments', 'Teacher Assignments', '/academics/teacher-assignments'],
    ['curriculum', 'Curriculum', '/academics/curriculum'], ['lesson-plans', 'Lesson Plans', '/academics/lesson-plans'],
    ['academic-assignments', 'Assignments', '/academics/assignments'], ['timetable', 'Timetable', '/academics/timetable']
  ]).map((item) => ({ ...item, page: item.route.startsWith('/attendance') ? '/attendance.html' : item.route.startsWith('/examinations/mock') ? '/mock-examinations.html' : item.route.startsWith('/examinations') ? '/examinations.html' : item.route === '/sporting-activities' ? '/sporting-activities.html' : item.route === '/academics/subject-register' ? '/subject-register.html' : item.route.startsWith('/results/mock') ? '/mock-results.html' : item.route.startsWith('/results') || item.route === '/promotion' ? '/results.html' : item.page })),
  ...group('FEE HUB', '/fees.html', [
    ['fees', 'Fees', '/fees'], ['finance', 'Finance', '/finance'], ['invoices', 'Invoices & Receipts', '/fees/invoices'],
    ['finance-reports', 'Finance Reports', '/finance/reports'], ['fee-structure', 'Fee Structure', '/fees/structure'],
    ['fee.scholarships', 'Scholarships', '/fees/scholarships'], ['admission-fee-management', 'Admission Fee Structures', '/fees/admission-structures'],
    ['student-fees', 'Student Fees', '/fees/students'], ['income', 'Income', '/finance/income'], ['payments', 'Payments', '/fees/payments'],
    ['expenses', 'Expenses', '/finance/expenses'], ['receipts', 'Receipts', '/fees/receipts'], ['cashbook', 'Cashbook', '/finance/cashbook'],
    ['arrears', 'Arrears', '/fees/arrears'], ['budgets', 'Budgets', '/finance/budgets'], ['discounts', 'Discounts', '/fees/discounts'],
    ['fee-statements', 'Fee Statements', '/fees/statements']
  ]).map((item) => ({ ...item, page: item.route.startsWith('/finance') ? '/finance.html' : item.moduleKey === 'invoices' || item.moduleKey === 'receipts' ? '/receipts.html' : item.moduleKey === 'admission-fee-management' ? '/admission-fees.html' : item.page })),
  ...group('STAFF MANAGEMENT', '/staff.html', [
    ['staff-directory', 'Staff Directory', '/staff'], ['teachers', 'Teachers', '/staff/teachers'], ['hr', 'HR', '/staff/hr'],
    ['leave', 'Leave', '/staff/leave'], ['staff-attendance-hr', 'Staff Attendance', '/staff/attendance'],
    ['qualifications', 'Qualifications / Licences', '/staff/qualifications-licences'], ['performance', 'Performance', '/staff/performance'],
    ['staff.professional-development', 'Professional Development', '/staff/professional-development'],
    ['qualifications-licences', 'Qualifications', '/staff/qualifications'], ['ntc-records', 'NTC Records', '/staff/ntc-records'],
    ['appraisals', 'Appraisal', '/staff/appraisal'], ['hr-documents', 'HR Documents', '/staff/documents']
  ]).map((item) => ({ ...item, page: item.moduleKey === 'leave' ? '/leave.html' : item.page })),
  ...group('STUDENTS MANAGEMENT', '/students.html', [
    ['student-profiles', 'Student Profiles', '/students'], ['admissions', 'Admissions', '/admissions'], ['student-search', 'Student Search', '/students/search'],
    ['admission-prospectus', 'Admission Prospectus Management', '/admissions/prospectus'], ['student-directory', 'Student Directory', '/students/directory'],
    ['admission-enquiries', 'Enquiries', '/admissions/enquiries'], ['student-ids', 'Student IDs', '/students/ids'],
    ['admission-applications', 'Applications', '/admissions/applications'], ['student-transfers', 'Transfers', '/students/transfers'],
    ['admission-review', 'Application Review', '/admissions/review'], ['student-alumni', 'Alumni', '/students/alumni'],
    ['admission-offers', 'Admission Offers', '/admissions/offers'], ['admission-enrollment', 'Enrollment', '/admissions/enrollment']
  ]).map((item) => ({ ...item, page: item.moduleKey === 'admission-prospectus' ? '/admission-prospectus.html' : item.route.startsWith('/admissions') ? '/admissions.html' : item.page })),
  ...group('REPORTS & ANALYTICS', '/reports.html', [
    ['reports', 'Reports & Analytics', '/reports'], ['admission-analytics', 'Admission Analytics', '/reports/admissions'],
    ['academic-reports', 'Academic Reports', '/reports/academic'], ['attendance-reports-management', 'Attendance Reports', '/reports/attendance'],
    ['financial-reports', 'Financial Reports', '/reports/financial'], ['enrollment-reports', 'Enrollment Reports', '/reports/enrollment'],
    ['staff-reports', 'Staff Reports', '/reports/staff'], ['operational-reports', 'Operational Reports', '/reports/operations'],
    ['management-dashboard', 'Management Dashboard', '/reports/management']
  ]).map((item) => ({ ...item, page: item.moduleKey === 'admission-analytics' ? '/admission-analytics.html' : item.moduleKey === 'academic-reports' ? '/reports-academic.html' : item.moduleKey === 'financial-reports' ? '/reports-financial.html' : item.page })),
  ...group('COMMUNICATION HUB', '/communication.html', [
    ['announcements', 'Announcements', '/communication'], ['messages', 'Messages', '/communication/messages'],
    ['calendar', 'School Calendar', '/communication/calendar'], ['sms', 'SMS', '/communication/sms'], ['email', 'Email', '/communication/email'],
    ['notifications', 'Notifications', '/communication/notifications'], ['communication-history', 'Communication History', '/communication/history']
  ]),
  ...group('LIBRARY MANAGEMENT', '/library.html', [['library', 'Library', '/library'], ['library-circulation', 'Borrowing & Returns', '/library/circulation']]),
  ...group('TRANSPORT MANAGEMENT', '/transport.html', [['transport', 'Transport', '/transport'], ['transport.gps', 'GPS Tracking', '/transport/gps'], ['transport-routes', 'Routes & Students', '/transport/routes']]),
  ...group('HOSTEL MANAGEMENT', '/hostel.html', [['hostel-residences', 'Dormitories & Beds', '/hostel'], ['hostel-roll-call', 'Boarding Roll Call', '/hostel/roll-call']]),
  ...group('HEALTH & WELFARE', '/welfare.html', [['health-records', 'Health Records', '/welfare/health'], ['discipline', 'Discipline', '/welfare/discipline'], ['counselling', 'Guidance & Counselling', '/welfare/counselling'], ['shep-activities', 'SHEP Activities', '/welfare/shep']]),
  ...group('INVENTORY & STORES', '/inventory.html', [['inventory', 'Inventory & Stores', '/inventory'], ['inventory-movements', 'Stock Movements', '/inventory/movements']]),
  ...group('ASSETS & PROPERTY', '/assets.html', [['assets', 'Assets', '/assets'], ['property', 'School Property', '/property']]),
  ...group('PROCUREMENT', '/procurement.html', [['procurement', 'Procurement', '/procurement']])
]);

export const PROPRIETOR_PAGE_ALIASES = Object.freeze(Object.fromEntries(PROPRIETOR_SIDEBAR_ROUTES.map(({ route, page }) => [route, page])));
