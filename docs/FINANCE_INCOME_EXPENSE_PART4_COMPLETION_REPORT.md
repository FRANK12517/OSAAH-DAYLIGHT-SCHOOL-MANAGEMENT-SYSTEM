# Part 4 — Durable Income and Expense Management Completion Report

**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`
**Production application:** `https://www.osaahdaylightschool.online`
**Part 4 scope:** Durable general/non-fee Income and Expense management. Cashbook, Discounts, and Scholarships remain deferred.

## A. Pre-implementation findings

The pre-implementation audit found no durable general Income or Expense tables. Existing `fees.js` contained compatibility-oriented in-memory `recordIncome` and `recordExpense` methods used by older reporting contracts, but those records were not durable, did not provide complete validation, did not provide controlled voiding, and were not suitable as the canonical general ledger source.

The existing canonical fee payment, invoice, receipt, collection, and fee-obligation services remain separate. Student fee payments are not copied into the new general Income table. The existing Part 3 `budgets` and `budget_items` tables and service were reused for optional Expense linkage. No Cashbook table or duplicate ledger was created.

Existing infrastructure reused includes the database adapter contract, migration runner, `financial_audit_history`, `financial-authorization.js`, canonical academic-year and term tables, Part 3 budget categories, authenticated server routing, and the declarative Finance renderer.

## B. Migration created

Added `schema/051_income_expense_management.sql` as the next additive migration after `schema/050_budget_management.sql`.

The migration is idempotent through `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`. It contains no `DROP`, `TRUNCATE`, destructive `ALTER`, unbounded production update, historical payment rewrite, invoice rewrite, receipt rewrite, or budget rewrite.

## C. Database tables, columns, and indexes

### `general_income`

| Column | Purpose |
|---|---|
| `id` | Durable transaction identifier |
| `school_id` | Tenant ownership and isolation |
| `transaction_date` | Transaction date |
| `academic_year`, `term` | Validated canonical reporting period |
| `income_category` | Controlled non-fee category |
| `custom_category` | Required only for `Other` |
| `description` | Income description |
| `reference_number` | School-scoped duplicate/idempotency reference |
| `amount` | `DECIMAL(12,2)` positive monetary amount |
| `payment_method` | Canonical general payment method |
| `payer_or_source` | Source or payer |
| `notes` | Optional notes |
| `status` | `POSTED` or `VOIDED` |
| `created_by`, `created_at` | Creation provenance |
| `updated_by`, `updated_at` | Modification provenance |
| `voided_by`, `voided_at`, `void_reason` | Controlled void provenance |

Indexes cover school/date, school/academic period/status, and school/category/status. A school-scoped unique constraint on `(school_id, reference_number, status)` prevents duplicate active postings while preserving the ability to retain voided history.

### `general_expenses`

The Expense table has the same core transaction and provenance fields, with `expense_category`, `payee`, and nullable `budget_id` and `budget_item_id` references to the canonical Part 3 budget structures.

Indexes cover school/date, school/academic period/status, school/category/status, and school/budget/budget-item/status. Expense records do not duplicate budget names, categories, allocations, or totals.

## D. Income service

`src/general-finance.js` exposes the durable Income service with:

- `create`;
- `list`;
- `get`;
- `update` for permitted descriptive fields while `POSTED`;
- `void` with a mandatory reason;
- controlled categories, payment methods, and statuses.

The service validates school context, academic year, term, date, amount, category, custom category, payment method, reference number, and status. Monetary values are validated as decimal strings and normalized to exact two-decimal values before persistence. No FLOAT monetary field or browser-formatted value is authoritative.

## E. Expense service

The same durable service exposes the Expense subsystem with:

- `create`;
- `list`;
- `get`;
- `update` for permitted descriptive fields while `POSTED`;
- `void` with a mandatory reason;
- canonical categories aligned with Part 3 Budget categories;
- optional Budget and Budget Item linkage.

Posted financial records are never hard-deleted. Voiding preserves the original transaction and records the actor, timestamp, and reason. Active reporting excludes `VOIDED` rows.

## F. API endpoints

All endpoints require authentication and use school-scoped financial authorization.

