# Existing Supabase schema reconciliation plan

## Target and evidence

Read-only Supabase inspection on 2026-10-15 confirmed project `douzohkmnuqwbpwcezke` (`OSAAH DAYLIGHT SCHOOL`), region `eu-west-1`, active/healthy, PostgreSQL 17. The owner has explicitly confirmed this exact ref is the intended live production database. No hosted migration or application connection has been attempted. The Supabase tools available to this task expose no backup/PITR inventory or restore-status operation, so recovery readiness is still unverified.

The Supabase migration ledger was empty. The `public` schema had seven base tables, six identity sequences, 18 indexes, no views/materialized views/functions/triggers, and zero rows in each of the seven base tables at the time of the read-only count:

| Existing table | Notable hosted definition | OSAAH baseline conflict |
|---|---|---|
| `users` | `id uuid DEFAULT gen_random_uuid()`; email, full_name, role fields | Baseline uses OSAAH string IDs, school-scoped users and server-managed password/session fields. |
| `classes` | `id integer GENERATED ALWAYS AS IDENTITY`; `class_name`, `section`, `capacity` | Baseline uses string class IDs, school/level relations, and canonical `name`/status fields. |
| `students` | integer identity `id`; text `student_id`; `class_id integer`; `parent_id uuid` | Baseline separates master `students` and `student_profiles`; both identities/links differ. |
| `subjects` | integer identity `id`; `subject_code`, `subject_name`; integer `class_id` | Baseline uses string subject/class IDs and school/department relationships. |
| `attendance` | bigint identity; student/class integer FKs | Baseline uses `student_attendance` and separate student/staff attendance history contracts. |
| `assessments` | bigint identity, integer student/subject FKs, generated total | Baseline uses separate academic score and GES assessment contracts. |
| `fee_payments` | integer identity; `amount_paid`, term/year text, integer student FK | Baseline's runtime Fee Hub contract is `student_fee_payments`, accounts, ledger and receipts. |

These are separate schema contracts, not safe in-place column conversions. The reconciliation migration preserves the original tables, indexes, constraints, and identity sequences together in private schema `osaah_legacy_20261015`; it does not drop them or infer a data mapping. In addition to explicit object/row guards, it now pins a complete catalog signature observed at 2026-10-15 22:33:25 UTC: 56 columns, 32 constraints, 18 indexes, six owned sequences, three RLS policies, 222 direct relation/sequence ACL entries, and 13 public relations. The signature covers column types/nullability/defaults/identity/generated expressions; constraint definitions and validation state; full index definitions; sequence settings and ownership; relation owners and RLS flags; policies; grants; and catalog dependencies. Any mismatch aborts before archive creation. The observed row counts were zero for each starter table and are checked again immediately before moving objects.

## Security findings

All seven existing tables had RLS enabled. The roles `anon`, `authenticated`, and `service_role` had direct table grants for the inspected tables. `service_role` has `BYPASSRLS`; the other two do not. Existing RLS policies were exactly three `SELECT USING (true)` policies on `classes`, `students`, and `subjects`, applying to `PUBLIC`. Since `anon` and `authenticated` also have table `SELECT`, they can read rows in those three tables while the policies exist. The four other tables had no policies, so RLS denies their rows despite the grants. The row-count query returned zero for these tables during inspection.

The migration removes those three broad policies from the archived tables, revokes API-role/public access to the archive, and keeps the archive schema outside the app's public API. The canonical baseline enables RLS on the new 159 public tables, revokes browser-role access to application tables/views/sequences, grants only `schools` `SELECT` under the `sch_default_01` policy, and grants the existing server-only `service_role` access. It does not connect Supabase Auth identities to OSAAH users; existing signed-cookie sessions and server RBAC remain authoritative.

## Migration behavior and execution gates

`supabase/migrations/202610150002_reconcile_existing_supabase.sql` is generated from the canonical baseline and the read-only starter-schema inspection. It:

1. Requires the Supabase-managed `anon`, `authenticated`, and `service_role` roles; requires `service_role BYPASSRLS`.
2. Asserts exact hosted fingerprints of all seven tables' columns, constraints, indexes, sequence settings/ownership, direct grants, relation RLS/ownership, policies, and catalog dependencies; also asserts exact seven-table and six-sequence inventories and absence of views, routines, triggers, foreign/materialized/partitioned relations, and external FKs.
3. Aborts if any existing starter table contains data or if the private archive schema already exists.
4. Moves the seven existing tables intact to `osaah_legacy_20261015`, which also moves their indexes and owned sequences; removes the three public-read policies and API-role access from that private archive.
5. Creates the 159-table OSAAH baseline, six views, constraints/indexes, RLS, backend grants, and the idempotent `sch_default_01` school row.

The migration is transactional. A preflight failure makes no changes. A second run stops at the archive-schema precondition; do not bypass it. Keep the archive until the owner has approved a separate disposal decision. The migration is not a TiDB data importer and no school business records are fabricated or transferred.

