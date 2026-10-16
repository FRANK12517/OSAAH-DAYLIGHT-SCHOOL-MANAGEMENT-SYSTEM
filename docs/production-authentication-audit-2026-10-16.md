# Production authentication audit baseline — 2026-10-16

This is a sanitized snapshot for the authentication regression work. No account identifiers, passwords, cookies, tokens, database URLs, or certificate values are recorded here.

## Verified baseline

- Repository: `FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM`.
- Test branch base: `d9b21855c1e5d1e456b59cb498228dd18da2a9b9` (`main`, merged PR #381). Existing unrelated Part29 changes remain in the original checkout and were not included in this branch.
- Production custom domain: `https://www.osaahdaylightschool.online` resolves to the existing Vercel application. The homepage and staff sign-in form render over HTTPS.
- Production deployment `u8kzCcW1AoVRxqsv1HX2nhyXk7fJ` was Ready on `main` at the base SHA above and had the custom domain assigned.
- Before the Production CA setting was added, the login API failed in the PostgreSQL TLS handshake with `SELF_SIGNED_CERT_IN_CHAIN`. The Supabase-published project root CA is now stored as a Vercel Secret scoped to Production; Preview keeps its separate CA and non-production database configuration. No SSL verification setting was weakened.
- Vercel created Ready Production deployment `u8kzCcW1AoVRxqsv1HX2nhyXk7fJ` on the same source SHA after that environment update. The live custom domain reached PostgreSQL on login, but `/api/auth/login` returned 503 and sanitized runtime logs reported PostgreSQL code `42P01` (`undefined_table`). This shows the TLS connection now reaches PostgreSQL; the login query is blocked by a missing relation in the connected schema. Logs did not identify which relation.
- Unauthenticated `GET /api/auth/session` returned 401, as expected.
- The live Production login attempt used the authorized test account for the first role only. It did not authenticate. The other five roles and all authenticated dashboard workflows remain untested while the shared schema failure persists.
- The canonical role-to-dashboard source is `SCHOOL_PORTAL_DASHBOARDS` in `src/auth.js`: Proprietor `/reports`, School Admin `/settings`, Headteacher `/academics`, Assistant Headteacher `/academics`, Accountant/Bursar `/fees`, Teacher `/academics`.
- Authentication tests use Node's built-in test runner. The pre-existing focused authentication/session tests and added role contract suite pass locally; this does not establish live account availability or schema completeness.

## Required next production action

Do not retry the role matrix until the owner verifies a restorable Supabase recovery point for project `douzohkmnuqwbpwcezke` and applies the already reviewed OSAAH production reconciliation/schema migration through the approved guarded process. Then verify the required relations and security settings with hosted catalog queries, redeploy Production if the environment changes, and resume the explicitly authorized six-account smoke test. No production SQL or school-record changes were performed during this audit.

## Baseline-to-change review

The regression branch is based on the verified `main` SHA above. Its intended changes are limited to PostgreSQL missing-relation diagnostics, six-role test coverage, CI enforcement, owner review rules, and this contract/audit documentation. Existing authentication decisions, database schema, passwords, and school records are not changed.
