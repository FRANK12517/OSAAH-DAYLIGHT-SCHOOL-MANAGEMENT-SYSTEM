# OSAAH Supabase 12-table schema reconciliation audit

Status: **BLOCKED before migration authoring or hosted validation**

Baseline: `d21c584b45244e58b152b5924ce8140c5be35896`\
Audit target: Supabase project `douzohkmnuqwbpwcezke` (Production)\
Scope: read-only comparison; no database or Vercel changes were made.

## Evidence available

The owner-provided read-only catalog results report PostgreSQL 17.11, twelve public base tables, and no `public.schema_migrations` relation. Aggregate counts at the time of inspection were six `users`, six `roles`, six `user_roles`, and zero rows in each of `assessments`, `attendance`, `auth_sessions`, `classes`, `fee_payments`, `permissions`, `role_permissions`, `students`, and `subjects`.

The reported `public.users` columns are `id`, `email`, `full_name`, `role`, `phone_number`, `is_active`, `created_at`, and `updated_at`. Reported columns for other relevant tables are:

| Table | Reported columns |
|---|---|
| `roles` | `id`, `name`, `description`, `created_at` |
| `permissions` | `id`, `name`, `description`, `created_at` |
| `user_roles` | `id`, `user_id`, `role_id`, `created_at` |
| `role_permissions` | `id`, `role_id`, `permission_id`, `created_at` |
| `auth_sessions` | `id`, `user_id`, `token_hash`, `expires_at`, `created_at` |

Read-only `EXPLAIN` results against the hosted database showed the staff authentication statement fails with SQLSTATE `42703` because `users.school_id` is absent. The parent lookup fails with SQLSTATE `42P01` because `public.parent_student_links` is absent. Those reproduce schema errors; they do not establish that either error is the same underlying cause as an earlier generic application `XX000` event.

The available counts and column lists are partial catalog evidence, not a complete schema dump. No database credentials, connection string, personal records, or authentication secrets are included here.

## Required application contract

`src/auth.js` staff login selects and joins:

- `users.id`, `school_id`, `username`, `email`, `password_hash`, and `status`;
- `user_roles.user_id` and `role_id`;
- `roles.id`, `role_key`, and `oversight_rank`;
- `role_permissions.role_id` and `permission_id`;
- `permissions.id` and `permission_key`.

It filters to active users and uses role keys and oversight rank to resolve authorization and dashboard routing. Durable session restoration additionally uses `auth_sessions.school_id`, `revoked_at`, and `last_used_at`, alongside `token_hash`, `user_id`, and `expires_at`.

Parent login joins `users`, `user_roles`, `roles`, and `parent_student_links`. It expects `school_id`, `username`/`email`, `status`, `role_key`, `parent_user_id`, `telephone`, and `link_status`. Child authorization relies on the parent-to-student relationship; an empty link table would not restore access to any child.

The canonical baseline migration defines string identifiers and a broader OSAAH data model (including `schools`, staff/role/permission objects, `parent_student_links`, and durable sessions). The existing `202610150002_reconcile_existing_supabase.sql` is pinned to a different seven-table, empty starter catalog. Its exact table-set, object-signature, and empty-row preconditions do not match the reported twelve-table database and populated authentication tables. It must not be run on this target.

## Gap assessment

| Area | Observed | Required / canonical | Assessment |
|---|---|---|---|
| Staff identity | Six users; `users` has no reported `school_id`, `username`, `password_hash`, or `status` | School scope, login identity, credential hash, active status | Confirmed schema incompatibility. Existing `email`, `role`, and `is_active` could inform a reviewed mapping, but cannot supply credential hashes or prove role semantics. |
| Roles and permissions | Six roles and six assignments; reported columns use `name`, not canonical role/permission keys | Canonical role key/rank and permission key, preserving assignment relationships | Incompatible names and populated records. Actual role labels/IDs and assignment relationships have not been reviewed in this audit; do not infer mappings. |
| Sessions | Empty `auth_sessions`; reported schema lacks school/revocation/last-use fields | Durable sessions scoped to user and school, with revocation and expiry | Required columns/indexes/constraints must be reconciled. Existing rows were zero at the reported count, but catalog definitions and grants remain to be verified. |
| Parent Portal | No `parent_student_links` table; `students` count zero | Explicit parent-to-student relationship and authorized lookup | Confirmed missing relation. Creating an empty relationship table alone does not make parent authentication/data access operational. |
| Other school workflows | Nine listed non-auth tables were empty at count time; twelve-table inventory includes only a subset of canonical application tables | Full canonical schema supports admissions, fees, attendance, results, reporting, and other features | The 12-table catalog is not the full OSAAH schema. The reported empty counts do not prove that authoritative records are absent from TiDB or backups. |
| Migration history | No `public.schema_migrations` relation reported | A reviewed migration history and controlled rollout | No ledger evidence. Do not mark an existing migration applied or rerun baseline files based on assumptions. |
| Constraints/security | Partial grants/RLS observations exist in earlier audits, but no complete catalog export is attached to this phase | Reviewed FK/unique/index/RLS/grant contract with server-only access | Full live object inventory and effective runtime role remain prerequisites to migration approval. |

