# OSAAH AI System-of-Record Durability Assessment

## Decision

**Production AI is NO-GO.** The SQL schema and migration framework describe the intended relational model but the listed business services do not yet use a runtime durable repository. Their Maps and arrays are erased when a serverless instance or process is recreated. AI audit logging and Human-Controlled Actions are the only production-capable durable stores, provided an approved adapter is configured.

`src/ai/system-of-record-readiness.js` is the executable version of this assessment. If `OSAAH_AI_ENABLED=true` in production, server startup fails closed with `SYSTEM_OF_RECORD_PERSISTENCE_REQUIRED`. This remains true even when the Part 16D audit/action adapter is healthy: durable governance metadata cannot make transient business facts authoritative.

## Matrix

| Domain | Current service / runtime store | Classification | Restart persistence | School isolation | Schema | AI dependency / transaction requirement |
| --- | --- | --- | --- | --- | --- | --- |
| Students; parent links | `students.js`: Maps | TRANSIENT_ONLY | No | Service-scoped only | 003, 023 | Academic, attendance, admissions; enrolment/link changes need a transaction |
| Years, terms, classes, subjects | `subjects.js`: local collections | TRANSIENT_ONLY | No | Service-scoped only | 001, 007, 020 | School Context, academic tools |
| Teacher assignments | `staff.js`: array | TRANSIENT_ONLY | No | Service-scoped only | 009 | Academic and attendance scope |
| Scores and results | `academic-results.js`: Maps | TRANSIENT_ONLY | No | Service-scoped only | 007, 017 | Academic intelligence; score/publication transitions need atomic writes |
| Student/staff attendance | `attendance.js`: Maps | TRANSIENT_ONLY | No | Service-scoped only | 006 | Attendance intelligence; register changes need grouped atomicity |
| Admissions | `admission-form.js`, `students.js`: Maps | TRANSIENT_ONLY | No | Service-scoped only | 003, 015 | Admissions intelligence; acceptance/enrolment link needs a transaction |
| Staff/workforce | `staff.js`: Maps/array | TRANSIENT_ONLY | No | Service-scoped only | 009 | Workforce intelligence |
| Fee Hub, payments, receipts, income, expenses | `fees.js`: Maps/arrays | TRANSIENT_ONLY | No | Service-scoped only | 008, 015 | Finance intelligence; payment/invoice effects must transact together |
| Transport, hostel, welfare | `operations.js`: arrays | TRANSIENT_ONLY | No | Service-scoped only | 011 | Operational intelligence |
| Inventory, assets, procurement, maintenance | `resources.js`: arrays | TRANSIENT_ONLY | No | Service-scoped only | 012 | Operational intelligence |
| Communication/calendar | `communication.js`: arrays/Map | TRANSIENT_ONLY | No | Service-scoped only | 010 | Knowledge sources |
| Official Documents | `reporting.js`: array | TRANSIENT_ONLY | No | Service-scoped only | 014 | Knowledge sources |
| Admission Prospectus | `admission-prospectus.js`: Map | TRANSIENT_ONLY | No | Service-scoped only | 016 | Knowledge sources |
| School Profile | runtime configuration | NOT_PRODUCTION_READY | No verified durable source | Not established | 001 | School Context and knowledge |
| AI audit | `ai/durable-stores.js`: adapter-backed append-only table | DURABLE_PRODUCTION | Yes, with approved adapter | Query requires school scope | 018 | Governance only |
| Human-Controlled Actions | `ai/durable-stores.js`: adapter-backed action table | DURABLE_PRODUCTION | Yes, with approved adapter | School-scoped CAS/idempotency | 022 | Governance only; transitions use transactions |

## Required implementation sequence

1. Approve a database vendor and configure a production adapter; do not infer one from schema files.
2. Port the services in priority order behind their existing APIs: students/school structure, Fee Hub, results, attendance, admissions, staff, operations, then knowledge/document sources.
3. Preserve production provenance in each durable repository. `TEST`, `DEMO`, `SEED`, `DEVELOPMENT`, `MIGRATION_VALIDATION`, and uncertain legacy records remain excluded by Production Data Guard.
4. Require server-side school scope on every repository read/write. Browser- or model-supplied school IDs must never decide scope.
5. Add reconstruction tests for create, update, terminal transitions, cross-school denial, rollback, and AI reads after service recreation. For knowledge, rebuild the index from durable documents; never treat the index as the source of truth.
6. Only then replace the readiness gate with a repository-health assessment that proves every AI dependency is durable and healthy.

No production migrations, adapter configuration, or deployment was performed by this assessment.
