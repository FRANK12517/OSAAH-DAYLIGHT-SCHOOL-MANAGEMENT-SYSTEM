import bcrypt from 'bcrypt';
import { promisify } from 'node:util';
import { scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { canonicalRoleKey } from './auth.js';

const deriveScrypt = promisify(scryptCallback);

const INVALID = Object.freeze({ success: false, error: 'Incorrect username or password.' });
const ADMINISTRATOR_PERMISSIONS = Object.freeze([
  'users.read', 'settings.read', 'students.read', 'academics.read', 'attendance.read',
  'examinations.read', 'fees.read', 'finance.read', 'staff.read', 'staff.manage',
  'communication.read', 'documents.read', 'reports.read', 'mock.scores.write'
]);
const ROLE_PERMISSIONS = Object.freeze({
  PROPRIETOR: ['*'],
  SCHOOL_ADMIN: ADMINISTRATOR_PERMISSIONS,
  HEADTEACHER: ['students.read', 'academics.read', 'attendance.read', 'examinations.read', 'results.read', 'results.generate', 'results.print', 'admissions.read', 'admissions.review', 'admissions.accept', 'admissions.reject', 'admissions.analytics.read', 'admission.prospectus.manage', 'subjects.read', 'subjects.manage', 'signatures.manage', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'fees.read', 'finance.read', 'staff.read', 'communication.read', 'reports.read', 'sporting_activities.view', 'subject_register.view', 'subject_register.manage', 'shep_activities.view', 'shep_activities.create', 'shep_activities.update', 'shep_activities.manage_participants', 'shep_activities.record_screening', 'shep_activities.create_referral', 'shep_activities.manage_followup', 'shep_activities.generate_reports', 'ai.actions.prepare', 'ai.actions.approve', 'ai.actions.review'],
  ASSISTANT_HEADTEACHER: ['students.read', 'academics.read', 'attendance.read', 'examinations.read', 'results.read', 'results.generate', 'results.print', 'admissions.read', 'admissions.review', 'admissions.accept', 'admissions.reject', 'admissions.analytics.read', 'admission.prospectus.manage', 'subjects.read', 'subjects.manage', 'signatures.manage', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'fees.read', 'finance.read', 'staff.read', 'communication.read', 'sporting_activities.view', 'subject_register.view', 'subject_register.manage', 'ai.actions.prepare', 'ai.actions.approve', 'ai.actions.review'],
  ACCOUNTANT_BURSAR: ['fees.read', 'fees.write', 'finance.read', 'fees.configure', 'fees.collect'],
  TEACHER: ['students.read', 'academics.read', 'attendance.read', 'attendance.write', 'examinations.read', 'marks.write', 'results.read', 'results.generate', 'results.print', 'mock.scores.read', 'mock.scores.write', 'mock.results.read', 'mock.results.generate', 'leave.read', 'leave.write', 'staff.professional-development.view', 'communication.read', 'messages.read', 'messages.write', 'sporting_activities.view', 'subject_register.view', 'shep_activities.view', 'shep_activities.create', 'shep_activities.update', 'shep_activities.manage_participants', 'shep_activities.record_screening', 'shep_activities.create_referral', 'shep_activities.manage_followup', 'shep_activities.generate_reports']
});
const ROLE_REDIRECTS = Object.freeze({ TEACHER: '/academics' });
const VALID_ROLES = new Set(Object.keys(ROLE_PERMISSIONS));
const REQUESTED_ROLE_ALIASES = Object.freeze({
  ADMINISTRATOR: 'SCHOOL_ADMIN',
  SCHOOL_ADMINISTRATOR: 'SCHOOL_ADMIN',
  ACCOUNTANT: 'ACCOUNTANT_BURSAR',
  CLASSROOM_TEACHER: 'TEACHER',
  PROPRIETOR: 'PROPRIETOR',
  PROPRIETRESS: 'PROPRIETOR',
  SCHOOL_PROPRIETOR: 'PROPRIETOR',
  SCHOOL_PROPRIETRESS: 'PROPRIETOR'
});

function requestedRoleKey(value) {
  const normalized = String(value ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return REQUESTED_ROLE_ALIASES[normalized] ?? canonicalRoleKey(normalized);
}

async function verifyPassword(password, storedHash, bcryptCompare) {
  if (typeof storedHash !== 'string') return false;
  if (/^\$2[aby]\$/.test(storedHash)) return bcryptCompare(password, storedHash);

  // Legacy in-memory/staff credential issuance stores Node scrypt as
  // `<16-byte-hex-salt>:<32-byte-hex-digest>`. Accept only this exact format.
  const match = /^([a-f0-9]{32}):([a-f0-9]{64})$/i.exec(storedHash);
  if (!match) return false;
  try {
    const actual = await deriveScrypt(password, match[1], 32);
    const expected = Buffer.from(match[2], 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createDatabaseAuthenticationController({
  database,
  auth,
  bcryptCompare = bcrypt.compare,
  schoolId = process.env.OSAAH_SCHOOL_ID ?? (process.env.NODE_ENV === 'production' ? '' : 'school-osaah-daylight'),
  schoolName = 'OSAAH DAYLIGHT SCH. COM.'
} = {}) {
  if (typeof database?.query !== 'function' || typeof auth?.issueExternalSession !== 'function') {
    throw new Error('Database authentication requires the shared TiDB adapter and authentication service.');
  }

  return async function authenticateDatabaseUser(input = {}, { proprietorOnly = false } = {}) {
    const identifier = String(input.username ?? input.email ?? '').trim();
    const normalizedIdentifier = identifier.toLowerCase();
    const password = typeof input.password === 'string' ? input.password : '';
    if (!normalizedIdentifier || !password) return { status: 401, body: { ...INVALID } };
    if (input.portal && String(input.portal).trim().toLowerCase() !== 'school') return { status: 401, body: { ...INVALID } };
    if (!schoolId || !schoolName) return { status: 503, body: { success: false, error: 'Authentication service is temporarily unavailable.' }, code: 'AUTH_SCHOOL_SCOPE_REQUIRED' };
    try {
      const rows = await database.query(
        'SELECT id, portal_name, email, password_hash, role, is_active FROM portal_users WHERE (LOWER(email) = ? OR LOWER(portal_name) = ?) AND is_active = 1 LIMIT 2',
        [normalizedIdentifier, normalizedIdentifier]
      );
      if (!Array.isArray(rows) || rows.length !== 1) return { status: 401, body: { ...INVALID } };
      const record = rows[0];
      if (Number(record.is_active) !== 1 && record.is_active !== true) return { status: 401, body: { ...INVALID } };
      const roleKey = canonicalRoleKey(record.role) === 'ADMINISTRATOR' ? 'SCHOOL_ADMIN' : canonicalRoleKey(record.role);
      if (!VALID_ROLES.has(roleKey) || (proprietorOnly && roleKey !== 'PROPRIETOR')) return { status: 401, body: { ...INVALID } };
      if (!await verifyPassword(password, record.password_hash, bcryptCompare)) {
        return { status: 401, body: { ...INVALID } };
      }
      const selectedRole = input.role ?? input.roleKey;
      if (selectedRole && requestedRoleKey(selectedRole) !== roleKey) {
        return { status: 401, body: { success: false, error: 'The selected role does not match this account.' } };
      }

      const username = String(record.portal_name ?? record.email ?? '');
      const user = {
        id: record.id,
        username,
        email: String(record.email ?? ''),
        fullName: username,
        role: roleKey,
        roleKey,
        portal: 'school',
        schoolId,
        schoolName,
        permissions: ROLE_PERMISSIONS[roleKey]
      };
      const session = auth.issueExternalSession(user);
      const redirectTo = ROLE_REDIRECTS[roleKey] ?? '/dashboard';
      return {
        status: 200,
        body: {
          success: true,
          token: session.token,
          user: { ...session.user, id: String(record.id), email: user.email, username, role: roleKey, redirectTo },
          redirectTo,
          expiresAt: session.expiresAt
        }
      };
    } catch (error) {
      return { status: 503, body: { success: false, error: 'Authentication service is temporarily unavailable.' }, code: typeof error?.code === 'string' ? error.code : 'DATABASE_AUTHENTICATION_FAILED' };
    }
  };
}

export default createDatabaseAuthenticationController;
