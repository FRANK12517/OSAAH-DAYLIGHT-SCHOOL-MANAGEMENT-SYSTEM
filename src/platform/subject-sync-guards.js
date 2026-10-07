const APPLY_TOKEN = 'APPLY_SUBJECT_CONFIGURATION';
export const AUTHORITATIVE_SCHOOL_ID = 'sch_default_01';
export const AUTHORITATIVE_SCHOOL_NAME = 'Osaahdaylight School';

const fail = (code, message, details = null) => { throw Object.assign(new Error(message), { code, details }); };

/**
 * Normalize only cosmetic presentation differences in the verified school name.
 * Durable identity is always anchored to AUTHORITATIVE_SCHOOL_ID.
 */
export function normalizeSchoolName(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const acceptedSchoolNames = new Set([
  normalizeSchoolName(AUTHORITATIVE_SCHOOL_NAME),
  normalizeSchoolName('Osaah Daylight School')
]);

export function assertAuthoritativeSchoolScope({ requestedSchoolId, schools }) {
  const records = Array.isArray(schools) ? schools : [];
  if (records.length !== 1) {
    fail('SCHOOL_SCOPE_MISMATCH', 'The production database must contain exactly one authoritative school record.', {
      expectedSchoolId: AUTHORITATIVE_SCHOOL_ID,
      recordCount: records.length
    });
  }
  const school = records[0];
  if (String(requestedSchoolId ?? '').trim() !== AUTHORITATIVE_SCHOOL_ID || school.id !== AUTHORITATIVE_SCHOOL_ID) {
    fail('SCHOOL_SCOPE_MISMATCH', 'The requested school is not the authoritative production school.', {
      expectedSchoolId: AUTHORITATIVE_SCHOOL_ID,
      requestedSchoolId: requestedSchoolId ?? null,
      actualSchoolId: school.id ?? null
    });
  }
  if (!acceptedSchoolNames.has(normalizeSchoolName(school.name))) {
    fail('SCHOOL_SCOPE_MISMATCH', 'The authoritative production school name does not match the verified school.', {
      expectedSchoolId: AUTHORITATIVE_SCHOOL_ID,
      expectedNames: [...acceptedSchoolNames],
      actualName: school.name ?? null
    });
  }
  return Object.freeze({ id: AUTHORITATIVE_SCHOOL_ID, name: school.name });
}

export function validateSubjectSyncExecution({ mode, databaseUrl, releaseSha, schoolId, academicYearId, executionToken, backupConfirmation }) {
  if (!['dry-run', 'apply'].includes(mode)) fail('INVALID_MODE', 'Use dry-run or apply.');
  if (!databaseUrl) fail('DATABASE_URL_REQUIRED', 'Protected DATABASE_URL is required.');
  if (!/^[0-9a-f]{40}$/.test(String(releaseSha ?? '').trim())) fail('RELEASE_SHA_REQUIRED', 'RELEASE_SHA must be the exact reviewed lowercase 40-character commit SHA.');
  if (String(schoolId ?? '').trim() !== AUTHORITATIVE_SCHOOL_ID) fail('SCHOOL_SCOPE_MISMATCH', `SCHOOL_ID must be ${AUTHORITATIVE_SCHOOL_ID}.`);
  if (!String(academicYearId ?? '').trim()) fail('SCOPE_REQUIRED', 'ACADEMIC_YEAR_ID is required.');
  if (mode === 'dry-run' && executionToken !== 'DRY_RUN_ONLY') fail('DRY_RUN_TOKEN_REQUIRED', 'Read-only preview requires EXECUTION_TOKEN=DRY_RUN_ONLY.');
  if (mode === 'apply' && executionToken !== APPLY_TOKEN) fail('APPLY_APPROVAL_REQUIRED', `Apply requires ${APPLY_TOKEN}.`);
  if (mode === 'apply' && backupConfirmation !== 'BACKUP_CONFIRMED') fail('BACKUP_CONFIRMATION_REQUIRED', 'A verified recoverable backup is required before apply.');
  return true;
}
