# Admission Workflow Protection Baseline

Baseline recorded against merged `main` commit `be7c15c585cb4fc0f68ee26854364eb922160678` on 2026-10-11.

## Repository and release state

- PR #366 (`codex/admission-class-validation`) is already merged into `main` at the commit above. The merged fix preserves a class's canonical ID in workflow metadata while sending the display label to the legacy application validator.
- The previous release audit recorded a successful Vercel production deployment for this exact commit (deployment ID `6997482041`). Production URL: <https://www.osaahdaylightschool.online>.
- `origin/main` resolves to the merged commit. The working checkout initially pointed at the PR head (`865fefd3add581898258b55d4976d9640a4cd44f`) and was one commit behind `origin/main`; no untracked files were present.
- Two pre-existing edits were present and remain unmodified and unstaged: `docs/OSAAH_SIDEBAR_REPAIR_PART29_RELEASE_GATE_REPORT.md` and `docs/role-sidebar-route-audit.json`.
- A fresh GitHub/Vercel metadata query was unavailable during this audit: GitHub CLI could not connect to GitHub, and the Vercel CLI is not installed. Release details above are from the prior successful release verification and local Git refs.

## Admission entry, navigation, and permissions

- `src/module-registry.js` registers `admissions` as **Admission / Admissions Workflow** in **STUDENTS MANAGEMENT** at `/admissions`, requiring `admissions.read`. The module allows PROPRIETOR, SCHOOL_ADMIN, HEADTEACHER, ASSISTANT_HEADTEACHER, and ADMISSIONS_OFFICER.
- `src/sidebar-registry.js` and `public/app.js` render the role-filtered sidebar and route navigation. `src/server.mjs` serves `/admissions` through the authenticated dashboard shell and checks authentication and route access.
- `src/auth.js` defines role permissions. HEADTEACHER and ASSISTANT_HEADTEACHER receive `admissions.write` in addition to review/decision permissions; the server independently checks permissions for admission API operations.
- The production browser was previously verified in a proprietor session by opening Student Management → Admission / Admissions Workflow. The page showed admission stages and class options. It showed no saved applications. A blank Continue action was stopped by required-field validation without creating an application.

## Current workflow and implementation dependencies

### User interface

- `public/admissions.html` contains the admission enquiry controls and saved/active application list.
- `public/admissions-workflow.js` loads class/year/term options, validates and normalizes enquiry data, creates or updates a draft through the API, and navigates to `admission-application.html`.
- `public/admission-application.html`, `public/admission-application.js`, `public/admission-form-navigation.js`, and `public/admission-form.css` implement the multi-section application, form navigation, Save Draft, resume, document upload, review, and submission interactions.
- `public/app.js` implements the authenticated shell, role-filtered navigation, and embedded module routing.

### Services and shared logic

- `src/durable-admissions.js` persists durable applications, draft updates, document and review state, offers, and application workflow state.
- `src/admission-form.js` is the in-memory/legacy admission service and implements validation, fee snapshots, status transitions, and document rules.
- `src/admission-enrollment.js` transactionally links an accepted application to a student, profile, enrollment, and parent link while allocating a Permanent Student ID.
- `src/existing-student-linking.js` links an already existing school student, preserving an established Permanent Student ID and avoiding duplicate class/year/term enrollment.
- Supporting code used by these services includes `src/permanent-student-id.js`, `src/student-classes.js`, `src/students.js`, `src/student-gender.js`, `src/ghana-phone.js`, `src/admission-fee-assessment.js`, and `src/admission-document-storage.js`.
- `src/server.mjs` wires the services, browser routes, authenticated APIs, school-scope checks, and public/parent admission routes.

### Confirmed API surface

The relevant routes are defined in `src/server.mjs`:

- `POST /api/auth/login`, `GET /api/auth/session`, and `GET /api/sidebar` support the authenticated shell.
- `GET /api/admission-workflow/options` returns authorized workflow options.
- `GET` and `POST /api/admission-applications` list and create applications.
- `GET /api/admission-applications/{applicationNumber}` reads an application; `PATCH /api/admission-applications/{applicationNumber}/update` updates a draft.
- Related routes upload, replace, list, download, and review documents; submit applications; record decisions; accept offers; and enroll approved applications.
- `POST /api/admissions` and related legacy decision/advance endpoints also remain registered. They are distinct from the durable application workflow and must not be silently removed or conflated with it.

### Persistence and schema contracts

