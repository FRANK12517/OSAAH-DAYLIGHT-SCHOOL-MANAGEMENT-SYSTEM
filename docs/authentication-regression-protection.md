# Authentication regression protection

## Authentication contract

School portal login is handled by `POST /api/auth/login`. The server normalizes the identifier, verifies the password against the configured persistence adapter, checks account eligibility, resolves the canonical role and permissions server side, and issues the `osaah_session` cookie. The cookie is HTTP-only and uses `SameSite=Lax`; production responses include `Secure`. Session records use durable storage when the configured adapter supports it. `GET /api/auth/session` restores the authenticated user and server-selected destination. `POST /api/auth/logout` revokes the session and clears the cookie.

Role keys and landing routes are defined by `SCHOOL_PORTAL_DASHBOARDS` in `src/auth.js`:

| Role key | Destination |
| --- | --- |
| `PROPRIETOR` | `/reports` |
| `SCHOOL_ADMIN` | `/settings` |
| `HEADTEACHER` | `/academics` |
| `ASSISTANT_HEADTEACHER` | `/academics` |
| `ACCOUNTANT_BURSAR` | `/fees` |
| `TEACHER` | `/academics` |

The application uses the existing single-school identity. Protected APIs must authorize from the server-resolved actor and permissions; client route visibility is not an authorization boundary.

## Local verification

Run the focused authentication and proprietor browser suite with:

```sh
OSAAH_RUN_LOCAL_AUTH_BROWSER_TESTS=1 npm run test:auth-regression
```

Run the isolated Playwright staff role matrix with generated synthetic users and credentials using:

```sh
npx playwright install chromium
OSAAH_RUN_LOCAL_AUTH_BROWSER_TESTS=1 node --test test/staff-role-auth-browser.test.js
```

On Windows PowerShell, set the environment variable with `$env:OSAAH_RUN_LOCAL_AUTH_BROWSER_TESTS = '1'` before running the test. The browser test creates synthetic accounts in process and does not use production identities.

## Production smoke tests

Production credential checks are manual and opt-in. Do not put production credentials in source, command-line arguments, test output, CI variables available to ordinary pull requests, screenshots, or artifacts. Use an approved secret store and an isolated browser context for each account. A production run must verify the session endpoint's server-resolved role, the role's expected route, dashboard content, refresh persistence, a permitted protected API, a denied cross-role API, and logout revocation. Do not create users, reset credentials, change roles, or modify school data to make a check pass. Record only role, identifier type, result category, HTTP status, route, and sanitized diagnostics.

For an approved, time-limited production session investigation, set `OSAAH_AUTH_SESSION_DIAGNOSTICS=1` in the protected Production environment and release the diagnostic build through the normal reviewed deployment process. The server logs cookie attributes without the cookie value, HMAC key configuration fingerprint, process/request/deployment correlation, a fingerprint of the configured database target, credential parsing result, signature outcome, token and session-ID fingerprints, durable-store lookup outcome, record-state classification, restored role category, and authorization result. Fingerprints are truncated SHA-256 digests and cannot be used as session credentials. The record classification query is read-only and is restricted to the hash of the presented session token. Do not enable broad request/body logging. Remove the diagnostic environment flag after the controlled test and retain only the sanitized report in access-controlled logs.

Do not add production credential smoke tests to routine deployment triggers. This repository's current synthetic browser matrix is the CI safeguard; its credentials are generated per run and never persisted.

## CI release gate

The `Verify protected components` workflow runs the authentication unit, durable session, role-routing, and Playwright browser regressions on pull requests and pushes to `main`. A failed assertion fails the workflow. The browser matrix requires Chromium, installed by the workflow. Repository branch protection should require the `Verify attendance integrity and protected components` job before merge; required status-check configuration is managed in GitHub repository settings and is not defined by workflow YAML.
