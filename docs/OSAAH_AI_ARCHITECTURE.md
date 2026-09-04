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

Application code depends on an `AIProvider` contract exposing `generate`, `toolCall`, `stream`, and `healthCheck`. The repository-native provider registry selects only explicitly enabled providers, publishes sanitized configuration metadata, caps output tokens, normalizes timeouts and failures, and never silently falls back to another provider. Provider requests accept only the authorized query, sanitized School Context, approved tool definitions/results, request identifiers, and an output limit.

`DisabledAIProvider` is the production-safe default and `DeterministicMockAIProvider` supports network-free tests. Provider responses are normalized to text, tool requests, finish status, provider/model identifiers, token usage, latency, and a safe error code. Provider SDKs and server-resolved credentials remain inside future adapters. No live provider, vendor SDK, API key, or credential is configured by this phase, and the AI Gateway remains provider-unavailable until an approved integration explicitly connects the registry.

The first live adapter is the server-only `OpenAIResponsesProvider`, selected exclusively through `createConfiguredAIProviderRegistry`. It calls the Responses API with `store: false`, a bounded output limit, and only minimized gateway inputs. The adapter uses the native Node runtime HTTP client through `fetch`; no vendor SDK or browser bundle is added. Provider tool requests are revalidated against the authorized Tool Registry and may describe only enabled READ or ANALYZE operations. They are not executed by the adapter.

Configuration names are `OSAAH_AI_PROVIDER_ID`, `OSAAH_AI_MODEL_ID`, `OSAAH_AI_API_KEY`, `OSAAH_AI_PROVIDER_ENABLED`, `OSAAH_AI_PROVIDER_TIMEOUT_MS`, `OSAAH_AI_PROVIDER_RETRY_LIMIT`, and `OSAAH_AI_MAX_OUTPUT_TOKENS`. The enable flag defaults off. Enabling requires an approved provider identifier, model, and server credential. Credentials are never included in registry metadata, provider results, audit events, or frontend code. Timeouts abort the outbound request; retries are bounded to timeout, rate-limit, and unavailable failures. With the switch off or the provider unavailable, repository-native deterministic intelligence continues without a provider call.

## Core orchestration

`createAIOrchestrator` is available only through the authenticated AI Gateway. The Gateway establishes identity, School Context, and every requested capability authorization before orchestration begins. The provider receives the approved READ/ANALYZE tool definitions but never executes a tool. Each returned tool request is checked again for its registered name, capability, operation, argument schema, prohibited SQL/storage fields, and authenticated school scope before `executeAuthorizedAITool` runs it. The existing executor reapplies RBAC, Production Data Guard, and output-schema minimization; Data Quality Guard then assesses the minimized result before it is returned to the provider for a grounded final response.

Zero-tool, one-tool, bounded multi-tool, and sequential rounds are supported. Cross-capability questions require every capability to authorize independently. Limits default to six tool calls, three provider rounds, 15 seconds, 1,024 output tokens, and 50,000 serialized context characters. Server configuration can change these with `OSAAH_AI_MAX_TOOL_CALLS`, `OSAAH_AI_MAX_ROUNDS`, `OSAAH_AI_MAX_DURATION_MS`, `OSAAH_AI_MAX_OUTPUT_TOKENS`, and `OSAAH_AI_MAX_CONTEXT_CHARS`; invalid or exhausted limits fail closed.

The final response separates provider narrative from immutable authoritative tool evidence. Reporting periods, source counts, missing counts, production-only status, quality state, and warnings remain server-derived. Narrative containing an unsupported numeric value is withheld. Narrative claiming complete, verified, or definitive data is also withheld whenever aggregate quality is PARTIAL, STALE, UNAVAILABLE, or INVALID. Conversation history is not an authorization input and provider-requested WRITE operations remain disabled.

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

## Production Data Guard

The server-side Production Data Guard is the mandatory boundary between authorized source queries and all future AI tools:

```text
Authorized query -> repository/source records -> Production Data Guard
  -> data-quality envelope -> sanitized structured result -> future AI layer
```