| Method | Endpoint | Capability |
|---|---|---|
| `GET` | `/api/finance/income` | List general Income with filters and metadata |
| `POST` | `/api/finance/income` | Create durable general Income |
| `GET` | `/api/finance/income/:id` | Retrieve one Income transaction |
| `PATCH` | `/api/finance/income/:id` | Update permitted Income fields |
| `POST` | `/api/finance/income/:id/void` | Void Income with a reason |
| `GET` | `/api/finance/expenses` | List Expenses with filters, metadata, and valid budgets |
| `POST` | `/api/finance/expenses` | Create durable Expense |
| `GET` | `/api/finance/expenses/:id` | Retrieve one Expense transaction |
| `PATCH` | `/api/finance/expenses/:id` | Update permitted Expense fields |
| `POST` | `/api/finance/expenses/:id/void` | Void Expense with a reason |

Unauthenticated requests receive HTTP 401. Unauthorized roles receive HTTP 403. Persistence-unavailable and validation errors return explicit structured error codes rather than empty-success responses.

## G. Frontend implementation

The Part 2 read-only Income and Expenses views in `public/finance-canonical.html` were replaced with operational server-backed modules.

### Income UI

The Income page now includes a General Income summary, durable register, date/reference/category/source/description/payment-method/amount/status/recorded-by/action columns, academic-year and term filters, date range filters, category/payment/status filters, search, Add Income, View, Edit, and Void actions.

The form includes transaction date, academic year, term, controlled category, conditional Specify Category, description, reference number, amount, payment method, source/payer, and notes.

### Expense UI

The Expense page now includes a durable register, Expense summary, date/reference/category/payee/description/budget/budget-item/payment-method/amount/status/recorded-by/action columns, equivalent filters and search, Add Expense, View, Edit, and Void actions.

The Budget dropdown is populated only from the authenticated school’s server-backed budgets. Budget Item options cascade from the selected Budget. The UI never stores transaction data in localStorage or creates client-side financial records.

Both modules include loading, loaded, empty, validation/error, duplicate-reference error, unauthorized, and server-error paths. Tables use the existing controlled horizontal overflow and dashboard styling conventions.

## H. Income categories

The canonical general Income categories are:

- Donations
- Grants
- Sponsorship
- Fundraising
- Facility Rental
- Sale of Materials
- Interest Income
- Investment Income
- Alumni Support
- PTA/Community Support
- Government Support
- Other

Ordinary student-fee categories are deliberately excluded. `Other` requires a persisted custom category.

## I. Expense categories

Expense categories reuse the Part 3 Budget category vocabulary:

- Salaries & Wages
- Teaching & Learning Materials
- Examination Expenses
- Utilities
- Maintenance & Repairs
- Transport
- Feeding/Canteen
- Boarding/Hostel
- ICT
- Administration
- Sports
- Staff Development
- Infrastructure
- Security
- Health & First Aid
- Events & Activities
- Communication
- Printing & Stationery
- Cleaning & Sanitation
- Other

`Other` also requires a persisted custom category.

## J. Payment methods

General Income and Expenses use one shared canonical vocabulary:

- `CASH`
- `BANK`
- `MOBILE_MONEY`
- `CHEQUE`
- `OTHER`

Student fee payment methods remain governed by the existing fee-payment service and are not replaced or duplicated.

## K. Duplicate and idempotency protection

The server requires a reference number for every general Income and Expense transaction. Before posting, the service checks for an existing active transaction with the same school-scoped reference. The database also enforces a school/reference/status uniqueness boundary to protect against concurrent duplicate posting.

Duplicate references return a structured `DUPLICATE_REFERENCE` error with HTTP 409. Frontend button disabling is not relied upon as the protection mechanism.

## L. Budget linkage

Expenses may link to a Part 3 Budget and Budget Item. The service verifies that:

1. the Budget belongs to the authenticated school;
2. the Budget is `APPROVED` or `ACTIVE`;
3. the Budget Item belongs to the selected Budget;
4. the Budget Item belongs to the authenticated school;
5. both keys are supplied together.

Cross-school Budget IDs, cross-budget Budget Items, missing Budget Items, and ineligible Budget statuses are rejected. No budget utilization field is incremented or materialized in Part 4. The canonical relationship is established for later Budget-vs-Actual work.

## M. RBAC matrix

| Role | View Income/Expenses | Create | Edit posted description fields | Void |
|---|---:|---:|---:|---:|
| `PROPRIETOR` | Yes | Yes | Yes | Yes |
| `SCHOOL_ADMIN` | Yes | Yes | Yes | No additional broadening beyond existing matrix |
| `ACCOUNTANT_BURSAR` | Yes | Yes | Yes | No |
| `HEADTEACHER` | Read-only where existing financial read access applies | No | No | No |
| `TEACHER` | No | No | No | No |

