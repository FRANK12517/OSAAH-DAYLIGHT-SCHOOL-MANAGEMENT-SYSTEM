# OSAAH AI Phase 0A Part 1 Baseline Audit

## Executive finding

The repository is a framework-free Node.js application with a static HTML/CSS/JavaScript frontend, a custom `node:http` server, in-memory domain services, a declarative module registry, and a separate SQLite-compatible relational schema.

The critical baseline finding is that the declared SQL schema is not connected to the running application. No database driver, ORM, repository layer, migration runner, or persistent connection exists in the runtime. Operational records are currently stored in arrays and `Map` objects and are lost when the process restarts.

Future AI work must not treat the SQL schema as an already active production database. The authoritative persistence path must be established before production AI consumes school records.

## Technology stack

| Area | Current implementation |
|---|---|
| Frontend | Static HTML, CSS, and vanilla JavaScript |
| Backend | Node.js 20+ using `node:http` |
| Module format | JavaScript ES modules |
| Database design | SQLite-compatible SQL; 89 declared tables |
| Runtime persistence | In-memory arrays and maps |
| ORM/database client | None |
| API | Same-origin JSON endpoints under `/api/*` |
| Routing | Ordered pathname conditions in `src/server.js` |
| Authentication | Scrypt password hashing and opaque in-memory sessions |
| Session transport | HTTP-only, `SameSite=Strict` cookie or bearer token |
| RBAC | Role definitions, permission sets, route guards, and service scope checks |
| UI/state framework | None; DOM state and Fetch API |
| PWA | Manifest, service worker, shell cache, and browser retry queue |
| PDF support | `pdfkit` and application PDF helpers |
| Testing | Node's built-in test runner |
| Deployment, jobs, server cache | None found |
| Environment handling | Direct `OSAAH_PORT` lookup |
| Logging | Limited console logging |
| Audit | Audit contracts and in-memory events; no persistent sink |

## Runtime architecture

`src/server.js` is the composition root and monolithic HTTP router. It constructs authentication, student, attendance, examinations, finance, staff, communications, operations, resources, compliance, reporting, admissions, subjects, signatures, and receipt services.

Domain services are separated by file and contain deterministic business functions, but persistence, authorization, routing, request validation, and auditing are not centralized into reusable middleware or repositories.

## Implemented domains

- Authentication, password reset, session expiry, lockout, and account lifecycle
- Students, family links, class history, identifiers, transfers, and admissions
- Admission applications, reviews, enrollment, fee snapshots, analytics, and prospectuses
- Academic structure, subjects, examinations, grading, terminal/mock results, and promotions
- Student and staff attendance with offline conflict handling
- Fee structures, invoices, partial payments, receipts, refunds/reversals/cancellations, income, and expenses
- Staff profiles, assignments, confidentiality, attendance, and leave
- Announcements, notifications, messages, calendar, and preferences
- Library, transport, hostel, health, discipline, and counselling
- Inventory, assets, procurement, property, and maintenance
- Compliance, privacy, managed documents, official documents, and verification
- Academic, financial, and admission reporting

Some registered navigation entries share generic pages and are not complete independent workflows. Registry presence is not proof of production completeness.

## Database inventory summary

The 89 tables cover:

- schools, years, terms, levels, classes, streams, departments, subjects, and houses;
- users, roles, permissions, mappings, settings, navigation, and audit logs;
- student profiles, contacts, health, documents, histories, and parent links;
- two generations of admissions structures plus fees, documents, and prospectuses;
- attendance and offline conflict records;
- examinations, timetables, marks, score records, grading, promotions, and signatures;
- fee structures, invoices, payments, gateway configuration, and adjustments;
- staff, assignments, leave, balances, and documents;
- communication and delivery records;
- library, transport, hostel, health, welfare, and counselling;
- inventory, assets, procurement, property, and maintenance;
- compliance, privacy, documents, report exports, and official documents.

Important model overlaps include `students`/`student_profiles`, `staff`/`staff_profiles`, `admission_applications`/`admission_form_applications`, and `examination_marks`/`academic_score_records`. Runtime-to-schema mapping must be reconciled before persistence or AI integration.

There is no universal soft-delete policy, provenance field, or production/test/demo marker.

## Authentication and RBAC

The source defines 25 roles, ranging from Proprietor and School Admin through domain officers, teachers, parents, and students. `canAccess()` grants a named permission or wildcard access. Sidebar visibility is filtered by role, permission, portal, school type, subscription, entitlement, feature availability, and device.

Server endpoints independently enforce permissions and portal rules, while services add school, child, student, class, subject, confidentiality, or workflow restrictions. Authorization therefore exists on both frontend and backend, with the backend as the security boundary.

Risks include duplicated permission definitions, route-by-route policy logic, hard-coded demo identities, in-memory sessions, and incomplete central resource-scope enforcement.

## Financial flow

```text
Fee setup -> publication -> invoice liability -> payment -> receipt
  -> mutable paid/balance state -> statement/report
```

Invoices calculate totals and discounts server-side. Payments support partial settlement and produce unique receipts. Receipt changes preserve the payment record and restore invoice balance. Admission fee structures are versioned and captured as snapshots.

Financial risks requiring resolution before AI activation include:

- runtime payment references differ from the SQL relationship;
- mutable balances are not an immutable ledger;
- payment date/year/term filtering is inconsistent in reports;
- other income plus fee payments can be double-counted;
- currency uses floating-point numbers;
- write operations have no database transaction boundary;
- scholarships, waivers, and adjustments are not complete runtime workflows.

AI must consume validated deterministic financial snapshots, never calculate authoritative balances from raw conversational data.

## Reporting and navigation

Academic, financial, admission, and dashboard calculations are server-side JavaScript aggregations over service data. No warehouse, materialized metrics, or server cache exists.

The sidebar architecture is declarative and extensible through `registerModule`, `registerFutureModule`, `visibleSidebar`, classification, validation, breadcrumbs, and health diagnostics. It is the correct starting point for linking modules to future AI capabilities, but AI metadata also needs tool schemas, sensitivity, provenance, quality, audit, and action classifications.

## Demo and seed data

`src/auth.js` contains fixed demo users and credentials. SQL seed files create school, role, permission, category, and level data. Mock score records are explicitly typed, but there is no repository-wide record-provenance mechanism. Unknown records cannot safely be assumed to be production data.

## Principal risks and debt

1. Runtime data is not persistent.
2. Demo credentials are included in source.
3. Production/test/demo provenance is absent.
4. Audit events lack a mandatory persistent sink.
5. Financial records are not an immutable transactional ledger.
6. Runtime objects and SQL models diverge.
7. Authorization and permissions are distributed and duplicated.
8. Sessions cannot survive restarts or scale horizontally.
9. The application defaults to a hard-coded school ID.
10. Storage references have no production storage adapter.
11. Structured logging, validation, rate limiting, security headers, and deployment configuration are absent.

## Validation baseline

At completion of Part 1:

- `npm test` executed 89 tests;
- all 89 passed;
- no build or type-check script existed;
- no database migration was run;
- no application or schema file was changed;
- the Git working tree remained clean.

The detailed permanent rules derived from this audit are maintained in `OSAAH_AI_ARCHITECTURE.md` and `OSAAH_AI_GOVERNING_RULE.md`.
