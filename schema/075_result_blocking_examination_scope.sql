-- Migration 075: isolate terminal and Mock result visibility controls.
-- Existing rows remain terminal blocks; no score/result data is deleted.
ALTER TABLE academic_result_blocks
  ADD COLUMN IF NOT EXISTS result_type ENUM('TERMINAL','MOCK') NOT NULL DEFAULT 'TERMINAL' AFTER term,
  ADD COLUMN IF NOT EXISTS mock_examination VARCHAR(32) NULL AFTER result_type;
ALTER TABLE academic_result_blocks
  DROP INDEX uq_academic_result_block_scope,
  ADD UNIQUE KEY uq_academic_result_block_examination_scope (school_id, academic_year, term, class_id, result_type, mock_examination, student_id),
  ADD KEY idx_academic_result_block_examination_lookup (school_id, academic_year, term, class_id, result_type, mock_examination, status);
ALTER TABLE academic_result_unblock_requests
  ADD COLUMN IF NOT EXISTS result_type ENUM('TERMINAL','MOCK') NOT NULL DEFAULT 'TERMINAL' AFTER term,
  ADD COLUMN IF NOT EXISTS mock_examination VARCHAR(32) NULL AFTER result_type,
  ADD KEY idx_academic_result_unblock_examination_lookup (school_id, academic_year, term, class_id, result_type, mock_examination, status);
