import bcrypt from 'bcrypt';
import { createHash, createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { normalizeGhanaPhone } from './ghana-phone.js';
import { createConfiguredTestParent, isConfiguredTestParentPhone, TEST_PARENT_ID, TEST_PARENT_SCHOOL_ID } from './test-parent-fixture.js';
import { createDurableStaffProvisioning } from './durable-staff-provisioning.js';

const SESSION_TTL_MS = 30 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const GENERIC_LOGIN_ERROR = 'Incorrect username or password.';
const PARENT_PERMISSIONS = Object.freeze(['children.read', 'communication.read', 'messages.read', 'messages.write', 'calendar.read', 'library.read', 'transport.read', 'hostel.read', 'discipline.read']);
export const SCHOOL_PORTAL_ROLE_ALIASES = Object.freeze({ ADMINISTRATOR: 'SCHOOL_ADMIN', SCHOOL_ADMINISTRATOR: 'SCHOOL_ADMIN', ACCOUNTANT: 'ACCOUNTANT_BURSAR', CLASSROOM_TEACHER: 'TEACHER', PROPRIETOR: 'PROPRIETOR', PROPRIETRESS: 'PROPRIETOR', SCHOOL_PROPRIETOR: 'PROPRIETOR', SCHOOL_PROPRIETRESS: 'PROPRIETOR' });
export const SCHOOL_PORTAL_DASHBOARDS = Object.freeze({ PROPRIETOR: '/reports', SCHOOL_ADMIN: '/settings', HEADTEACHER: '/academics', ASSISTANT_HEADTEACHER: '/academics', ACCOUNTANT_BURSAR: '/fees', TEACHER: '/academics', DEVELOPER: '/developer/communication-setup' });
const STAFF_ASSIGNABLE_ROLES = Object.freeze({ HEADTEACHER: 'HEADTEACHER', ASSISTANT_HEADTEACHER: 'ASSISTANT_HEADTEACHER', ACCOUNTANT: 'ACCOUNTANT_BURSAR', ACCOUNTANT_BURSAR: 'ACCOUNTANT_BURSAR', CLASSROOM_TEACHER: 'TEACHER', TEACHER: 'TEACHER' });
const ROLE_PERMISSIONS = Object.freeze({ HEADTEACHER: ['students.read', 'academics.read', 'attendance.read', 'examinations.read', 'results.read', 'results.generate', 'results.print', 'admissions.read', 'admissions.review', 'admissions.accept', 'admissions.reject', 'admissions.analytics.read', 'admission.prospectus.manage', 'subjects.read', 'subjects.manage', 'signatures.manage', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'fees.read', 'finance.read', 'staff.read', 'communication.read', 'calendar.read', 'calendar.write', 'reports.read', 'sporting_activities.view', 'sporting_activities.create', 'sporting_activities.update', 'sporting_activities.delete', 'sporting_activities.manage_fixtures', 'sporting_activities.record_results', 'sporting_activities.manage_participants', 'sporting_activities.generate_reports', 'subject_register.view', 'subject_register.manage', 'subject_register.assign_teacher', 'subject_register.activate', 'subject_register.deactivate', 'subject_register.copy_register', 'shep_activities.view', 'shep_activities.create', 'shep_activities.update', 'shep_activities.manage_participants', 'shep_activities.record_screening', 'shep_activities.create_referral', 'shep_activities.manage_followup', 'shep_activities.generate_reports', 'staff.attendance.read', 'staff.attendance.write'], ASSISTANT_HEADTEACHER: ['students.read', 'academics.read', 'attendance.read', 'examinations.read', 'results.read', 'results.generate', 'results.print', 'admissions.read', 'admissions.review', 'admissions.accept', 'admissions.reject', 'admissions.analytics.read', 'admission.prospectus.manage', 'subjects.read', 'subjects.manage', 'signatures.manage', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'fees.read', 'finance.read', 'staff.read', 'communication.read', 'calendar.read', 'calendar.write', 'sporting_activities.view', 'sporting_activities.create', 'sporting_activities.update', 'sporting_activities.delete', 'sporting_activities.manage_fixtures', 'sporting_activities.record_results', 'sporting_activities.manage_participants', 'sporting_activities.generate_reports', 'subject_register.view', 'subject_register.manage', 'subject_register.assign_teacher', 'subject_register.activate', 'subject_register.deactivate', 'subject_register.copy_register', 'staff.attendance.read', 'staff.attendance.write'], ACCOUNTANT_BURSAR: ['students.read', 'fees.read', 'fees.write', 'finance.read', 'fees.configure', 'fees.collect'], TEACHER: ['students.read', 'academics.read', 'attendance.read', 'attendance.write', 'examinations.read', 'marks.write', 'results.read', 'results.generate', 'results.print', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'leave.read', 'leave.write', 'staff.professional-development.view', 'communication.read', 'calendar.read', 'messages.read', 'messages.write', 'sporting_activities.view', 'sporting_activities.create', 'sporting_activities.update', 'sporting_activities.manage_fixtures', 'sporting_activities.record_results', 'sporting_activities.manage_participants', 'sporting_activities.generate_reports', 'subject_register.view', 'shep_activities.view', 'shep_activities.create', 'shep_activities.update', 'shep_activities.manage_participants', 'shep_activities.record_screening', 'shep_activities.create_referral', 'shep_activities.manage_followup', 'shep_activities.generate_reports'] });
for (const roleKey of ['HEADTEACHER', 'ASSISTANT_HEADTEACHER']) ROLE_PERMISSIONS[roleKey].push('ai.actions.prepare', 'ai.actions.approve', 'ai.actions.review');
export function canonicalRoleKey(roleKey) { const normalized = String(roleKey ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_'); return SCHOOL_PORTAL_ROLE_ALIASES[normalized] ?? normalized; }

function addStaffAttendanceRoleGrants(user) { if (['HEADTEACHER', 'ASSISTANT_HEADTEACHER'].includes(canonicalRoleKey(user?.roleKey))) { user.permissions.add('staff.attendance.read'); user.permissions.add('staff.attendance.write'); } return user; }

function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`; }
function passwordMatches(password, stored) { const [salt, expected] = stored.split(':'); const actual = scryptSync(password, salt, 32); return timingSafeEqual(actual, Buffer.from(expected, 'hex')); }

export const DEMO_USERS = [
  createConfiguredTestParent(),
  { id: 'user-parent-1', username: 'parent@example.com', phone: '+233241234567', passwordHash: passwordHash('Parent123!', 'parent-salt'), portal: 'parent', roleKey: 'PARENT', schoolId: 'school-osaah-daylight', permissions: new Set(['children.read', 'communication.read', 'messages.read', 'messages.write', 'calendar.read', 'library.read', 'transport.read', 'hostel.read', 'discipline.read']), children: [{ id: 'student-1', name: 'Ama Mensah', className: 'Primary 4' }, { id: 'student-2', name: 'Kojo Mensah', className: 'Primary 2' }], authorizedStaffIds: ['user-teacher-1'] },
  { id: 'user-proprietor-1', username: 'proprietor@osaah.edu.gh', passwordHash: passwordHash('Proprietor123!', 'proprietor-salt'), portal: 'school', roleKey: 'PROPRIETOR', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) },
  { id: 'user-teacher-1', username: 'teacher@osaah.edu.gh', passwordHash: passwordHash('Teacher123!', 'teacher-salt'), portal: 'school', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read', 'academics.read', 'attendance.read', 'attendance.write', 'examinations.read', 'marks.write', 'results.read', 'results.generate', 'results.print', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'leave.read', 'leave.write', 'staff.professional-development.view', 'communication.read', 'messages.read', 'messages.write', 'discipline.read', 'discipline.write', 'property.request', 'shep_activities.view', 'shep_activities.create', 'shep_activities.update', 'shep_activities.manage_participants', 'shep_activities.record_screening', 'shep_activities.create_referral', 'shep_activities.manage_followup', 'shep_activities.generate_reports']), assignedStudentIds: ['student-1'], assignedParentIds: ['user-parent-1'] },
  { id: 'user-hr-1', username: 'hr@osaah.edu.gh', passwordHash: passwordHash('HumanResources123!', 'hr-salt'), portal: 'school', roleKey: 'HR_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['staff.read', 'staff.write', 'hr.read', 'hr.write', 'hr.confidential.read', 'leave.read', 'leave.write', 'staff.attendance.read', 'staff.attendance.write']) },
  { id: 'user-examination-1', username: 'exams@osaah.edu.gh', passwordHash: passwordHash('Examination123!', 'examination-salt'), portal: 'school', roleKey: 'EXAMINATION_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['examinations.read', 'examinations.write', 'marks.write', 'results.read', 'results.generate', 'results.print', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'results.approve', 'promotion.write']) },
  { id: 'user-admissions-1', username: 'admissions@osaah.edu.gh', passwordHash: passwordHash('Admissions123!', 'admissions-salt'), portal: 'school', roleKey: 'ADMISSIONS_OFFICER', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read', 'admissions.read', 'admissions.write', 'admission.prospectus.manage']) },
  { id: 'user-bursar-1', username: 'bursar@osaah.edu.gh', passwordHash: passwordHash('Bursar123!', 'bursar-salt'), portal: 'school', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read', 'fees.read', 'fees.write', 'fees.configure', 'fees.collect', 'fee.scholarships.view', 'finance.read', 'hr.confidential.read']) },
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

export function createAuthService({ users = DEMO_USERS, database = null, now = () => Date.now(), audit = () => {}, sessionSecret = process.env.OSAAH_SESSION_SECRET, testParentSchoolId = TEST_PARENT_SCHOOL_ID } = {}) {
  users = users.map((user) => addStaffAttendanceRoleGrants({ ...user, permissions: new Set(user.permissions), children: user.children?.map((child) => ({ ...child })) }));
  const sessions = new Map(); const durableSessionIds = new Set(); const revokedSessionIds = new Set(); const attempts = new Map(); const resetTokens = new Map();
  const administratorAssignments = [];
  const durableStaff = database?.query && database?.execute && database?.transaction ? createDurableStaffProvisioning({ database, passwordHash, verifyLogin: (credentials) => loginFromDatabase(credentials), revokeSession: (token) => logoutSession(token), now }) : null;
  const signingKey = typeof sessionSecret === 'string' && sessionSecret.length >= 32 ? sessionSecret : null;
  const durableSessionStore = Boolean(database?.supportsDurableAuthSessions && database?.query && database?.execute);
  const tokenHash = (token) => createHash('sha256').update(String(token)).digest('hex');
  const nowIso = () => new Date(now()).toISOString();
  async function persistDurableSession(user, session, token) {
    if (!durableSessionStore) return;
    await database.execute('INSERT INTO auth_sessions (id, user_id, school_id, token_hash, created_at, expires_at, revoked_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)', [session.sessionId, user.id, user.schoolId, tokenHash(token), nowIso(), new Date(session.expiresAt).toISOString(), nowIso()]);
  }
  async function revokeDurableSessionsForUser(userId) {
    if (!durableSessionStore) return;
    await database.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND revoked_at IS NULL', [nowIso(), userId]);
  }
  function revokeDurableSessionsBestEffort(userId) {
    void revokeDurableSessionsForUser(userId).catch((error) => {
      console.error('Durable session revocation failed', { userId, code: error?.code ?? 'UNKNOWN' });
      securityEvent('SESSION_REVOCATION_FAILED', { id: userId });
    });
  }
  function signSession(session) { const payload = Buffer.from(JSON.stringify(session)).toString('base64url'); const signature = createHmac('sha256', signingKey).update(payload).digest('base64url'); return `v1.${payload}.${signature}`; }
  function verifiedSession(token) {
    if (!signingKey || typeof token !== 'string' || !token.startsWith('v1.')) return sessions.get(token);
    const parts = token.split('.'); if (parts.length !== 3) return null;
    const expected = createHmac('sha256', signingKey).update(parts[1]).digest(); let actual;
    try { actual = Buffer.from(parts[2], 'base64url'); } catch { return null; }
    // Reject alternate base64url encodings that decode to the same bytes. Without
    // this canonical-form check, changing unused trailing bits can leave the
    // decoded HMAC unchanged and make a tampered token appear valid.
    if (actual.toString('base64url') !== parts[2]) return null;
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    try { const session = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); return session && typeof session.userId === 'string' && typeof session.sessionId === 'string' && Number.isFinite(session.expiresAt) && !revokedSessionIds.has(session.sessionId) ? session : null; } catch { return null; }
  }
  function revokeLocalSession(token, session = verifiedSession(token)) { if (session?.sessionId) revokedSessionIds.add(session.sessionId); if (token) sessions.delete(token); if (session?.sessionId) durableSessionIds.delete(session.sessionId); }
  function isActive(user) { return user.is_active !== false && user.isActive !== false && !['DISABLED', 'REVOKED', 'REMOVED', 'SUSPENDED', 'DEACTIVATED'].includes(String(user.accountStatus ?? '').toUpperCase()); }
  function securityEvent(action, user, sessionId = null) { audit({ action, entity: 'Authentication', entityId: user?.id ?? null, userId: user?.id ?? null, roleId: canonicalRoleKey(user?.roleKey), sessionId }); }
  function sanitize(user, sessionId = null) { const roleKey = canonicalRoleKey(user.roleKey); return { id: user.id, username: user.username, portal: user.portal, roleKey, role: roleKey, accountStatus: isActive(user) ? 'ACTIVE' : String(user.accountStatus ?? 'DISABLED').toUpperCase(), schoolId: user.schoolId, sessionId, dashboard: SCHOOL_PORTAL_DASHBOARDS[roleKey] ?? '/', schoolType: user.schoolType, subscription: user.subscription, entitlements: user.entitlements ?? [], featureAvailability: user.featureAvailability ?? [], ...(roleKey === 'PARENT' ? {} : { children: user.children ?? [], authorizedStaffIds: user.authorizedStaffIds ?? [], assignedStudentIds: user.assignedStudentIds ?? [], assignedParentIds: user.assignedParentIds ?? [], assignedClassIds: user.assignedClassIds ?? [], assignedSubjectIds: user.assignedSubjectIds ?? [], assignedDepartmentIds: user.assignedDepartmentIds ?? [] }) }; }
  function selectAuthorizedRoleRows(rows, requestedRole = null) {
    const normalizedRequested = requestedRole ? canonicalRoleKey(requestedRole) : null;
    const grouped = new Map();
    for (const row of rows ?? []) {
      const roleKey = canonicalRoleKey(row.roleKey);
      if (!roleKey) continue;
      if (!grouped.has(roleKey)) grouped.set(roleKey, []);
      grouped.get(roleKey).push(row);
    }
    const available = [...grouped.keys()].sort((left, right) => {
      const rank = (key) => Math.max(...(grouped.get(key) ?? []).map((row) => Number(row.oversightRank ?? 0)));
      return rank(right) - rank(left) || left.localeCompare(right);
    });
    const selectedRole = normalizedRequested
      ? available.find((roleKey) => roleKey === normalizedRequested)
      : available[0];
    return { roleKey: selectedRole ?? null, rows: selectedRole ? grouped.get(selectedRole) : [], availableRoles: available };
  }
  function createSessionResult(user) {
    // In-memory sessions are not portable across serverless instances. In
    // production, fail closed unless a stable HMAC signing key is configured.
    if (process.env.NODE_ENV === 'production' && !signingKey) return { ok: false, status: 503, error: 'Authentication service unavailable.' };
    attempts.delete(user.id);
    const sessionId = randomUUID(); const expiresAt = now() + SESSION_TTL_MS;
    const session = { userId: user.id, roleKey: canonicalRoleKey(user.roleKey), sessionId, expiresAt, ...(user.id === TEST_PARENT_ID && user.isTestFixture === true ? { testParentFixture: true } : {}) };
    const token = signingKey ? signSession(session) : randomBytes(32).toString('hex');
    sessions.set(token, session); securityEvent('LOGIN_SUCCESS', user, sessionId);
    return { ok: true, token, user: sanitize(user, sessionId), redirectTo: SCHOOL_PORTAL_DASHBOARDS[canonicalRoleKey(user.roleKey)] ?? '/', expiresAt };
  }
  async function createDurableSessionResult(user) {
    if (process.env.NODE_ENV === 'production' && !durableSessionStore) return { ok: false, status: 503, error: 'Authentication service unavailable.' };
    attempts.delete(user.id);
    const sessionId = randomUUID(); const expiresAt = now() + SESSION_TTL_MS;
    const session = { userId: user.id, roleKey: canonicalRoleKey(user.roleKey), sessionId, expiresAt, ...(user.id === TEST_PARENT_ID && user.isTestFixture === true ? { testParentFixture: true } : {}) };
    const token = signingKey ? signSession(session) : randomBytes(32).toString('hex');
    sessions.set(token, session);
    await persistDurableSession(user, session, token);
    if (durableSessionStore) durableSessionIds.add(session.sessionId);
    securityEvent('LOGIN_SUCCESS', user, sessionId);
    return { ok: true, token, user: sanitize(user, sessionId), redirectTo: SCHOOL_PORTAL_DASHBOARDS[canonicalRoleKey(user.roleKey)] ?? '/', expiresAt };
  }
  function loginByPhone({ phone, portal = 'parent' }) {
    const normalized = normalizeGhanaPhone(phone);
    const key = String(phone ?? '').trim();
    const throttle = attempts.get(`parent-phone:${normalized ?? key}`);
    if (throttle?.lockedUntil > now()) return { ok: false, status: 429, error: 'Too many failed attempts. Try again later.' };
    if (portal !== 'parent' || !normalized) {
      return { ok: false, status: 401, error: normalized ? 'Phone number is not registered. Contact the school administrator.' : 'Enter a valid Ghana phone number.' };
    }
    const user = users.find((candidate) => candidate.portal === 'parent' && isActive(candidate) && [candidate.phone, candidate.telephone, candidate.parentPhone, ...(candidate.children ?? []).flatMap((child) => [child.phone, child.parentPhone])].some((value) => normalizeGhanaPhone(value) === normalized));
    if (!user) {
      const next = throttle ?? { count: 0 }; next.count += 1; if (next.count >= MAX_ATTEMPTS) next.lockedUntil = now() + LOCKOUT_MS; attempts.set(`parent-phone:${normalized}`, next); securityEvent('PARENT_PHONE_LOGIN_FAILED', null); return { ok: false, status: 401, error: 'Phone number is not registered. Contact the school administrator.' };
    }
    attempts.delete(`parent-phone:${normalized}`); return createSessionResult(user);
  }
  function login({ username, password, portal, role }) {
    const key = String(username ?? '').trim().toLowerCase(); const throttle = attempts.get(key); if (throttle?.lockedUntil > now()) return { ok: false, status: 429, error: 'Too many failed attempts. Try again later.' };
    const user = users.find((candidate) => (candidate.username.toLowerCase() === key || String(candidate.email ?? '').toLowerCase() === key) && candidate.portal === portal);
    if (user && portal === 'school' && role && canonicalRoleKey(role) !== canonicalRoleKey(user.roleKey)) return { ok: false, status: 401, error: 'The selected role does not match this account.' };
    if (!user || typeof password !== 'string' || !passwordMatches(password, user.passwordHash) || !isActive(user)) { const next = throttle ?? { count: 0 }; next.count += 1; if (next.count >= MAX_ATTEMPTS) next.lockedUntil = now() + LOCKOUT_MS; attempts.set(key, next); securityEvent('LOGIN_FAILED', user); return { ok: false, status: 401, error: GENERIC_LOGIN_ERROR }; }
    attempts.delete(key); return createSessionResult(user);
  }
  async function hydrateStaffAssignments(user) {
    if (canonicalRoleKey(user?.roleKey) !== 'TEACHER' || !database?.query) return user;
    try {
      const assignments = await database.query(`SELECT DISTINCT sa.class_id AS classId,sa.subject_id AS subjectId
        FROM staff s JOIN staff_profiles sp ON sp.id=s.id AND sp.school_id=s.school_id
        LEFT JOIN staff_assignments sa ON sa.staff_id=sp.id
        WHERE s.user_id=? AND s.school_id=?`, [user.id, user.schoolId]);
      user.assignedClassIds = [...new Set((assignments ?? []).map((item) => item.classId).filter(Boolean).map(String))];
      user.assignedSubjectIds = [...new Set((assignments ?? []).map((item) => item.subjectId).filter(Boolean).map(String))];
    } catch (error) {
      console.error('Teacher assignment lookup failed', { code: error?.code ?? 'UNKNOWN', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null });
      user.assignedClassIds ??= [];
      user.assignedSubjectIds ??= [];
    }
    return user;
  }
  async function loginByPhoneFromDatabase({ phone, portal = 'parent' }) {
    const normalized = normalizeGhanaPhone(phone);
    if (portal !== 'parent' || !normalized) return loginByPhone({ phone, portal });
    if (!database?.query) return loginByPhone({ phone, portal });
    // The controlled QA identity is a server-owned namespace, not a durable
    // Parent account. Resolve it before any live lookup so a colliding phone
    // value can never authenticate an unintended production Parent.
    if (isConfiguredTestParentPhone(normalized) && process.env.OSAAH_ENABLE_SAMPLE_FIXTURES !== 'false') {
      const user = createConfiguredTestParent(testParentSchoolId);
      const existingIndex = users.findIndex((candidate) => candidate.id === user.id);
      if (existingIndex >= 0) users[existingIndex] = user;
      else users.push(user);
      return createSessionResult(user);
    }
    let rows = [];
    try {
      rows = await database.query(`SELECT DISTINCT u.id,u.school_id AS schoolId,u.username,u.email,u.status,psl.telephone AS parentPhone
        FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id
        JOIN parent_student_links psl ON psl.parent_user_id=u.id
        WHERE r.role_key='PARENT' AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE' AND COALESCE(psl.link_status,'ACTIVE')='ACTIVE'`, []);
    } catch {
      try { rows = await database.query(`SELECT DISTINCT u.id,u.school_id AS schoolId,u.username,u.email,u.status,psl.telephone AS parentPhone
        FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id JOIN parent_student_links psl ON psl.parent_user_id=u.id
        WHERE r.role_key='PARENT' AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE'`, []); } catch { rows = []; }
    }
    const row = rows.find((candidate) => normalizeGhanaPhone(candidate.parentPhone) === normalized);
    if (!row) return { ok: false, status: 401, error: 'Phone number is not registered. Contact the school administrator.' };
    const user = { id: row.id, username: row.username ?? row.email ?? row.id, email: row.email, portal: 'parent', roleKey: 'PARENT', schoolId: row.schoolId, phone: normalized, accountStatus: 'ACTIVE', is_active: true, permissions: new Set(PARENT_PERMISSIONS) };
    users.push(user); return await createDurableSessionResult(user);
  }
  async function loginFromDatabase({ username, password, portal, role }) {
    const key = String(username ?? '').trim().toLowerCase();
    const throttle = attempts.get(key);
    if (throttle?.lockedUntil > now()) return { ok: false, status: 429, error: 'Too many failed attempts. Try again later.' };
    if (portal !== 'school' || !database?.query) return login({ username, password, portal, role });
    let rows;
    try {
      rows = await database.query(`SELECT u.id,u.school_id AS schoolId,u.username,u.email,u.password_hash AS passwordHash,u.status,r.role_key AS roleKey,r.oversight_rank AS oversightRank,p.permission_key AS permissionKey
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id=u.id
        LEFT JOIN roles r ON r.id=ur.role_id
        LEFT JOIN role_permissions rp ON rp.role_id=r.id
        LEFT JOIN permissions p ON p.id=rp.permission_id
        WHERE LOWER(COALESCE(u.email,''))=? OR LOWER(COALESCE(u.username,''))=? ORDER BY COALESCE(r.oversight_rank,0) DESC,r.role_key,p.permission_key`, [key, key]);
    } catch (error) {
      const tableMatch = String(error?.message ?? '').match(/Table ['`]([^'`]+)['`] doesn't exist/i);
      const tableName = tableMatch?.[1]?.split('.').pop() || null;
      console.error('School database authentication query failed', { code: error?.code ?? 'UNKNOWN', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null, table: tableName });
      securityEvent('LOGIN_DATABASE_ERROR', null);
      return { ok: false, status: 503, error: 'Authentication service unavailable.' };
    }
    const identityRows = rows ?? [];
    const identity = identityRows[0];
    const selected = selectAuthorizedRoleRows(identityRows, role);
    const row = selected.rows[0] ?? identity;
    const userRows = selected.rows;
    const roleKey = selected.roleKey;
    const scopedRows = userRows.filter((candidate) => canonicalRoleKey(candidate.roleKey) === roleKey);
    const active = row && String(row.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE';
    let passwordValid = false;
    if (row && typeof password === 'string' && typeof row.passwordHash === 'string') {
      try {
        passwordValid = row.passwordHash.includes(':') ? passwordMatches(password, row.passwordHash) : await bcrypt.compare(password, row.passwordHash);
      } catch { passwordValid = false; }
    }
    if (row && role && !roleKey) return { ok: false, status: 401, error: 'The selected role does not match this account.' };
    if (!row || !active || !passwordValid || !roleKey) {
      const next = throttle ?? { count: 0 }; next.count += 1; if (next.count >= MAX_ATTEMPTS) next.lockedUntil = now() + LOCKOUT_MS; attempts.set(key, next); securityEvent('LOGIN_FAILED', row ? { ...row, roleKey } : null); return { ok: false, status: 401, error: GENERIC_LOGIN_ERROR };
    }
    const user = addStaffAttendanceRoleGrants({ id: row.id, username: row.username ?? row.email, email: row.email, portal: 'school', roleKey, schoolId: row.schoolId, accountStatus: 'ACTIVE', is_active: true, permissions: new Set(scopedRows.map((candidate) => candidate.permissionKey).filter(Boolean)) });
    if (!user.permissions.size) for (const permission of ROLE_PERMISSIONS[roleKey] ?? []) user.permissions.add(permission);
    await hydrateStaffAssignments(user);
    attempts.delete(key); users.push(user); return await createDurableSessionResult(user);
  }
  function authenticate(token) {
    const session = verifiedSession(token);
    if (!session || session.expiresAt <= now()) { if (token) sessions.delete(token); return null; }
    const isTestParentFixtureSession = session.userId === TEST_PARENT_ID && session.testParentFixture === true;
    const user = isTestParentFixtureSession
      ? (process.env.OSAAH_ENABLE_SAMPLE_FIXTURES === 'false' ? null : createConfiguredTestParent(testParentSchoolId))
      : users.find((candidate) => candidate.id === session.userId && (!session.roleKey || canonicalRoleKey(candidate.roleKey) === canonicalRoleKey(session.roleKey)))
        ?? users.find((candidate) => candidate.id === session.userId);
    if (!user) { if (token) sessions.delete(token); return null; }
    if (!isActive(user)) { revokeLocalSession(token, session); securityEvent('SESSION_REVOKED', user, session.sessionId); return null; }
    return { ...sanitize(user, session.sessionId), permissions: user.permissions };
  }
  async function authenticateAsync(token) {
    const local = authenticate(token);
    const session = verifiedSession(token);
    if (!durableSessionStore || typeof token !== 'string' || !token || local && (!session || !durableSessionIds.has(session.sessionId))) return local;
    const rows = await database.query(`SELECT s.id AS sessionId,s.user_id AS userId,s.school_id AS schoolId,s.expires_at AS expiresAt,u.email AS username,u.email,u.status,r.role_key AS roleKey,r.oversight_rank AS oversightRank,p.permission_key AS permissionKey FROM auth_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id LEFT JOIN role_permissions rp ON rp.role_id=r.id LEFT JOIN permissions p ON p.id=rp.permission_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='ACTIVE' ORDER BY COALESCE(r.oversight_rank,0) DESC,r.role_key,p.permission_key`, [tokenHash(token), nowIso()]);
    const row = rows?.[0];
    if (!row) { if (session) revokeLocalSession(token, session); else sessions.delete(token); return null; }
    const userRows = rows.filter((candidate) => candidate.userId === row.userId);
    const selectedRoleKey = canonicalRoleKey(session?.roleKey ?? row.roleKey);
    const roleKey = userRows.some((candidate) => canonicalRoleKey(candidate.roleKey) === selectedRoleKey) ? selectedRoleKey : canonicalRoleKey(row.roleKey);
    const scopedRows = userRows.filter((candidate) => canonicalRoleKey(candidate.roleKey) === roleKey);
    const user = addStaffAttendanceRoleGrants({ id: row.userId, username: row.username, email: row.email, portal: roleKey === 'PARENT' ? 'parent' : 'school', roleKey, schoolId: row.schoolId, accountStatus: 'ACTIVE', is_active: true, permissions: new Set(scopedRows.map((candidate) => candidate.permissionKey).filter(Boolean)) });
    if (user.roleKey === 'PARENT') for (const permission of PARENT_PERMISSIONS) user.permissions.add(permission);
    if (!user.permissions.size) for (const permission of ROLE_PERMISSIONS[user.roleKey] ?? []) user.permissions.add(permission);
    await hydrateStaffAssignments(user);
    await database.execute('UPDATE auth_sessions SET last_used_at=? WHERE id=? AND revoked_at IS NULL', [nowIso(), row.sessionId]);
    return { ...sanitize(user, row.sessionId), permissions: user.permissions };
  }
  async function logoutSession(token) {
    const session = verifiedSession(token);
    const user = users.find((candidate) => candidate.id === session?.userId);
    if (token && durableSessionStore) await database.execute('UPDATE auth_sessions SET revoked_at=? WHERE token_hash=? AND revoked_at IS NULL', [nowIso(), tokenHash(token)]);
    if (session) { revokeLocalSession(token, session); if (user) securityEvent('SESSION_REVOKED', user, session.sessionId); }
  }
  function logout(token) { void logoutSession(token); }
  function changeAccountState(userId, active, status = active ? 'ACTIVE' : 'DISABLED') { const user = users.find((candidate) => candidate.id === userId); if (!user) return false; user.is_active = active; user.accountStatus = status; if (!active) for (const [token, session] of sessions) if (session.userId === userId) { revokeLocalSession(token, session); securityEvent(status === 'REVOKED' ? 'SESSION_REVOKED' : 'ACCOUNT_DISABLED', user, session.sessionId); } revokeDurableSessionsBestEffort(userId); for (const assignment of administratorAssignments) if (assignment.userId === userId && !active) { assignment.status = status; assignment.removedAt ??= new Date(now()).toISOString(); } return true; }
  function setAccountStatus(userId, status, schoolId = null) { if (database?.query && schoolId) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.setStatus(userId, schoolId, status === true ? 'ACTIVE' : 'DISABLED'); } return changeAccountState(userId, status === true); }
  function revokeAccount(userId, schoolId = null) { if (database?.query && schoolId) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.setStatus(userId, schoolId, 'REVOKED'); } return changeAccountState(userId, false, 'REVOKED'); }
  function administratorUsername(fullName) { const base = String(fullName ?? 'administrator').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') || 'administrator'; let username = `${base}@osaah.edu.gh`; let suffix = 2; while (users.some((user) => user.username.toLowerCase() === username.toLowerCase())) username = `${base}${suffix++}@osaah.edu.gh`; return username; }
  function createAdministrator(input, actor) { if (!input?.fullName || !input?.staffId) throw new Error('Full name and Staff ID are required'); if (users.some((user) => user.staffId === input.staffId)) throw new Error('Staff ID already exists'); const temporaryPassword = randomBytes(18).toString('base64url'); const assignedAt = input.assignedAt ?? new Date(now()).toISOString(); const accountStatus = input.accountStatus === 'REVOKED' ? 'REVOKED' : input.accountStatus === 'DISABLED' ? 'DISABLED' : 'ACTIVE'; const user = { id: randomUUID(), username: administratorUsername(input.fullName), passwordHash: passwordHash(temporaryPassword), portal: 'school', roleKey: 'SCHOOL_ADMIN', schoolId: actor.schoolId, staffId: input.staffId, fullName: input.fullName, phone: input.phone ?? null, email: input.email ?? null, assignedAt, assignedBy: actor.id, must_change_password: true, is_active: accountStatus === 'ACTIVE', accountStatus, permissions: new Set(['users.read', 'settings.read', 'settings.write', 'students.read', 'academics.read', 'attendance.read', 'examinations.read', 'fees.read', 'finance.read', 'staff.read', 'staff.manage', 'communication.read', 'calendar.read', 'calendar.write', 'documents.read', 'reports.read']) }; const active = administratorAssignments.find((assignment) => assignment.schoolId === actor.schoolId && assignment.status === 'ACTIVE'); if (active) { revokeAccount(active.userId); active.status = 'REASSIGNED'; active.removedAt = assignedAt; } users.push(user); const assignment = { id: randomUUID(), schoolId: actor.schoolId, userId: user.id, fullName: user.fullName, staffId: user.staffId, username: user.username, assignedAt, assignedBy: actor.id, removedAt: accountStatus === 'ACTIVE' ? null : assignedAt, status: accountStatus }; administratorAssignments.push(assignment); return { administrator: { id: user.id, fullName: user.fullName, staffId: user.staffId, username: user.username, phone: user.phone, email: user.email, assignedAt, assignedBy: user.assignedBy, status: user.accountStatus, mustChangePassword: user.must_change_password }, temporaryPassword }; }
  function listAdministrators(schoolId) { return administratorAssignments.filter((assignment) => !schoolId || assignment.schoolId === schoolId).map((assignment) => ({ ...assignment })); }
  function getAdministrator(userId, schoolId) { const assignment = administratorAssignments.find((item) => item.userId === userId && item.schoolId === schoolId); return assignment ? { ...assignment } : null; }
  function updateAdministrator(userId, input, schoolId) { const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId); if (!user) return null; if (input.staffId && input.staffId !== user.staffId && users.some((candidate) => candidate.staffId === input.staffId)) throw new Error('Staff ID already exists'); for (const field of ['fullName', 'staffId', 'phone', 'email']) if (input[field] !== undefined) user[field] = input[field]; const assignment = administratorAssignments.find((item) => item.userId === userId && item.schoolId === schoolId); if (assignment) Object.assign(assignment, { fullName: user.fullName, staffId: user.staffId }); return { id: user.id, fullName: user.fullName, staffId: user.staffId, username: user.username, phone: user.phone, email: user.email, status: user.accountStatus }; }
  function resetAdministratorCredentials(userId, schoolId) { const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId); if (!user) return null; const temporaryPassword = randomBytes(18).toString('base64url'); user.passwordHash = passwordHash(temporaryPassword); user.must_change_password = true; for (const [token, session] of sessions) if (session.userId === userId) revokeLocalSession(token, session); revokeDurableSessionsBestEffort(userId); return { username: user.username, temporaryPassword }; }
  let staffSequence = users.filter((user) => /^OSAAH-STAFF-\d+$/.test(user.username)).length;
  function staffUsername() { let username; do { staffSequence += 1; username = `OSAAH-STAFF-${String(staffSequence).padStart(4, '0')}`; } while (users.some((user) => user.username === username)); return username; }
  function staffView(user) { return { id: user.id, fullName: user.fullName, staffId: user.staffId, username: user.username, email: user.email, phone: user.phone, roleKey: user.roleKey, primaryRole: user.roleKey === 'TEACHER' ? 'CLASSROOM_TEACHER' : user.roleKey === 'ACCOUNTANT_BURSAR' ? 'ACCOUNTANT' : user.roleKey, assignedClassIds: user.assignedClassIds ?? [], assignedSubjectIds: user.assignedSubjectIds ?? [], accountStatus: user.accountStatus ?? 'ACTIVE', createdAt: user.createdAt, mustChangePassword: Boolean(user.must_change_password) }; }
  function registerStaff(input, actor) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff provisioning is unavailable.'); return durableStaff.register(input, actor); } const roleKey = STAFF_ASSIGNABLE_ROLES[input?.primaryRole ?? input?.roleKey]; if (!input?.fullName || !input?.staffId || !roleKey) throw new Error('Full name, Staff ID, and an assignable role are required'); if (users.some((user) => user.staffId === input.staffId)) throw new Error('Staff ID already exists'); const temporaryPassword = randomBytes(18).toString('base64url'); const user = { id: randomUUID(), username: staffUsername(), passwordHash: passwordHash(temporaryPassword), portal: 'school', roleKey, schoolId: actor.schoolId, staffId: input.staffId, fullName: input.fullName, phone: input.phone ?? null, email: input.email ?? null, assignedClassIds: input.assignedClassId ? [input.assignedClassId] : [], assignedSubjectIds: input.assignedSubjectId ? [input.assignedSubjectId] : [], accountStatus: 'ACTIVE', is_active: true, must_change_password: true, createdAt: new Date(now()).toISOString(), permissions: new Set(ROLE_PERMISSIONS[roleKey] ?? []) }; users.push(user); return { staff: staffView(user), temporaryPassword }; }
  function listStaff(schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff directory is unavailable.'); return durableStaff.list(schoolId); } return users.filter((user) => user.schoolId === schoolId && user.staffId && user.roleKey !== 'SCHOOL_ADMIN' && user.portal === 'school').map(staffView); }
  function getStaff(userId, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff directory is unavailable.'); return durableStaff.get(userId, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); return user ? staffView(user) : null; }
  function updateStaff(userId, input, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.update(userId, input, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); if (!user) return null; if (input.staffId && input.staffId !== user.staffId && users.some((candidate) => candidate.staffId === input.staffId)) throw new Error('Staff ID already exists'); for (const field of ['fullName', 'staffId', 'phone', 'email']) if (input[field] !== undefined) user[field] = input[field]; return staffView(user); }
  function changeStaffRole(userId, requestedRole, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.changeRole(userId, requestedRole, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); const roleKey = STAFF_ASSIGNABLE_ROLES[requestedRole]; if (!user || !roleKey) return null; const previousRole = user.roleKey; user.roleKey = roleKey; user.permissions = new Set(ROLE_PERMISSIONS[roleKey] ?? []); user.must_change_password = true; for (const [token, session] of sessions) if (session.userId === userId) revokeLocalSession(token, session); revokeDurableSessionsBestEffort(userId); return { staff: staffView(user), previousRole, newRole: roleKey }; }
  function assignStaff(userId, input, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.assign(userId, input, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); if (!user) return null; if (input.classId !== undefined) user.assignedClassIds = input.classId ? [input.classId] : []; if (input.subjectId !== undefined) user.assignedSubjectIds = input.subjectId ? [input.subjectId] : []; return staffView(user); }
  function resetStaffCredentials(userId, schoolId) { if (database?.query) { if (!durableStaff) throw new Error('Durable staff management is unavailable.'); return durableStaff.resetCredentials(userId, schoolId); } const user = users.find((candidate) => candidate.id === userId && candidate.schoolId === schoolId && candidate.staffId); if (!user) return null; const temporaryPassword = randomBytes(18).toString('base64url'); user.passwordHash = passwordHash(temporaryPassword); user.must_change_password = true; for (const [token, session] of sessions) if (session.userId === userId) revokeLocalSession(token, session); revokeDurableSessionsBestEffort(userId); return { username: user.username, temporaryPassword }; }
  function requestPasswordReset(username) { const user = users.find((candidate) => candidate.username.toLowerCase() === username.trim().toLowerCase()); if (!user) return { ok: true }; const token = randomUUID(); resetTokens.set(token, { userId: user.id, expiresAt: now() + RESET_TTL_MS }); return { ok: true, token }; }
  function completePasswordReset(token, newPassword) { const reset = resetTokens.get(token); if (!reset || reset.expiresAt <= now() || typeof newPassword !== 'string' || newPassword.length < 10) return { ok: false, error: 'Invalid or expired reset request.' }; const user = users.find((candidate) => candidate.id === reset.userId); if (!user) return { ok: false, error: 'Invalid or expired reset request.' }; user.passwordHash = passwordHash(newPassword); resetTokens.delete(token); for (const [sessionToken, session] of sessions) if (session.userId === user.id) revokeLocalSession(sessionToken, session); revokeDurableSessionsBestEffort(user.id); return { ok: true }; }
  return { login, loginByPhone, loginByPhoneFromDatabase, loginFromDatabase, authenticate, authenticateAsync, logout, logoutSession, requestPasswordReset, completePasswordReset, setAccountStatus, revokeAccount, createAdministrator, listAdministrators, getAdministrator, updateAdministrator, resetAdministratorCredentials, registerStaff, listStaff, getStaff, updateStaff, changeStaffRole, assignStaff, resetStaffCredentials, sessionTtlMs: SESSION_TTL_MS, genericLoginError: GENERIC_LOGIN_ERROR };
}

export function canAccess(user, permission) { return Boolean(user && (user.permissions.has('*') || user.permissions.has(permission))); }
