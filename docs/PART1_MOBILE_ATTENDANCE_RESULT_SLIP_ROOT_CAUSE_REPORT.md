# Part 1 Root-Cause Report

## Scope

Inspection of `main` was completed before implementation. The application is a Node.js server-rendered frontend with browser modules in `public/`, service modules in `src/`, optional durable TiDB access through `src/ai/tidb-database-adapter.js`, and Node's built-in test runner.

## Confirmed root causes

### Today's Attendance mobile workflow

1. `public/attendance.html` rendered the full seven-column desktop table at every viewport.
2. The shared mobile table rules force a wide table (`min-width: 680px`) and horizontal scrolling; they do not provide a card presentation for the attendance register.
3. `public/attendance-register.js` generated a single table row with no mobile-specific labels or student gender/date presentation.
4. Register rows were always initialized to `PRESENT`, which violates the requirement not to auto-mark students merely because a register loads.
5. `/api/attendance/register` returned enrollment rows but did not return an existing attendance record for the selected date/context, so edits could not be restored into the UI.
6. `/api/attendance/students/sync` always used create-only persistence (`correction: false`), making a save of an existing record fail as a duplicate instead of updating it.
7. The save handler did not lock the form during submission, so duplicate submissions were possible.

### Student Result Slip workflow

1. `public/result-view.js` loaded `/api/academic/options`, then rendered its dropdowns, but never selected a default class.
2. Because `classId` remained empty, `syncStudents()` exited before requesting `/api/academic/result-students`, leaving the student control at the prerequisite state instead of automatically loading eligible students.
3. Student loading had no explicit ready/empty/error state and did not protect against stale responses from rapid context changes.
4. A failed initial options request was only surfaced as a generic status message; student loading could not recover independently.

## Affected files

- `public/attendance.html`
- `public/attendance-register.js`
- `public/result-view.js`
- `public/styles.css`
- `src/server.mjs`
- `config/protected-components.json`
- `scripts/verify-protected-components.mjs`
- `test/part1-mobile-attendance-result-slip.test.js`

## Baseline validation

The focused baseline run reached the existing tests but could not execute the full repository gate because the clean clone had not yet installed declared npm dependencies (`bcrypt`, `pdfkit`, and `mysql2`). This environment prerequisite is recorded separately from implementation failures; dependencies will be installed before final validation.
