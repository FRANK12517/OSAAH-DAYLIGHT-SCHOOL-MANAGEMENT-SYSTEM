# Fee Hub preservation policy

Fee Setup, the staff Fee Structure view, and the parent fee-obligation view are protected financial workflows. Preserve their behavior and the canonical durable `fee_obligations` contract when making changes.

## Required change practice

Before changing Fee Setup, Fee Structure, fee publication APIs/services, fee schemas, academic-context resolution, parent fee queries, or related payment/receipt code:

1. Read this policy and inspect the dedicated suite with `npm run test:fee-hub`.
2. Keep publication, staff reads, and parent visibility on the canonical durable fee service; do not substitute an in-memory or mocked production source.
3. Preserve strict positive GHS validation in integer pesewas, tenant scope, role checks, academic year/term identifiers, idempotency, and server-side parent-to-student authorization.
4. Run `npm run test:fee-hub` after relevant changes and the required broader tests before merging.
5. Review migrations for additive/backward-compatible behavior and preserve payments, receipts, balances, obligations, and financial audit history.
6. When changing publication or visibility rules, verify parent authorization and financial integrity as well as staff behavior.
7. Update regression tests for an intentionally authorized business-rule change. Record the changed contract, the authorization/review, and the evidence supporting the change.

## Release checklist

- Fee Setup accepts valid positive amounts and rejects malformed values; failed requests do not report success or lose entered values.
- A successful publication is durably persisted and repeat requests do not duplicate obligations.
- Fee Structure reads the durable published records for the selected year and term; errors are never shown as an empty state.
- Parent results include only published obligations belonging to students linked to the authenticated parent in the same school.
- Fee Hub tests pass in CI along with broader required tests and the production build.
- Any schema change has a reviewed compatibility plan and follows the existing protected migration workflow.

This policy protects critical contracts without prohibiting legitimate future work. A deliberate, reviewed, tested change may update a contract when its impact is understood and documented.
