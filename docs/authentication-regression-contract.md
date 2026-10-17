# Authentication regression contract

This contract records the staff sign-in, session, role, and dashboard behavior that must remain covered before authentication changes merge.

## Supported staff login and dashboard mapping

Staff sign in through the School Portal with a username or email and password. The server looks up the account in PostgreSQL, verifies its stored password hash and active status, resolves the assigned role and permissions, then issues the existing signed session. Teacher username and email are both supported by the lookup; parent sign-in is a separate phone-based flow.

| Canonical role | Dashboard route |
| --- | --- |
| `PROPRIETOR` | `/reports` |
| `SCHOOL_ADMIN` | `/settings` |
| `HEADTEACHER` | `/academics` |
| `ASSISTANT_HEADTEACHER` | `/academics` |
| `ACCOUNTANT_BURSAR` | `/fees` |
| `TEACHER` | `/academics` |

Existing aliases such as `ADMINISTRATOR` and `SCHOOL_ADMINISTRATOR` resolve to `SCHOOL_ADMIN`; `ACCOUNTANT` resolves to `ACCOUNTANT_BURSAR`. Do not change these mappings or stored role values as part of unrelated refactoring.

## Session and authorization requirements

- Password verification and role selection remain server-side. Invalid credentials must not create a session.
- A database or session-storage failure returns a safe service-unavailable response, not an incorrect-password response, and must not set a session cookie.
- Sessions must be validated on the server and restored through `GET /api/auth/session`; logout invalidates the current session.
- HTTPS deployments use `Secure`, `HttpOnly`, `SameSite=Strict`, path-scoped session cookies. Do not weaken these attributes to make a test pass.
- API authorization must continue to enforce role permissions and parent-to-student relationships on the server. Client-side redirects are not authorization.
- Never include production credentials, passwords, cookies, or tokens in fixtures, logs, screenshots, or CI output.

## Required validation

Run `npm run test:auth:regression` for the focused maintained role matrix, database staff login, durable session, serverless session, and proprietor authentication tests. The dedicated `Authentication regression contract` workflow runs on pull requests and main-branch pushes that touch authentication, role routing, related tests, or the workflow itself. The full suite remains `npm test`.

Configure the `Authentication regression contract` status check as required in GitHub branch protection for `main`. Changes to the role map or authentication contract require the `@FRANK12517` review already enforced by `CODEOWNERS`. Intentional behavior changes must update this document, the matrix test, and any affected session, route-guard, and authorization tests in the same reviewed change.

## Production smoke test

Production account checks are manual, explicitly authorized smoke tests; they do not run from pull requests or deployments. Use one isolated browser context per supplied test account. Verify server acceptance, canonical role, expected dashboard content, session restore after refresh, and logout. Do not modify school records, roles, credentials, or published data. Record only the role, outcome, route, and sanitized error category.

## Recovery after an authentication regression

Stop further account attempts if the shared authentication service or database is failing. Inspect sanitized runtime logs to identify the failing stage. Revert through the repository's normal reviewed release process if the regression came from a deployment. Resolve certificate, environment, database schema, or account issues at their actual source; do not disable TLS verification, bypass session validation, or apply unreviewed production schema changes.
