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

Local Part 2 commit: `5b9ae4c` (`feat(admissions): add existing student migration interface`). It is on `codex/admission-tidb-enrollment`; it has not been pushed, opened as a PR, merged, or deployed.

Local code updates made for Part 2:

- `public/admissions.html` now exposes the three registration categories and an accessible status/result region.
- `public/admissions-workflow.js` wires the already-enrolled category to the existing read-only migration preview and explicit, selected, idempotent migration endpoint. It shows eligible/already-ID/manual-review counts, uses the preview fingerprint, a new stable request key per deliberate operation, and confirmation before applying. Transfer and first-time options explain their required existing review paths and do not call the migration endpoint.
- `src/module-registry.js` makes the existing Admissions navigation item discoverable to Headteacher and Assistant Headteacher, in addition to the existing roles. Backend role checks remain in place.
- `test/admissions-workflow-ui.test.js` covers category presentation, guarded preview/execution contract, leadership navigation roles, and transfer/first-time exclusion from migration.

The existing ID convention is already `OSAAH/YYYY/NNNN`. The existing migration service uses verified `admission_date` year and transactional sequence-row locking, preserves valid IDs, detects duplicate/ambiguous identities and inconsistent profile/enrollment relationships, requires a fresh fingerprint, and writes resumable audit metadata. No ID generator replacement or schema change was made.

Part 2 remains incomplete and release-blocked. The current migration only assigns missing IDs to canonical records that already have a profile and enrollment; it does not register a school-held student absent from those tables or select/create academic placement. The page deliberately identifies this boundary. Transfer and first-time staff-assisted persistence is also not implemented. Health insurance cannot be stored for this migration path until a compatible verified schema field and authorized visibility contract exist. Production evidence says migration 081 is absent and production durable admissions should stay disabled pending schema verification. Do not treat the page as production-ready while its endpoints are disabled or prerequisites are unverified.

Verification after the local changes: `node --test test/admissions-workflow-ui.test.js test/admission-migration-preview.test.js test/admission-migration-service.test.js test/admission-enrollment.test.js test/admission-workflow-validation.test.js test/permanent-student-id.test.js` passed **25/25**; `node --test test/all-role-routing.test.js test/admissions-workflow-ui.test.js` passed **10/10**; `node --check public/admissions-workflow.js` and `git diff --check` completed without errors. `npm test` was attempted across all 60 maintained test files, but three HTTP tests failed in the sandbox (two admission-form HTTP tests and the admission-prospectus HTTP test); the run remained open after those failures and was interrupted, so there is no passing full-suite result. Earlier focused HTTP failures identified localhost connection `EACCES`; re-run the complete suite in an environment that permits local server sockets before release.

## Part 3 audit — end-to-end status (2026-10-11)

The required merged/deployed Parts 1 and 2 could not be verified. Local Part 2 commits are `5b9ae4c` and `9f65733`; branch remains `codex/admission-tidb-enrollment`, ahead of its remote at inspection. GitHub was not queried successfully, and no deployed-commit evidence is available. No real production records were touched.

Local Part 3 verification commit: `d97d0e6` (`fix(admissions): show migrated student identifiers`). It is not pushed, merged, or deployed.

The migration interface now renders the service-returned Permanent Student IDs beside each completed student reference. Its successful scope remains limited to records already present in `students`, with exactly one linked profile and an existing enrollment; it does not satisfy scenario A's missing-software-record registration or class placement.

Parent online applications remain a separate `/admissions/apply` route and separate `/api/admission-applications/*` endpoints. The page collects the existing parent candidate, guardian, document, and optional health-insurance fields; submission requires declaration and school-required documents, and staff review requires an assessment score before acceptance. Internal migration endpoints separately require school portal plus `admissions.review` for preview and `admissions.accept` for execution. These are source-level checks only; sandbox HTTP restrictions prevented live endpoint verification.

However, `src/admission-form.js` stores application drafts in process-local Maps, and `createApplication` always creates a fresh application number. The public form submits a new POST on each submission and has no request idempotency key. Repeated parent submissions can therefore produce duplicate application drafts, and restart durability is not established. The acceptance path returns an already-accepted application on repeated review, but no database-backed end-to-end duplicate/collision behavior was verified. The migration operation itself has request-key/fingerprint idempotency and durable item audit by design, subject to the pending 081 schema.

