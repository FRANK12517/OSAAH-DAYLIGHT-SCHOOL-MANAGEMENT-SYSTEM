# Production Deployment Linkage and Readiness

## Verified existing deployment

OSAAH Daylight School Complex is linked to the existing Vercel project below. These identifiers come from the repository's local Vercel linkage metadata and the public GitHub Deployments records; they must be reused rather than creating or guessing another project.

| Property | Verified value |
| --- | --- |
| Hosting provider | Vercel |
| Vercel project | `osaah-daylight-school-management-system` |
| Vercel project ID | `prj_oMzpGXKCDc7QnIRfGY0v7f6XsfG9` |
| Vercel organization ID | `team_sAVdHiUHkejVU6c5Vjfzh9mW` |
| Git repository | `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM` |
| Production branch observed in deployment history | `master` |
| Preview branch observed in deployment history | `main` |
| Latest verified successful Production commit | `31997d16e962f27142595796290da57a0d8be43b` |
| GitHub Production deployment ID | `6287516127` |
| Vercel deployment URL | `https://osaah-daylight-school-management-system-lih2pwmi9.vercel.app` |
| Previous successful Production commit | `5d176ec008465825219fc938e7ce1abed5b3a3a2` |
| Previous GitHub Production deployment ID | `6287349787` |
| Previous Vercel deployment URL | `https://osaah-daylight-school-management-system-1apvcgxou.vercel.app` |

The deployment URL is protected by Vercel authentication. A canonical custom production domain was not observable from the repository or public deployment status and must not be guessed. The linked metadata is stored locally as `.vercel/repo.json`; `.vercel` remains excluded from Git.

## Current decision: NO-GO

Do not deploy or enable production AI. Production persistence is not ready: the business domains audited in Part 16E still use process-local stores, no approved production database vendor/adapter is configured, and durable connectivity/migration health cannot be verified. The Vercel project environment could not be inspected with the local OIDC identity, so every required name below remains unverified and is treated as missing for release approval.

### Required AI names to verify in Vercel Production

- `OSAAH_AI_ENABLED`
- `OSAAH_AI_PROVIDER_ENABLED`
- `OSAAH_AI_PROVIDER_ID`
- `OSAAH_AI_MODEL_ID`
- `OSAAH_AI_API_KEY`
- `OSAAH_AI_ACTION_INTEGRITY_KEY`
- `OSAAH_AI_PROVIDER_TIMEOUT_MS`
- `OSAAH_AI_PROVIDER_RETRY_LIMIT`
- `OSAAH_AI_MAX_OUTPUT_TOKENS`
- `OSAAH_AI_MAX_TOOL_CALLS`
- `OSAAH_AI_MAX_ROUNDS`
- `OSAAH_AI_MAX_DURATION_MS`
- `OSAAH_AI_MAX_CONTEXT_CHARS`
- `OSAAH_AI_MAX_MESSAGE_CHARS`
- `OSAAH_AI_MAX_HISTORY_ITEMS`
- `OSAAH_AI_MAX_HISTORY_CHARS`
- `OSAAH_AI_MAX_CONVERSATION_TURNS`
- `OSAAH_AI_CONVERSATION_TIMEOUT_MS`

Keep `OSAAH_AI_ENABLED=false` until all persistence, migration, and acceptance gates pass. Environment audits must report names, target environments, and presence only; never print values.

### Required database configuration

- `OSAAH_DATABASE_ADAPTER_MODULE`
- The approved database vendor's connection-variable names, once the vendor is selected
- TLS, pooling, connection-timeout, and statement-timeout configuration suitable for Vercel Functions

Connection-variable names cannot be finalized safely until the database vendor is approved. No generic `DATABASE_URL` should be introduced merely to make this checklist appear complete.

## Required verification before release

An authorized Vercel project administrator must establish a read-only project audit session and verify:

1. the canonical production domain and Production branch;
2. presence and Production targeting of every required variable name;
3. approved durable database adapter and connection health;
4. migration status against the same database target, including migrations 018 and 022;
5. healthy durable AI audit and Human-Controlled Action stores;
6. restart-safe authoritative repositories for every Part 16E business domain;
7. current backup/restore point and responsible recovery operator;
8. previous known-good deployment remains available for rollback.

Follow `PRODUCTION_MIGRATIONS.md` for database backup, status, apply, verification, and recovery. Do not run migrations merely to test project linkage.

## Rollback mechanism

Before any future release, record the new deployment ID and retain the latest known-good Production deployment. On application failure, disable AI through `OSAAH_AI_ENABLED=false` and promote/redeploy the recorded known-good commit using the existing Vercel project. On persistence or migration failure, stop traffic-changing work and follow the approved database restore or forward-repair procedure. An application rollback does not itself reverse committed database migrations.

No deployment, environment mutation, migration, domain linkage change, or production credential creation was performed during this audit.
