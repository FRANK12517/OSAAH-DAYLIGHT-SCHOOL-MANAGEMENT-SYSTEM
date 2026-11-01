import { createConfiguredTestParent, TEST_PARENT_PHONE } from '../../src/test-parent-fixture.js';

export function createParentLoginDatabase({ user = createConfiguredTestParent(), rows = null } = {}) {
  const persisted = { session: null };
  const bucket = { windowStartedAt: new Date(0).toISOString(), requestCount: 0 };
  const database = {
    dialect: 'tidb',
    supportsDurableAuthSessions: true,
    async query(sql, params = []) {
<<<<<<< Updated upstream
      if (/FROM terms t JOIN academic_years/i.test(sql)) return [{ id: 'term-1', academicYearId: 'year-1', name: 'Term 1', startsOn: '2026-01-01', endsOn: '2026-04-01', isCurrent: true }];
      if (/FROM academic_years/i.test(sql)) return [{ id: 'year-1', name: '2026/2027', startsOn: '2026-01-01', endsOn: '2026-12-31', isCurrent: true }];
      if (/FROM classes c/i.test(sql)) return [{ id: 'class-1', name: 'Basic 1', displayOrder: 1, levelName: 'Primary 1' }];
=======
>>>>>>> Stashed changes
      if (/FROM users u JOIN schools school/i.test(sql)) return rows ?? [{
        id: user.id, schoolId: user.schoolId, username: user.username, email: user.email,
        status: 'ACTIVE', parentPhone: user.phone ?? TEST_PARENT_PHONE, phoneMatchCount: 1
      }];
      if (/FROM auth_sessions s JOIN users u/i.test(sql)) {
        if (!persisted.session || params[0] !== persisted.session.tokenHash) return [];
        return [{ sessionId: persisted.session.sessionId, userId: user.id, schoolId: user.schoolId,
          expiresAt: persisted.session.expiresAt, username: user.username, email: user.email,
          status: 'ACTIVE', roleKey: 'PARENT', permissionKey: null }];
      }
      return [];
    },
    async execute(sql, params = []) {
      if (/UPDATE parent_auth_rate_limits SET/i.test(sql)) Object.assign(bucket, { windowStartedAt: params[0], requestCount: params[1] });
      if (/INSERT INTO auth_sessions/i.test(sql)) persisted.session = { sessionId: params[0], tokenHash: params[3], expiresAt: params[5] };
      if (/UPDATE auth_sessions SET revoked_at=/i.test(sql)) persisted.session = null;
      return { affectedRows: 1 };
    },
    async transaction(callback) {
      return callback({
        query: async (sql, params = []) => /parent_auth_rate_limits/i.test(sql)
          ? [{ windowStartedAt: bucket.windowStartedAt, requestCount: bucket.requestCount }]
          : database.query(sql, params),
        execute: (sql, params = []) => database.execute(sql, params)
      });
    }
  };
  return { database, persisted, bucket };
}

export async function createCredentialedTestParent(schoolId = 'sch_default_01') {
  const user = { ...createConfiguredTestParent(schoolId), schoolId };
  const { database, persisted } = createParentLoginDatabase({ user });
  return { user, database, persisted, phone: user.phone ?? TEST_PARENT_PHONE };
}
