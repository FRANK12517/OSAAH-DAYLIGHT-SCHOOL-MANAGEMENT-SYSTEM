# Admission Workflow Change Control

Use this checklist for pull requests that modify Admission / Admission Workflow or a documented dependency in `docs/ADMISSION_WORKFLOW_PROTECTION_BASELINE.md`.

## Review checklist

- [ ] Does the change affect admission navigation, module registration, route registration, or the Student Management shell?
- [ ] Does it affect authentication, authorization, school scope, session handling, or role permissions?
- [ ] Does it change admission form fields, validation, class IDs/labels, or step navigation?
- [ ] Does it affect Save Draft, resume, application identity, or duplicate request handling?
- [ ] Does it affect first-time, transfer, or already-enrolled student handling?
- [ ] Does it affect document requirements, assessment, review, application status, offer, or approval rules?
- [ ] Does it affect enrollment, Permanent Student ID generation, existing-student linking, transaction handling, or duplicate prevention?
- [ ] Does it affect admission APIs, database queries, persistence contracts, schema, indexes, or migrations?
- [ ] Have the admission protection command and relevant shared-component checks passed without skipped or uninitialized required tests?
- [ ] Are intentional behavior or API changes documented and approved by the designated maintainer?

## Required evidence in the pull request

Summarize affected contract areas, explain any behavior changes, list tests and exact results, and state whether a test database/browser fixture was used. Tests that create or mutate applications or student identities must use isolated deterministic fixtures or an approved non-production environment. Do not use production records as fixtures.

When a change intentionally updates the admission contract, update the baseline/contract documentation, manifest, regression assertions, and this checklist in the same reviewed change. A changed contract must remain explicit; do not weaken or delete a failing assertion to make the gate pass.

## Current known issue

The baseline documents an authenticated staff continuation route that currently returns 403 at `/admission-application.html`. Keep that issue visible and test the behavior after it is authorized for correction. Do not mark it as an accepted contract or make the route public as a workaround.
