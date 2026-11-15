-- TiDB migration 086: retain the source school and level for transfer students.
-- Before applying, follow docs/transfer-student-fields-migration.md to take and
-- verify a protected backup and confirm existing values fit the target widths.

SET @osaah_previous_school_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_profiles' AND COLUMN_NAME = 'previous_school'
);
SET @osaah_previous_school_correct = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_profiles' AND COLUMN_NAME = 'previous_school'
    AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 120 AND IS_NULLABLE = 'YES'
);
SET @osaah_previous_school_ddl = IF(
  @osaah_previous_school_exists = 0,
  'ALTER TABLE student_profiles ADD COLUMN previous_school VARCHAR(120) NULL',
  IF(@osaah_previous_school_correct = 1, 'SELECT 1', 'ALTER TABLE student_profiles MODIFY COLUMN previous_school VARCHAR(120) NULL')
);
PREPARE osaah_previous_school_stmt FROM @osaah_previous_school_ddl;
EXECUTE osaah_previous_school_stmt;
DEALLOCATE PREPARE osaah_previous_school_stmt;

SET @osaah_previous_class_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_profiles' AND COLUMN_NAME = 'previous_class'
);
SET @osaah_previous_class_correct = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'student_profiles' AND COLUMN_NAME = 'previous_class'
    AND DATA_TYPE = 'varchar' AND CHARACTER_MAXIMUM_LENGTH = 20 AND IS_NULLABLE = 'YES'
);
SET @osaah_previous_class_ddl = IF(
  @osaah_previous_class_exists = 0,
  'ALTER TABLE student_profiles ADD COLUMN previous_class VARCHAR(20) NULL',
  IF(@osaah_previous_class_correct = 1, 'SELECT 1', 'ALTER TABLE student_profiles MODIFY COLUMN previous_class VARCHAR(20) NULL')
);
PREPARE osaah_previous_class_stmt FROM @osaah_previous_class_ddl;
EXECUTE osaah_previous_class_stmt;
DEALLOCATE PREPARE osaah_previous_class_stmt;
