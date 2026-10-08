# Part 2 — Durable SMS Messages

## Implemented scope

- The **Messages** navigation entry is an SMS management workspace for Proprietor, School Administrator, and Headteacher only.
- A separate **In-App Messages** route preserves the existing parent–teacher messaging path and `/api/communication/messages` endpoints.
- Parent audiences are resolved server-side from active parent role/link records, the canonical school, non-test students, and normalized Ghana numbers. Parent phone lists are never returned by the roster-options or preview endpoints.
- Supported audiences: all registered eligible parents, one parent, selected parents, and parents linked to active students in a chosen class + academic year + term. Existing Basic/Primary and KG aliases are normalized for class matching.
- SMS drafts, campaigns, per-recipient provider references, failures, and delivery updates persist in Migration 077 tables. Duplicate campaign/phone records are constrained; send requests require explicit confirmation and an idempotency key.
- Provider acceptance is recorded as `SENT`, not `DELIVERED`. `DELIVERED` is set only after a token-validated Arkesel callback. Segment estimates use GSM-7/UCS-2 rules; price is not guessed when the provider does not return a quote.
- In absence of protected SMS configuration the UI allows preview and draft work, but disables sending and the server fails closed.

## Provider contract and settings

The current provider adapter implements Arkesel's official REST SMS endpoint, `POST https://sms.arkesel.com/api/v2/sms/send`, with the `api-key` header and JSON body (`sender`, `message`, `recipients`, `callback_url`). Provider credentials are read only from server environment variables:

- `ARKESEL_API_KEY` — protected secret; never place in client code or source control.
- `ARKESEL_SENDER_ID` — approved sender ID (up to 11 characters).
- `ARKESEL_CALLBACK_TOKEN` — high-entropy secret added to the private delivery callback URL.
- `ARKESEL_COST_PER_SEGMENT_GHS` — optional school-configured rate for each estimated SMS segment; preview multiplies this by recipient count and GSM/UCS-2 segments. If unset, the UI explicitly says the cost estimate is unavailable.
- `PUBLIC_BASE_URL` — canonical public site origin for callbacks; otherwise `VERCEL_URL` or the current Osaah site origin is used.
- `OSAAH_SMS_ALLOW_NONPRODUCTION` — defaults to `false`; Vercel Preview/local deployments cannot access the SMS persistence API or send even if secrets are inherited unless this is deliberately enabled for an isolated test database and provider sandbox.

Official reference: [Arkesel SMS API developer documentation](https://developers.arkesel.com/) and [Arkesel SMS API overview](https://arkesel.com/developer-api/sms-api/). The provider request was not invoked in development or validation, and no live API key is configured by this change.

## Protected production release gate

1. Review and merge the feature branch/PR under normal repository protections.
2. Verify provider environment variables and the production callback URL in the protected production environment; do not put credentials in issue/PR text.
3. Confirm Migration 076 is present in the production migration ledger with the exact committed checksum. Migration 077 intentionally blocks unless this is true.
4. Confirm a recent, restorable production backup. Trigger the workflow `Production SMS migration 077` in `dry-run` mode and review its read-only schema snapshot, exact checksum, prerequisites, and plan.
5. Apply only after the protected production environment approval, exact `APPLY_DURABLE_SMS_MESSAGES_077` secret, and explicit `BACKUP_CONFIRMED` input are available. The apply runner verifies created columns/indexes, three-role grants, absence of unauthorized role grants, preserved existing row counts, and the migration ledger checksum.
6. After deployment, verify the Messages route and preview/draft flows with authorized test identities. Do **not** send to real parents during validation; only use a provider sandbox or separately approved test number. No production migration, deploy, or SMS send was run as part of this implementation task.

## Validation

Focused tests cover role gating, page/API access, in-app messaging route preservation, test-data exclusion, Ghana number normalization and deduplication, class/academic context, segment estimates, durable draft/send records, provider acceptance versus delivery callbacks, Migration 077 inventory and SQL policy. Full suite results are reported in the implementation handoff.
