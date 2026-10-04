const LEGACY_COMPETING_SCORE_VERSION = 55;
const LEGACY_COMPETING_SCORE_NAME = '055_canonical_academic_scores.sql';

export function assertSafeAcademicMigration(migration, { allowAcademicLifecycleMigration = false } = {}) {
  if (Number(migration?.version) === LEGACY_COMPETING_SCORE_VERSION || migration?.name === LEGACY_COMPETING_SCORE_NAME) {
    throw Object.assign(new Error('Legacy competing academic score migration 055 is blocked; academic_score_records is the authoritative score store.'), {
      code: 'LEGACY_COMPETING_SCORE_STORE_BLOCKED',
      migration: LEGACY_COMPETING_SCORE_NAME
    });
  }
  if (Number(migration?.version) === 67 && !allowAcademicLifecycleMigration) {
    throw Object.assign(new Error('Migration 067 requires its dedicated protected release workflow and explicit authorization.'), {
      code: 'ACADEMIC_LIFECYCLE_MIGRATION_REQUIRES_PROTECTED_RELEASE',
      migration: migration?.name
    });
  }
}
