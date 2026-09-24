# Finance and Fee Hub Forensic Audit

**Repository:** `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`
**Audited revision:** `5a3f80b` (`main`, 2026-09-24)
**Production URL supplied:** `https://www.osaahdaylightschool.online`
**Scope:** Repository forensic audit only. No production data was accessed or modified, no migrations were applied, and no application fixes were implemented.

## Executive finding

The generic message is caused by a **frontend placeholder branch**, not by a database failure. The affected navigation items are deliberately normalized to one shared page, `public/finance-canonical.html`. That page computes a view label from the route, but its loader only performs real data requests for `/finance/reports` and `/fees/admission-structures`. Every other finance or fee view falls through to the literal placeholder:

> `Authorized financial view · server-backed data`

The repository already contains substantial server-backed fee and financial functionality, including invoice, payment, receipt, statement, obligation, collection, fee-structure, balance, reporting, audit-history, RBAC, and school-scope code. The immediate defect is therefore principally **missing frontend view implementations and route-to-API wiring**, with additional backend coverage gaps for some requested domains such as budgets, expenses, cashbook, and discounts.

## A. Root cause

`public/finance-canonical.html` contains a `views` map for the finance destinations and renders a single card for the selected view. Its `load()` function has only two implemented branches:

1. `/finance/reports` calls `/api/reports/financial?reportType=FINANCIAL_SUMMARY`.
2. `/fees/admission-structures` calls `/api/admission-fees`.

For all remaining routes, the function assigns the placeholder literal without issuing a request. The route query parameter changes the title, description, and `data-view-id`, but does not change the rendered data implementation. This explains why pages open successfully while showing no module-specific content.

The route contract reinforces the same behavior: all `/finance/*` and most `/fees/*` routes resolve to `/finance-canonical.html` and advertise the generic API dependencies `/api/fees/obligations` and `/api/reports/financial`, even where the page does not call either endpoint.

## B. Exact placeholder component

| Item | Finding |
|---|---|
| Exact file | `public/finance-canonical.html` |
| Exact source | The `load()` function's final success branch, currently assigning `status.textContent='Authorized financial view · server-backed data'` |
| Indirect generator | `src/sidebar-route-contract.js`, where `componentFor()` maps most `/finance/*` and `/fees/*` routes to `/finance-canonical.html`, and `apiFor()` gives them the same generic API dependency list |
| Route aliasing | `src/server.mjs` maps proprietor finance and fee routes through `PROPRIETOR_PAGE_ALIASES`; the same server also maps `/finance/receipts` directly to `/finance-canonical.html` |
| Temporary status | No explicit `TEMPORARY`, `TODO`, or feature-gate marker was found beside the placeholder. It is therefore an active production rendering path, not a clearly marked temporary fallback |
| Other exact-string occurrences | Only `public/finance-canonical.html` contains the exact placeholder string in the repository |

## C. Affected routes and route matrix

The following routes are the destinations requested for audit. `component` is the component selected by the route contract or proprietor navigation contract. `API currently used by the page` describes actual frontend behavior, not merely metadata.

