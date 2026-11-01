# TiDB connection setup

OSAAH's application runtime selects TiDB explicitly with `OSAAH_DATABASE_ADAPTER=tidb`. It uses the existing Node.js server and the `mysql2` TiDB adapter. It does not use PostgreSQL, Supabase, SQLite, or another database at runtime.

## Required configuration

Set exactly one connection form in the server's secret/configuration store:

1. `DATABASE_URL=mysql://<username>:<url-encoded-password>@<host>:<port>/osaahdaylightschool`, or
2. `TIDB_HOST`, `TIDB_PORT`, `TIDB_DATABASE=osaahdaylightschool`, `TIDB_USER`, and `TIDB_PASSWORD`.

In both cases set `OSAAH_DATABASE_ADAPTER=tidb`. If URL and component values are both provided, they must agree. URL passwords must be percent-encoded. Never place these values in client-side variables or source control.

| Setting | Requirement |
| --- | --- |
| TiDB host | The actual host supplied for the isolated development cluster; not supplied by this repository. |
| Port | Provider-assigned port; the adapter fallback is `3306`. Set the actual cluster port explicitly and confirm it with the provider. |
| Database | `osaahdaylightschool`; enforced by runtime configuration validation. |
| Username/password | A dedicated TiDB account, supplied through the deployment secret store. Runtime use needs appropriate access to the complete OSAAH schema and data; migrations need separately controlled DDL rights. |
| TLS CA | `TIDB_CA_CERT` is optional when Node's trust store recognizes the provider chain. Supply the provider's PEM CA when required. TLS is always enabled with minimum TLS 1.2 and certificate verification (`rejectUnauthorized=true`). |
| TiDB server version | Must be confirmed against the isolated cluster before connecting. Repository configuration does not declare a supported version range; do not infer one from MySQL protocol compatibility. |
| Pool | `connectionLimit=10`, `connectTimeout=15000` ms; TLS minimum 1.2. |

The safe placeholders are in `.env.example` and `deploy/tidb.env.example`. Do not copy placeholder values into a live deployment. No TiDB endpoint or credentials were available during this phase, so no connection was attempted.

## Identity and readiness check

After an isolated development cluster and credentials are provisioned, run `node scripts/database-readiness.mjs --verify-tidb` with the TiDB settings and `OSAAH_TIDB_TARGET_ISOLATION_APPROVAL=ISOLATED_TEST_TARGET_CONFIRMED` in the authenticated local process. The readiness command verifies configuration, connects through the application adapter, checks TiDB server version and `SELECT DATABASE()` identity, and reports sanitized status. Stop if the selected database is not exactly `osaahdaylightschool` or if the version is not approved. This check does not initialize schema or run migrations.

The current `.env.local` must not be used for this purpose: its URL scheme is PostgreSQL and its selected database is not the canonical OSAAH database. The runtime rejects it before opening a connection.
