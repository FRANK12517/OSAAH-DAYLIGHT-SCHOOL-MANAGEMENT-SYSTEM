# OSAAH AI Architecture Recommendations

## Required work before connecting a model

1. Establish the authoritative persistent data source and repository layer.
2. Reconcile runtime service objects with the declared SQL schema.
3. Remove source-controlled demo credentials from production startup paths.
4. Implement trustworthy data provenance without relabelling unknown legacy records as production.
5. Centralize school and resource-scope authorization around existing RBAC.
6. Add a persistent append-only audit sink with request correlation IDs.
7. Reconcile finance reporting, date/term filters, income classification, and payment relationships.
8. Introduce decimal-safe money handling and transactional financial writes.
9. Define secure document storage and access contracts.
10. Add structured request validation, logging, metrics, rate limiting, and production configuration validation.

## Recommended AI integration sequence

### Foundation

- Keep `src/ai` isolated from current domain services.
- Add the future AI Gateway under authenticated `/api/ai/*` routes.
- Reuse existing module keys in capability declarations.
- Keep tools narrow, server-side, schema-validated, and disabled by default.
- Make all authorization and production-data decisions before provider invocation.

### Context and data safety

- Build School Context from real configuration services.
- Attach school, academic year, term, portal, class, subject, and linked-student scope.
- Require every tool response to include provenance, freshness, completeness, and evidence metadata.
- Default production execution to `PRODUCTION` data only and deny unknown provenance.

### Deterministic intelligence

- Introduce deterministic financial and academic snapshots before narrative interpretation.
- Version snapshots and preserve the filters and source timestamps used to produce them.
- Return verified metrics separately from generated explanations.
- Prevent providers from recalculating official balances, grades, positions, attendance, or admission outcomes.

### Provider integration

- Add one provider adapter only after gateway, authorization, provenance, quality, and audit controls exist.
- Keep credentials and SDK-specific code inside the adapter.
- Redact and minimize provider payloads.
- Add timeout, retry, circuit-breaker, usage-limit, and health behavior.
- Ensure OSAAH continues normally when the provider is unavailable.

### Controlled actions

- Defer write tools until Phase 15.
- Separate recommendation, proposed action, confirmation, and execution.
- Reauthorize immediately before execution.
- Use existing deterministic application services for the actual mutation.
- Require idempotency and before/after audit evidence.

## Recommended ownership boundaries

| Concern | Owner |
|---|---|
| Identity and session | Existing OSAAH authentication |
| Permission decision | Existing RBAC plus centralized resource-scope guard |
| Records and transactions | Existing OSAAH services/repositories |
| Official calculation | Deterministic domain/reporting engine |
| AI-readable exposure | Registered server-side AI tool |
| Interpretation | Domain intelligence engine and provider abstraction |
| Execution | Existing service through Controlled Action Framework |
| Evidence and traceability | Persistent OSAAH/AI audit infrastructure |

## Release recommendation

Do not expose production AI merely because a provider can generate responses. Production readiness requires passing authorization-isolation, provenance, data-quality, audit, prompt-injection, privacy, financial reconciliation, regression, failure-mode, and rollback tests.

The release must be reversible by disabling the AI Gateway or capabilities without disabling any existing OSAAH module.