| Destination | Role/navigation route(s) | Component | API currently used by page | Backend capability found | Assessment |
|---|---|---|---|---|---|
| Finance | `/finance` | `finance.html` for the general alias; proprietor `/finance` uses `finance-canonical.html` | None for `finance.html`; placeholder for proprietor canonical view | Fee services and financial reporting exist | Frontend missing; route behavior differs by navigation contract |
| Income | `/finance/income` | `finance-canonical.html` | None; placeholder | In-memory `listIncomes()` exists in `src/fees.js`; financial report can aggregate income | Frontend missing; durable SQL source not demonstrated in the canonical fee schema |
| Cashbook | `/finance/cashbook` | `finance-canonical.html` | None; placeholder | No dedicated cashbook API/service/table found | Frontend and backend domain missing |
| Budgets | `/finance/budgets` | `finance-canonical.html` | None; placeholder | No dedicated budget API/service/table found | Frontend and backend/domain schema missing |
| Payments | `/fees/payments` | `finance-canonical.html` in proprietor contract; route is also registered in the accountant fee hub | None; placeholder | `/api/fees/payments` supports creation; fee service supports payment listing and payment/receipt logic | Frontend missing; read/list UI not wired |
| Receipts | `/fees/receipts` and `/finance/receipts` | `finance-canonical.html` for proprietor routes; standalone `public/receipts.html` exists for the older `/fees/invoices` alias | None on canonical page; standalone page calls receipt preview/PDF endpoints | `/api/fees/receipts/:number`, `/api/fees/receipts/change`, receipt branding, PDF generation | Two navigation keys share the same canonical view; existing receipt implementation is disconnected from those canonical entries |
| Arrears | `/fees/arrears` | `finance-canonical.html` | None; placeholder | Fee balances and `/api/fees/notifications/balance` exist; `vw_fee_arrears` exists | Frontend missing; backend primitives exist |
| Discounts | `/fees/discounts` | `finance-canonical.html` | None; placeholder | Ledger supports `DISCOUNT`; reporting view exposes discounts; no dedicated discount API/UI found | Frontend missing; dedicated backend workflow incomplete |
| Fee Statements | `/fees/statements` | `finance-canonical.html` | None; placeholder | `/api/fees/statements` calls `fees.statement()` with academic-year, term, and class filters | Frontend missing; backend endpoint exists |
| Fees | `/fees` | `fees.html` for general alias; proprietor `/fees` uses canonical page | `fees.html` has its own limited page behavior; canonical route is placeholder | Fee structures, fee types, obligations, and publication endpoints exist | Canonical proprietor frontend missing; older fee page is not a complete hub |
| Student Fees | `/fees/students` | `finance-canonical.html` | None; placeholder | Student fee accounts, ledger, balances, invoices, payments, and statements exist | Frontend missing; backend primitives exist |
| Invoices & Receipts | `/fees/invoices` | Proprietor contract maps to `finance-canonical.html`; general server alias also maps `/fees/invoices` to `receipts.html` before proprietor aliasing | Standalone alias uses receipt lookup; canonical proprietor route is placeholder | Invoice creation/listing, payments, receipts, and register view exist | Alias conflict/role-specific page selection; needs one canonical contract |
| Fee Structure | `/fees/structure` | `finance-canonical.html` | None; placeholder | `fee_structures`, `fee_structures_v2`, fee types, publication, and published-structure view exist | Frontend missing; backend/schema support exists |

### Request path to server path

The authenticated server flow is:

`sidebar entry` → `visibleSidebar()` / proprietor route contract → protected-page authorization → `pageAliases` / `PROPRIETOR_PAGE_ALIASES` → HTML component → frontend loader → server API branch → service → adapter/repository → school-scoped tables/views.

For canonical finance routes, the chain terminates in the same HTML page before a module-specific frontend service is selected. The API chain is therefore absent for most affected destinations even though server endpoints exist for several of them.

## D. Existing real components found

The repository contains these reusable implementations and should not receive duplicate finance systems:

- `public/fee-setup.html` — functional fee publication form using `/api/fee-setup/options` and `/api/fees/obligations/publish`.
- `public/collections.html`, `public/canteen.html`, and `public/collection-reports.html` — collection workflows and reporting pages.
- `public/receipts.html` and `public/receipts.js` — receipt lookup, preview, print, and PDF download through `/api/fees/receipts/:receiptNumber/preview` and `/pdf`.
- `public/reports-financial.html` — separate financial report page.
- `src/fees.js` — invoice, payment, receipt, income, expense, fee structure, and statement service behavior.
- `src/fee-collections.js` and `src/fee-collections-repository.js` — school-scoped collection creation, listing, aggregation, publication, and correction.
- `src/student-fee-ledger.js` — charge, discount, payment, reversal, and adjustment ledger semantics.
- `src/fee-obligation-balances.js` — currently an explicit unavailable-attribution projection for obligation-to-payment balances.
- `src/reporting.js` — financial report building and export.
- `src/receipt-branding.js` — receipt retrieval and branded HTML/PDF output.
- `src/parent-fee-obligations-repository.js` and `src/parent-fees-renderer.js` — parent-facing fee obligations and rendering.

These are canonical or near-canonical building blocks. The placeholder page is not evidence that all of this functionality is absent.

## E. Existing API endpoints found

The server exposes the following relevant endpoints in `src/server.mjs`:

