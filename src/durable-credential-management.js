import { randomBytes } from 'node:crypto';

const PASSWORD_SYMBOLS = '!@#$%^&*()-_=+[]{}:,.?';
const PASSWORD_MIN_LENGTH = 12;

export function passwordMeetsPolicy(password) {
  return password.length >= PASSWORD_MIN_LENGTH && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
}

function generatedPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' + PASSWORD_SYMBOLS;
  const bytes = randomBytes(24);
  const required = ['A', 'a', '1', PASSWORD_SYMBOLS[0]];
  const result = required.concat([...bytes].map((byte) => alphabet[byte % alphabet.length]));
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = bytes[index % bytes.length] % (index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result.join('');
}

function failure(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

export function createDurableCredentialManagement({ database, passwordHash, now = () => Date.now() } = {}) {
  if (!database?.query || !database?.transaction || !database?.execute || typeof passwordHash !== 'function') {
    throw failure('Durable credential management is unavailable.', 503, 'PERSISTENCE_UNAVAILABLE');
  }
  const nowIso = () => new Date(now()).toISOString();

  async function reissue(userId, schoolId) {
    const targetId = String(userId ?? '').trim();
    const scope = String(schoolId ?? '').trim();
    if (!targetId || !scope) throw failure('A valid account and school are required.', 400, 'INVALID_TARGET');
    const temporaryPassword = generatedPassword();
    return database.transaction(async (tx) => {
      const rows = await tx.query(`SELECT u.id AS id, u.username AS username, u.email AS email, u.status AS status,
          s.id AS staffId, r.role_key AS roleKey
        FROM users u
        LEFT JOIN staff s ON s.user_id=u.id AND s.school_id=u.school_id
        LEFT JOIN user_roles ur ON ur.user_id=u.id
        LEFT JOIN roles r ON r.id=ur.role_id AND (r.school_id=u.school_id OR r.school_id IS NULL)
        WHERE u.id=? AND u.school_id=?
        ORDER BY r.oversight_rank DESC
        LIMIT 1 FOR UPDATE`, [targetId, scope]);
      const target = rows?.[0];
      if (!target) throw failure('Account not found.', 404, 'ACCOUNT_NOT_FOUND');
      if (String(target.status ?? 'ACTIVE').toUpperCase() !== 'ACTIVE') throw failure('Disabled accounts cannot receive credentials.', 409, 'ACCOUNT_DISABLED');
      const timestamp = nowIso();
      const hash = passwordHash(temporaryPassword);
      const result = await tx.execute(`UPDATE users
        SET password_hash=?, updated_at=?
        WHERE id=? AND school_id=?`, [hash, timestamp, targetId, scope]);
      if (!Number(result?.affectedRows)) throw failure('Credential update was not persisted.', 503, 'CREDENTIAL_UPDATE_FAILED');
      await tx.execute('UPDATE auth_sessions SET revoked_at=? WHERE user_id=? AND school_id=? AND revoked_at IS NULL', [timestamp, targetId, scope]);
      return {
        userId: String(target.id),
        username: target.username ?? target.email ?? '',
        email: target.email ?? null,
        staffId: target.staffId ?? null,
        roleKey: target.roleKey ?? null,
        temporaryPassword,
        mustChangePassword: true
      };
    });
  }

  return Object.freeze({ reissue });
}

export { generatedPassword };
