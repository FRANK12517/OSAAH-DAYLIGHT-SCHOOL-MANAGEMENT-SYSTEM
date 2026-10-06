import { assertCanonicalSchoolContext } from './school-context.js';

export const USER_DIRECTORY_SQL = `
  SELECT
    u.id AS id,
    u.email AS username,
    u.email AS email,
    u.status AS status,
    s.first_name AS firstName,
    s.last_name AS lastName,
    r.role_key AS roleKey,
    r.role_name AS roleName
  FROM users u
  LEFT JOIN staff s ON s.user_id = u.id AND s.school_id = u.school_id
  LEFT JOIN user_roles ur ON ur.user_id = u.id
  LEFT JOIN roles r ON r.id = ur.role_id AND (r.school_id = u.school_id OR r.school_id IS NULL)
  WHERE u.school_id = ?
  ORDER BY u.email, u.id, r.role_name
`;
export const CREDENTIAL_MANAGEMENT_PERMISSION = 'users.credentials.manage';

function directoryError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

function displayName(row) {
  const name = [row.firstName, row.lastName].filter((part) => typeof part === 'string' && part.trim()).map((part) => part.trim()).join(' ');
  return name || row.username || row.email || 'Unnamed account';
}

export function createUserDirectoryService({ database, canonicalSchoolId } = {}) {
  async function listFor(actor) {
    const context = assertCanonicalSchoolContext(actor, canonicalSchoolId);
    if (context.portal !== 'school') throw directoryError('School account access is required.', 403, 'PORTAL_FORBIDDEN');
    if (typeof database?.query !== 'function') throw directoryError('User directory service is unavailable.', 503, 'USER_DIRECTORY_UNAVAILABLE');

    let rows;
    try {
      rows = await database.query(USER_DIRECTORY_SQL, [context.schoolId]);
    } catch (error) {
      const table = String(error?.message ?? '').match(/Table ['`]([^'`]+)['`] doesn't exist/i)?.[1]?.split('.').pop() ?? null;
      const column = String(error?.message ?? '').match(/Unknown column ['`]([^'`]+)['`]/i)?.[1] ?? null;
      console.error('Users & Roles database query failed', {
        code: error?.code ?? 'UNKNOWN',
        errno: error?.errno ?? null,
        sqlState: error?.sqlState ?? null,
        table,
        column
      });
      throw directoryError('User directory service is unavailable.', 503, 'USER_DIRECTORY_UNAVAILABLE');
    }

    const users = new Map();
    for (const row of rows ?? []) {
      if (!row?.id) continue;
      let user = users.get(String(row.id));
      if (!user) {
        user = {
          id: String(row.id),
          displayName: displayName(row),
          username: row.username || row.email || '',
          email: row.email || null,
          status: String(row.status || 'UNKNOWN').toUpperCase(),
          roles: []
        };
        users.set(user.id, user);
      }
      if (row.roleKey && !user.roles.some((role) => role.key === String(row.roleKey))) {
        user.roles.push({ key: String(row.roleKey), name: String(row.roleName || row.roleKey) });
      }
    }
    return [...users.values()];
  }

  return Object.freeze({ listFor });
}
