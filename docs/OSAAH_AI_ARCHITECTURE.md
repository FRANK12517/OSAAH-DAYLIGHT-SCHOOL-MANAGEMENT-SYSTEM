# OSAAH AI Architecture

## Status and scope

This document is the permanent architectural contract for OSAAH AI. Phase 0A defines contracts only: no model provider is configured, no application data is sent to a model, no AI route or user interface is active, and no AI action can execute.

## System ownership

The OSAAH Daylight School Complex School Management System is the **system of record**. It owns authentication, authorization, school configuration, database records, financial transactions, academic and attendance records, admissions decisions, staff records, official documents, deterministic business rules, and audit records.

OSAAH AI is the **system of intelligence**. It may retrieve information through authorized server-side tools, analyze and explain verified results, compare and detect patterns, prepare drafts, make recommendations, and—only in a later approved phase—request controlled actions.

AI output never replaces a stored record or deterministic calculation. When an AI response and the system of record disagree, the system of record is authoritative.

## Permanent request path

```text
Authenticated OSAAH user
  -> AI Gateway
  -> AI Authorization Guard
  -> School Context Engine
  -> Capability Registry
  -> Tool Registry
  -> Production Data Guard
  -> Data Quality Guard
  -> AI Orchestrator
  -> AI Provider abstraction (not configured in Phase 0A)
  -> audited response
```

No UI, module, intelligence engine, or action handler may call a provider directly. Providers receive only the minimum authorized, validated tool output required for the operation. They never receive a database handle or unrestricted application data.

## Components

The permanent layer comprises the AI Gateway, Capability Registry, Tool Registry, School Context Engine, Authorization Guard, Production Data Guard, Data Quality Guard, Orchestrator, Provider Adapter, AI Audit Logger, domain intelligence engines, School Knowledge Engine, Dashboard Intelligence Engine, Alert/Briefing Engine, Controlled Action Framework, and Future Module Integration Contract.

Phase 0A introduces only dependency-free contracts and registries in `src/ai`. Domain engines and runtime wiring are deliberately deferred.

## AI Gateway contract

The future gateway is the sole AI entry point. It must:

1. accept an identity produced by existing OSAAH authentication;
2. generate or propagate a correlation/request ID;
3. derive school, portal, role, permission, class, subject, and linked-student scope server-side;
4. resolve the active academic year and term from authoritative configuration;
5. authorize the requested capability and every tool call;
6. apply provenance and data-quality guards;
7. record an audit event for success, denial, degradation, and failure;
8. invoke providers only through the provider abstraction.

Client-supplied role, permission, school, class, or student scope is never trusted.

## Tool architecture

An AI tool is a narrow server-side adapter over an existing OSAAH service or deterministic reporting path. A registered tool declares:

- stable tool identifier and description;
- required permissions;
- input and output schemas;
- school-scoping policy;
- whether production data is required;
- audit classification;
- `READ` or `WRITE` classification;
- capability/module ownership;
- implementation handler only when a later phase activates it.

Tools are deny-by-default. They return bounded data and evidence metadata, not unrestricted tables. Sensitive calculations reuse authoritative OSAAH functions. Write tools remain disabled until the Controlled Action phase and require validation, authorization, confirmation, idempotency, and an audit record.

## Capability Registry

A capability links an existing module to the intelligence it may expose. It declares module identity, category, enabled state, version, permissions, domain, tools, metrics, reports, actions, dashboard support, provenance rules, data-quality requirements, and audit requirements.

Capabilities complement the existing sidebar registry; they do not replace it. Stable `moduleKey` values from the sidebar are reused as `moduleId` values where possible.

## Future module integration contract

Every new OSAAH module is AI-ready by default. Completion requires, where applicable:

- navigation metadata in the existing module registry;
- an AI capability declaration;
- narrowly scoped server-side tools;
- RBAC and resource-scope rules;
- reportable metrics and their deterministic sources;
- provenance and test/demo exclusion rules;
- data-quality reporting;
- audit requirements.

A module may register `aiEnabled: false` with a non-empty reason. Registration does not itself expose data or activate a model.

## School Context

The School Context Engine must dynamically derive school identity, active year and term, levels, classes, subjects, assessment configuration, fee configuration, roles, available modules, calendar, and school rules from authoritative services. The context also contains the current user's server-derived scope. Missing configuration is reported as unavailable; it is never invented.

## RBAC inheritance

AI inherits existing authentication and `canAccess` permission semantics. Permission approval alone is insufficient: each tool also enforces school and resource scope, including assigned classes/subjects, linked children, department restrictions, financial sensitivity, and portal isolation. Authorization is checked at the gateway and again immediately before tool execution.

## Production-data isolation

The provenance vocabulary is:

- `PRODUCTION`
- `TEST`
- `DEMO`
- `SEED`
- `DEVELOPMENT`
- `MIGRATION_VALIDATION`

