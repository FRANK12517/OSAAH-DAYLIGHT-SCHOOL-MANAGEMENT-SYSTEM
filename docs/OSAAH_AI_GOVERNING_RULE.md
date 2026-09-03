# OSAAH AI Governing Rule

## Permanent authority boundary

The **OSAAH Daylight School Complex School Management System** is the **System of Record**.

It remains the sole authority for:

- authentication and user identity;
- roles, permissions, and resource access;
- school configuration and operational records;
- students, staff, academics, attendance, and admissions;
- fees, payments, receipts, expenses, and financial reports;
- transport, hostel, communication, documents, and future modules;
- deterministic business rules and official audit records.

**OSAAH AI** is the **System of Intelligence**.

It may retrieve authorized information through controlled server-side tools, analyze and compare verified records, identify patterns, summarize, explain, recommend, prepare drafts, generate intelligence, and later propose controlled actions.

## Non-negotiable rules

1. AI enhances the existing application. It must never rebuild, replace, bypass, or destabilize it.
2. Existing OSAAH records and deterministic calculations always take precedence over generated output.
3. AI receives no unrestricted database access.
4. Every AI request inherits the authenticated user's existing role, permissions, school, portal, and resource scope.
5. AI cannot elevate permissions or accept client/model claims about identity or authorization.
6. Production analysis excludes test, demo, seed, development, and migration-validation data.
7. Missing, stale, conflicting, or incomplete data is disclosed rather than invented.
8. Financial and academic totals are calculated by deterministic OSAAH services, not by a language model.
9. Every AI capability and tool is explicitly registered, scoped, validated, and auditable.
10. AI write operations remain disabled until the Controlled Action phase.
11. Consequential actions require current authorization, validation, explicit confirmation, idempotency, and before/after auditing.
12. If AI is unavailable, the existing OSAAH application continues to operate normally.
13. Future modules become AI-aware through registration, not through rewrites of the AI core.
14. A module may explicitly set `aiEnabled = false` with a documented reason.

## Authority model

```text
Existing OSAAH application -> owns truth and executes transactions
OSAAH AI Platform          -> interprets, explains, and coordinates
Authorized users           -> retain decision-making authority
Audit and governance       -> provide traceability and accountability
```

This rule applies to every OSAAH AI design, implementation, test, deployment, and future integration.
