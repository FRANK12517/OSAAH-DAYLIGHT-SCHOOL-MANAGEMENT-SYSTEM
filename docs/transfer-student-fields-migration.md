# Transfer student fields migration (TiDB)

Migration `086_transfer_student_previous_class.sql` adds or normalizes nullable
`student_profiles.previous_school VARCHAR(120)` and
`student_profiles.previous_class VARCHAR(20)`. It checks `INFORMATION_SCHEMA`
before choosing the `ADD COLUMN` or `MODIFY COLUMN` statement, so rerunning it
does not duplicate columns.

## Production procedure

Do not run the migration until a protected backup has completed and the
preflight confirms that narrowing existing values will not truncate data.
Use the TiDB production connection through the approved secret store; do not
place credentials in shell history or commit them.

1. Confirm `SELECT DATABASE()` returns `osaahdaylightschool` and inspect the
   `student_profiles` column definitions.
2. Inspect the live column list first. Run the relevant length query only when
   that column already exists; a missing column has no existing values to
   check and will be added by migration 086. Check existing values that exceed
   the target widths:

   ```sql
   SELECT
     SUM(CHAR_LENGTH(previous_school) > 120) AS previous_school_over_limit,
     MAX(CHAR_LENGTH(previous_school)) AS previous_school_max_length
   FROM student_profiles;

   SELECT
     SUM(CHAR_LENGTH(previous_class) > 20) AS previous_class_over_limit,
     MAX(CHAR_LENGTH(previous_class)) AS previous_class_max_length
   FROM student_profiles;
   ```

   If either over-limit count is nonzero, stop and reconcile those values
   without truncation before applying migration 086.
3. Back up the profile table to the approved encrypted backup location and
   verify that the dump is readable and its recorded row count matches the
   source table. Example (use the organization's protected MySQL option file
   and secure backup path):

   ```sh
   mysqldump --defaults-extra-file=/secure/path/tidb.cnf --single-transaction --quick \
     osaahdaylightschool student_profiles > /secure/backup/student_profiles-before-086.sql
   ```
4. Apply the migration using the repository migration runner with a truthful
   production baseline and its required release verification, or execute the
   SQL file as one session so its prepared statements share the same TiDB
   connection.
5. Verify both columns are nullable with the requested type and width, and
   confirm registration/profile reads return the values.

## Current execution status

The migration is prepared but has not been applied to production. This
workspace has no usable TiDB connection, and the linked Vercel project
reported no Production environment variables. Therefore the production
schema, backup, DDL output, and post-migration state remain unverified.
