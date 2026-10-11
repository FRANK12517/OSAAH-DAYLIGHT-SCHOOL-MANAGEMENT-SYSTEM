# Admission workflow audit — Part 1

Audit date: 2026-10-11

Repository: `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`

Inspected branch: `codex/admission-tidb-enrollment` at `8d1ad97`
Production evidence reference: [Admission schema reconciliation](ADMISSION_SCHEMA_RECONCILIATION.md)

## Scope and baseline

The checkout was already on a dedicated admission branch, with seven local commits ahead of `origin/codex/admission-tidb-enrollment`. Its worktree contained 12 modified tracked files unrelated to admissions and multiple untracked work/recovery directories. Those changes were preserved. `origin/main` was locally at `b373e12` (`fix(migrations): honor production baseline for Migration 080`); the remote GitHub API could not be reached, so live PR status, latest remote main, checks, and current deployment status were not verified. No PR or production change was attempted.

The focused command `node --test test/admission-form.test.js test/admission-workflow-validation.test.js test/admission-enrollment.test.js test/admission-migration-preview.test.js test/admission-migration-service.test.js` yielded 23 passing and 2 failing tests. Both failures were HTTP tests unable to bind/connect to localhost (`EACCES`) in this sandbox; admission unit tests passed. This is an environment-blocked baseline, not a clean baseline.

## Dashboard findings

| Dashboard | Access and entry | Current workflow finding |
| --- | --- | --- |
| School Proprietor | `/admissions` is registered for `PROPRIETOR`, `SCHOOL_ADMIN`, `ADMISSIONS_OFFICER`; `/admissions` maps to `public/admissions.html`. Proprietor sidebar maps its Admissions item to that same file. | Sees the static enquiry stub (name, parent telephone, requested class) and stage list. New staff APIs and migration are not wired into this screen. Server APIs allow staff validation, preview, migration, and accepted-application enrollment with permission checks. |
| Headteacher | `admissions.read/review/accept/reject` permissions and admission analytics are present; analytics route is registered. No admissions workflow module entry is registered for Headteacher. | Can access leadership analytics/prospectus, but no discoverable application or staff-registration form is registered. Direct page access and API read/write boundaries should be verified as part of UI delivery. |
| Assistant Headteacher | Same admission review/accept/reject/analytics permissions as Headteacher. No Admissions module entry is registered for this role either. | Same gap: relevant capabilities exist in APIs, but there is no admission workflow entry point in the role’s sidebar. |

`src/module-registry.js`, `src/proprietor-sidebar-routes.js`, `src/auth.js`, and `src/server.mjs` define navigation and server authorization. Current internal API routes include `/api/staff-admissions/validate`, `/api/staff-admissions/migration-preview`, `/api/staff-admissions/migration`, and `/api/staff-admissions/register`. Public applications remain on `/admissions/apply` and `/api/admission-form/*`; server guards prevent school-portal users from using the public page and prevent public users from using internal migration APIs.

## Existing data and process

- `src/admission-form.js` is the rich application service: canonical applicant name parts live in its application sections; it supports document upload/review, assessment, decisions, fee snapshots, and public/parent application handling. Its service currently uses process-local `Map` storage unless an enabled persistence adapter is supplied.
- `src/admission-enrollment.js` materializes an accepted durable application into `students`, `student_profiles`, `student_enrollments`, family contacts, parent links, and audit history; it generates permanent IDs and refuses existing-student migration through this new-applicant path.
- `src/admission-migration-preview.js` and `src/admission-migration-service.js` implement a read-only match/preview and explicit, audited, resumable existing-student ID migration. This repairs/migrates records already in canonical student tables; it is not yet a staff registration form for creating a missing system record from school-held identity data.
- `src/admission-form.js` validates `EXISTING_STUDENT`, `TRANSFER`, and `FIRST_TIME`; assessment and document-review acceptance gates apply to transfer/first-time, not already-enrolled migration. `healthInsuranceNumber` is optional and format-checked only when supplied.
- `public/admissions.html` still asks for applicant name under “New Enquiry” and is not connected to the canonical application service. Thus duplicate identity entry is visible at the enquiry/application boundary and workflow records are not unified by that screen.
- Schema history begins in `schema/003_students_admissions.sql` (`admission_applications` with serialized `applicant_data`) and continues through migrations including the student master/profile link (`028` and later candidate contracts). `schema/081_admission_migration_audit.sql` adds migration batch/item audit tables. The current production reconciliation says 081 is absent from the live ledger and must remain pending until prerequisites are verified.
- Permanent ID allocation is in `src/permanent-student-id.js` and the durable allocator in `src/admission-enrollment.js` / migration service. Runtime schema checks fail closed; production sequence-table columns/index and full student-domain constraints remain unverified.

## Duplication, permissions, and unresolved behavior