It recognizes the centralized provenance categories `PRODUCTION`, `TEST`, `DEMO`, `SEED`, `DEVELOPMENT`, and `MIGRATION_VALIDATION`. Production execution defaults to production-only and rejects client attempts to request test data, disable filtering, or select another provenance. Development and test environments may opt into fixtures only through server-controlled configuration.

New records derive provenance from the trusted runtime and creation source through `createRecordProvenance`; seeders, fixtures, demos, developer utilities, and migration validation must pass their source so they are classified automatically. Browser input must never set provenance.

Legacy records without provenance fail closed. A reviewed, server-owned `legacyClassifier` may recognize a specific legacy record as operational; accepted legacy records produce `PARTIAL` quality and a warning. Unknown legacy records are excluded rather than silently labelled production. Because the current SQL design is not connected to runtime persistence, no speculative database migration is introduced in this phase. A later persistence migration must add provenance without changing IDs, amounts, scores, or timestamps and must reconcile unknown rows explicitly.

Every enabled operational capability declares `productionDataOnly`, `provenanceAware`, and `dataQualityAware`. Every enabled tool explicitly declares production, school-scope, quality, and audit policies. Diagnostics expose only policy state and aggregate exclusion counts—not excluded records or personal/financial content.

Academic scores, payments, expenses, attendance, admissions, and staff records all use the same guard contract. Domain-specific AI tools must filter before aggregating averages, balances, counts, projections, alerts, or recommendations. A provider is never responsible for deciding whether data is genuine.

## AI Authorization Model

Every AI tool call uses the authenticated user object returned by the existing OSAAH authentication service. The AI layer has no login, account store, session format, role mapping, or permission system of its own. Client/model payload fields claiming a role, school, permission, or assignment are ignored as authority and cannot replace server-derived context.

`createAIAuthorizationContext` normalizes the authenticated user ID, school, role, permissions, portal, session metadata, assigned classes, subjects, departments and students, linked parent students, and optional server-resolved academic period. Invalid or incomplete authenticated context is denied.

Authorization is deny-by-default and ordered as follows:

```text
Existing session authentication -> capability lookup and health
  -> capability permission and role constraints -> tool registration
  -> tool permission and operation type -> school/object scope
  -> Production Data Guard -> field-minimized structured result
```

Unknown capabilities return a safe permission denial; unknown or malformed tools return `TOOL_NOT_ALLOWED`. Disabled or unhealthy capabilities return `CAPABILITY_DISABLED`. Cross-school, class, subject, department, student, and parent-child failures return `SCOPE_DENIED` without confirming whether the requested record exists. `WRITE` always returns `WRITE_DISABLED`; `PREPARE_ACTION` remains unavailable.

Teacher scope follows the existing assignment fields (`assignedClassIds`, `assignedSubjectIds`, and `assignedStudentIds`). Parent scope requires a student ID present in the authenticated account's existing linked children. Knowing an ID, index number, or name never creates authorization. Combined tools must pass every capability listed by the execution request; one permitted domain cannot unlock another.

Tool implementations are called only by `executeAuthorizedAITool`. The wrapper overwrites the tool's school input with the authenticated school, applies the Production Data Guard, and minimizes output to fields declared by the tool's output schema. Tool handlers and future model-generated arguments remain untrusted inputs to these server-side checks.

Current financial RBAC is not expanded here. The registered Finance capability currently permits Proprietor and Accountant/Bursar. Existing application permissions give the Headteacher `finance.read`, but the capability's explicit role constraint does not currently include Headteacher; Assistant Headteacher does not currently have equivalent finance permission. Those discrepancies must be resolved explicitly in the financial implementation phase rather than through silent AI privilege expansion.

## AI Audit and Governance

Every request entering the approved AI tool-execution boundary receives a server-generated `requestId` and a `correlationId`, unless trusted gateway values are propagated. Those identifiers remain consistent across request receipt, authorization, tool execution, production-data filtering, completion, denial, and failure events. Future Data Quality Guard and provider adapters must propagate the same identifiers.

