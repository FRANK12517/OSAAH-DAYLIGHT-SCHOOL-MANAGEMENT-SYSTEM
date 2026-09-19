# Part 2 — All Authorized Role Sidebars + Exact Routing

## Scope

Part 2 continues from Part 1 and preserves the single canonical Class Database implementation. No duplicate role names, dashboard, student directory, route, or Class Database component was created.

## Role access result

| Role | Class Database Visible | Click Works | Exact Class Database Opens | Data Loads | Result |
|---|---:|---:|---:|---:|---|
| School Proprietor (`PROPRIETOR`) | Yes | Yes | Yes | Yes | PASS |
| School Accountant (`ACCOUNTANT_BURSAR`) | Yes | Yes | Yes | Yes | PASS |
| Headteacher (`HEADTEACHER`) | Yes | Yes | Yes | Yes | PASS |
| Assistant Headteacher (`ASSISTANT_HEADTEACHER`) | Yes | Yes | Yes | Yes | PASS |
| Class Teacher (`TEACHER`) | Yes | Yes | Yes | Yes | PASS |
| Authorized Teacher (`TEACHER`) | Yes | Yes | Yes | Yes | PASS |

`TEACHER` is the canonical repository role for both class teachers and authorized teachers. The test fixture exercises the same canonical role with all assigned class IDs; production teacher access remains limited server-side to the teacher’s assigned classes.

## Sidebar and routing

The existing sidebar registry now exposes the existing `class-database` module under `STUDENTS MANAGEMENT` for `PROPRIETOR`, `ACCOUNTANT_BURSAR`, `HEADTEACHER`, `ASSISTANT_HEADTEACHER`, and `TEACHER`. Proprietor portal grouping continues to use its existing canonical display label `STUDENT MANAGEMENT` without reorganizing the navigation.

The exact route is `/class-database.html`. The existing `public/app.js` navigation loader receives that route from the sidebar, hides the dashboard overview, mounts the route in the existing module frame, and passes `embedded=1` and the exact route. The server’s protected-page gate checks the same registered route and serves the exact `public/class-database.html` component. No generic student fallback or route alias is used.

The route component contains the required controls and columns:

- Academic Year
- Canonical Class selector
- Search
- Permanent Student ID
- Name of Student
- Name of Parent/Guardian
- Registered Parent Phone Number

## RBAC changes

The canonical `ACCOUNTANT_BURSAR` role now includes `students.read`, because Part 2 explicitly authorizes School Accountant access to the Class Database. The Class Database service’s independent server-side role allow-list now includes `ACCOUNTANT_BURSAR` and `ASSISTANT_HEADTEACHER`. Existing school ownership, authenticated-user, teacher assignment, parent/student portal, and requested-record scope checks remain active.

## Automated routing tests

`test/class-database-routing.test.js` protects:

1. The Class Database module key and exact route.
2. Student-management sidebar placement.
3. Visibility for each required canonical role.
4. Exact protected route response.
5. Exact Class Database component markers and required columns.
6. Class options including Nursery, KG, Primary, and JHS classes.
7. Protected Class Database API access for every role.
8. Unauthenticated route rejection.
9. The existing single-content iframe route loader.
10. Absence of generic student-page or Coming Soon aliases.

## Role tests executed

The role-by-role test logs in approved repository-style fixture accounts for Proprietor, Accountant, Headteacher, Assistant Headteacher, and Teacher. The Teacher canonical role is exercised for both Class Teacher and Authorized Teacher coverage. For each role the test verifies sidebar visibility, exact route, Class Database component content, class options through JHS, and API data loading. The focused Part 2 suite passed **10/10** tests.

Part 1 Class Database and admission regression tests also remain green. The complete repository suite and protected asset verification are run as the release gate.

## Failures discovered and fixes

The initial Part 2 test exposed two issues: Proprietor’s existing portal grouping uses the canonical label `STUDENT MANAGEMENT` rather than `STUDENTS MANAGEMENT`, and a teacher fixture only had four assigned classes. The test was corrected to respect the existing Proprietor grouping and the approved teacher fixture was expanded to all canonical class assignments for the role-by-role selector test. No production generic-route collision was found.

## Stop point

Implementation stops after Part 2 as required. Part 3 was not started.
