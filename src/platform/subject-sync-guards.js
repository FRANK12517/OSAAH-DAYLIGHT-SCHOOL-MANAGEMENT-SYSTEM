const APPLY_TOKEN = 'APPLY_SUBJECT_CONFIGURATION';
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

export function validateSubjectSyncExecution({ mode, databaseUrl, releaseSha, schoolId, academicYearId, executionToken, backupConfirmation }) {
  if (!['dry-run', 'apply'].includes(mode)) fail('INVALID_MODE', 'Use dry-run or apply.');
  if (!databaseUrl) fail('DATABASE_URL_REQUIRED', 'Protected DATABASE_URL is required.');
  if (!/^[0-9a-f]{40}$/.test(String(releaseSha ?? '').trim())) fail('RELEASE_SHA_REQUIRED', 'RELEASE_SHA must be the exact reviewed lowercase 40-character commit SHA.');
  if (!String(schoolId ?? '').trim() || !String(academicYearId ?? '').trim()) fail('SCOPE_REQUIRED', 'SCHOOL_ID and ACADEMIC_YEAR_ID are required.');
  if (mode === 'dry-run' && executionToken !== 'DRY_RUN_ONLY') fail('DRY_RUN_TOKEN_REQUIRED', 'Read-only preview requires EXECUTION_TOKEN=DRY_RUN_ONLY.');
  if (mode === 'apply' && executionToken !== APPLY_TOKEN) fail('APPLY_APPROVAL_REQUIRED', `Apply requires ${APPLY_TOKEN}.`);
  if (mode === 'apply' && backupConfirmation !== 'BACKUP_CONFIRMED') fail('BACKUP_CONFIRMATION_REQUIRED', 'A verified recoverable backup is required before apply.');
  return true;
}