`AIAuditLogger` writes immutable structured events through an append-only sink contract. The event model records identity and school context, capability and tool identifiers, operation type, authorization result, safe data scope, production-only policy, data-quality state, request status, duration, severity, environment, and safe error codes. It reserves nullable provider, model, token-usage, cost, latency, controlled-action approval, target-record, and rollback-reference fields without enabling a provider or action execution.

Audit metadata is privacy-first. Raw prompts, tool inputs, database rows, student or parent profiles, payment details, credentials, cookies, session/access tokens, API keys, database URLs, and provider responses are not accepted as general metadata. A central redactor removes secret-named values, and metadata is constrained to an explicit safe allowlist of counts, references, reporting periods, cutoffs, quality indicators, and action-governance identifiers. Production filtering events store included/excluded counts and provenance-violation state, never excluded records or payment values.

The additive `ai_audit_logs` schema is separate from the general business `audit_logs` table because AI requests produce multiple correlated events and require provider/action-ready fields and indexes. It is indexed by time, request/correlation, user, school, capability, status, and operation. The current runtime remains storage-adapter based; production persistence must connect the logger's append-only sink to this schema before an external model is enabled. In-memory storage is for the current provider-free runtime and automated tests only.

Retention is centrally configurable and has no arbitrary default expiry. Ordinary AI requests never delete audit records. Any future archival or deletion job must be approved under the school's retention and privacy policies and must not mutate evidence during request processing.

AI audit diagnostics reuse `ai.diagnostics.read` in production and are school-filtered. Parents, teachers, and unrelated staff cannot inspect system-wide events. Diagnostics expose only recent safe event metadata, authorization failures, filter counts, quality states, and error codes; they do not expose prompts, records, secrets, or model content.

Audit persistence failure never changes an authorization denial into an allow and never disables Production Data Guard. Denied requests remain denied while the persistence failure is sent to the configured monitoring callback. For an authorized tool declaring `auditRequired`, failure to persist required audit events stops execution before the handler runs or fails the request, preserving a fail-closed boundary without leaking tool results.

Future financial summaries may record a deterministic calculation reference, academic year, term, reporting cutoff, source-record count, quality state, and requesting user. They must not copy individual payment values into AI audit events. Future controlled actions must separately record recommendation, approval or rejection identity/time, execution status, target reference, and rollback reference; autonomous and controlled AI actions remain disabled.

## School Context Engine

`SchoolContextService` assembles minimized, structured school context from authoritative OSAAH service adapters at request time. The adapters represent the existing sources of truth for the school profile, academic years, terms, calendar, classes, subjects, teacher allocations, assessment rules, fee structures, admission configuration, and role assignments. Sidebar and AI capability registries provide module availability. The context engine does not introduce a parallel configuration database and does not infer missing configuration.

Academic-year and term resolution is deterministic. An academic year is active only when the authoritative source marks it active/current or exactly one dated configuration contains the current school date. Terms use their configured identifiers and names and may resolve as `NOT_STARTED`, `ACTIVE`, `ENDED`, or `ARCHIVED`. Zero or multiple active candidates produce `ACADEMIC_YEAR_MISSING`, `ACTIVE_TERM_MISSING`, or multiple-active warnings rather than selecting the newest row. Calendar context exposes only structured current-term event references and dates and derives whether the school is currently in session.

Classes, levels, subjects, class-subject relationships, and teacher assignment references are read dynamically. Teacher context is restricted to the authenticated teacher's current class and subject assignments. Assessment context carries the existing CA/examination maxima, weights, grading boundaries, and result-publication states supplied by the authoritative academic service; the context engine does not calculate or modify scores.

Context types—`BASIC_SCHOOL`, `ACADEMIC`, `FINANCIAL`, `ADMISSIONS`, `STAFF`, `OPERATIONS`, and `FULL_MANAGEMENT`—load only their declared source sections. Financial context contains fee-structure references and applicability, not invoices, payments, or amounts. Admission context contains cycle status and eligible class references, not applicant records or documents. Module context reports only registered, enabled modules visible to the authenticated role and permissions.

