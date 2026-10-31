# TiDB runtime SQL compatibility

Production selects the `mysql2` TiDB adapter for `osaahdaylightschool`. The PostgreSQL adapter remains in the repository for historical tooling and tests; it is not selected by the production database selector. The targeted parent authentication and new duplicate-key helper require the TiDB dialect.

## Runtime SQL changes

| Module | Previous active-path SQL | TiDB implementation | Regression coverage |
|---|---|---|---|
| `src/admission-enrollment.js` | `ON CONFLICT` sequence initialization, role assignment, and parent link | Plain insert; on duplicate-key, query the exact target unique key. Re-throw collisions on another key. | `test/admission-enrollment.test.js`, `test/tidb-conflict.test.js` |
| `src/existing-student-linking.js` | `ON CONFLICT` sequence initialization | Plain insert plus exact sequence-key check. | `test/existing-student-linking.test.js` |
| `src/auth.js` | PostgreSQL upsert and TiDB `INSERT IGNORE` for phone rate limit | TiDB-only service and exact duplicate-key handling; no broad ignore. | `test/parent-sms-auth.test.js` |
| `src/durable-academic.js` | `ON CONFLICT DO NOTHING` for defaults | Plain insert plus exact identity check; unrelated unique collisions are errors. | `test/durable-academic.test.js`, `test/tidb-conflict.test.js` |
| `src/fee-collections-repository.js` | `ON CONFLICT DO NOTHING` for canonical fee type | Plain insert; only verified `(school_id, code)` conflict is treated as existing. | `test/fee-collections-repository.test.js` |
| `src/durable-announcements.js` | `ON CONFLICT ... DO UPDATE` read marker | Plain insert then exact recipient-key lookup and targeted update. | `test/durable-announcements.test.js`, `test/tidb-conflict.test.js` |
| `src/sample-fixture-repository.js` | `ON CONFLICT ... DO UPDATE` fixture | Plain insert then exact fixture-key lookup and targeted update. | `test/sample-fixture-repository.test.js` |
| `src/school-settings.js` | `ON CONFLICT ... DO UPDATE` setting | Plain insert then exact setting-key lookup and targeted update. | `test/school-settings.test.js` |
| `src/durable-result-blocking.js` | PostgreSQL cast and expression conflict target | `IS NULL`-compatible parameter comparison and generated normalized mock-label key with targeted insert/update. | `test/part8-result-blocking.test.js`, migration 083 checks |

`src/tidb-conflict.js` centralizes duplicate detection: it accepts MySQL duplicate-key errors only after a query confirms the intended conflict identity. This narrows ignored conflicts, but the check and subsequent update are not atomic by themselves. Callers that need strict concurrent upsert serialization must run them within a transaction or rely on the target unique key and retry policy. `announcement_reads`, `sample_data_fixtures`, and `system_settings` currently use direct database operations; simultaneous first writes may race, causing the second verification query/update to surface an error. This is a known follow-up requiring transaction-bound adapter methods and TiDB concurrency tests.

## Remaining audit boundaries

- Historical PostgreSQL strings remain in the dedicated PostgreSQL adapter and the non-production test compatibility branches; verify they cannot be selected in production before removing the adapter/dependency.
- `schema/001_foundation.sql` and `003_students_admissions.sql` contain SQLite `PRAGMA`; `002` and `004` contain SQLite seed syntax including `INSERT OR IGNORE` and `||`. These are historical and must not be replayed on TiDB.
- `schema/075_result_blocking_examination_scope.sql` drops/replaces an index. It requires data preflight and is not automatically safe to replay. Migration 083 is additive, but unique-index creation fails if duplicate scopes exist.
- All other date, JSON, lock, and placeholder behavior needs exact TiDB version verification. The repository code audit is not proof of production compatibility.

## Verification limits

No live TiDB credentials, read-only catalog result, production data, or Vercel environment were used. No claim is made that production login, SMS delivery, or every database-backed module works against the live service.
