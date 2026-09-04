import { registerModule } from './sidebar-registry.js';
import { registerFutureModule } from './sidebar-classification.js';

registerModule({ moduleKey: 'student-profiles', moduleName: 'Student Profiles', category: 'STUDENTS MANAGEMENT', route: '/students', icon: '◎', displayOrder: 1, requiredPermission: 'students.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER'] });
registerModule({ moduleKey: 'student-search', moduleName: 'Student Search', category: 'STUDENTS MANAGEMENT', route: '/students/search', icon: '⌕', displayOrder: 2, requiredPermission: 'students.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'ADMISSIONS_OFFICER'] });
registerModule({ moduleKey: 'admissions', moduleName: 'Admissions', category: 'ADMISSIONS', route: '/admissions', icon: '✦', displayOrder: 1, requiredPermission: 'admissions.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'ADMISSIONS_OFFICER'] });
registerModule({ moduleKey: 'admission-prospectus', moduleName: 'Admission Prospectus Management', category: 'ADMISSIONS', route: '/admissions/prospectus', icon: '▤', displayOrder: 6, requiredPermission: 'admission.prospectus.manage', roles: ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ADMISSIONS_OFFICER'] });
registerModule({ moduleKey: 'admission-analytics', moduleName: 'Admission Analytics', category: 'REPORTS & ANALYTICS', route: '/admissions/analytics', icon: '▥', displayOrder: 2, requiredPermission: 'admissions.analytics.read', roles: ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'] });
registerModule({ moduleKey: 'attendance-dashboard', moduleName: 'Attendance Dashboard', category: 'ATTENDANCE MANAGEMENT', route: '/attendance', icon: '✓', displayOrder: 1, requiredPermission: 'attendance.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER'] });
registerModule({ moduleKey: 'student-attendance', moduleName: 'Student Attendance', category: 'ATTENDANCE MANAGEMENT', route: '/attendance/students', icon: '◷', displayOrder: 2, requiredPermission: 'attendance.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER'] });
registerModule({ moduleKey: 'staff-attendance', moduleName: 'Staff Attendance', category: 'ATTENDANCE MANAGEMENT', route: '/attendance/staff', icon: '◉', displayOrder: 3, requiredPermission: 'staff.attendance.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER'] });
registerModule({ moduleKey: 'attendance-reports', moduleName: 'Attendance Reports', category: 'ATTENDANCE MANAGEMENT', route: '/attendance/reports', icon: '▤', displayOrder: 4, requiredPermission: 'attendance.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER'] });
registerModule({ moduleKey: 'examinations', moduleName: 'Examinations', category: 'EXAMINATIONS & RESULTS', route: '/examinations', icon: '✎', displayOrder: 1, requiredPermission: 'examinations.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'EXAMINATION_OFFICER', 'TEACHER'] });
registerModule({ moduleKey: 'marks-entry', moduleName: 'Marks Entry', category: 'EXAMINATIONS & RESULTS', route: '/examinations/marks', icon: '▦', displayOrder: 2, requiredPermission: 'marks.write', roles: ['PROPRIETOR', 'EXAMINATION_OFFICER', 'TEACHER'] });
registerModule({ moduleKey: 'results', moduleName: 'Results & Reports', category: 'EXAMINATIONS & RESULTS', route: '/results', icon: '▤', displayOrder: 3, requiredPermission: 'results.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'EXAMINATION_OFFICER', 'TEACHER'] });
registerModule({ moduleKey: 'promotion', moduleName: 'Promotion', category: 'EXAMINATIONS & RESULTS', route: '/promotion', icon: '↑', displayOrder: 4, requiredPermission: 'promotion.write', roles: ['PROPRIETOR', 'HEADTEACHER', 'EXAMINATION_OFFICER'] });
registerModule({ moduleKey: 'mock-score-entry', moduleName: 'Mock Score Entry', category: 'EXAMINATIONS & RESULTS', route: '/examinations/mock', icon: '▦', displayOrder: 5, requiredPermission: 'mock.scores.write', roles: ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'EXAMINATION_OFFICER', 'TEACHER'] });
registerModule({ moduleKey: 'mock-results', moduleName: 'Mock Results', category: 'EXAMINATIONS & RESULTS', route: '/results/mock', icon: '▤', displayOrder: 6, requiredPermission: 'mock.results.read', roles: ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'EXAMINATION_OFFICER', 'TEACHER'] });
registerModule({ moduleKey: 'subject-management', moduleName: 'Subject Management', category: 'ACADEMICS', route: '/academics/subjects', icon: '✎', displayOrder: 5, requiredPermission: 'subjects.read', roles: ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'] });
registerModule({ moduleKey: 'sporting-activities', moduleName: 'Sporting Activities', description: 'Record inter-house and inter-school sporting activities, fixtures, and participation.', category: 'ACADEMICS', route: '/sporting-activities', icon: '⚽', displayOrder: 1, requiredPermissions: ['sporting_activities.view'], roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'] });
registerModule({ moduleKey: 'signature-management', moduleName: 'Result Signatures', category: 'ADMINISTRATIVE', route: '/settings/result-signatures', icon: '✍', displayOrder: 9, requiredPermission: 'signatures.manage', roles: ['PROPRIETOR', 'HEADTEACHER'] });
registerModule({ moduleKey: 'fee-structure', moduleName: 'Fee Structure', category: 'FEE HUB', route: '/fees', icon: '$', displayOrder: 3, requiredPermission: 'fees.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'ACCOUNTANT_BURSAR', 'HEADTEACHER'] });
registerModule({ moduleKey: 'admission-fee-management', moduleName: 'Admission Fee Structures', category: 'FEE HUB', route: '/fees/admission-structures', icon: '$', displayOrder: 4, requiredPermission: 'fees.read', roles: ['PROPRIETOR', 'ACCOUNTANT_BURSAR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'] });
registerModule({ moduleKey: 'invoices', moduleName: 'Invoices & Receipts', category: 'FEE HUB', route: '/fees/invoices', icon: '▤', displayOrder: 2, requiredPermission: 'fees.read', roles: ['PROPRIETOR', 'ACCOUNTANT_BURSAR'] });
registerModule({ moduleKey: 'finance-reports', moduleName: 'Finance Reports', category: 'FINANCE', route: '/finance', icon: '₵', displayOrder: 2, requiredPermission: 'finance.read', roles: ['PROPRIETOR', 'ACCOUNTANT_BURSAR', 'HEADTEACHER'] });
registerModule({ moduleKey: 'staff-directory', moduleName: 'Staff Directory', category: 'STAFF MANAGEMENT', route: '/staff', icon: '◉', displayOrder: 1, requiredPermission: 'staff.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'HR_OFFICER'] });
registerModule({ moduleKey: 'teachers', moduleName: 'Teachers', category: 'STAFF MANAGEMENT', route: '/staff/teachers', icon: '✎', displayOrder: 2, requiredPermission: 'staff.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'HR_OFFICER'] });
registerModule({ moduleKey: 'hr', moduleName: 'HR', category: 'STAFF MANAGEMENT', route: '/staff/hr', icon: '▣', displayOrder: 3, requiredPermission: 'hr.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HR_OFFICER'] });
registerModule({ moduleKey: 'leave', moduleName: 'Leave', category: 'STAFF MANAGEMENT', route: '/staff/leave', icon: '◷', displayOrder: 4, requiredPermission: 'leave.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HR_OFFICER', 'TEACHER'] });
registerModule({ moduleKey: 'staff-attendance-hr', moduleName: 'Staff Attendance', category: 'STAFF MANAGEMENT', route: '/attendance/staff', icon: '✓', displayOrder: 5, requiredPermission: 'staff.attendance.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'HR_OFFICER'] });
registerModule({ moduleKey: 'qualifications', moduleName: 'Qualifications / Licences', category: 'STAFF MANAGEMENT', route: '/staff/qualifications', icon: '▤', displayOrder: 6, requiredPermission: 'staff.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HR_OFFICER'] });
registerModule({ moduleKey: 'performance', moduleName: 'Performance', category: 'STAFF MANAGEMENT', route: '/staff/performance', icon: '★', displayOrder: 7, requiredPermission: 'hr.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'HR_OFFICER'] });
registerModule({ moduleKey: 'announcements', moduleName: 'Announcements', category: 'COMMUNICATION HUB', route: '/communication', icon: '!', displayOrder: 1, requiredPermission: 'communication.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'PARENT'] });
registerModule({ moduleKey: 'messages', moduleName: 'Messages', category: 'COMMUNICATION HUB', route: '/communication/messages', icon: '✉', displayOrder: 2, requiredPermission: 'messages.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'PARENT'] });
registerModule({ moduleKey: 'calendar', moduleName: 'School Calendar', category: 'COMMUNICATION HUB', route: '/communication/calendar', icon: '□', displayOrder: 3, requiredPermission: 'calendar.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'PARENT'] });
registerModule({ moduleKey: 'library-circulation', moduleName: 'Borrowing & Returns', category: 'LIBRARY MANAGEMENT', route: '/library/circulation', icon: '↔', displayOrder: 2, requiredPermission: 'library.write', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'LIBRARIAN'] });
registerModule({ moduleKey: 'transport-routes', moduleName: 'Routes & Students', category: 'TRANSPORT MANAGEMENT', route: '/transport/routes', icon: '⌖', displayOrder: 2, requiredPermission: 'transport.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'DRIVER', 'PARENT'] });
registerModule({ moduleKey: 'hostel-residences', moduleName: 'Dormitories & Beds', category: 'HOSTEL MANAGEMENT', route: '/hostel', icon: '⌂', displayOrder: 1, requiredPermission: 'hostel.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HOSTEL_MANAGER_MATRON', 'PARENT'] });
registerModule({ moduleKey: 'hostel-roll-call', moduleName: 'Boarding Roll Call', category: 'HOSTEL MANAGEMENT', route: '/hostel/roll-call', icon: '✓', displayOrder: 2, requiredPermission: 'hostel.attendance.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HOSTEL_MANAGER_MATRON'] });
registerModule({ moduleKey: 'health-records', moduleName: 'Health Records', category: 'HEALTH & WELFARE', route: '/welfare/health', icon: '+', displayOrder: 1, requiredPermission: 'health.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEALTH_OFFICER'] });
registerModule({ moduleKey: 'discipline', moduleName: 'Discipline', category: 'HEALTH & WELFARE', route: '/welfare/discipline', icon: '!', displayOrder: 2, requiredPermission: 'discipline.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'PARENT'] });
registerModule({ moduleKey: 'counselling', moduleName: 'Guidance & Counselling', category: 'HEALTH & WELFARE', route: '/welfare/counselling', icon: '♡', displayOrder: 3, requiredPermission: 'counselling.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'COUNSELLOR', 'HEADTEACHER'] });
registerModule({ moduleKey: 'inventory', moduleName: 'Inventory & Stores', category: 'INVENTORY & STORES', route: '/inventory', icon: '▤', displayOrder: 1, requiredPermission: 'inventory.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'STOREKEEPER', 'TEACHER'] });
registerModule({ moduleKey: 'inventory-movements', moduleName: 'Stock Movements', category: 'INVENTORY & STORES', route: '/inventory/movements', icon: '↕', displayOrder: 2, requiredPermission: 'inventory.write', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'STOREKEEPER'] });
registerModule({ moduleKey: 'assets', moduleName: 'Assets', category: 'ASSETS & PROPERTY', route: '/assets', icon: '▣', displayOrder: 1, requiredPermission: 'assets.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'PROPERTY_MANAGER', 'HEADTEACHER'] });
registerModule({ moduleKey: 'property', moduleName: 'School Property', category: 'ASSETS & PROPERTY', route: '/property', icon: '⌂', displayOrder: 2, requiredPermission: 'property.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'PROPERTY_MANAGER', 'HEADTEACHER', 'TEACHER'] });
registerModule({ moduleKey: 'procurement', moduleName: 'Procurement', category: 'PROCUREMENT', route: '/procurement', icon: '₵', displayOrder: 1, requiredPermission: 'procurement.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'PROCUREMENT_OFFICER'] });
registerModule({ moduleKey: 'property-requests', moduleName: 'Property Requests', category: 'ASSETS & PROPERTY', route: '/property/requests', icon: '✦', displayOrder: 3, requiredPermission: 'property.request', roles: ['TEACHER'] });
registerModule({ moduleKey: 'compliance', moduleName: 'Compliance & Regulatory', category: 'COMPLIANCE & DOCUMENTS', route: '/compliance', icon: '✓', displayOrder: 1, requiredPermission: 'compliance.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'COMPLIANCE_OFFICER'] });
registerModule({ moduleKey: 'documents', moduleName: 'Document Management', category: 'COMPLIANCE & DOCUMENTS', route: '/documents', icon: '▤', displayOrder: 2, requiredPermission: 'documents.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'COMPLIANCE_OFFICER', 'DATA_PROTECTION_OFFICER'] });
registerModule({ moduleKey: 'privacy', moduleName: 'Privacy & Data Protection', category: 'SYSTEM & SECURITY', route: '/privacy', icon: '⌾', displayOrder: 3, requiredPermission: 'privacy.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'DATA_PROTECTION_OFFICER'] });
registerModule({ moduleKey: 'reports', moduleName: 'Reports & Analytics', category: 'REPORTS & ANALYTICS', route: '/reports', icon: '▥', displayOrder: 1, requiredPermission: 'reports.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'] });
registerModule({ moduleKey: 'academic-reports', moduleName: 'Academic Performance Reports', category: 'REPORTS & ANALYTICS', route: '/reports/academic', icon: '▥', displayOrder: 2, requiredPermission: 'academics.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'] });
registerModule({ moduleKey: 'financial-reports', moduleName: 'Financial Reports', category: 'REPORTS & ANALYTICS', route: '/reports/financial', icon: '₵', displayOrder: 3, requiredPermission: 'finance.read', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'] });
registerModule({ moduleKey: 'official-documents', moduleName: 'Official Documents', category: 'ADMINISTRATIVE', route: '/official-documents', icon: '▤', displayOrder: 6, requiredPermission: 'documents.generate', roles: ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'] });
registerModule({ moduleKey: 'public-website', moduleName: 'Public School Website', category: 'ADMINISTRATIVE', route: '/website', icon: '◇', displayOrder: 7, requiredPermission: 'website.manage', roles: ['PROPRIETOR', 'SCHOOL_ADMIN'] });
registerModule({ moduleKey: 'administrator-management', moduleName: 'Administrator Management', category: 'ADMINISTRATIVE', route: '/administrator-management', icon: '◉', displayOrder: 8, requiredPermission: 'administrator.manage', roles: ['PROPRIETOR'] });
registerModule({ moduleKey: 'staff-management', moduleName: 'Staff Management', category: 'STAFF MANAGEMENT', route: '/staff-management', icon: '◉', displayOrder: 8, requiredPermission: 'staff.manage', roles: ['SCHOOL_ADMIN'] });
registerFutureModule({ module_key: 'fee.scholarships', module_name: 'Scholarships', feature_domain: 'fee_hub', route: '/fees/scholarships', icon: '★', parent_module_key: 'fee-structure', permissions: ['fee.scholarships.view'], roles: ['ACCOUNTANT_BURSAR', 'SCHOOL_ADMIN', 'PROPRIETOR', 'HEADTEACHER'], mobile_enabled: true });
registerFutureModule({ module_key: 'transport.gps', module_name: 'GPS Tracking', feature_domain: 'transport_management', route: '/transport/gps', icon: '⌖', parent_module_key: 'transport', permissions: ['transport.gps.view'], roles: ['TRANSPORT_MANAGER', 'DRIVER', 'SCHOOL_ADMIN', 'PROPRIETOR', 'HEADTEACHER'], mobile_enabled: true });
registerFutureModule({ module_key: 'staff.professional-development', module_name: 'Professional Development', feature_domain: 'staff_management', route: '/staff/professional-development', icon: '★', parent_module_key: null, permissions: ['staff.professional-development.view'], roles: ['TEACHER', 'HR_OFFICER', 'SCHOOL_ADMIN', 'HEADTEACHER', 'PROPRIETOR'], mobile_enabled: true });

[['parent-attendance', 'Attendance', '#attendance'], ['parent-results', 'Results', '#results'], ['parent-fees', 'Fees', '#fees'], ['parent-payments', 'Payments', '#payments'], ['parent-timetable', 'Timetable', '#timetable'], ['parent-homework', 'Homework', '#homework'], ['parent-assignments', 'Assignments', '#assignments'], ['parent-announcements', 'Announcements', '#announcements'], ['parent-calendar', 'Calendar', '#calendar'], ['parent-messages', 'Messages', '#messages'], ['parent-transport', 'Transport', '#transport'], ['parent-documents', 'Documents', '#documents']].forEach(([moduleKey, moduleName, route], index) => registerModule({ moduleKey, moduleName, category: 'COMMUNICATION HUB', route: `/${route}`, icon: '•', displayOrder: index + 1, requiredPermission: 'children.read', roles: ['PARENT'], parentDashboard: true, visible: true }));
registerModule({ moduleKey: 'parent-admission-prospectus', moduleName: 'Admission Prospectus', category: 'COMMUNICATION HUB', route: '/parent/admission-prospectus', icon: '▤', displayOrder: 13, requiredPermission: 'children.read', roles: ['PARENT'], visible: true });

// Keep the expanded school navigation declarative so future modules only need one registry entry.
function registerNavigationGroup(category, requiredPermission, roles, entries) {
  entries.forEach(([moduleKey, moduleName, route, icon], index) => registerModule({
    moduleKey,
    moduleName,
    category,
    route,
    icon,
    displayOrder: index + 10,
    requiredPermission,
    roles
  }));
}

registerNavigationGroup('ADMINISTRATIVE', 'settings.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER'], [
  ['school-profile', 'School Profile', '/settings', '▣'],
  ['academic-calendar', 'Academic Calendar', '/communication/calendar', '□']
]);
registerNavigationGroup('STUDENTS MANAGEMENT', 'students.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'ADMISSIONS_OFFICER'], [
  ['student-directory', 'Student Directory', '/students', '◎'],
  ['student-ids', 'Student IDs', '/students', '#'],
  ['student-transfers', 'Transfers', '/students', '↔'],
  ['student-alumni', 'Alumni', '/students', '◉']
]);
registerNavigationGroup('ADMISSIONS', 'admissions.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'ADMISSIONS_OFFICER'], [
  ['admission-enquiries', 'Enquiries', '/admissions', '?'],
  ['admission-applications', 'Applications', '/admissions', '✦'],
  ['admission-review', 'Application Review', '/admissions', '✓'],
  ['admission-offers', 'Admission Offers', '/admissions', '✉'],
  ['admission-enrollment', 'Enrollment', '/admissions', '◎']
]);
registerNavigationGroup('ACADEMICS', 'academics.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACADEMIC_COORDINATOR', 'TEACHER'], [
  ['academic-years', 'Academic Years', '/academics', '□'],
  ['academic-terms', 'Terms', '/academics', '◷'],
  ['academic-classes', 'Classes', '/academics', '▦'],
  ['academic-subjects', 'Subjects', '/academics', '✎'],
  ['teacher-assignments', 'Teacher Assignments', '/academics', '◉'],
  ['curriculum', 'Curriculum', '/academics', '▤'],
  ['lesson-plans', 'Lesson Plans', '/academics', '✎'],
  ['academic-assignments', 'Assignments', '/academics', '✦'],
  ['timetable', 'Timetable', '/academics', '□']
]);
registerNavigationGroup('ATTENDANCE MANAGEMENT', 'attendance.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER'], [
  ['attendance-alerts', 'Attendance Alerts', '/attendance', '!']
]);
registerNavigationGroup('EXAMINATIONS & RESULTS', 'examinations.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'EXAMINATION_OFFICER', 'TEACHER'], [
  ['exam-timetable', 'Exam Timetable', '/examinations', '□'],
  ['broadsheets', 'Broadsheets', '/results', '▥'],
  ['report-cards', 'Report Cards', '/results', '▤'],
  ['promotion-results', 'Promotion Results', '/promotion', '↑']
]);
registerNavigationGroup('FEE HUB', 'fees.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'], [
  ['student-fees', 'Student Fees', '/fees', '$'],
  ['payments', 'Payments', '/fees', '₵'],
  ['receipts', 'Receipts', '/fees/invoices', '▤'],
  ['arrears', 'Arrears', '/fees', '!'],
  ['discounts', 'Discounts', '/fees', '%'],
  ['fee-statements', 'Fee Statements', '/fees', '▥']
]);
registerNavigationGroup('FINANCE', 'finance.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'], [
  ['income', 'Income', '/finance', '₵'],
  ['expenses', 'Expenses', '/finance', '−'],
  ['cashbook', 'Cashbook', '/finance', '▤'],
  ['budgets', 'Budgets', '/finance', '▦']
]);
registerNavigationGroup('STAFF MANAGEMENT', 'staff.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'HR_OFFICER'], [
  ['qualifications-licences', 'Qualifications', '/staff/qualifications', '▤'],
  ['ntc-records', 'NTC Records', '/staff/qualifications', '✓'],
  ['appraisals', 'Appraisal', '/staff/performance', '★'],
  ['hr-documents', 'HR Documents', '/staff/hr', '▤']
]);
registerNavigationGroup('COMMUNICATION HUB', 'communication.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'PARENT'], [
  ['sms', 'SMS', '/communication', '✉'],
  ['email', 'Email', '/communication', '✉'],
  ['notifications', 'Notifications', '/communication', '!'],
  ['communication-history', 'Communication History', '/communication', '▥']
]);
registerNavigationGroup('LIBRARY MANAGEMENT', 'library.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'LIBRARIAN'], [
  ['books', 'Books', '/library', '▤'],
  ['borrowing', 'Borrowing', '/library/circulation', '↔'],
  ['returns', 'Returns', '/library/circulation', '↔'],
  ['library-reports', 'Library Reports', '/library', '▥']
]);
registerNavigationGroup('TRANSPORT MANAGEMENT', 'transport.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'TRANSPORT_MANAGER', 'DRIVER'], [
  ['vehicles', 'Vehicles', '/transport', '▰'],
  ['drivers', 'Drivers', '/transport', '◉'],
  ['routes', 'Routes', '/transport/routes', '⌖'],
  ['transport-students', 'Students', '/transport/routes', '◎'],
  ['trips', 'Trips', '/transport', '↔'],
  ['transport-fees', 'Transport Fees', '/transport', '$']
]);
registerNavigationGroup('HOSTEL MANAGEMENT', 'hostel.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HOSTEL_MANAGER_MATRON'], [
  ['houses', 'Houses', '/hostel', '⌂'],
  ['dormitories', 'Dormitories', '/hostel', '⌂'],
  ['beds', 'Beds', '/hostel', '□'],
  ['boarders', 'Boarders', '/hostel', '◎'],
  ['roll-call', 'Roll Call', '/hostel/roll-call', '✓'],
  ['hostel-fees', 'Hostel Fees', '/hostel', '$']
]);
registerNavigationGroup('HEALTH & WELFARE', 'health.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEALTH_OFFICER'], [
  ['health', 'Health', '/welfare/health', '+'],
  ['sick-bay', 'Sick Bay', '/welfare/health', '+'],
  ['student-welfare', 'Student Welfare', '/welfare/health', '♡']
]);
registerNavigationGroup('INVENTORY & STORES', 'inventory.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'STOREKEEPER', 'TEACHER'], [
  ['stock', 'Stock', '/inventory', '▤'],
  ['stock-in', 'Stock In', '/inventory/movements', '↓'],
  ['stock-out', 'Stock Out', '/inventory/movements', '↑'],
  ['suppliers', 'Suppliers', '/inventory', '◉'],
  ['inventory-reports', 'Inventory Reports', '/inventory', '▥']
]);
registerNavigationGroup('ASSETS & PROPERTY', 'property.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'PROPERTY_MANAGER', 'HEADTEACHER', 'TEACHER'], [
  ['buildings', 'Buildings', '/property', '⌂'],
  ['furniture', 'Furniture', '/assets', '▣'],
  ['maintenance', 'Maintenance', '/property', '⚙'],
  ['property-reports', 'Property Reports', '/property', '▥']
]);
registerNavigationGroup('PROCUREMENT', 'procurement.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'PROCUREMENT_OFFICER'], [
  ['purchase-requests', 'Purchase Requests', '/procurement', '✦'],
  ['quotations', 'Quotations', '/procurement', '▤'],
  ['purchase-orders', 'Purchase Orders', '/procurement', '▥'],
  ['goods-received', 'Goods Received', '/procurement', '✓'],
  ['procurement-suppliers', 'Suppliers', '/procurement', '◉']
]);
registerNavigationGroup('COMPLIANCE & DOCUMENTS', 'compliance.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'COMPLIANCE_OFFICER'], [
  ['nasia', 'NaSIA', '/compliance', '✓'],
  ['ntc', 'NTC', '/compliance', '✓'],
  ['fire-safety', 'Fire Safety', '/compliance', '✓'],
  ['emis-census', 'EMIS / School Census', '/compliance', '▥'],
  ['inspections', 'Inspections', '/compliance', '⌕'],
  ['compliance-calendar', 'Compliance Calendar', '/compliance', '□'],
  ['document-repository', 'Document Repository', '/documents', '▤']
]);
registerNavigationGroup('REPORTS & ANALYTICS', 'reports.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'], [
  ['academic-reports', 'Academic Reports', '/reports', '▥'],
  ['attendance-reports-management', 'Attendance Reports', '/reports', '▥'],
  ['financial-reports', 'Financial Reports', '/reports', '₵'],
  ['enrollment-reports', 'Enrollment Reports', '/reports', '◎'],
  ['staff-reports', 'Staff Reports', '/reports', '◉'],
  ['operational-reports', 'Operational Reports', '/reports', '▤'],
  ['management-dashboard', 'Management Dashboard', '/reports', '⌂']
]);
registerNavigationGroup('SYSTEM & SECURITY', 'users.read', ['PROPRIETOR', 'SCHOOL_ADMIN'], [
  ['roles', 'Roles', '/users', '◉'],
  ['permissions', 'Permissions', '/users', '✓'],
  ['audit-logs', 'Audit Logs', '/settings', '▥'],
  ['sessions', 'Sessions', '/settings', '◷'],
  ['backups', 'Backups', '/settings', '↓']
]);
