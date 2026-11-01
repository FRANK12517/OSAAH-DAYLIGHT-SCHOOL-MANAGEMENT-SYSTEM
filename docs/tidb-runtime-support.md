# TiDB runtime selection status

## Configuration contract

The server's `OSAAH_DATABASE_ADAPTER` setting explicitly selects `tidb` or `postgres`.

- TiDB requires `OSAAH_DATABASE_ADAPTER=tidb` and `DATABASE_URL` in the form `mysql://username:password@host:port/osaahdaylightschool`. The existing TiDB adapter enforces TLS 1.2 or later and certificate verification. It does not support disabling certificate checks.
- PostgreSQL accepts the existing `OSAAH_POSTGRES_URL` or Vercel `POSTGRES_URL`; `OSAAH_DATABASE_ADAPTER=postgres` can make that selection explicit. `DATABASE_URL` by itself never selects PostgreSQL.
- If both database families are configured, or the selected family conflicts with the supplied URL, startup fails with a sanitized configuration error. No database URL, hostname, or credential is logged.
- `sch_default_01` remains the application school identity. This selector does not add tenant routing.

For Vercel, configure Preview and Production independently only after the corresponding connection target has been verified. Do not set Production during this implementation. A Preview URL must belong to an approved non-production TiDB database; never copy Production credentials into Preview.

## Compatibility and release gate

This change only wires the existing TiDB adapter into server adapter selection. It does **not** establish that current runtime SQL or the live TiDB schema is compatible. The current application query sources include PostgreSQL `ON CONFLICT ... DO UPDATE/NOTHING` statements and expression conflict targets alongside `?` placeholders and MySQL/TiDB maintenance SQL. The existing TiDB adapter passes query strings through to `mysql2`; it does not translate PostgreSQL upsert syntax. Core write paths including admissions/enrollment, fee publication, announcements, result blocking, and settings therefore need dialect-specific review and verified compatibility before TiDB can be used for production traffic.

The latest TiDB schema, migration ledger, required columns, indexes, and generated-ID behavior have not been inspected in this task. No live connection was attempted. Do not deploy or change Vercel variables until read-only inspection on the existing database and an approved non-production TiDB test target confirm compatibility. Do not run migrations as a substitute for this inspection.

## Reversibility

To return to PostgreSQL, set `OSAAH_DATABASE_ADAPTER=postgres`, restore the reviewed PostgreSQL URL variable, and remove `DATABASE_URL` from that environment. To disable database-backed startup rather than pick another database, remove database URLs only in a non-production environment where database-less startup is intentionally permitted. Never remove a Production URL as an unreviewed rollback step.
