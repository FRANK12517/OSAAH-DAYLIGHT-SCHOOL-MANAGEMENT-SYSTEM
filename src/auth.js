import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`; }
function passwordMatches(password, stored) { const [salt, expected] = stored.split(':'); const actual = scryptSync(password, salt, 32); return timingSafeEqual(actual, Buffer.from(expected, 'hex')); }

export const DEMO_USERS = [
  { id: 'user-parent-1', username: 'parent@example.com', passwordHash: passwordHash('Parent123!', 'parent-salt'), portal: 'parent', roleKey: 'PARENT', schoolId: 'school-osaah-daylight', permissions: new Set(['children.read', 'communication.read', 'messages.read', 'messages.write', 'calendar.read', 'library.read', 'transport.read', 'hostel.read', 'discipline.read']), children: [{ id: 'student-1', name: 'Ama Mensah', className: 'Primary 4' }, { id: 'student-2', name: 'Kojo Mensah', className: 'Primary 2' }], authorizedStaffIds: ['user-teacher-1'] },
  { id: 'user-proprietor-1', username: 'proprietor@osaah.edu.gh', passwordHash: passwordHash('Proprietor123!', 'proprietor-salt'), portal: 'school', roleKey: 'PROPRIETOR', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) },
  { id: 'user-teacher-1', username: 'teacher@osaah.edu.gh', passwordHash: passwordHash('Teacher123!', 'teacher-salt'), portal: 'school', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read', 'academics.read', 'attendance.read', 'attendance.write', 'examinations.read', 'marks.write', 'results.read', 'leave.read', 'leave.write', 'staff.professional-development.view', 'communication.read', 'messages.read', 'messages.write', 'discipline.read', 'discipline.write', 'property.request']), assignedStudentIds: ['student-1'], assignedParentIds: ['user-parent-1'] },
  { id: 'user-hr-1', username: 'hr@osaah.edu.gh', passwordHash: passwordHash('HumanResources123!', 'hr-salt'), portal: 'school', roleKey: 'HR_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['staff.read', 'staff.write', 'hr.read', 'hr.write', 'hr.confidential.read', 'leave.read', 'leave.write', 'staff.attendance.read', 'staff.attendance.write']) },
  { id: 'user-examination-1', username: 'exams@osaah.edu.gh', passwordHash: passwordHash('Examination123!', 'examination-salt'), portal: 'school', roleKey: 'EXAMINATION_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['examinations.read', 'examinations.write', 'marks.write', 'results.read', 'results.approve', 'promotion.write']) },
  { id: 'user-admissions-1', username: 'admissions@osaah.edu.gh', passwordHash: passwordHash('Admissions123!', 'admissions-salt'), portal: 'school', roleKey: 'ADMISSIONS_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read', 'admissions.read', 'admissions.write']) },
  { id: 'user-bursar-1', username: 'bursar@osaah.edu.gh', passwordHash: passwordHash('Bursar123!', 'bursar-salt'), portal: 'school', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-osaah-daylight', permissions: new Set(['fees.read', 'fees.write', 'fee.scholarships.view', 'finance.read', 'hr.confidential.read']) },
  { id: 'user-librarian-1', username: 'librarian@osaah.edu.gh', passwordHash: passwordHash('Librarian123!', 'librarian-salt'), portal: 'school', roleKey: 'LIBRARIAN', schoolId: 'school-osaah-daylight', permissions: new Set(['library.read', 'library.write']) },
  { id: 'user-transport-1', username: 'transport@osaah.edu.gh', passwordHash: passwordHash('Transport123!', 'transport-salt'), portal: 'school', roleKey: 'TRANSPORT_MANAGER', schoolId: 'school-osaah-daylight', permissions: new Set(['transport.read', 'transport.write', 'transport.gps.view']) },
  { id: 'user-matron-1', username: 'matron@osaah.edu.gh', passwordHash: passwordHash('Matron12345!', 'matron-salt'), portal: 'school', roleKey: 'HOSTEL_MANAGER_MATRON', schoolId: 'school-osaah-daylight', permissions: new Set(['hostel.read', 'hostel.write', 'hostel.attendance.read']) },
  { id: 'user-health-1', username: 'health@osaah.edu.gh', passwordHash: passwordHash('HealthOfficer123!', 'health-salt'), portal: 'school', roleKey: 'HEALTH_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['health.read', 'health.write']) },
  { id: 'user-counsellor-1', username: 'counsellor@osaah.edu.gh', passwordHash: passwordHash('Counsellor123!', 'counsellor-salt'), portal: 'school', roleKey: 'COUNSELLOR', schoolId: 'school-osaah-daylight', permissions: new Set(['counselling.read', 'counselling.write']) },
  { id: 'user-storekeeper-1', username: 'storekeeper@osaah.edu.gh', passwordHash: passwordHash('Storekeeper123!', 'storekeeper-salt'), portal: 'school', roleKey: 'STOREKEEPER', schoolId: 'school-osaah-daylight', permissions: new Set(['inventory.read', 'inventory.write']) },
  { id: 'user-procurement-1', username: 'procurement@osaah.edu.gh', passwordHash: passwordHash('Procurement123!', 'procurement-salt'), portal: 'school', roleKey: 'PROCUREMENT_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['procurement.read', 'procurement.write']) },
  { id: 'user-property-1', username: 'property@osaah.edu.gh', passwordHash: passwordHash('PropertyManager123!', 'property-salt'), portal: 'school', roleKey: 'PROPERTY_MANAGER', schoolId: 'school-osaah-daylight', permissions: new Set(['assets.read', 'assets.write', 'property.read', 'property.write']) },
  { id: 'user-compliance-1', username: 'compliance@osaah.edu.gh', passwordHash: passwordHash('Compliance123!', 'compliance-salt'), portal: 'school', roleKey: 'COMPLIANCE_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['compliance.read', 'compliance.write', 'documents.read', 'documents.write']) },
  { id: 'user-dpo-1', username: 'dpo@osaah.edu.gh', passwordHash: passwordHash('DataProtection123!', 'dpo-salt'), portal: 'school', roleKey: 'DATA_PROTECTION_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['privacy.read', 'privacy.write', 'documents.read']) }
];

export function createAuthService({ users = DEMO_USERS, now = () => Date.now() } = {}) {
  users = users.map((user) => ({ ...user, permissions: new Set(user.permissions), children: user.children?.map((child) => ({ ...child })) }));
  const sessions = new Map(); const attempts = new Map(); const resetTokens = new Map();
  function sanitize(user) { return { id: user.id, username: user.username, portal: user.portal, roleKey: user.roleKey, schoolId: user.schoolId, schoolType: user.schoolType, subscription: user.subscription, entitlements: user.entitlements ?? [], featureAvailability: user.featureAvailability ?? [], children: user.children ?? [], authorizedStaffIds: user.authorizedStaffIds ?? [], assignedStudentIds: user.assignedStudentIds ?? [], assignedParentIds: user.assignedParentIds ?? [], assignedClassIds: user.assignedClassIds ?? [], assignedSubjectIds: user.assignedSubjectIds ?? [], assignedDepartmentIds: user.assignedDepartmentIds ?? [] }; }
  function login({ username, password, portal }) {
    const key = username.trim().toLowerCase(); const throttle = attempts.get(key); if (throttle?.lockedUntil > now()) return { ok: false, status: 429, error: 'Too many failed attempts. Try again later.' };
    const user = users.find((candidate) => candidate.username.toLowerCase() === key && candidate.portal === portal);
    if (!user || !passwordMatches(password, user.passwordHash)) { const next = throttle ?? { count: 0 }; next.count += 1; if (next.count >= MAX_ATTEMPTS) next.lockedUntil = now() + LOCKOUT_MS; attempts.set(key, next); return { ok: false, status: 401, error: 'Invalid portal credentials.' }; }
    attempts.delete(key); const token = randomBytes(32).toString('hex'); sessions.set(token, { userId: user.id, expiresAt: now() + SESSION_TTL_MS }); return { ok: true, token, user: sanitize(user), expiresAt: now() + SESSION_TTL_MS };
  }
  function authenticate(token) { const session = sessions.get(token); if (!session || session.expiresAt <= now()) { if (token) sessions.delete(token); return null; } const user = users.find((candidate) => candidate.id === session.userId); return user ? { ...sanitize(user), permissions: user.permissions } : null; }
  function logout(token) { sessions.delete(token); }
  function requestPasswordReset(username) { const user = users.find((candidate) => candidate.username.toLowerCase() === username.trim().toLowerCase()); if (!user) return { ok: true }; const token = randomUUID(); resetTokens.set(token, { userId: user.id, expiresAt: now() + RESET_TTL_MS }); return { ok: true, token }; }
  function completePasswordReset(token, newPassword) { const reset = resetTokens.get(token); if (!reset || reset.expiresAt <= now() || typeof newPassword !== 'string' || newPassword.length < 10) return { ok: false, error: 'Invalid or expired reset request.' }; const user = users.find((candidate) => candidate.id === reset.userId); if (!user) return { ok: false, error: 'Invalid or expired reset request.' }; user.passwordHash = passwordHash(newPassword); resetTokens.delete(token); for (const [sessionToken, session] of sessions) if (session.userId === user.id) sessions.delete(sessionToken); return { ok: true }; }
  return { login, authenticate, logout, requestPasswordReset, completePasswordReset, sessionTtlMs: SESSION_TTL_MS };
}

export function canAccess(user, permission) { return Boolean(user && (user.permissions.has('*') || user.permissions.has(permission))); }
