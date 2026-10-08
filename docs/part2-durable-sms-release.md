# Part 2 — Durable SMS Messages

## Implemented scope

- The **Messages** navigation entry is an SMS management workspace for Proprietor, School Administrator, and Headteacher only.
- A separate **In-App Messages** route preserves the existing parent–teacher messaging path and `/api/communication/messages` endpoints.
- Parent audiences are resolved server-side from active parent role/link records, the canonical school, non-test students, and normalized Ghana numbers. Parent phone lists are never returned by the roster-options or preview endpoints.
- Supported audiences: all registered eligible parents, one parent, selected parents, and parents linked to active students in a chosen class + academic year + term. Existing Basic/Primary and KG aliases are normalized for class matching.
- SMS drafts, campaigns, per-recipient provider references, failures, and delivery updates persist in Migration 077 tables. Duplicate campaign/phone records are constrained; sends require explicit confirmation, a signed server-issued preview token bound to the actor/message/recipient snapshot, and its one-use idempotency key. Sends re-resolve the parent roster and reject stale previews.
- Provider acceptance is recorded as `SUBMITTED`, not `SENT` or `DELIVERED`. Per-recipient references are required before acceptance is recorded; `DELIVERED`, `FAILED`, and `REJECTED` are applied from provider callbacks. Timeouts are recorded as `SUBMISSION_UNKNOWN` and are not automatically retried. Segment estimates use GSM-7/UCS-2 rules; price is not guessed when the provider does not return a quote.
- In absence of protected SMS configuration the UI allows preview and draft work, but disables sending and the server fails closed.

## Provider contract and settings

The current provider adapter implements Arkesel's official REST SMS endpoint, `POST https://sms.arkesel.com/api/v2/sms/send`, with the `api-key` header and JSON body (`sender`, `message`, `recipients`, `callback_url`). Provider credentials are read only from server environment variables:

- `ARKESEL_API_KEY` — protected secret; never place in client code or source control.
- `ARKESEL_SENDER_ID` — approved sender ID (up to 11 characters).
- `ARKESEL_CALLBACK_TOKEN` — high-entropy secret added to the private delivery callback URL.
- `ARKESEL_COST_PER_SEGMENT_GHS` — optional school-configured rate for each estimated SMS segment; preview multiplies this by recipient count and GSM/UCS-2 segments. If unset, the UI explicitly says the cost estimate is unavailable.
- `PUBLIC_BASE_URL` — canonical public site origin for callbacks; otherwise `VERCEL_URL` or the current Osaah site origin is used.
- `OSAAH_SMS_PREVIEW_SECRET` — protected high-entropy secret of at least 32 characters used to sign short-lived previews. Sending is disabled if it is absent.

The SMS persistence API is instantiated in Vercel Production only when Vercel's system environment markers identify `VERCEL=1`, `VERCEL_ENV=production`, and `NODE_ENV=production`. Preview/local deployments do not read or write SMS tables, regardless of inherited database or Arkesel credentials. No non-production provider sandbox/database integration is enabled; automated tests use isolated injected fixtures and mocked provider responses only. Provider credentials alone cannot enable SMS.

Official reference: [Arkesel SMS API developer documentation](https://developers.arkesel.com/) and [Arkesel SMS API overview](https://arkesel.com/developer-api/sms-api/). The provider request was not invoked in development or validation, and no live API key is configured by this change.

## Protected production release gate

1. Review and merge the feature branch/PR under normal repository protections.
2. Verify provider environment variables and the production callback URL in the protected production environment; do not put credentials in issue/PR text.
3. Configure `ARKESEL_API_KEY`, approved `ARKESEL_SENDER_ID` (maximum 11 characters), `ARKESEL_CALLBACK_TOKEN`, and `OSAAH_SMS_PREVIEW_SECRET` only in the protected Vercel Production environment; keep `ARKESEL_COST_PER_SEGMENT_GHS` optional and verify the public callback origin. Never expose these values in client code or PR text. No provider secret is required by Preview/local deployments.
4. Confirm Migration 076 is present in the production migration ledger with the exact committed checksum. Migration 077 intentionally blocks unless this is true.
5. Confirm a recent, restorable production backup. Trigger the workflow `Production SMS migration 077` in `dry-run` mode and review its read-only schema snapshot, exact checksum, prerequisites, and plan.
6. Apply only after the protected production environment approval, exact `APPLY_DURABLE_SMS_MESSAGES_077` secret, and explicit `BACKUP_CONFIRMED` input are available. The apply runner verifies created columns/indexes, three-role grants, absence of unauthorized role grants, preserved existing row counts, and the migration ledger checksum.
7. After separate deployment authorization, verify the Messages route and preview/draft flows with authorized test identities. Do **not** send to real parents during validation; any provider sandbox test requires an independently isolated database/provider configuration and must be separately authorized. No production migration, deploy, or SMS send was run as part of this implementation task.

## Validation

Focused tests cover role gating, Preview/local fail-closed behavior, page/API access, in-app messaging route preservation, test-data exclusion, Ghana number normalization and deduplication, class/academic context, segment estimates, durable draft/send records, signed preview freshness/expiry, idempotency, mocked provider acceptance/rejection and timeouts, delivery callbacks, and Migration 077 inventory and SQL policy. Full suite results are reported in the implementation handoff.
