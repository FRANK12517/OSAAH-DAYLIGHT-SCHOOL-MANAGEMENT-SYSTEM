# Database runtime selection

The application uses one configured database adapter for authentication, durable sessions, and AI persistence.

- To select TiDB, set `OSAAH_DATABASE_ADAPTER=tidb` and provide a server-side MySQL connection URL in `DATABASE_URL`. The URL must use `mysql://` and include host, database name, username, and password. The TiDB adapter enforces TLS 1.2 or later and certificate verification.
- PostgreSQL/Supabase remains supported through `OSAAH_POSTGRES_URL` or `POSTGRES_URL`. When `OSAAH_DATABASE_ADAPTER` is unset, a configured PostgreSQL URL continues to select PostgreSQL.
- A MySQL `DATABASE_URL` without explicit TiDB selection is rejected. Configuring TiDB and PostgreSQL URLs together is also rejected; remove the unused production URL when configuring the selected runtime.
- Production requires `OSAAH_SESSION_SECRET` for signed sessions. Startup does not run migrations or create tables. The read-only `/api/health` check reports database and durable `auth_sessions` availability separately.

This selection behavior does not verify that a configured server is TiDB or that the production schema is compatible. Before release, verify server identity, TLS, database name, `auth_sessions` columns/indexes, and login/session queries against an authorized TiDB environment. No live TiDB integration has been performed by this change.