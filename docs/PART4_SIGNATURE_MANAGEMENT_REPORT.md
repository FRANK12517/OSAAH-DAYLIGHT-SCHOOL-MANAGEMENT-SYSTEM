# Part 4 — Signature Management, Name, and Phone

## Discovered schema and services

The active implementation uses the in-memory `createSignatureService` in `src/signatures.js`. Signature records are scoped by `schoolId`, signatory role, academic year, term, class, and canonical staff identifier. Staff identity is provided by `src/staff.js`, whose canonical profile already contains `fullName`, `phone`, `roleKey`, employment status, and school scope. Class-teacher resolution uses the existing staff assignment records.

The existing API routes are `/api/result-signatures` for protected listing and profile creation, and `/api/result-signatures/:id` for protected deactivation. The existing signature result path is `student → class → staff assignment → staff profile → signature profile`, with school scoping enforced by both the staff and signature services. No duplicate staff identity table was introduced.

## Migration decision

No database migration was required. The current repository signature store is an in-memory service, and the existing canonical staff profile already has the required `fullName` and `phone` fields. Signature records now persist `fullName`, `phone`, `name` (renderer compatibility alias), and the existing secure storage reference alongside the existing role and academic context fields. A future durable adapter can map these fields without changing the API contract.

## Implementation changes

The signature service now requires a non-empty full name, a valid Ghana phone number using the existing `isValidGhanaPhone` validator, a supported signature MIME type, a positive bounded file size, and a safe relative `signatures/...` storage reference. For class teachers, name and phone default from the canonically assigned staff profile. For headteachers, they default from the active school Headteacher/Proprietor profile. Validation runs before deactivation, so a failed replacement cannot erase an existing valid signature.

The Result Signatures page now exposes Full Name, Phone Number, signature metadata, and a `SAVE SIGNATURE PROFILE` action. Staff name and phone values are pre-populated from the canonical profile when available. The result slip now renders `Name:` and `Phone:` for both Class Teacher and Headteacher signature blocks, retaining the existing safe image-source sanitizer and print/PDF placement below Attendance inside the navy/gold border.

## Security

Signature retrieval remains school-scoped and protected by the existing `signatures.manage`/Headteacher/Proprietor authorization path. Class-teacher signatures can only be saved for an active teacher assigned to the selected class and academic context. Arbitrary external URLs, traversal paths, whitespace-bearing references, and unsupported signature types are rejected. Missing signatures render a safe `Signature not uploaded` state rather than blocking result generation.

## Tests

The focused Part 4 signature suite passes **13/13** tests. It covers required name, phone, and signature validation; canonical identity prefill; failed replacement preservation; assigned class-teacher resolution; Headteacher resolution; cross-school rejection; missing-signature fallback; phone rendering; print/PDF-safe layout; and unchanged result calculations. The existing signature and academic result tests were updated to provide canonical staff phone metadata where the new validation is intentionally enforced.