## Why an executable migration is not included

The six existing users have no reported `password_hash` field. A schema change cannot reconstruct valid password hashes. Copying accounts into canonical `users` with a null hash would preserve identities but would not make them authenticatable; inventing credentials or hashes would violate the security requirements. A reviewed credential reset/enrollment procedure is required.

The six populated role rows and assignments need explicit, semantically correct canonical role-key mappings. The current evidence contains neither the role labels/IDs nor an approved mapping to the application's role catalog. Guessing from `roles.name` or `users.role` could grant the wrong permissions. The existing `permissions` and `role_permissions` counts are empty, so current effective authorization would also require an approved role-permission provisioning plan; do not silently substitute hard-coded grants.

The exact types, constraints, indexes, RLS policies, triggers, ownership, grants, and dependencies for all twelve current tables have not been captured in the evidence available to this worktree. Those details determine whether existing identifiers can be preserved as-is or whether a copy into canonical tables is needed. A generic rename, `ALTER COLUMN TYPE`, table archive, or canonical baseline rerun could break existing foreign keys or change security behavior.

For those reasons, this phase intentionally does not ship a migration that merely adds columns or creates an empty parent-link table while leaving the remaining application contract unsatisfied. Such a partial migration could appear successful while authentication and workflows remain broken.

## Required evidence and decisions before migration authoring

1. Run a fresh, read-only catalog export for the intended project ref: all columns with exact types/defaults/nullability; primary/unique/foreign/check constraints; indexes; sequences; views/functions/triggers; owners; RLS flags and policies; table/sequence grants; and dependencies for all twelve public tables.
2. Confirm current aggregate row counts again immediately before planning. For roles, return only role labels plus assignment counts, and a non-personal mapping of source role IDs to approved canonical role keys. Do not export user rows or credentials.
3. Approve how the six existing user accounts regain credentials without weakening authentication (for example, an established secure password-reset process). Never generate or log temporary credentials in a migration.
4. Confirm whether existing `user_roles` assignments map to the eight OSAAH runtime roles and which canonical permissions should be assigned. Require an owner-reviewed mapping; do not infer it from table names.
5. Determine authoritative school-data source and obtain a verified, restorable recovery point. Current evidence does not establish TiDB contents, backups, or a successful restore.
6. Provision a separate non-Production Supabase database with a confirmed project reference and verified TLS. The current target is identified as Production; it is not an acceptable migration test target.
7. Use the resulting exact catalog and approved mapping manifest to author a one-time transactional migration with preflight fingerprints, data-preservation assertions, post-validation, and rollback instructions. Test it against an isolated reproduction of the exact 12-table schema before requesting a hosted Preview rehearsal.

## Validation status

- Hosted read-only `EXPLAIN`: confirms missing `users.school_id` (`42703`) and missing `parent_student_links` (`42P01`).
- Hosted migration: **not run**.
- Isolated hosted test database: **not available/verified in this phase**.
- The isolated worktree initially lacked the original worktree's narrow trailing-literal-`\\n` correction in the baseline migration. I applied that same two-line removal locally in this worktree because the focused PGlite suite otherwise stopped at SQLSTATE `42601`; the original worktree file was not edited. With the corrected local baseline, the seven focused authentication, session, PostgreSQL adapter, and PGlite files passed **42/42** using loopback access. These are local tests only; they do not connect to hosted Supabase and do not validate the reported twelve-table starting schema.
- `npm run test:supabase`: **26/26 passed** after making the reconciliation test normalize CRLF line endings before locating the migration's SQL block. This is local PGlite/CLI validation; it does not test the hosted 12-table schema.
- `node scripts/validate-supabase-migration.mjs`: passed static validation (159 tables, six views, 448 foreign-key references, RLS enablement present).
- No Preview login/session/RBAC test against Supabase was performed.

## Release decision

**BLOCKED.** The schema failure is demonstrated, but there is not enough verified schema and mapping evidence to produce or validate a safe data-preserving upgrade. No database, Vercel configuration, or deployment was changed. Do not run either existing migration against the current hosted target.