| Endpoint | Capability | Scope/RBAC observation |
|---|---|---|
| `/api/fees/structures` | List/create or manage fee structures | Financial authorization and authenticated school scope are used by the service path |
| `/api/fees/types` | Fee-type registry | Fee configuration permissions apply |
| `/api/fees/obligations` and `/api/fees/obligations/:id` | List/get published obligations | Fee-service school scoping applies |
| `/api/fees/obligations/publish` and `/api/fees/publish` | Publish fee obligations / legacy fee publication | Write/publish authorization is enforced in route/service paths |
| `/api/fees/invoices` | Invoice operations/listing | Invoice resource authorization exists in `src/fees.js` |
| `/api/fees/payments` | Payment creation and payment operations | Creation uses `authorizeFinancial(user, 'CREATE', 'payments')` and input-school validation |
| `/api/fees/receipts/:number` | Receipt JSON/preview/PDF | `PRINT_EXPORT` authorization for school users; receipt lookup is school-aware |
| `/api/fees/receipts/change` | Receipt reverse/void/change | `VOID_REVERSE` authorization is enforced |
| `/api/fees/statements` | Student fee statement | Parent-child restriction or financial `READ` on `studentFees` |
| `/api/fees/collections`, `/api/fees/collections/:id`, `/api/fees/collections/reports` | Collection creation, correction, listing, and aggregation | Collection service queries include `school_id=?` |
| `/api/fees/notifications/balance` | Queue balance notifications | Uses authenticated school and student validation |
| `/api/finance/gateway` | Gateway configuration | Uses `finance.write`, but is not a read-side finance hub endpoint |
| `/api/reports/financial` | Financial report | Allows `finance.read`, `fees.read`, or `reports.read`; delegates to `reporting.buildFinancialReport()` |
| `/api/reports/financial/export` | Financial report export | Same read permission family; export format is selected by query parameter |

No dedicated endpoint was found for a full cashbook, budget register, or expense approval/budget workflow. The presence of `listExpenses()` in the in-memory fee service is not equivalent to a durable expenses subsystem.

## F. Existing database tables and views

### Canonical or additive fee-hub structures

| Module concern | Tables/views found | Status |
|---|---|---|
| Legacy fee setup and finance | `schema/008_fees_finance.sql` fee structures, invoices, payments, receipts, and related legacy objects | Existing legacy support |
| Collection records | `fee_collection_records`, collection-period and correction structures from migrations 029, 030, and 037 | Existing for fee collections, Extra Classes, and Canteen |
| Fee structures | `fee_structures`, `fee_structures_v2`, `fee_types`, `vw_published_fee_structures` | Existing, with overlapping legacy/v2 reconciliation concerns |
| Student fee accounts | `student_fee_accounts` | Existing canonical account primitive |
| Charges/discounts/payments/reversals | `student_fee_ledger` with `CHARGE`, `DISCOUNT`, `PAYMENT`, and reversal status fields | Existing ledger primitive |
| Invoices | `fee_invoices`, `fee_invoice_items` | Existing canonical invoice support |
| Payments and receipts | `student_fee_payments`, `student_fee_receipts` | Existing canonical payment/receipt support |
| Audit | `financial_audit_history` | Existing audit history and transaction-reference index |
| Balances/arrears | `vw_student_fee_balances`, `vw_fee_overview`, `vw_fee_arrears` | Existing reporting projections |
| Invoice/receipt register | `vw_invoice_receipt_register` | Existing reporting projection |
| Collection summary | `vw_fee_collection_summary` | Existing collection projection |

### Database gaps

No dedicated canonical tables or views were found for:

- budgets and budget allocations/utilization;
- a cashbook or general financial movement register separate from fee collections/payments;
- durable general income and expense journals with approval state;
- a dedicated discount-award/concession workflow with approver and publication semantics.

The schema comments explicitly state that the newer normalized fee structures were introduced because the existing tables lacked account, charge, discount, or receipt-history primitives. That is consistent with the current split between legacy fee tables and the newer canonical ledger/account tables.

## G. Missing frontend functionality

The shared canonical page lacks module-specific rendering and data loading for:

- Finance overview and KPI cards;
- income list, filters, totals, and export;
- expenses and approval status;
- cashbook movements and reconciliation;
- budgets and utilization;
- payment register and payment status;
- receipt history and actions;
- arrears/balance list;
- discount list, approval, and audit presentation;
- fee statements;
- student fee accounts and balances;
- invoice/receipt register;
- published fee-structure browsing.

The existing `views` map is presentation metadata only. It must not be treated as a functional implementation.

## H. Missing backend functionality

Backend support is uneven:

