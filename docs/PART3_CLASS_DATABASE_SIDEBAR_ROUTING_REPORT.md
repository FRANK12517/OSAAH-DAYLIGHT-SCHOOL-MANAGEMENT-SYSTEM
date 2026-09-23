# Part 3 — Class Database Sidebar Access and Exact Routing

## Conclusion

Part 3 exposes the existing canonical Class Database to every required school role through the existing Students Management navigation architecture. The implementation uses one route, one view key, one page component, and the existing Class Database API. It does not introduce role-specific data stores, duplicate Class Database components, new authorization pages, or changes to promotion, repetition, or completed-archive behavior.

The focused Part 3 suite passed **41 tests**. The deterministic repository suite passed **696 tests**, with **0 failures**. The external `test/live-ai-provider.test.js` remains excluded because it requires a live provider and independently stalls in this sandbox; no other test was excluded.

## Branch and commit scope

The work was implemented on the feature branch `feat/part3-class-database-sidebar-routing`. The final application changes are limited to the proprietor route registry and permanent routing regression coverage. The final merge commit and production deployment are recorded after the GitHub workflow completes.

## Architecture inspected

The forensic inspection covered the canonical role identifiers in `src/roles.js`, the shared sidebar registry in `src/sidebar-registry.js`, the proprietor-specific route registry in `src/proprietor-sidebar-routes.js`, and the route contract resolver in `src/sidebar-route-contract.js`. It also covered the browser shell in `public/app.js`, including sidebar rendering, active-view state, `history.pushState`, `window.onpopstate`, iframe replacement, navigation-version guards, mobile drawer behavior, and the single replaceable module workspace.

Server-side inspection covered `/api/sidebar`, protected static-page authorization, Class Database API authorization, school scoping, and the existing teacher class-scope enforcement. The implementation preserves these controls. The browser shell still renders one dashboard overview or one module iframe at a time, and it clears the previous iframe source before loading a new route.

## Canonical route contract

| Contract field | Canonical value |
|---|---|
| Sidebar module key | `class-database` |
| Navigation key | `class-database` |
| Label | `Class Database` |
| Parent section | `STUDENTS MANAGEMENT` |
| Route | `/class-database.html` |
| Exact view | `class-database` |
| Component | `/class-database.html` |
| Required permission | `students.read` |
| API dependencies | `/api/class-database/options`, `/api/class-database` |

The proprietor-specific route registry now points its Class Database item directly to `/class-database.html`. This prevents the prior generic student-management fallback and ensures the same canonical page is used by the proprietor shell and the shared school sidebar.

## Roles and authorization

The shared registry exposes the canonical item to `PROPRIETOR`, `SCHOOL_ADMIN`, `HEADTEACHER`, `ASSISTANT_HEADTEACHER`, `ACCOUNTANT_BURSAR`, `ADMISSIONS_OFFICER`, `ACADEMIC_COORDINATOR`, and `TEACHER`. The required Part 3 roles are therefore covered, including the School Accountant and all authorized teachers.

No RBAC permission was weakened. The item still requires `students.read`. The Class Database API continues to authenticate the caller, scope records to the caller's school, and restrict teacher results to assigned classes. Direct unauthenticated API and route access remains rejected.

## Files changed

`src/proprietor-sidebar-routes.js` was updated so the proprietor Students Management item uses the Class Database page rather than the generic student-canonical page. `test/proprietor-sidebar.test.js` was updated for the additional authoritative route. `test/class-database-part3-routing.test.js` was added as permanent coverage for role visibility, exact route and component identity, direct page resolution, API authorization, logout protection, and generic-page fall-through prevention.

## Verification matrix

| Role | Sidebar item visible | Click/route works | Exact Class Database opened | Data/API authorized | Refresh contract | Logout protection | Result |
|---|---:|---:|---:|---:|---:|---:|---|
| Proprietor | Yes | Yes | Yes | Yes | Yes | Yes | PASS |
| Accountant / Bursar | Yes | Yes | Yes | Yes | Yes | Yes | PASS |
| Headteacher | Yes | Yes | Yes | Yes | Yes | Yes | PASS |
| Assistant Headteacher | Yes | Yes | Yes | Yes | Yes | Yes | PASS |
| Class Teacher / Teacher | Yes | Yes | Yes | Yes | Yes | Yes | PASS |
| Authorized teacher scope | Yes | Yes | Yes | Scoped | Yes | Yes | PASS |

The automated test also verifies that `/class-database.html` does not render Student Profiles, Student Search, Student Directory, a generic dashboard, or a Coming Soon placeholder. It verifies the 13 canonical class options, including Nursery 1 through JHS 3, without duplicating the Part 2 query suite.

## Routing and view-state behavior

The existing navigation handler passes the canonical navigation key and exact view into `navigateToRoute`. The route is persisted through the existing URL query parameters and browser history. `window.onpopstate` re-resolves the selected navigation item. The renderer removes the prior iframe source, increments its navigation version, and ignores stale load or error callbacks. These safeguards prevent overlapping views, stale content, duplicate dashboard rendering, and generic fallbacks.

Mobile behavior remains provided by the existing responsive drawer. The Class Database item is included in the same Students Management group and uses the same scrollable module workspace as desktop navigation. No separate mobile implementation was introduced.

## Test totals and limitations

The focused Part 3 routing and Class Database compatibility suite completed with **41 passed and 0 failed**. The deterministic repository suite completed with **696 passed and 0 failed**. The live-provider test was not included because it requires an external live AI provider and stalls independently in the sandbox. Browser-level manual login, viewport, rapid-navigation, and refresh checks were not executed through a live browser in this run; those checks are therefore **NOT SUPPLIED — MANUAL VERIFICATION REQUIRED**. The automated server and source-contract tests cover the route, authorization, view resolution, logout-with-cleared-credentials, and single-component rendering contracts.

## Routing contract result

| Routing contract | Expected destination | Actual destination | Result |
|---|---|---|---|
| Class Database → Class Database | `/class-database.html`, view `class-database` | `/class-database.html`, view `class-database`, component `/class-database.html` | PASS |

## Scope boundary

Part 4 promotion and repetition behavior was not modified. Part 5 completed-class archive lifecycle behavior was not modified. Existing Part 1 and Part 2 student identity, gender, enrollment, search, parent contact, class selector, teacher-scope, and school-isolation behavior was preserved and revalidated through the regression suite.

## References

[1]: https://github.com/FRANK12517/OSAAH-DAYLIGHT-SCHOOL-MANAGEMENT-SYSTEM "OSAAH Daylight School Management System repository"
