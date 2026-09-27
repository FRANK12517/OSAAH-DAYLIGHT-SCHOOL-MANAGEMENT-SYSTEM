export const DEFAULT_PRODUCTION_SCHOOL_ID = 'sch_default_01';
export const DEMO_SCHOOL_ID = 'school-osaah-daylight';

export class SchoolContextError extends Error {
  constructor(message = 'Authenticated school context is required.', code = 'SCHOOL_CONTEXT_REQUIRED', status = 403) {
    super(message);
    this.name = 'SchoolContextError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Resolve the only school context allowed for an authenticated request.
 * The browser never supplies the value used here; it is taken from the
 * authenticated, active staff/parent account loaded by the server.
 */
export function resolveCurrentSchoolContext(authenticatedUser, { portal = null } = {}) {
  if (!authenticatedUser?.id) throw new SchoolContextError('Authentication is required.', 'UNAUTHENTICATED', 401);
  if (authenticatedUser.accountStatus && authenticatedUser.accountStatus !== 'ACTIVE') throw new SchoolContextError('The account is not active.', 'ACCOUNT_INACTIVE', 403);
  if (portal && authenticatedUser.portal !== portal) throw new SchoolContextError('The account is not authorized for this portal.', 'PORTAL_FORBIDDEN', 403);
  const schoolId = String(authenticatedUser.schoolId ?? '').trim();
  if (!schoolId) throw new SchoolContextError('Authenticated school scope is required.', 'SCHOOL_SCOPE_REQUIRED', 403);
  return Object.freeze({ schoolId, userId: authenticatedUser.id, roleKey: authenticatedUser.roleKey, portal: authenticatedUser.portal });
}

export function assertCanonicalSchoolContext(authenticatedUser, canonicalSchoolId) {
  const context = resolveCurrentSchoolContext(authenticatedUser);
  if (canonicalSchoolId && context.schoolId !== canonicalSchoolId) throw new SchoolContextError('The authenticated account is outside the canonical OSAAH school context.', 'SCHOOL_CONTEXT_MISMATCH', 403);
  return context;
}