Production AI defaults to `PRODUCTION` only. Unknown provenance is not silently treated as production.

The current schema does not provide a universal provenance marker. A later backward-compatible migration should add provenance through an additive metadata table keyed by school, entity type, and entity ID, then gradually add indexed native provenance columns to high-volume tables. Existing rows must initially be classified as `UNKNOWN` and explicitly reconciled; they must not be bulk-labelled production without verification.

## Data Quality

Every tool result carries a quality envelope with one of:

- `COMPLETE`
- `PARTIAL`
- `STALE`
- `UNAVAILABLE`
- `INVALID`

The envelope includes assessment time, source freshness, completeness percentage when measurable, issues, and missing fields/records. For class performance this should include score-entry coverage, students or subjects with missing scores, unpublished assessments, and refresh time. AI explanations must disclose degraded quality and must not present partial data as final truth.

## Financial intelligence

```text
Authoritative financial records
  -> validation and reconciliation
  -> deterministic Financial Calculation Engine
  -> immutable/versioned Financial Snapshot
  -> AI interpretation
  -> dashboard or assistant
```

The provider may interpret an approved financial snapshot but may not calculate the authoritative balance from conversational text or arbitrary raw records. Existing reporting discrepancies identified in Phase 0A Part 1 must be resolved before financial AI activation.

## AI audit architecture

Every operation records metadata sufficient to reconstruct access and effects: ID, user, school, role, request ID, operation, capability, tool, data scope, timestamp, result status, provider and model when used, token/cost metadata when available, requested/executed action flags, and error code.

Raw prompts, student details, financial details, document contents, and model responses are not logged unless a specific approved purpose requires them. Prefer hashes, classifications, counts, record identifiers, and redacted metadata. AI audit events must ultimately use a persistent append-only sink; the current in-memory/no-op audit paths are not sufficient for production AI.

## Provider abstraction

Application code depends on an `AIProvider` contract exposing `generate`, `stream`, `toolCall`, and `healthCheck`. Provider SDKs and credentials remain inside provider adapters. No provider implementation or dependency is installed in Phase 0A.

## Controlled actions

Action execution is disabled until its dedicated phase. Later actions must separate proposal from execution and require a registered write tool, current authorization, validated inputs, explicit confirmation for consequential changes, idempotency, deterministic business-service execution, and before/after auditing. The model never writes directly to storage.

## Phased roadmap

0. Baseline audit and permanent architecture.
1. Gateway, registries, and foundation.
2. Production-data protection and security.
3. Dynamic School Context Engine.
4. Read-only assistant and tool orchestration.
5–11. Financial, dashboard, academic, attendance, admissions, staff/operations, and knowledge intelligence.
12–13. Role-specific assistants, briefings, alerts, and proactive intelligence.
14. Future-module automatic integration.
15. Controlled actions.
16. Hardening, regression, governance, and production release.

Each phase must preserve existing behavior, pass the existing test suite, and satisfy the security contracts established by all earlier phases.

## How to Make a New OSAAH Module AI-Ready

1. Create an `OSAAH_MODULE_MANIFEST` with a stable ID, semantic version, category, absolute route, sidebar placement, roles, explicit permissions, database/data ownership, production-data policy, metrics, audit policy, dependencies, and regression tests.
2. Register navigation through the existing sidebar/module registration adapter. Navigation registration does not activate AI.
3. Leave `ai.enabled` false by default and document why AI is unavailable or still under evaluation.
4. Implement and test server-side authorization and school/resource isolation before considering AI exposure.
5. Establish trustworthy production/test/demo separation and sensitive-field filtering.
6. Define narrow tools with mandatory input/output schemas, permissions, school scope, data-quality behavior, provenance requirements, and auditing.
7. Register an AI capability manifest under `src/ai/capabilities`. The discovery layer loads it without changes to the AI core.
8. Add deterministic metrics and reports through authoritative OSAAH services. Do not delegate official calculations to a provider.
9. Add tests for validation, permission denial, cross-school isolation, provenance exclusion, incomplete data, sensitive output, audit events, and failure behavior.
10. Activate only after all safeguards pass. `PREPARE_ACTION` and `WRITE` remain unavailable until their approved implementation phases.

Capability versions use semantic versions and are addressable by major key, such as `finance@1` and `finance@2`. An unversioned lookup resolves the latest registered major version. Health is reported independently as `ACTIVE`, `DISABLED`, `DEGRADED`, or `UNAVAILABLE`, allowing orchestration to avoid incomplete or unavailable backends.

Developer diagnostics expose metadata only: registered module identities, capabilities, enabled tools, health, and sanitized validation errors. Diagnostics require a development/test environment or the `ai.diagnostics.read` permission and must never include school records or confidential configuration.