Every request derives identity, school, role, permissions, and teacher assignments through the existing authorization context. Client-submitted authority is not accepted. Every configuration collection passes the Production Data Guard and must carry trusted provenance and school scope from its source adapter; excluded data contributes only counts and structured warnings. Missing school or period configuration produces `CONTEXT_PARTIAL` or `CONTEXT_UNAVAILABLE` with `COMPLETE`, `PARTIAL`, or `UNAVAILABLE` quality metadata.

Context is resolved at request time, so stale cached configuration cannot override the system of record. A canonical SHA-256 fingerprint of the filtered, role-minimized configuration supplies `contextVersion`; it changes when relevant context changes but not merely because generation time changes. Generation is audited through the existing AI audit logger using request/correlation ID, user, role, school, context type, version, quality, warning count, and excluded-record count—never the raw context.

## Data Quality Guard

`AIDataQualityGuard` is the centralized server-side quality boundary for AI-safe results. It uses the standard `COMPLETE`, `PARTIAL`, `STALE`, `UNAVAILABLE`, and `INVALID` states and carries source count, missing count, source update time, reporting period, warnings, and an evidence-based completeness percentage when an expected count is explicitly supplied. Unknown or unvalidated evidence resolves to `INVALID`; no model or client may assert quality.

The guard can apply Production Data Guard before assessment, validates all quality metadata, and marks only validated, available, current results with no known missing items as verified complete. Capability and tool registries continue to require explicit `dataQualityAware` policy for enabled production access. School Context uses the guard after authorization, production filtering, school scoping, period resolution, and minimization. Quality audit events contain correlation metadata and counts only, never source rows.

## Repository-native AI Gateway

`AIGateway` is the only server-side entry point for AI operations. The authenticated server identity is converted to the existing authorization context before School Context, capability, tool, scope, production-data, and data-quality checks run. Request and correlation identifiers flow through every layer and safe gateway lifecycle events. Unknown, mismatched, disabled, unauthorized, cross-school, and WRITE requests fail closed with structured errors.

The HTTP boundary is `POST /api/ai/gateway`; it ignores client-supplied identity and uses only the authenticated OSAAH session or bearer token. Tool handlers remain registered, bounded service adapters and receive no database handle. No external provider is configured or invoked in this phase; a provider-required request returns `PROVIDER_UNAVAILABLE` after authorization and validation.

## AI Assistant Conversation Boundary

The authorized dashboard assistant uses `POST /api/ai/conversation` as its browser-facing boundary. The route resolves the current OSAAH session server-side and forwards only the authenticated user, bounded message, opaque conversation reference, and validated history shape to `AIConversationService`. Client claims about user, role, permission, or school are ignored. The service recomputes capability authorization on every message before invoking the AI Gateway, so prior conversation content cannot retain revoked access.

Conversation state stores only the opaque identifier, user and school ownership, turn count, and timestamps. It does not persist prompts, provider credentials, student/staff/financial rows, or tool results. `POST /api/ai/conversation/reset` deletes that minimal state. Message length, history item/character counts, turn count, request duration, and selected capability count are bounded by server policy. Prompt requests to bypass authorization, expose system instructions or secrets, execute SQL, or perform writes are rejected before Gateway execution; WRITE remains globally disabled.

The response contract exposes a safe explanation, authoritative minimized facts, reporting periods, quality state, and quality warnings. Internal tool names, schemas, prompts, provider configuration, and audit internals are not returned. Partial, stale, invalid, or unavailable evidence retains its server-generated quality state and cannot be rendered as verified complete. Provider or orchestration outages become a controlled assistant-unavailable response and do not affect other OSAAH dashboard functions.

The UI is mounted into the existing authenticated dashboard workspace and first requests server-generated suggestions. If no authorized capability or conversation service is available, the assistant is not displayed. Suggested questions derive from current authorized capabilities. Browser code calls only OSAAH conversation endpoints, renders returned values through DOM text APIs, and has no provider SDK, credential, or direct provider route.
