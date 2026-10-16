# OsaaH Daylight School Management System

Phase 1 establishes the integrated application foundation. The repository was uninitialized when this phase began, so the implementation uses Node.js built-ins and a SQLite-compatible schema with no unnecessary framework dependency.

## Run

```text
npm test
npm start
```

Open `http://localhost:3000`. Set `OSAAH_PORT` to change the port.

Authentication changes must preserve the role, dashboard, session, cookie, and authorization contracts in [the authentication regression contract](docs/authentication-regression-contract.md). Run `npm run test:auth:regression` before changing or reviewing login behavior.

The official logo should be supplied at `public/assets/osaah-daylight-logo.png`; the UI references that permanent asset and intentionally does not generate a substitute.

