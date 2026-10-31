const duplicateCodes = new Set(['ER_DUP_ENTRY', '1062', 1062, '23505']);

function isDuplicateKey(error) {
  return duplicateCodes.has(error?.code) || duplicateCodes.has(error?.errno);
}

async function matchingConflict(database, sql, parameters) {
  const rows = await database.query(sql, parameters);
  return Array.isArray(rows) && rows.length > 0;
}

/**
 * TiDB-safe insert-if-absent with verification of the intended unique key.
 * Other unique-key violations are deliberately rethrown rather than ignored.
 */
export async function tidbInsertIfAbsent(database, { insertSql, insertParameters = [], conflictSql, conflictParameters = [] }) {
  try {
    await database.execute(insertSql, insertParameters);
    return true;
  } catch (error) {
    if (!isDuplicateKey(error) || !await matchingConflict(database, conflictSql, conflictParameters)) throw error;
    return false;
  }
}

/**
 * TiDB-safe targeted upsert. On a duplicate key, update only after confirming
 * the requested conflict identity exists; unrelated unique collisions surface.
 */
export async function tidbInsertOrUpdate(database, { insertSql, insertParameters = [], conflictSql, conflictParameters = [], updateSql, updateParameters = [] }) {
  try {
    await database.execute(insertSql, insertParameters);
    return 'inserted';
  } catch (error) {
    if (!isDuplicateKey(error) || !await matchingConflict(database, conflictSql, conflictParameters)) throw error;
    await database.execute(updateSql, updateParameters);
    return 'updated';
  }
}

export { isDuplicateKey };