The new `income` and `expenses` resources are registered in the existing financial authorization infrastructure. Individual routes do not contain arbitrary role-name authorization logic. Accountant and Proprietor permissions are intentionally not identical: the Accountant can create and update but cannot void; the Proprietor retains full financial control.

## N. School isolation

All reads and writes use the authenticated actor’s `schoolId`. A supplied mismatching `schoolId` is rejected. Transaction retrieval, update, void, duplicate checks, Budget lookup, and Budget Item lookup are school-scoped.

The focused API tests verify authenticated creation/listing, teacher denial, unauthenticated denial, and the inability to use fee categories to cross the student-fee/general-income boundary. Service tests verify cross-school input and Budget-link rejection.

## O. Audit and provenance

The service writes meaningful events to the existing `financial_audit_history` table:

- `INCOME_CREATED`
- `INCOME_UPDATED`
- `INCOME_VOIDED`
- `EXPENSE_CREATED`
- `EXPENSE_UPDATED`
- `EXPENSE_VOIDED`

Events include school, entity, transaction ID, reference, actor, timestamp, and previous/new values where appropriate. The existing financial audit callback is also invoked. No secrets, authentication tokens, or credentials are stored.

## P. Finance Overview integration

The existing `/api/reports/financial` endpoint now consumes durable general Income and Expense services asynchronously while preserving canonical fee sources.

Finance totals are derived as:

> **Total inflows = canonical valid fee payments + active general Income**
>
> **Total Expenses = active durable Expense transactions**
>
> **Net position = total inflows − total Expenses**

Fee payments are not inserted into `general_income`, so fee collections are counted exactly once. Voided Income and Expenses are excluded from active totals.

## Q. Reporting integration

`src/reporting.js` retains the existing synchronous report contract for legacy callers and adds a durable asynchronous financial report path that fetches general Income and Expenses through their authenticated services. Financial reports can filter by academic year, term, date range, category, and the existing fee dimensions without changing the existing invoice/payment report source.

Income and Expense transactions appear in `incomeTransactions`, `expenseTransactions`, `incomeByCategory`, and `expenseByCategory`. Existing fee collection, expected fee, outstanding balance, and collection-rate fields remain fee-system-derived.

## R. Focused test results

The focused Part 4 suite passed:

```text
4 tests passed
0 failed
```

Coverage includes durable create/retrieve/list, academic-year and term filters, category and search filters, custom categories, amount validation, duplicate references, authorized updates, unauthorized updates, voiding, active-total exclusion, persistence, audit history, Budget linkage, cross-school Budget rejection, API authentication, RBAC, and the fee/general-income boundary.

## S. Part 3 regression results

Part 3 Budget, Part 2 Finance, and financial RBAC regressions passed:

```text
16 tests passed
0 failed
```

## T. Full suite results

The final deterministic repository suite passed:

```text
753 tests passed
0 failed
```

The verified Part 3 baseline was 749 passed and 0 failed. The increase reflects the four focused Part 4 tests. No existing test was deleted, skipped, weakened, or rewritten merely to obtain a passing result. Migration-inventory expectations were extended to recognize the new additive migration 051.

## U. Migration validation

Migration validation completed successfully:

```json
{"valid":true,"migrationCount":50}
```

The repository now discovers migration 051 as the final migration. Syntax checks passed for `src/general-finance.js`, `src/server.mjs`, `src/reporting.js`, and the embedded finance browser script. `git diff --check` passed. The migration contains no destructive operation markers.

## V. Production migration status

**Not applied.** Migration 051 was added to the repository but was not executed against the production database. No production data or schema was modified.

## W. Production deployment status

**Not deployed.** The production application was not changed through a deployment action during Part 4.

## X. Production verification status

**Not verified against production.** No production login, live transaction creation, production migration, production report query, or production UI verification was performed.

## Y. Remaining gaps

### Cashbook

**Deferred.** No Cashbook transaction storage or duplicate financial ledger was created. The next phase should implement Cashbook as a projection over canonical fee payments, general Income, and Expenses.

### Budget utilization

**Partially prepared, not fully integrated.** Expenses now carry canonical `budget_id` and `budget_item_id` relationships, but Part 4 deliberately does not mutate stored utilization. Full active Expense aggregation into Budget-vs-Actual utilization remains a later phase.

### Discounts

**Deferred.** No Discounts subsystem was implemented.

### Scholarships

**Deferred.** No Scholarships subsystem was implemented.

Additional future work includes applying migration 051 through the production migration process, deploying the changes, validating the live schema against repository assumptions, and performing controlled production verification.