- **Present:** fee structures, fee types, obligations, collection records, invoices, payments, receipts, statements, fee ledger, balance projections, financial reports, and audit history.
- **Partial:** discounts are represented in the ledger and balance views, but there is no dedicated discount-management endpoint/workflow; `fee-obligation-balances.js` explicitly returns `allocation_status: 'UNAVAILABLE'` because historical payments link to invoices rather than obligations.
- **Partial:** income and expenses are represented by service-level/in-memory report inputs, but a durable, dedicated SQL journal and approval lifecycle were not found.
- **Missing:** dedicated cashbook API/service and durable cashbook source model.
- **Missing:** dedicated budget API/service/schema and utilization workflow.
- **Needs reconciliation:** legacy `fee_structures`/invoice/payment objects coexist with newer `fee_structures_v2`, account, ledger, invoice, payment, and receipt objects. Existing migrations are additive and intentionally preserve historical records; repair work must choose the canonical read path rather than create another parallel model.

## I. Missing database support

No migration is required merely to eliminate the current placeholder. The immediate failure is frontend routing/rendering. Database migrations would only be justified after product requirements confirm that budgets, cashbook, durable general income/expenses, or discount approvals are in scope and after the canonical source-of-truth model is selected.

Do not add speculative columns, rename production columns, drop tables, or create duplicate fee tables as part of the next repair phase.

## J. RBAC issues

The financial authorization matrix in `src/financial-authorization.js` is materially least-privilege at the service layer:

| Role | Effective financial actions in matrix |
|---|---|
| `PROPRIETOR` | Read, create, update, delete, publish, void/reverse, print/export |
| `ACCOUNTANT_BURSAR` (including normalized `ACCOUNTANT`) | Read, create, update, print/export |
| `SCHOOL_ADMIN` | Read, create, update, delete, publish, print/export |
| `HEADTEACHER` / `ASSISTANT_HEADTEACHER` | Read, print/export |
| `TEACHER` | None |

Important observations:

1. Accountant sidebar entries are permission-gated with `finance.read`, `fees.read`, `fees.configure`, and `fees.collect` as appropriate. The proprietor-specific navigation contract places the finance and fee-hub items in the proprietor portal and reuses the canonical page.
2. The service matrix allows the proprietor to void/reverse, while the accountant cannot. This matches the least-privilege test in `test/part7-financial-rbac.test.js`.
3. Receipt reverse/void, payment creation, statement reads, and financial report reads have explicit server-side checks; authorization is not left solely to UI visibility.
4. The route contract advertises generic `/api/fees/obligations` and `/api/reports/financial` dependencies for every fee/finance route. This is a metadata/design defect because it can imply capabilities that the actual page neither loads nor authorizes per view. It is not, by itself, evidence of privilege escalation.
5. The requested audit names `ACCOUNTANT` and `PROPRIETOR`; the implementation normalizes `ACCOUNTANT` to `ACCOUNTANT_BURSAR`. This should remain a documented alias, not a new role.

A future implementation must preserve separate read, create, update, approve/publish, reverse/void, and export decisions. In particular, do not grant all finance permissions to make the placeholder disappear.

## K. School isolation

The code contains strong school-scope controls in the financial service path:

- `assertSchoolScope()` requires an authenticated actor with `schoolId` and rejects a requested school ID that differs from the authenticated scope.
- `assertInputSchool()` rejects cross-school client input.
- Financial SQL examples use `WHERE school_id=?`, including fee collections, receipt retrieval, and reporting views join on matching school IDs.
- Student and parent lookups validate the authenticated school before financial actions.
- Fee/report service instances carry a configured school ID and filter returned records to it.

The repository tests include cross-school rejection cases, and the full suite passed after dependencies were installed. The audit did not find evidence that the placeholder itself leaks data; it simply fails to load module data. Any future frontend/API additions must continue to derive school scope from the authenticated session and must not trust a client-supplied school ID.

## L. Duplicate/alias routes

### Fee Structure

Only one distinct Fee Structure route was found: `/fees/structure`, module key `fee-structure`, exact view `fee-structure`, and component `/finance-canonical.html`. It appears more than once in route-audit documentation because the same canonical route is projected into different role/navigation views. This is an intentional shared destination, not two independent Fee Structure modules.

### Receipts

There are two proprietor navigation keys with separate paths:

- `receipts` → `/fees/receipts`
- `finance-receipts` → `/finance/receipts`

Both map to `/finance-canonical.html` in the proprietor contract. They are therefore alias-like duplicate navigation entries and should be consolidated or explicitly differentiated in the repair phase. Separately, `/fees/invoices` has a legacy/general page alias to `public/receipts.html`, while the proprietor alias overrides it to the canonical finance page. This is a material route-contract inconsistency for “Invoices & Receipts.”

