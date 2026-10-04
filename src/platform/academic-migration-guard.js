const LEGACY_COMPETING_SCORE_VERSION = 55;
const LEGACY_COMPETING_SCORE_NAME = '055_canonical_academic_scores.sql';
const PROTECTED_RELEASE_VERSIONS = new Set([67, 68]);

/**
 * Enforce academic migration policy at the production execution boundary.
 * Generic migration-runner callers deliberately do not use this function so
 * fixture migrations can exercise transaction/lock behavior with historical
 * version numbers without acquiring production authority.
 */
export function assertProductionAcademicMigrationAllowed(migration, { authorizedMigrationVersion = null } = {}) {
  const version = Number(migration?.version);
  if (version === LEGACY_COMPETING_SCORE_VERSION || migration?.name === LEGACY_COMPETING_SCORE_NAME) {
    throw Object.assign(new Error('Legacy competing academic score migration 055 is blocked; academic_score_records is the authoritative score store.'), {
      code: 'LEGACY_COMPETING_SCORE_STORE_BLOCKED',
      migration: LEGACY_COMPETING_SCORE_NAME
    });
  }
  if (PROTECTED_RELEASE_VERSIONS.has(version) && authorizedMigrationVersion !== version) {
    throw Object.assign(new Error(`Migration ${String(version).padStart(3, '0')} requires its dedicated protected release workflow and explicit authorization.`), {
      code: version === 67 ? 'ACADEMIC_LIFECYCLE_MIGRATION_REQUIRES_PROTECTED_RELEASE' : 'ACADEMIC_SCORE_FOUNDATION_REQUIRES_PROTECTED_RELEASE',
      migration: migration?.name
    });
  }
}
