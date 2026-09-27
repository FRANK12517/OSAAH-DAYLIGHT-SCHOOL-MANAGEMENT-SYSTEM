export const RESULT_SLIP_CONFIRMATION = 'APPLY_RESULT_SLIP_055_056';
export const EXPECTED_PRODUCTION_DATABASE = 'osaahdaylightschool';
const IMMUTABLE_RELEASE_SHA = /^[0-9a-f]{40}$/;

export function validateReleaseInputs({ confirmation, releaseRef, databaseUrl }) {
  if (confirmation !== RESULT_SLIP_CONFIRMATION) throw Object.assign(new Error('Production confirmation phrase did not match.'), { code: 'CONFIRMATION_MISMATCH' });
  if (typeof releaseRef !== 'string' || !releaseRef.trim()) throw Object.assign(new Error('A release_ref is required.'), { code: 'RELEASE_REF_REQUIRED' });
  if (!IMMUTABLE_RELEASE_SHA.test(releaseRef)) throw Object.assign(new Error('release_ref must be a full lowercase 40-character commit SHA.'), { code: 'RELEASE_REF_INVALID' });
  if (typeof databaseUrl !== 'string' || !databaseUrl.trim()) throw Object.assign(new Error('Protected DATABASE_URL is unavailable.'), { code: 'DATABASE_URL_MISSING' });
}

export function assertExpectedDatabase(databaseName) {
  if (databaseName !== EXPECTED_PRODUCTION_DATABASE) throw Object.assign(new Error('Connected database does not match the protected production target.'), { code: 'DATABASE_TARGET_MISMATCH' });
}

export async function verifyResultSlipSchema(database, { allowMissingTables = [] } = {}) {
  const allowedMissing = new Set(allowMissingTables);
  const tables = await database.query(`SELECT TABLE_NAME AS tableName,TABLE_TYPE AS tableType
    FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?)`, ['canonical_academic_scores', 'canonical_ges_assessments']);
  const byTable = new Map(tables.map((row) => [row.tableName, row.tableType]));
  const contracts = {
    canonical_academic_scores: {
      columns: ['id','school_id','student_id','class_id','academic_year_id','term_id','subject_id','class_score','exam_score','total_score','created_at','updated_at'],
      unique: ['school_id','student_id','class_id','academic_year_id','term_id','subject_id'],
      foreignKeys: [['school_id','schools','id'],['student_id','students','id'],['class_id','classes','id'],['academic_year_id','academic_years','id'],['term_id','terms','id'],['subject_id','subjects','id']]
    },
    canonical_ges_assessments: {
      columns: ['id','school_id','student_id','class_id','academic_year_id','term_id','conduct','attitude','interest','class_teacher_remarks','headteacher_remarks','created_at','updated_at'],
      unique: ['school_id','student_id','class_id','academic_year_id','term_id'],
      foreignKeys: [['school_id','schools','id'],['student_id','students','id'],['class_id','classes','id'],['academic_year_id','academic_years','id'],['term_id','terms','id']]
    }
  };
  for (const [table, contract] of Object.entries(contracts)) {
    if (byTable.get(table) !== 'BASE TABLE') {
      if (!byTable.has(table) && allowedMissing.has(table)) continue;
      throw Object.assign(new Error(`Required Result Slip table is missing or not a base table: ${table}.`), { code: 'RESULT_SLIP_TABLE_MISSING' });
    }
    const [columns, indexes, foreignKeys] = await Promise.all([
      database.query('SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]),
      database.query('SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX', [table]),
      database.query('SELECT COLUMN_NAME AS columnName,REFERENCED_TABLE_NAME AS referencedTable,REFERENCED_COLUMN_NAME AS referencedColumn FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL', [table])
    ]);
    const presentColumns = new Set(columns.map((item) => item.columnName));
    const missing = contract.columns.filter((column) => !presentColumns.has(column));
    if (missing.length) throw Object.assign(new Error(`Required columns are missing from ${table}: ${missing.join(', ')}.`), { code: 'RESULT_SLIP_COLUMNS_MISSING' });
    const uniqueIndexes = new Map();
    for (const index of indexes.filter((item) => Number(item.nonUnique) === 0)) {
      if (!uniqueIndexes.has(index.indexName)) uniqueIndexes.set(index.indexName, []);
      uniqueIndexes.get(index.indexName)[Number(index.sequence) - 1] = index.columnName;
    }
    if (![...uniqueIndexes.values()].some((fields) => JSON.stringify(fields) === JSON.stringify(contract.unique))) throw Object.assign(new Error(`Required unique scope is missing from ${table}.`), { code: 'RESULT_SLIP_UNIQUE_SCOPE_MISSING' });
    const missingForeignKeys = contract.foreignKeys.filter(([column, targetTable, targetColumn]) => !foreignKeys.some((item) => item.columnName === column && item.referencedTable === targetTable && item.referencedColumn === targetColumn));
    if (missingForeignKeys.length) throw Object.assign(new Error(`Required identity references are missing from ${table}.`), { code: 'RESULT_SLIP_FOREIGN_KEYS_MISSING' });
  }
  const verifiedTables = Object.keys(contracts).filter((table) => byTable.has(table));
  return { verifiedTables, studentIdentity: 'students.id', uniqueScopes: Object.fromEntries(verifiedTables.map((table) => [table, contracts[table].unique])) };
}
