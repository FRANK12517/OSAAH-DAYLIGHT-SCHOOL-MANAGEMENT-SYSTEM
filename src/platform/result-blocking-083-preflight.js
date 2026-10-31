export const RESULT_BLOCKING_083_DUPLICATE_GROUPS_SQL = `
SELECT school_id, academic_year, term, class_id, result_type,
       IFNULL(mock_examination, '') AS mock_examination_key, student_id,
       COUNT(*) AS duplicate_count
FROM academic_result_blocks
GROUP BY school_id, academic_year, term, class_id, result_type,
         IFNULL(mock_examination, ''), student_id
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC
LIMIT 100
`;

export async function preflightResultBlocking083(database) {
  if (!database || typeof database.query !== 'function') throw Object.assign(new Error('A read-only TiDB query adapter is required.'), { code: 'MIGRATION_083_PREFLIGHT_ADAPTER_REQUIRED' });
  const rows = await database.query(RESULT_BLOCKING_083_DUPLICATE_GROUPS_SQL);
  const duplicates = Array.isArray(rows) ? rows.map((row) => ({
    schoolId: row.school_id ?? row.schoolId,
    academicYear: row.academic_year ?? row.academicYear,
    term: row.term,
    classId: row.class_id ?? row.classId,
    resultType: row.result_type ?? row.resultType,
    mockExaminationKey: row.mock_examination_key ?? row.mockExaminationKey ?? '',
    studentId: row.student_id ?? row.studentId,
    duplicateCount: Number(row.duplicate_count ?? row.duplicateCount)
  })) : [];
  if (duplicates.length) throw Object.assign(new Error(`Migration 083 is blocked by ${duplicates.length} duplicate logical result-block scope(s). Review the duplicate scope report and reconcile rows before retrying; this preflight does not modify data.`), { code: 'MIGRATION_083_DUPLICATE_SCOPES', duplicates });
  return Object.freeze({ ready: true, duplicateGroupCount: 0 });
}

export async function verifyResultBlocking083Statement({ adapter, statement, statementIndex }) {
  const sql = String(statement ?? '').trim();
  const isGeneratedKey = /^ALTER\s+TABLE\s+academic_result_blocks\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+mock_examination_key\b/i.test(sql);
  const isUniqueIndex = /^CREATE\s+UNIQUE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+uq_academic_result_block_tidb_scope\b/i.test(sql);
  if (isGeneratedKey && statementIndex === 1) {
    const columns = await adapter.query("SELECT column_name AS columnName, extra FROM information_schema.COLUMNS WHERE table_schema=DATABASE() AND table_name='academic_result_blocks' AND column_name='mock_examination_key'");
    if (columns.length !== 1 || !/VIRTUAL GENERATED|VIRTUAL/i.test(String(columns[0].extra ?? ''))) throw Object.assign(new Error('Migration 083 mock examination key column postcondition failed.'), { code: 'MIGRATION_083_COLUMN_POSTCONDITION_FAILED' });
    return;
  }
  if (isUniqueIndex && statementIndex === 2) {
    await preflightResultBlocking083(adapter);
    const columns = await adapter.query("SELECT index_name AS indexName, non_unique AS nonUnique, column_name AS columnName, seq_in_index AS sequence FROM information_schema.STATISTICS WHERE table_schema=DATABASE() AND table_name='academic_result_blocks' AND index_name='uq_academic_result_block_tidb_scope' ORDER BY seq_in_index");
    const expected = ['school_id','academic_year','term','class_id','result_type','mock_examination_key','student_id'];
    if (columns.length !== expected.length || Number(columns[0]?.nonUnique) !== 0 || columns.some((column, index) => column.columnName !== expected[index] || Number(column.sequence) !== index + 1)) throw Object.assign(new Error('Migration 083 unique index postcondition failed.'), { code: 'MIGRATION_083_INDEX_POSTCONDITION_FAILED' });
    return;
  }
  throw Object.assign(new Error('Unexpected statement in migration 083; stop for manual review.'), { code: 'MIGRATION_083_STATEMENT_UNEXPECTED' });
}
