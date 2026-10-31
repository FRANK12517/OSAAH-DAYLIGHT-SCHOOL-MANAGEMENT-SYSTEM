-- Normalize NULL terminal labels so TiDB can enforce the logical result scope.
-- Existing duplicate logical scopes intentionally make index creation fail; reconcile
-- those rows before retrying rather than silently replacing any block.
ALTER TABLE academic_result_blocks
  ADD COLUMN IF NOT EXISTS mock_examination_key VARCHAR(32)
    AS (IFNULL(mock_examination, '')) VIRTUAL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_academic_result_block_tidb_scope
  ON academic_result_blocks
    (school_id, academic_year, term, class_id, result_type, mock_examination_key, student_id);
