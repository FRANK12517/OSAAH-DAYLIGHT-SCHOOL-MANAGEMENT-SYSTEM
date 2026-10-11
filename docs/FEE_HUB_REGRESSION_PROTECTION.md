# Fee Setup and Fee Structure Regression Protection

Fee Setup, publishing, Fee Structure, parent fee visibility, and linked financial history are critical workflows. This document records their current source paths, observable contracts, and required checks. It extends [the Fee Hub preservation policy](fee-hub-preservation.md).

## Requirements reviewed

The user-provided implementation brief was read from `C:\Users\ABBAN\.codex\attachments\d7120273-087c-493f-a4d2-dea8a6251ef5\Pasted text.txt`. Repository context reviewed includes `docs/fee-hub-preservation.md`, `docs/PART_4_FEE_SETUP_REPORT.md`, `docs/FINANCE_FEE_HUB_PART2_COMPLETION_REPORT.md`, `docs/FINANCE_FEE_HUB_FORENSIC_AUDIT.md`, and `docs/PART_5_FINAL_ACCEPTANCE_REPORT.md`. No separate in-repository requirements text file for this repair was found.

## Source-level defect evidence

- The Fee Setup contract converts entered GHS to integer pesewas before sending `amountMinor`; the server requires a positive safe integer. The shared parser accepts `100`, `250.50`, `1200.75`, and `0.50`, and rejects invalid precision and unsafe values. No production request body or authenticated session was available to determine which exact input caused the reported generic amount message.
- The fee type selected by Fee Setup is a canonical `fee_types` identifier. The publication repository now resolves active school-scoped fee type rows and known system fee codes inside the publication transaction; relying only on `fee_structures` could reject the selected type before obligation insertion, which left the Fee Structure query with nothing to display.
- The previous finance audit records a generic placeholder path for finance pages. The current `/fees/structure` view reads `/api/fees/structures`, which retrieves published rows from canonical obligations. The API now keeps infrastructure errors distinct from successful empty reads and returns sanitized error text.
- Existing target materialization keyed retries by target, so the same student, fee type, academic year, and term could receive an additional obligation through an overlapping target. Publication now locks eligible students and matching fee rows in the existing transaction, checks all target scopes, then inserts only after the full conflict check succeeds.

## Protected source map

| Workflow | Source of truth and integration points |
|---|---|
| Fee Setup form and exact GHS validation | `public/fee-setup.html`, `public/fee-amount.js`, `public/fee-type-catalogue.js` |
| Authoritative academic, fee type, and class options | `GET /api/fee-setup/options` in `src/server.mjs`; school-scoped academic year, term, fee type, and class queries |
| Authenticated publication | `POST /api/fees/obligations/publish` in `src/server.mjs`; `publishFeeObligations` in `src/fee-collections-repository.js` |
| Durable obligation schema and lifecycle | `schema/029_fee_obligations_collections.sql`, later additive fee migrations, `fee_obligations` |
| Idempotency and target overlap | `src/fee-collections-repository.js`; exact retries are skipped, and another published obligation for the same student, fee type, year, and term blocks an overlapping target |
| Accountant and Proprietor Fee Structure | `/fees/structure` in `public/finance-canonical.html`, backed by `GET /api/fees/structures` in `src/server.mjs` and `listPublishedFeeStructures` in `src/fee-collections-repository.js` |
| Parent fee visibility and parent-to-student access | `GET /api/parent/fee-obligations` in `src/server.mjs`, `src/parent-fee-obligations-repository.js`, and `public/parent-fees.html` / `src/parent-fees-renderer.js` |
| Existing balances, payments, and receipts | `src/fee-obligation-balances.js`, `src/fee-collections.js`, `src/fee-collections-repository.js`, durable payment/reader modules, and schemas `029`, `041`–`044`, `046` |
| Regression tests and required CI gate | `test/fee-hub-regression.test.js`, `test/fee-setup-part4.test.js`, existing Fee Hub repository/parent/payment tests, `npm run test:fee-hub`, `.github/workflows/protected-components.yml`, `config/protected-components.json` |

## Contracts that changes must preserve

- Treat the form's Publish Fee button, submit handler, authenticated API request, exact integer pesewas representation, and durable response as one workflow.
- Accept positive GHS values with at most two fractional digits; reject empty, zero, negative, malformed, over-precision, and unsafe values on both the client and server.
- Resolve academic year, term, fee type, and class from authorized school-scoped sources. Keep canonical IDs through persistence and reads.
- Support `WHOLE_SCHOOL` and `SPECIFIC_CLASS`; require a canonical class for the latter and persist no class for the former.
- Preserve one obligation per eligible student and safe idempotent retries. Serialize overlapping publication attempts and do not allow an overlapping published obligation for the same student, fee type, academic year, and term to double-charge that student. Resolve an existing publication through the supported correction process before retrying with another target.
- Read Fee Structure from published canonical obligations. Show an empty state only after a successful response with no rows; API, context, and permission errors remain errors.
- Keep Accountant and Proprietor views on the same route, APIs, and canonical records. Preserve each role's existing server-side permissions.
- Parent queries must constrain the authenticated parent, school, active parent-child link, and published lifecycle. Class-specific obligations must only be materialized for students in the selected class.
- Preserve fee balances, payment and receipt records, tenant boundaries, audit history, transaction integrity, and the existing migration process.

## Mandatory regression and release gates

1. Run `npm run test:fee-hub` for changes to Fee Setup, fee publication, Fee Structure, parent fee reads, fee obligations, or linked financial workflows.
2. Run `npm run protection:verify`, the complete repository suite, migration validation, and the production build as required by the repository release workflow.
3. Keep the Fee Hub suite in the existing pull request and `main` workflow. A successful build alone does not demonstrate that publication works.
4. Dependency upgrades, refactors, API or schema changes, and CSS/component redesigns must pass the protected suite. Maintain backward compatibility or include a coordinated, tested migration when a public contract changes.
5. Do not delete or weaken existing coverage just to make a change pass. Extend tests when an authorized business rule changes and document its evidence.
6. Never publish arbitrary test fees into production. Publishing tests must use an isolated database or established fixtures. Production financial verification requires an approved amount and the applicable release safeguards.
7. Before deployment, review the complete branch diff, confirm required checks and approvals, and verify that migration behavior preserves existing fee and financial data. Do not report branch protection or required review settings as enabled unless verified in GitHub.