1. Enquiry name/phone/requested class is a separate static entry surface from the detailed application candidate and guardian fields. The enquiry form has no persistence or canonical link.
2. The public application stores candidate and guardian data as application data; enrollment copies identity and guardian contact into student master/profile/contact/link records. This is a necessary stage projection today, but there is no demonstrated canonical identity ID shared from the public application before enrollment.
3. The static staff enquiry and rich public form do not share one admission record. The durable public form adapter/retry-safe relationship to `admission_applications` is explicitly unresolved in the production reconciliation.
4. Proprietor, Headteacher, and Assistant Headteacher have inconsistent discoverability: leadership roles have review permissions but no Admission sidebar item; proprietor has a placeholder form. Review/approval authority is broad for both head roles and should be retained unless school rules establish a narrower split.
5. Existing migration API is appropriately restricted to school sessions with `admissions.review` for preview and `admissions.accept` plus explicit execute confirmation for writes. Parent/public users cannot access it. Keep this boundary.

## Backward-compatible Part 1 design / handoff

Use a visible category choice in a staff-only admission workspace, with three paths: **Already-Enrolled Student: Migrate into System**, **Transfer Student: Register Transfer**, and **First-Time Student: New Admission**. The first path must collect verified identity, class and academic placement, optional health insurance, and a stable match/reference; it should connect to the migration service where a matching canonical school record exists, and a separately reviewed safe staff-registration transaction is needed where no system record exists. Never reuse the accepted-application enrollment endpoint for this category. Transfer and first-time paths continue through existing application/document/assessment/review gates, preserving the school’s current mandatory application fields.

Replace the static enquiry name with canonical name parts and derive the display name. Persist an enquiry/application identity relationship before copying identity into a student record; maintain a mapping/reconciliation path for historical records, avoid deleting or merging existing rows, and retain audit events. Keep parent online application separate and ensure all three authorized dashboards route to the same role-guarded staff workspace. Add optional health insurance to the staff registration data contract and authorized views only after its schema location and privacy policy are verified.

The implementation is deliberately held at audit/handoff: a staff missing-record enrollment transaction and its durable schema contract are not established, production migration prerequisites remain unresolved, live GitHub/deployment status could not be queried, and the baseline HTTP tests were blocked by sandbox localhost restrictions. Do not deploy or claim Part 1 complete until these are resolved and the new category workflow is implemented and verified. `docs/ADMISSION_SCHEMA_RECONCILIATION.md` contains the production migration evidence and release gates; preserve it with this handoff for Parts 2 and 3.

## Part 2 continuation — local implementation status (2026-10-11)

Part 2's dependency on a merged and deployed Part 1 could not be met: the actual branch is still `codex/admission-tidb-enrollment` at `8d1ad97`, ahead of its remote by seven commits; this is the branch containing Part 1's migration work and audit, not a verified merged/deployed implementation. No production writes, PR creation, merge, or deployment were attempted.

Local code updates made for Part 2:

- `public/admissions.html` now exposes the three registration categories and an accessible status/result region.
- `public/admissions-workflow.js` wires the already-enrolled category to the existing read-only migration preview and explicit, selected, idempotent migration endpoint. It shows eligible/already-ID/manual-review counts, uses the preview fingerprint, a new stable request key per deliberate operation, and confirmation before applying. Transfer and first-time options explain their required existing review paths and do not call the migration endpoint.
- `src/module-registry.js` makes the existing Admissions navigation item discoverable to Headteacher and Assistant Headteacher, in addition to the existing roles. Backend role checks remain in place.
- `test/admissions-workflow-ui.test.js` covers category presentation, guarded preview/execution contract, leadership navigation roles, and transfer/first-time exclusion from migration.

The existing ID convention is already `OSAAH/YYYY/NNNN`. The existing migration service uses verified `admission_date` year and transactional sequence-row locking, preserves valid IDs, detects duplicate/ambiguous identities and inconsistent profile/enrollment relationships, requires a fresh fingerprint, and writes resumable audit metadata. No ID generator replacement or schema change was made.

Part 2 remains incomplete and release-blocked. The current migration only assigns missing IDs to canonical records that already have a profile and enrollment; it does not register a school-held student absent from those tables or select/create academic placement. The page deliberately identifies this boundary. Transfer and first-time staff-assisted persistence is also not implemented. Health insurance cannot be stored for this migration path until a compatible verified schema field and authorized visibility contract exist. Production evidence says migration 081 is absent and production durable admissions should stay disabled pending schema verification. Do not treat the page as production-ready while its endpoints are disabled or prerequisites are unverified.

Verification after the local changes: `node --test test/admissions-workflow-ui.test.js test/admission-migration-preview.test.js test/admission-migration-service.test.js test/admission-enrollment.test.js test/admission-workflow-validation.test.js test/permanent-student-id.test.js` passed **25/25**; `node --test test/all-role-routing.test.js test/admissions-workflow-ui.test.js` passed **10/10**; `node --check public/admissions-workflow.js` and `git diff --check` completed without errors. `npm test` was attempted across all 60 maintained test files, but three HTTP tests failed in the sandbox (two admission-form HTTP tests and the admission-prospectus HTTP test); the run remained open after those failures and was interrupted, so there is no passing full-suite result. Earlier focused HTTP failures identified localhost connection `EACCES`; re-run the complete suite in an environment that permits local server sockets before release.