Before execution, verify a restorable recovery point as below and refresh the read-only catalog and row counts. The project owner has already confirmed the target ref and production classification. Apply the reconciliation file `supabase/migrations/202610150002_reconcile_existing_supabase.sql` via the Supabase Dashboard SQL Editor **only after the recovery evidence is recorded**. Verify the Dashboard project ref is `douzohkmnuqwbpwcezke`, open **SQL Editor**, create a new query, paste the complete reviewed file, inspect the transaction and preflight again, then click **Run** once. This SQL file is itself the prepared production migration command; the local runner intentionally rejects all remote database hosts. If an error occurs, stop and inspect the transaction result and catalog before any retry. After commit, run the read-only checks in `docs/supabase-migration-validation.sql` in the same project's SQL Editor. The migration transaction archives (does not drop/truncate) the starter tables. Manual SQL Editor execution does not by itself prove Supabase CLI migration history is synchronized; inspect and reconcile that history before any later CLI push rather than rerunning this migration.

After application, run the read-only checks in `docs/supabase-migration-validation.sql`; expected counts are 159 base tables, six views, 448 foreign keys, all public tables with RLS enabled, and seven archived starter tables with no client grants/policies. Verify the required auth objects, school seed, service-role access and no client access to private records. Then execute authenticated application workflow checks against a distinct approved non-production clone before any application cutover. No TiDB data export/import is currently available, so the SQL migration alone installs schema but does not transfer business records.

## Unresolved gates

- The project is confirmed as production; its recovery state has not been verified.
- No source TiDB schema/data snapshot, export, or reconciliation is available; production school records have not been transferred.
- Hosted SQL was not executed; hosted post-migration RLS tests and runtime application workflows have not run.
- Read-only Vercel follow-up verified the existing production deployment/domain and listed variable names without reading values. Production contains both `DATABASE_URL` and `OSAAH_POSTGRES_URL`; Preview has no `OSAAH_POSTGRES_URL`. Application runtime now treats `OSAAH_POSTGRES_URL` as authoritative, logs only a value-free notice when a different legacy `DATABASE_URL` is present, and never falls back to it. Remove obsolete `DATABASE_URL` from Vercel Production after confirming no separately classified maintenance workflow depends on it. Configure Preview only with a distinct non-production Supabase URL; do not copy Production credentials. No Vercel settings were changed. A non-production Preview database target still needs owner confirmation and connection configuration.
- Physical TiDB retirement is not approved and must wait until production use of PostgreSQL and rollback readiness are proven.

## Recovery gate and exact Dashboard action

The project owner must provide a restorable pre-change recovery record for `douzohkmnuqwbpwcezke` before anyone runs the reconciliation SQL. Available Supabase product documentation describes daily backups for eligible paid plans in **Database > Backups** and PITR in **Database > Backups > Point in Time**; PITR is an add-on and Supabase requires at least a Small compute add-on. Project metadata/read-only SQL does not reveal plan, backup retention, earliest/latest restore point, or successful restoration, and no connected tool here exposes those details. See [Supabase Database Backups and PITR](https://supabase.com/docs/guides/platform/backups).

1. In Supabase Dashboard, select project ref `douzohkmnuqwbpwcezke`, then open **Database > Backups**. Confirm an available backup predates the change and that the dashboard offers restoration for it; or open **Database > Backups > Point in Time** and confirm a recovery point timestamp before the change is selectable. Do not start a restore.
2. If neither exists, check **Settings > Add-ons** for PITR eligibility, enable PITR (and the required Small compute add-on if needed), then return to **Database > Backups > Point in Time** and wait until the displayed recovery window includes an available point. If the plan/add-on prevents this, create an off-project logical backup and validate that it can be restored to a disposable PostgreSQL database before treating it as recovery evidence.
3. Record the exact project ref/region, the available restore point timestamp, dashboard availability/restore status (or a successful test restore on a disposable database from a logical backup), and the named operator authorized to initiate recovery. A plan name, enabled toggle, or backup-retention setting alone is insufficient.
4. Immediately before apply, repeat the read-only catalog and per-table row-count inspection. The migration repeats exact-signature and empty-table checks. Any drift, data, or dependency stops execution for separate review.

## Preview and workflow rehearsal checklist

After schema execution is approved and validated on non-production, configure only the Vercel Preview environment with a server-only `OSAAH_POSTGRES_URL` for that non-production Supabase database. When the Supabase database certificate is not trusted by the Node runtime, download the project's root certificate from Supabase **Database Settings > SSL Configuration** and set it as server-only `OSAAH_PG_SSL_CA` in Vercel Preview. The PostgreSQL adapter passes that CA to `pg` while retaining `rejectUnauthorized: true` and hostname verification; do not set `NODE_TLS_REJECT_UNAUTHORIZED=0` or any equivalent bypass. Never put database URLs, CA configuration, or service-role API keys in browser bundles, `NEXT_PUBLIC_*`, or logs. Keep Production variables untouched. Record the Vercel project/team, Preview deployment URL and commit SHA, database project ref, and a redacted confirmation that the app reports PostgreSQL adapter health. Confirm no runtime code path selects TiDB/MySQL; legacy `mysql2` tools remain separate maintenance utilities.

Run the nine isolated synthetic workflow checks against that Preview database and record request/response evidence, row-level authorization outcomes, and cleanup for each: (1) staff authentication/session lifecycle, (2) admissions/enrollment, (3) student profiles and parent-child authorization, (4) student/staff attendance, (5) terminal results, (6) JHS mock results, (7) Fee Hub, (8) payment/receipt issuance and parent receipt authorization, and (9) finance totals. Use non-production synthetic fixtures only; reconcile any created fixture identifiers and verify cleanup afterward. Include role-denial checks for unrelated parents and unauthorized staff. PGlite/local PostgreSQL checks are not evidence of hosted Preview success.