Role source review confirms Headteacher and Assistant Headteacher hold the same admissions read/review/accept/reject permissions, and the Admissions module is now visible to both; no privilege expansion was made. The server continues to gate ID migration separately. `students.write` direct profile creation is not added to these roles. Student directory/search, class list, attendance, academic results, family links, and fees consume canonical student records through existing modules, but Part 2 does not create/link the missing existing student, and no end-to-end test student was registered to verify those integrations. Fee publication uses class/student scope; no financial or academic records are fabricated by migration.

Part 3 remains incomplete. No verified end-to-end test was run for migration of a school-held student, transfer registration, first-time registration, public retry duplication, simultaneous production ID allocation, downstream module visibility, responsive browser behavior, or production permissions. Local source and unit checks cannot establish production behavior. Durable application persistence/idempotency, safe staff creation and placement for missing system records, migration 081 plus verified schema prerequisites, sandbox-capable HTTP regressions, and actual GitHub/deployment evidence remain blockers. Do not certify, merge, or deploy this workflow until those conditions are met.

Part 3 local verification after showing completed IDs: `node --test --test-name-pattern="official admission form|admission review requires|admission analytics|an injected public admission persistence" test/admission-form.test.js` passed **4/4** selected tests; focused admission/migration/enrollment/ID/UI tests passed **25/25**; `node --check public/admissions-workflow.js` passed. The full regression suite remains without a passing result as recorded above.

## Continuation verification (2026-10-11)

Fetched `origin/main` successfully; its current SHA is `9c9160c957989cf5eee9a39c3b10b319399acda0` (`feat(admissions): add step navigation to application form`, PR #359). `git merge-base --is-ancestor 8d1ad97 origin/main` and the equivalent check for `5b9ae4c` both returned false: neither the local Part 1 implementation nor Part 2 UI commit is in current main. The feature branch is 608 commits behind and 70 ahead of fetched main. Its branch diff spans 47 files, including a substantial separate finance feature; do not open it as a scoped admissions PR or attempt an automatic wholesale merge. The GitHub CLI PR/check API still returned `error connecting to api.github.com`, and no installed GitHub connector was available, so PR state and required checks remain unverified.

Further schema confirmation: the local candidate schema `015_admission_form_fee_engine.sql` defines `admission_form_applications`, but the production inventory cited above did not find that table. Production does have a different `admission_applications` record shape. No verified forward migration maps the public form application's JSON fields/documents/ownership/idempotency contract onto the deployed table, and migration 081's own batch/item tables are also absent. `admission-form.js` remains Map-backed. Therefore a safe multi-instance durable parent implementation cannot be enabled or certified from current evidence. Similarly, the sequence table's production indexes/columns and the complete required student/profile nullability/foreign-key contracts remain unknown. The earlier candidate schema is not sufficient proof to create staff student/enrollment rows on the live database.

The staff UI now hides the existing-student migration category unless `/api/sidebar` confirms school portal role `PROPRIETOR`, `HEADTEACHER`, or `ASSISTANT_HEADTEACHER`; API permission checks remain authoritative. Updated focused command `node --test test/admissions-workflow-ui.test.js test/all-role-routing.test.js test/admission-migration-preview.test.js test/admission-migration-service.test.js test/admission-enrollment.test.js test/admission-workflow-validation.test.js test/permanent-student-id.test.js` passed **32/32**. `node --check public/admissions-workflow.js` passed. Full suite `node --test --test-force-exit test/*.test.js` completed: **468 passed, 44 failed (512 total)**. Failures include sandbox loopback `EACCES` HTTP cases and at least one unrelated transcript teacher-scope failure caused by the already-modified `src/academic-results.js`; this is not a release-passing suite.

Continuation local commit: `976d312` (`fix(admissions): hide migration from unauthorized roles`); not pushed, merged, or deployed.

Production probe: `Invoke-RestMethod -Uri 'https://www.osaahdaylightschool.online/api/release' -Method Get -TimeoutSec 15` failed with `No such host is known`; the browser fetch tool also could not access `/api/release` or `/admissions/apply`. Thus deployed commit, route health, staff operation, and public application behavior were not verified.
