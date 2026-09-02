import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';

const SESSION_TTL_MS = 30 * 60 * 1000;
const RESET_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`; }
function passwordMatches(password, stored) { const [salt, expected] = stored.split(':'); const actual = scryptSync(password, salt, 32); return timingSafeEqual(actual, Buffer.from(expected, 'hex')); }

export const DEMO_USERS = [
  { id: 'user-parent-1', username: 'parent@example.com', passwordHash: passwordHash('Parent123!', 'parent-salt'), portal: 'parent', roleKey: 'PARENT', schoolId: 'school-osaah-daylight', permissions: new Set(['children.read']), children: [{ id: 'student-1', name: 'Ama Mensah', className: 'Primary 4' }] },
  { id: 'user-proprietor-1', username: 'proprietor@osaah.edu.gh', passwordHash: passwordHash('Proprietor123!', 'proprietor-salt'), portal: 'school', roleKey: 'PROPRIETOR', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) },
  { id: 'user-teacher-1', username: 'teacher@osaah.edu.gh', passwordHash: passwordHash('Teacher123!', 'teacher-salt'), portal: 'school', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['students.read', 'academics.read', 'attendance.write']) },
  { id: 'user-bursar-1', username: 'bursar@osaah.edu.gh', passwordHash: passwordHash('Bursar123!', 'bursar-salt'), portal: 'school', roleKey: 'ACCOUNTANT_BURSAR', schoolId: 'school-osaah-daylight', permissions: new Set(['fees.read', 'fees.write', 'finance.read']) },
  { id: 'user-librarian-1', username: 'librarian@osaah.edu.gh', passwordHash: passwordHash('Librarian123!', 'librarian-salt'), portal: 'school', roleKey: 'LIBRARIAN', schoolId: 'school-osaah-daylight', permissions: new Set(['library.read', 'library.write']) },
  { id: 'user-transport-1', username: 'transport@osaah.edu.gh', passwordHash: passwordHash('Transport123!', 'transport-salt'), portal: 'school', roleKey: 'TRANSPORT_MANAGER', schoolId: 'school-osaah-daylight', permissions: new Set(['transport.read', 'transport.write']) }
];

export function createAuthService({ users = DEMO_USERS, now = () => Date.now() } = {}) {
  users = users.map((user) => ({ ...user, permissions: new Set(user.permissions), children: user.children?.map((child) => ({ ...child })) }));
  const sessions = new Map(); const attempts = new Map(); const resetTokens = new Map();
  function sanitize(user) { return { id: user.id, username: user.username, portal: user.portal, roleKey: user.roleKey, schoolId: user.schoolId, children: user.children ?? [] }; }
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