### Other route aliases

The proprietor contract maps all requested finance and fee-hub children to `/finance-canonical.html`. The accountant-facing registry has additional fee-hub routes such as `/fees/setup`, `/fees/collections/extra-classes`, `/fees/collections/canteen`, and `/fees/collections/reports` that correctly map to separate functional pages. These should be preserved and not folded into the generic canonical page.

## M. Recommended repair order

1. **Freeze the route contract:** choose one canonical path and one navigation key for each requested module; explicitly decide whether `/fees/receipts` and `/finance/receipts` are aliases or different views; preserve `/fees/structure` as the single Fee Structure destination.
2. **Separate page shell from view implementations:** retain shared layout if useful, but replace the unconditional placeholder branch with view-specific renderers and explicit data loaders.
3. **Wire existing APIs first:** implement Finance Reports, Student Fees, Statements, Payments, Receipts, Arrears, Fee Structure, and Invoice/Receipt Register against existing services and endpoints before adding any new schema.
4. **Reconcile source of truth:** document which legacy versus canonical account/ledger/invoice/payment objects each screen reads. Do not mix totals from incompatible models without a reconciliation rule.
5. **Add backend endpoints only for confirmed gaps:** especially durable income/expense journals, cashbook, budgets, and discount workflows. Add schema only after field ownership, approval semantics, audit behavior, and migration/backfill requirements are specified.
6. **Apply per-operation RBAC:** retain the existing proprietor/accountant distinction for read, create, update, publish/approve, void/reverse, and export. Add endpoint-level tests for every new view.
7. **Verify school isolation:** test every list, aggregate, export, and detail endpoint with two schools and a mismatched client-supplied school ID.
8. **Run route and production smoke tests:** verify both role portals, canonical view identity, API status, empty states, filters, export behavior, and no cross-school results before deployment.

## N. Files that will require modification in a future repair phase

This audit did not modify these files. They are the likely change set, subject to implementation design:

- `public/finance-canonical.html` — replace placeholder-only rendering with view-specific UI/data loading or delegate to dedicated pages.
- `public/receipts.html` / `public/receipts.js` — reuse or adapt for the canonical Receipts and Invoices & Receipts destinations.
- `public/reports-financial.html` — assess whether it should become the sole Finance Reports implementation.
- `src/sidebar-route-contract.js` — correct per-view component and API dependency declarations.
- `src/proprietor-sidebar-routes.js` — consolidate duplicate receipt navigation and clarify invoice/receipt aliases.
- `src/sidebar-registry.js` — adjust accountant navigation only if the final canonical route contract requires it.
- `src/server.mjs` — adjust page aliases and add only confirmed missing endpoint branches.
- `src/fees.js`, `src/fee-collections.js`, `src/reporting.js`, and related repositories — reuse/extend existing services rather than introduce duplicate finance services.
- `src/financial-authorization.js` — only if new operation/resource permissions are required; preserve least privilege.
- Relevant route/RBAC/school-isolation tests under `test/` — required for every repair.

## O. Migrations required, if any

**None required for the immediate placeholder root cause.**

Potential future migrations, only if the product confirms the corresponding modules are required:

- a durable general income/expense journal with school scope, approval state, reversal/audit fields, and indexes;
- a cashbook transaction/reconciliation model;
- budget and budget-line/utilization tables;
- a discount/concession award model if ledger entries alone are insufficient for approval and audit requirements.

Those would be new product/data-model decisions, not repairs that can be safely inferred from the current placeholder. Existing migrations 038 and 040–049 already provide substantial canonical fee-hub support and must be reconciled before adding more tables.

## Validation performed

- Exact placeholder search across the repository: one occurrence, in `public/finance-canonical.html`.
- Route, component, API, authorization, service, and schema inspection completed for the requested finance/fee destinations.
- Full repository test suite after installing declared dependencies: **738 tests passed, 0 failed**.
- Test execution generated a timestamp-only change in `docs/role-sidebar-route-audit.json`; that generated artifact was restored. The audit clone is clean and contains no application or schema changes.

## Final conclusion

The production symptom is a **route-wide frontend placeholder defect**. The system is not starting from an empty database: canonical fee/account/ledger/invoice/payment/receipt/reporting primitives and school-scoped authorization already exist. The safe repair is to connect each canonical navigation destination to the appropriate existing implementation, resolve route aliases, and add only the genuinely missing general-finance domains after their data model and RBAC requirements are approved.

**Part 2 was not implemented.**
