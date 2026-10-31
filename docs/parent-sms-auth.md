# Parent Portal phone-only sign-in

The Parent Portal accepts the registered Ghanaian phone number in `POST /api/auth/login`. It does not request a password or SMS code, send a login message, or call the Arkesel gateway. The server ignores client-supplied passwords, codes, and role values for this portal. Staff still use their existing username, password, and server-assigned role flow. Arkesel remains available to authorized school messaging services.

## Server checks

The login lookup normalizes Ghana phone formats and requires exactly one matching phone account. It joins the account to the canonical `sch_default_01` school, an active school-scoped `PARENT` role assignment, an active `parent_student_links` row, a same-school `student_profiles` record, and the same-school `students` master row referenced by `student_profiles.student_master_id`. Account, profile, and master status checks run before session creation. A missing/ambiguous/inactive relationship gets the same generic denial; database or session-store failures fail closed. Durable per-phone rate limits use `parent_auth_rate_limits` in a transaction. The application must have the existing schema migration `082_parent_sms_auth.sql` applied before enabling this login path; no OTP secret is required.

The relationship and student authorization checks remain in force for every Parent Dashboard request. The login response does not embed child identities or grant access based on a phone number alone.

## Security limitation

Phone-only sign-in does not prove that the person entering a registered number owns or controls that phone. Anyone who knows the number may potentially access the associated Parent account. This is an explicit authentication risk and requires the school's acceptance and security review before release. Rate limits and relationship checks reduce abuse and scope access, but they do not verify phone ownership.

## Retained legacy SMS challenge schema

The `src/parent-sms-auth.js` challenge service and the `parent_auth_challenges` table/migrations are retained for historical recovery and are not wired to the Parent login routes. `POST /api/auth/parent/request-code` and `POST /api/auth/parent/verify-code` are not registered. The challenge tables are not automatically dropped. `parent_auth_rate_limits` from the existing migration is still used for shared login throttling; the login path does not use challenge rows or require `OSAAH_PARENT_OTP_HMAC_SECRET`.

## Validation and release limits

Automated tests use synthetic database adapters and do not establish live TiDB compatibility, production account eligibility, actual dashboard rendering with the approved parent record, SMS delivery, or any of the six real staff account login paths. The phone `0247293733` must be checked against the intended TiDB records, including the student's authoritative master relationship, before a controlled release smoke test. Never claim production login or dashboard success based only on mocked tests.
