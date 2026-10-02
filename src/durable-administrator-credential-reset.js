const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

function failure(message, status, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export function validateAdministratorResetPassword(password) {
  if (typeof password !== 'string') throw failure('Enter a new password.', 400, 'INVALID_PASSWORD');
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw failure(`The new password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`, 400, 'INVALID_PASSWORD');
  }
  return password;
}

export function createDurableAdministratorCredentialReset({ database, passwordHash, now = () => Date.now() } = {}) {
  if (typeof database?.query !== 'function' || typeof database?.execute !== 'function' || typeof database?.transaction !== 'function' || database.supportsDurableAuthSessions !== true) {
    throw failure('Durable Administrator credential reset is unavailable.', 503, 'PERSISTENCE_UNAVAILABLE');
  }
  if (typeof passwordHash !== 'function') throw new TypeError('A password-hashing function is required.');

  async function resetByEmail(email, newPassword, schoolId) {
    if (!schoolId) throw failure('School context is required.', 400, 'INVALID_SCHOOL');
    validateAdministratorResetPassword(newPassword);

    if (typeof email !== 'string' || !email.trim()) throw failure('Enter the Administrator email address.', 400, 'INVALID_EMAIL');
    const normalizedEmail = email.trim().toLowerCase();
    if (normalizedEmail.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw failure('Enter a valid Administrator email address.', 400, 'INVALID_EMAIL');
    }

    const passwordHashValue = passwordHash(newPassword);
    const timestamp = new Date(now()).toISOString();
    return database.transaction(async (tx) => {
      const rows = await tx.query(`
        SELECT u.id AS userId, u.email AS email
        FROM users u
        WHERE u.school_id=?
          AND LOWER(COALESCE(u.email, ''))=?
          AND UPPER(COALESCE(u.status, 'ACTIVE'))='ACTIVE'
        LIMIT 2 FOR UPDATE
      `, [schoolId, normalizedEmail]);

      if (!rows?.length) throw failure('An active School Administrator matching that account was not found.', 404, 'ADMINISTRATOR_NOT_FOUND');
      if (rows.length !== 1) throw failure('More than one active School Administrator matched; no credential was changed.', 409, 'AMBIGUOUS_ADMINISTRATOR');

      const target = rows[0];
      const roleRows = await tx.query(`
        SELECT ur.role_id AS roleId
        FROM user_roles ur
        JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=?
          AND r.role_key='SCHOOL_ADMIN'
          AND (r.school_id=? OR r.school_id IS NULL)
        FOR UPDATE
      `, [target.userId, schoolId]);
      if (!roleRows?.length) throw failure('An active School Administrator matching that account was not found.', 404, 'ADMINISTRATOR_NOT_FOUND');

      const updated = await tx.execute(
        "UPDATE users SET password_hash=? WHERE id=? AND school_id=? AND UPPER(COALESCE(status, 'ACTIVE'))='ACTIVE'",
        [passwordHashValue, target.userId, schoolId]
      );
      if (Number(updated?.affectedRows) !== 1) throw failure('The Administrator account changed during the reset; no credential was changed.', 409, 'ADMINISTRATOR_CHANGED');

      const revoked = await tx.execute(
        'UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND school_id=? AND revoked_at IS NULL',
        [timestamp, target.userId, schoolId]
      );
      return {
        userId: target.userId,
        email: target.email,
        sessionsRevoked: Number(revoked?.affectedRows ?? 0)
      };
    });
  }

  return Object.freeze({ resetByEmail });
}