- `schema/003_students_admissions.sql` defines `admission_applications`, student profiles, class history, and parent/student links.
- `schema/015_admission_form_fee_engine.sql` defines the legacy `admission_form_applications`, `admission_documents`, and `admission_fee_structures` records.
- `schema/023_permanent_student_ids.sql` and `schema/027_student_id_sequences.sql` define permanent ID storage and annual allocation sequence state.
- `schema/028_admission_student_master_fk.sql` links applications to the student master.
- `schema/059_backward_compatible_enrollment_contract.sql` and `schema/080_restore_student_enrollment_is_current.sql` cover enrollment compatibility/current state.
- `schema/078_admissions_leadership_access.sql` adds the enquiry request reference, application/student identity uniqueness, and enrollment-context uniqueness constraints.
- Durable enrollment writes `students`, `student_profiles`, `student_enrollments`, `parent_student_links`, `student_id_sequences`, and `admission_applications` in a database transaction. Production schema changes are outside this protection task.

## Existing regression coverage and CI baseline

The 2026-10-11 focused run passed 38 tests across:

- `test/admissions-workflow-ui.test.js` and `test/admission-form.test.js`.
- `test/durable-admission-stages.test.js`, `test/admission-enrollment.test.js`, and `test/existing-student-linking.test.js`.
- `test/admissions-leadership-http.test.js`, `test/admission-document-upload-http.test.js`, `test/admission-document-storage.test.js`, and `test/admission-fee-assessment.test.js`.
- Existing migration and identity tests, including `test/admissions-migration-gate.test.js`, `test/production-admissions-migration-078.test.js`, `test/admission-workflow-migration-preflight.test.js`, `test/admission-migration-078-preflight-source.test.js`, and `test/permanent-student-id.test.js`.

The repository uses Node's built-in test runner (`node --test`) and Playwright for at least one unrelated responsive-browser test. Admission tests are currently separate files; `package.json` has no admission-specific protection command and no admission-specific GitHub Actions workflow exists. `.github/workflows/protected-components.yml` runs the general protected-components, attendance, fee-hub, and migration checks on pull requests. `.github/workflows/login-assets-integrity.yml` runs only for login asset or workflow changes.

The existing root `CODEOWNERS` file assigns `@FRANK12517` to login branding/integrity files only. A required CODEOWNERS approval rule has not been established by this repository baseline. A prior branch-protection query reported zero required approving reviews and one required check, `Verify protected login assets`; current GitHub settings could not be refreshed during this audit.

## Verified admission contract from current tests and code

- A canonical class option ID and its display label may differ. The enquiry sends the class label expected by the legacy validator and preserves the option ID in enquiry metadata.
- Staff intake supports `FIRST_TIME`, `TRANSFER`, and `ALREADY_ENROLLED`; each type has different validation/document rules.
- Save Draft is implemented by the application UI and uses create/update APIs. Existing UI tests assert the save/reopen wiring and service tests exercise draft creation/update. Leadership HTTP tests cover durable enquiry creation, update, and readback. There is no browser end-to-end test for the full Save Draft/resume flow in the baseline.
- Enrollment allocates IDs server-side in a transaction, serializes concurrent sequence use, reconciles existing identifiers, and does not allocate for pending/rejected applications.
- Existing-student linking preserves an established ID and does not duplicate an existing enrollment context.
- The current tests cover the ID allocator and enrollment service using isolated fixtures; no production database was used for these checks.

## Separately identified functional defect — do not encode as the desired contract

The authenticated staff enquiry's successful Next action in `public/admissions-workflow.js` navigates to `/admission-application.html?applicationNumber=...&step=2`. However, the `publicAdmissionPage` guard in `src/server.mjs` returns HTTP 403 when that page is requested with an authenticated school-portal session. A local HTTP reproduction using the repository's in-memory proprietor test account returned:

```text
/admissions 200
/admission-application.html?applicationNumber=APP-TEST&step=2 403
```

This is separate from the merged class-label fix and conflicts with the staff application UI, which contains staff-specific review and submission behavior. This audit did not change the route guard, role permissions, or production behavior. The protection system must not describe staff continuation as passing until the authorization conflict is resolved and covered by a browser/API test. Resolution requires preserving authentication and granting access only through the already-intended admission permission model; do not make the page public or broaden unrelated role access.

## Baseline test evidence

Command run against the release source on 2026-10-11:

```text
node --test test/admissions-workflow-ui.test.js test/admission-form.test.js test/durable-admission-stages.test.js test/admission-enrollment.test.js test/existing-student-linking.test.js test/admissions-leadership-http.test.js
```

Result: 38 tests passed, 0 failed. This proves those test assertions only; it does not prove the blocked staff browser continuation, a production draft write, or production Permanent Student ID persistence.
