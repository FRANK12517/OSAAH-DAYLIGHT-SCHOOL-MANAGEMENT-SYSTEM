import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const authTables = ['users', 'user_roles', 'roles', 'role_permissions', 'permissions'];
const knownAccounts = [
  'accountant@osaah.edu.gh',
  'administrator@osaah.edu.gh',
  'headteacher@osaah.edu.gh',
  'assistantheadteacher@osaah.edu.gh'
];

const safeError = (error) => ({
  ok: false,
  error: { code: error?.code ?? 'RBAC_INVENTORY_FAILED', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null }
});

async function main() {
  if (!process.env.DATABASE_URL) return { ...safeError({ code: 'DATABASE_URL_MISSING' }) };
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try {
    const [[databaseRow]] = await pool.query('SELECT DATABASE() AS database_name');
    const connectedDatabase = databaseRow?.database_name ?? null;
    const [tableRows] = await pool.query('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) ORDER BY TABLE_NAME', [authTables]);
    const present = new Set(tableRows.map((row) => row.TABLE_NAME));
    const tableStatus = Object.fromEntries(authTables.map((table) => [table, present.has(table) ? 'EXISTS' : 'MISSING']));
    const showCreate = {};
    const columns = {};
    const indexes = {};
    const foreignKeys = {};
    for (const table of authTables.filter((item) => present.has(item))) {
      const [[ddl]] = await pool.query(`SHOW CREATE TABLE \`${table}\``);
      showCreate[table] = ddl?.['Create Table'] ?? ddl?.['Create View'] ?? null;
      const [tableColumns] = await pool.query('SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION', [table]);
      columns[table] = tableColumns.map((row) => ({ name: row.COLUMN_NAME, type: row.COLUMN_TYPE, nullable: row.IS_NULLABLE, key: row.COLUMN_KEY, default: row.COLUMN_DEFAULT, extra: row.EXTRA }));
      const [tableIndexes] = await pool.query('SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY INDEX_NAME, SEQ_IN_INDEX', [table]);
      indexes[table] = tableIndexes.map((row) => ({ name: row.INDEX_NAME, column: row.COLUMN_NAME, unique: row.NON_UNIQUE === 0, sequence: row.SEQ_IN_INDEX }));
      const [tableForeignKeys] = await pool.query('SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL ORDER BY CONSTRAINT_NAME, ORDINAL_POSITION', [table]);
      foreignKeys[table] = tableForeignKeys.map((row) => ({ name: row.CONSTRAINT_NAME, column: row.COLUMN_NAME, referencedTable: row.REFERENCED_TABLE_NAME, referencedColumn: row.REFERENCED_COLUMN_NAME }));
    }

    const roleValues = present.has('users') && (columns.users ?? []).some((column) => column.name === 'role')
      ? await pool.query('SELECT COALESCE(role, \'<NULL>\') AS role, COUNT(*) AS count FROM users GROUP BY role ORDER BY count DESC, role')
      : [[]];
    const roleValueCounts = (roleValues[0] ?? []).map((row) => ({ role: row.role, count: Number(row.count) }));
    const roleMappings = present.has('user_roles') && present.has('users') && present.has('roles')
      ? await pool.query('SELECT ur.user_id AS userId, u.email, u.status, r.role_key AS roleKey, r.role_name AS roleName, r.school_id AS roleSchoolId, u.school_id AS userSchoolId FROM user_roles ur JOIN users u ON u.id = ur.user_id JOIN roles r ON r.id = ur.role_id ORDER BY u.email, r.role_key')
      : [[]];
    const canonicalMappings = (roleMappings[0] ?? []).map((row) => ({ userId: row.userId, email: row.email, status: row.status, roleKey: row.roleKey, roleName: row.roleName, schoolRelationship: row.roleSchoolId == null || row.roleSchoolId === row.userSchoolId ? 'VALID' : 'INVALID' }));

    let accountRows = [];
    if (present.has('users')) {
      const userColumns = new Set((columns.users ?? []).map((column) => column.name));
      const select = ['u.id', 'u.email', 'u.status', 'u.school_id AS schoolId', userColumns.has('role') ? 'u.role' : 'NULL AS role', userColumns.has('password_hash') ? 'CASE WHEN u.password_hash IS NULL OR u.password_hash = \'\' THEN \'NO\' ELSE \'YES\' END AS passwordHashPresent' : "'UNKNOWN' AS passwordHashPresent", userColumns.has('locked_until') ? 'CASE WHEN u.locked_until IS NOT NULL AND u.locked_until > CURRENT_TIMESTAMP THEN \'YES\' ELSE \'NO\' END AS locked' : "'UNKNOWN' AS locked"].join(',');
      const [rows] = await pool.query(`SELECT ${select}, CASE WHEN s.id IS NULL THEN 'INVALID' ELSE 'VALID' END AS schoolRelationship FROM users u LEFT JOIN schools s ON s.id = u.school_id WHERE LOWER(u.email) IN (?) ORDER BY u.email`, [knownAccounts]);
      accountRows = rows;
      if (present.has('user_roles') && present.has('roles')) {
        for (const account of accountRows) account.canonicalRoleMapping = canonicalMappings.filter((mapping) => mapping.email?.toLowerCase() === account.email?.toLowerCase()).map(({ roleKey, roleName, schoolRelationship }) => ({ roleKey, roleName, schoolRelationship }));
      }
    }

    const rowCounts = {};
    for (const table of ['users', 'user_roles', 'roles', 'role_permissions', 'permissions', 'schools', 'students', 'student_enrollments', 'fee_obligations', 'fee_collection_records']) {
      if (present.has(table) || ['schools', 'students', 'student_enrollments', 'fee_obligations', 'fee_collection_records'].includes(table)) {
        try { const [[row]] = await pool.query(`SELECT COUNT(*) AS count FROM \`${table}\``); rowCounts[table] = Number(row.count); } catch { rowCounts[table] = null; }
      }
    }

    return {
      ok: true,
      connectedDatabase,
      expectedDatabase,
      databaseMatch: connectedDatabase === expectedDatabase,
      select1: true,
      canonicalAuthTables: tableStatus,
      showCreateTable: showCreate,
      columns,
      indexes,
      foreignKeys,
      roleValueCounts,
      canonicalUserRoleMappings: canonicalMappings,
      knownStaffAccounts: accountRows.map(({ id, email, status, schoolId, role, passwordHashPresent, locked, schoolRelationship, canonicalRoleMapping }) => ({ id, email, status, schoolId, legacyRole: role, passwordHashPresent, locked, schoolRelationship, canonicalRoleMapping: canonicalRoleMapping ?? [] })),
      rowCounts
    };
  } catch (error) {
    return safeError(error);
  } finally {
    await pool.end();
  }
}

const result = await main();
process.stdout.write(`${JSON.stringify(result)}\n`);
if (!result.ok) process.exitCode = 1;
