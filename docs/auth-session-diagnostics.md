# Temporary Authentication Session Diagnostics

Production session diagnostics are disabled by default. The server records these events only when `OSAAH_AUTH_SESSION_DIAGNOSTICS=1` is set for the running deployment. The flag must be enabled through the approved Vercel production environment workflow for a bounded diagnostic window, then disabled and followed by a redeploy.

The instrumentation writes structured records to server logs. It does not add an API endpoint or return diagnostic fields to a browser. The session endpoint and protected page authorization paths emit stages for credential receipt and cookie parsing, signature inspection, durable lookup, identity and role restoration, school assignment, and authorization. Successful login also records persistence and cookie attributes. Events use request IDs and truncated SHA-256 fingerprints to correlate a login with a later request; they do not contain cookie values, bearer tokens, session IDs, passwords, signing secrets, database connection strings, school IDs, or user identifiers.

The diagnostic target fingerprint is a one way digest of the configured database dialect and endpoint host, port, and database name. It excludes URL credentials and query parameters. The signing key and token fingerprints are also truncated one way digests. Fingerprints support equality checks during the diagnostic window; they cannot recover the source credentials.

When the normal durable session lookup does not return an accepted row, the service performs one additional read-only classification query restricted to the SHA-256 hash of the presented token. It checks whether that exact session row exists, whether it is revoked or expired, and whether its referenced identity exists. The query does not return other sessions, identity fields, or school values. Account activity is reported separately from the exact restore predicate so that a `NULL` status can be recognized as active by the login rule while still showing that the restore query's exact `u.status='ACTIVE'` condition rejects it.

Diagnostics are best effort. Errors from the classification query are recorded as a safe error type and code and do not replace the normal authentication result. Errors from the normal authentication lookup retain their existing behavior. The diagnostic feature does not change which token is accepted, how a session is persisted, or which authorization rules apply.

## Controlled production procedure

1. Deploy this change only through the protected pull request and production approval process.
2. Enable `OSAAH_AUTH_SESSION_DIAGNOSTICS=1` using the approved Vercel environment workflow and redeploy the approved commit.
3. Confirm the deployed commit and flag state. Perform the authorized login, `/api/auth/session`, and `/reports` checks, then correlate server records using the request ID and token fingerprint.
4. Disable the flag promptly, redeploy, and verify subsequent requests no longer emit diagnostic records.
5. Remove the temporary instrumentation in a reviewed follow-up change once the failure is understood. Retain its regression tests or replace them with targeted permanent coverage.

Do not copy production secrets or diagnostic logs containing sensitive account activity into source control or user-facing responses. Diagnostic log access and retention must follow the production logging policy.
