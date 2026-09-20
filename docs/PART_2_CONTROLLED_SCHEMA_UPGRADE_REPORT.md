# OSAAH Daylight School Complex
## Part 2 Controlled Database Schema Upgrade Report

**Audit and implementation date:** 2026-09-20  
**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`  
**Branch:** `main`  
**Base commit:** `cf1ce5e`  
**Scope:** Part 2 only. No production migration was applied.

## Part 2 status

**Repository implementation: PASS. Production application: NOT RUN.**

Part 2 adds one controlled, additive migration and the associated validation coverage. It preserves the Part 1 report, the existing authentication services, the existing class service, and the existing Fee Hub architecture. No production database connection was available in this sandbox, so live schema inspection, row-level orphan checks, migration status, and migration application remain blocked until the deployment database adapter and credentials are supplied through the approved secret configuration.

## 1. Migrations created

### `schema/031_controlled_schema_upgrade.sql`

The migration is deterministic and forward-only. It does not drop, truncate, delete, rename, or change an existing primary-key type. It performs the following additive operations:

1. Upserts the canonical school-scoped role rows for `PROPRIETOR`, `SCHOOL_ADMIN`, `HEADTEACHER`, `ASSISTANT_HEADTEACHER`, `ACCOUNTANT_BURSAR`, and `TEACHER`.
2. Adds school/status and role-resolution indexes to the existing `users`, `user_roles`, and `roles` tables.
3. Creates the missing `student_enrollments` relationship used by the existing enrollment repository, retaining historical class and academic-year records.
4. Creates `class_label_aliases` for verified display-label mappings without inserting duplicate rows into `classes`.
5. Adds lookup indexes for class ordering and fee obligation targeting.

The migration contains no production user seed, password data, student copy, class copy, fee copy, payment copy, receipt copy, or audit rewrite.

## 2. Tables modified

No production table was modified during this implementation because the migration was not applied.

If applied through the controlled migration runner, the intended additive effects are:

| Table or object | Planned effect |
|---|---|
| `roles` | Upsert canonical role metadata per school using the existing role architecture. |
| `users` | Add a school/status lookup index only. |
| `user_roles` | Add a role/user lookup index only. |
| `student_enrollments` | Create if absent, because the existing enrollment repository already writes this relationship. Existing rows are preserved. |
| `class_label_aliases` | Create a metadata table for verified display aliases. No class identities are copied. |
| `classes` | Add a level/order lookup index only. |
| `fee_obligations` | Add school/target/period and school/structure/period lookup indexes only. |

## 3. Columns modified

**None.** No existing column definition, primary-key type, foreign-key type, password field, student identifier, fee amount field, or school relationship was altered.

The only new columns are in the newly created `student_enrollments` and `class_label_aliases` tables. They are additive and are not backfilled by this migration.

## 4. Foreign keys modified

No existing foreign key was dropped or changed.

The newly created `student_enrollments` table declares relationships to the existing `students`, `classes`, `academic_years`, and `terms` tables. This makes the relationship already used by `src/admission-enrollment.js` explicit while preserving class and academic-year history.

The `class_label_aliases` table intentionally does not add a new competing class table or force an unknown production key type. Its `school_id` and `class_id` values are compatibility metadata that will be populated only after Part 3 verifies the live canonical identifiers.

Because no live database was available, the deployed database’s actual foreign-key metadata and type compatibility remain unverified. The production migration must therefore run the approved read-only preflight before applying migration 031.

## 5. Indexes modified

The migration adds these indexes:

- `idx_users_school_status` on `users(school_id, status)`.
- `idx_user_roles_role_user` on `user_roles(role_id, user_id)`.
- `idx_roles_school_key` on `roles(school_id, role_key)`.
- `idx_student_enrollments_scope` on `student_enrollments(academic_year_id, class_id, student_id)`.
- `idx_student_enrollments_student` on `student_enrollments(student_id, academic_year_id)`.
- `idx_class_label_alias_class` on `class_label_aliases(class_id)`.
- `idx_class_label_alias_school` on `class_label_aliases(school_id)`.
- `idx_classes_level_order` on `classes(level_id, display_order, id)`.
- `idx_fee_obligations_target_period` on `fee_obligations(school_id, applicability_type, class_id, academic_year_id, term_id)`.
- `idx_fee_obligations_structure_period` on `fee_obligations(school_id, fee_structure_id, academic_year_id, term_id)`.

All are declared with `IF NOT EXISTS` where supported by the existing migration style.

## 6. Data migrated

**No production data was migrated.** No database connection or migration apply command was available in this sandbox.

The migration does not copy or rewrite existing users, staff, students, Permanent Student IDs, admissions, enrollments, classes, academic years, terms, results, attendance, fees, payments, receipts, balances, parent relationships, communications, or audit records.

The only data-writing statement is an idempotent role metadata upsert. It creates or updates canonical role labels and oversight ranks for existing schools. It does not create users, staff, user-role assignments, passwords, or permissions for individual people. Part 3 will validate actual user assignments and authentication behavior.

## 7. Class architecture status

**Status: PREPARED; live identity mapping BLOCKED.**

The migration retains the existing `classes` table as the sole class identity source. It does not insert `Basic 1` through `Basic 6` rows and does not copy legacy `Primary` rows. The new `class_label_aliases` table exists only to support a verified presentation mapping such as `Primary 1` → `Basic 1` while preserving one stable class ID.

The required canonical sequence remains:

`Nursery 1`, `Nursery 2`, `KG 1`, `KG 2`, `Basic 1` through `Basic 6`, `JHS 1`, `JHS 2`, and `JHS 3`.

Production class IDs, existing `Primary` records, school scope, and academic-year relationships must be inventoried before aliases are populated. No duplicate class architecture was created.

## 8. User and role schema status

**Status: PREPARED; authentication restoration deferred to Part 3.**

The migration uses the existing `schools → users → user_roles → roles → permissions` architecture. It adds the required canonical role metadata without creating a second role system. It does not insert individual users, passwords, staff records, or user-role assignments.

Canonical application role keys prepared by the migration are:

- `PROPRIETOR`
- `SCHOOL_ADMIN`
- `HEADTEACHER`
- `ASSISTANT_HEADTEACHER`
- `ACCOUNTANT_BURSAR`
- `TEACHER`

Legacy display labels such as Administrator and Accountant must be mapped to these application identifiers during Part 3 authentication restoration. Email addresses are not used as role identifiers.

Existing Proprietor compatibility is preserved. The separate proprietor controller was not replaced, and no temporary second login architecture was created.

## 9. Fee schema status

**Status: PREPARED; live relationship validation BLOCKED.**

The existing `fee_obligations` table remains the Fee Hub obligation source. The migration adds indexes for school, target type, class, academic year, term, and fee structure lookups. It does not create a parallel fee-definition table and does not copy one new fee definition for every student.

The repository’s current publication flow explicitly resolves eligible students and creates obligations for them. This migration does not alter that behavior. Whole-school and specific-class targets remain represented through the existing `applicability_type` and `class_id` fields, with student-level obligations produced by the existing canonical repository where required for parent visibility and balance calculations.

The Fee Hub routes now sanitize exceptions from database-backed obligation and collection repositories. Browser clients receive safe responses such as `Fee service is temporarily unavailable.` instead of raw SQL errors, usernames, passwords, connection strings, internal hostnames, or stack traces. Server-side diagnostics remain available through controlled logging paths, but no secret-bearing diagnostic was added.

## 10. Data-integrity checks

### Completed locally

The repository checks confirm that:

- migration 031 is discovered in numeric order;
- the migration inventory contains 30 uniquely versioned SQL files;
- the migration contains no executable `DROP`, `TRUNCATE`, `DELETE`, or `RENAME` statement;
- no class or class-level rows are seeded by the migration;
- no users or staff are hard-coded into the migration;
- canonical role identifiers are present;
- the migration uses the existing class and fee tables rather than creating parallel architectures;
- repository whitespace validation passes.

### Blocked pending production connection

The following checks could not be executed against production:

- `INFORMATION_SCHEMA` table and column inventory;
- `SHOW CREATE TABLE` validation;
- primary-key and foreign-key type comparison against deployed tables;
- applied migration history and checksum status;
- orphaned user, staff, student, enrollment, class, fee, payment, parent-link, and audit record queries;
- school-scope leakage checks against production rows;
- production dry-run and migration apply.

The controlled production procedure must run those read-only checks and stop if any existing orphan or key-type incompatibility is found.

## 11. Test results

| Check | Result |
|---|---|
| `npm run migration:validate` | **PASS** — 30 migrations discovered. |
| `npm run assets:verify` | **PASS** — protected login assets verified. |
| Part 2 schema-upgrade tests | **PASS**. |
| Migration runner tests | **PASS**. |
| Proprietor authentication tests | **PASS**. |
| Fee collection API tests | **PASS**. |
| Full `npm test` | **PASS** — 622 tests passed, 0 failed. |
| `git diff --check` | **PASS**. |
| Production migration apply | **NOT RUN** — no durable database adapter/credentials configured. |
| Production schema and orphan checks | **BLOCKED** — no live database connection available. |

## 12. Branch

`main`

## 13. Commit

No commit was created. The implementation is present as a working tree change based on commit `cf1ce5e`.

## 14. Files changed

- `schema/031_controlled_schema_upgrade.sql`
- `src/server.mjs`
- `test/part2-schema-upgrade.test.js`
- `test/ai-production-acceptance.test.js`
- `docs/PART_1_FORENSIC_AUDIT_REPORT.md` — preserved from Part 1
- `docs/PART_2_CONTROLLED_SCHEMA_UPGRADE_REPORT.md`

## Required confirmations

- **No production data was intentionally deleted.** No production migration was applied and no destructive database command was run.
- **No duplicate authentication architecture was created.** The existing authentication services were preserved; Part 3 login restoration was not implemented.
- **No duplicate class architecture was created.** Existing `classes` remains canonical; `class_label_aliases` stores only future verified display metadata.
- **Existing Proprietor compatibility was preserved.** The proprietor controller, bcrypt verification path, and current session architecture were not replaced.

## Stop condition

Part 2 is complete at the repository level and validated locally. Parts 3–5 were not implemented. The next authorized phase is Part 3 staff authentication restoration and comprehensive validation after production schema preflight and migration status verification.

## References

[1]: `schema/031_controlled_schema_upgrade.sql` "Part 2 controlled additive schema migration"

[2]: `src/server.mjs` "Application wiring, Fee Hub routes, and safe database error responses"

[3]: `src/admission-enrollment.js` "Existing enrollment repository contract"

[4]: `src/parent-fee-obligations-repository.js` "Parent Fee Hub visibility query contract"

[5]: `src/fee-collections-repository.js` "Fee obligations and collection persistence contract"

[6]: `test/part2-schema-upgrade.test.js` "Part 2 migration safety and contract tests"

[7]: `test/ai-production-acceptance.test.js` "Repository-wide migration acceptance test"

[8]: `docs/PART_1_FORENSIC_AUDIT_REPORT.md` "Verified Part 1 forensic findings"

[9]: `docs/PRODUCTION_MIGRATIONS.md` "Controlled production migration runbook"
