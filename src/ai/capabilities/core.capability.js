const objectSchema = Object.freeze({ type: 'object', additionalProperties: false });

function tool(name, capabilityId, description, requiredPermission, operationType = 'READ') {
  return Object.freeze({ name, capabilityId, description, operationType, requiredPermission, inputSchema: objectSchema, outputSchema: { type: 'object' }, productionDataOnly: true, schoolScoped: true, dataQualityAware: true, auditRequired: true, enabled: true });
}

function capability({ id, moduleId, moduleName, category, description, permission, roles, domain, tools, metrics, reports = [], widgets = [] }) {
  return Object.freeze({ id, moduleId, moduleName, category, version: '1.0.0', enabled: true, description, requiredPermissions: [permission], requiredRoles: roles, dataDomain: domain, tools: tools.map((item) => item.name), metrics, reports, actions: [], dashboardWidgets: widgets, productionDataOnly: true, dataQualityRequirements: ['PROVENANCE', 'FRESHNESS', 'COMPLETENESS'], auditRequired: true });
}

const definitions = [
  ['students', 'student-profiles', 'Student Profiles', 'STUDENTS MANAGEMENT', 'Authorized student profile and enrolment intelligence.', 'students.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER'], 'STUDENTS', [['students.summary', 'Read a scoped student summary.', 'READ']], ['studentCount', 'enrolmentByClass']],
  ['academics', 'academics', 'Academics', 'ACADEMICS', 'Authorized academic configuration and performance intelligence.', 'academics.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER'], 'ACADEMICS', [['academics.performance', 'Analyze scoped academic performance.', 'ANALYZE']], ['averageScore', 'scoreCompleteness'], ['ACADEMIC_PERFORMANCE']],
  ['attendance', 'attendance-dashboard', 'Attendance Dashboard', 'ATTENDANCE MANAGEMENT', 'Authorized attendance summaries and patterns.', 'attendance.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER'], 'ATTENDANCE', [['attendance.summary', 'Read a scoped attendance summary.', 'READ']], ['presentCount', 'absentCount', 'lateCount']],
  ['admissions', 'admissions', 'Admissions', 'ADMISSIONS', 'Authorized application, decision, and enrolment intelligence.', 'admissions.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'ADMISSIONS_OFFICER'], 'ADMISSIONS', [['admissions.summary', 'Analyze scoped admission activity.', 'ANALYZE']], ['applicationCount', 'acceptedCount', 'rejectedCount'], ['ADMISSION_SUMMARY']],
  ['finance', 'finance', 'Finance', 'FINANCE', 'Deterministic financial snapshot interpretation metadata.', 'finance.read', ['PROPRIETOR', 'ACCOUNTANT_BURSAR'], 'FINANCE', [['finance.summary', 'Read an authoritative financial summary.', 'READ']], ['totalIncome', 'totalExpenses', 'outstandingFees'], ['FINANCIAL']],
  ['staff', 'staff-directory', 'Staff Directory', 'STAFF MANAGEMENT', 'Authorized staff profile and attendance intelligence.', 'staff.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'HR_OFFICER'], 'STAFF', [['staff.summary', 'Read a scoped staff summary.', 'READ']], ['staffCount', 'attendanceCount']],
  ['transport', 'transport', 'Transport', 'TRANSPORT MANAGEMENT', 'Authorized transport route and assignment intelligence.', 'transport.read', ['PROPRIETOR', 'TRANSPORT_MANAGER', 'DRIVER'], 'TRANSPORT', [['transport.summary', 'Read a scoped transport summary.', 'READ']], ['vehicleCount', 'routeCount']],
  ['hostel', 'hostel-residences', 'Dormitories & Beds', 'HOSTEL MANAGEMENT', 'Authorized hostel capacity and allocation intelligence.', 'hostel.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HOSTEL_MANAGER_MATRON'], 'HOSTEL', [['hostel.summary', 'Read a scoped hostel summary.', 'READ']], ['capacity', 'occupiedBeds']],
  ['communication', 'announcements', 'Announcements', 'COMMUNICATION HUB', 'Authorized communication activity intelligence.', 'communication.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'TEACHER', 'PARENT'], 'COMMUNICATION', [['communication.summary', 'Read authorized communication activity.', 'READ']], ['announcementCount', 'notificationCount']],
  ['documents', 'documents', 'Document Management', 'COMPLIANCE & DOCUMENTS', 'Authorized document inventory metadata without unrestricted content access.', 'documents.read', ['PROPRIETOR', 'SCHOOL_ADMIN', 'COMPLIANCE_OFFICER', 'DATA_PROTECTION_OFFICER'], 'DOCUMENTS', [['documents.summary', 'Read authorized document metadata totals.', 'READ']], ['documentCount', 'expiringCount']]
];

export const capabilities = Object.freeze(definitions.map(([id, moduleId, moduleName, category, description, permission, roles, domain, toolDefs, metrics, reports, widgets]) => {
  const tools = toolDefs.map(([name, toolDescription, operationType]) => tool(name, id, toolDescription, permission, operationType));
  return Object.freeze({ capability: capability({ id, moduleId, moduleName, category, description, permission, roles, domain, tools, metrics, reports, widgets }), tools });
}));
