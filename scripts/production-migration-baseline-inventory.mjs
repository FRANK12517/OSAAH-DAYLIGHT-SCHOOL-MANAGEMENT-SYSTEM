import { runDiagnostic } from './production-migration-059-067-068-metadata-diagnostic.mjs';

if (!(await runDiagnostic())) process.exitCode = 1;
