# Admissions recovery and release evidence

Date: 2026-10-09 (Africa/Accra)

## Recovery

The original `codex/admissions-workflow-repair` checkout was readable at recovery time. Its `.git` pointer and registered worktree entry matched commit `146867520c67493f53de377c907a29a3e050d541`. The execution account was `DESKTOP-0BOA05K\\CodexSandboxOffline`; the owner was `DESKTOP-0BOA05K\\ABBAN`. ACL inspection showed sandbox read/execute access. The path was outside this chat's writable roots. A Git ownership rejection also occurred when addressing the worktree with `git -C` from another checkout. Running Git with the worktree as its working directory succeeded. Necessary writes and execution were authorized through sandbox escalation.

No observed read failure established a process lock, antivirus interference, moved directory, or invalid Git metadata. No permissions, antivirus configuration, or global Git trust settings were changed.

All 36 original pending files (26 modified, 10 untracked) were preserved in a 757-file source/project backup outside the worktree. Each copied file was verified against its source with SHA-256. The backup includes migration 078, frontend, backend, tests, package files, a tracked binary patch, original Git status, base SHA, and CSV manifest. Dependencies and Git administrative data are not duplicated by this source backup. Original unrelated primary-checkout modifications were not edited or staged.

## Implementation preserved and continued

The recovered implementation covers the twelve-stage admissions interface, enquiry retry tokens, draft reopening, leadership navigation, document review, assessment, decisions, offers, acceptance, enrollment, permanent IDs, class assignment, Fee Setup assessment, and parent links. Admission Prospectus remains separately routed.

Recovery follow-up fixes protect parent ownership on repeated enquiries, prevent completed applications from being resubmitted, permit enrollment retry after a committed enrollment, redact nested private storage metadata, reject replacement of missing documents, preserve existing administrator access, and remove a duplicated academic-year option. Migration 078 requires explicit protected-release authorization.

## Verification and limits

- Initial focused suite: 27 passed, 0 failed.
- Final full regression: 1,292 passed, 7 failed, 0 skipped (1,299 tests).
- All seven failures also reproduced on the untouched base commit in a detached worktree: 19 passed, 7 failed across the six affected test files.
- Six baseline failures concern historical migration byte checksums, Windows CRLF-sensitive assertions, and a stale sidebar audit count. The seventh is an environment failure: the tests invoke `python3`, which resolves to the unavailable Windows launcher. Adding the bundled `python.exe` directory to PATH does not provide `python3`.
- Additional authenticated HTTP coverage verifies all three leadership roles can open Admissions and save/reopen a persisted draft; teacher creation is denied. This uses a controlled database fixture, not production TiDB.
- Schema discovery validation passed: 77 migration files, including version 078. This is not production SQL execution validation.
- Protected components: 3 passed. Protected login assets: 12 passed. Git whitespace validation passed.

Failed baseline cases:

1. assignment production migration is manual, exact-SHA, read-only by default, and explicitly gated
2. Administrator marks.write is delivered by a forward migration without editing migration 032
3. Part 29 preserves the release gate and certifies every role destination
4. Migration 063 checksum matches the immutable repository SQL
5. Migration 063 application wrapper is bound to the reviewed migration identity
6. migration 060 is one additive unique index on the approved ordered columns and never edits migration 059
7. TiDB-compatible unique DDL rejects same-year duplicates, allows the same name in another year, and preserves existing rows (Python environment)

## Release blockers

The read-only migration 078 preflight returned `DATABASE_URL_MISSING`. Production data prerequisites, duplicate/orphan checks, index compatibility, and real database concurrency remain unverified. No production database write was attempted. A reviewed, authorized migration procedure and protected environment approval are required before applying 078.

Production private Blob configuration, authenticated browser completion of all twelve stages, all three production leadership dashboards, and deployment SHA parity remain unverified. Automated HTTP and fixture tests do not replace these checks. Do not merge or deploy this draft until the database gate and required reviews pass.

## Deployment and rollback

Review the exact release SHA; run the authorized read-only preflight; confirm a production backup and approve the additive migration through the protected release process. Verify the database ledger and constraints before deploying code that uses the new columns. Configure private Blob credentials, deploy the reviewed SHA, and verify `/api/release` plus authenticated leadership workflows.

If application rollback is required, redeploy the previous verified application SHA. Preserve allocated student IDs, admissions, uploads, and additive schema changes. Do not delete production rows or reverse the schema without a separately reviewed data-preserving plan.
