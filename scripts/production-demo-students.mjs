import { discoverMigrations } from '../src/platform/migration-runner.js';
import { provisionPermanentDemoStudents } from '../src/production-demo-students.js';

const mode = process.argv[2] ?? 'dry-run';
if (!['dry-run', 'apply'].includes(mode)) throw Object.assign(new Error('Only dry-run or apply is supported.'), { code: 'INVALID_DEMO_MODE' });
const environment = process.env;
for (const name of ['DATABASE_URL', 'OSAAH_DEMO_SCHOOL_ID', 'OSAAH_DEMO_EXPECTED_DATABASE', 'OSAAH_DEMO_PARENT_PHONE']) {
  if (!environment[name]) throw Object.assign(new Error(`${name} is required.`), { code: `${name}_REQUIRED` });
}
if (mode === 'apply' && environment.OSAAH_DEMO_STUDENTS_APPROVAL !== 'PRODUCTION_DEMO_RESTORE_APPROVED') throw Object.assign(new Error('Apply requires the explicit production restoration approval token.'), { code: 'DEMO_APPLY_GUARD_REQUIRED' });
if (mode === 'apply' && (!environment.OSAAH_DEMO_STUDENTS_BACKUP_REF || !environment.OSAAH_DEMO_RESTORE_ACTOR_USER_ID)) throw Object.assign(new Error('Apply requires the verified backup reference and accountable actor user ID.'), { code: 'DEMO_APPLY_GUARD_REQUIRED' });

const { createDatabaseAdapter } = await import('../src/ai/tidb-database-adapter.js');
const migrations = await discoverMigrations(new URL('../schema/', import.meta.url));
const migration = migrations.find((item) => item.version === 84);
if (!migration || migration.name !== '084_demo_student_class_assignments.sql') throw Object.assign(new Error('The permanent demo migration is missing from this release.'), { code: 'DEMO_MIGRATION_MISSING' });
let adapter;
try {
  adapter = createDatabaseAdapter({ environment });
  const result = await provisionPermanentDemoStudents(adapter, {
    schoolId: environment.OSAAH_DEMO_SCHOOL_ID,
    parentPhone: environment.OSAAH_DEMO_PARENT_PHONE,
    expectedDatabase: environment.OSAAH_DEMO_EXPECTED_DATABASE,
    migrationChecksum: migration.checksum,
    actorUserId: environment.OSAAH_DEMO_RESTORE_ACTOR_USER_ID,
    apply: mode === 'apply',
    approval: environment.OSAAH_DEMO_STUDENTS_APPROVAL,
    backupReference: environment.OSAAH_DEMO_STUDENTS_BACKUP_REF
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (cause) {
  process.stderr.write(`${JSON.stringify({ ok: false, code: cause?.code ?? 'DEMO_RESTORE_FAILED', message: cause?.code ? cause.message : 'Permanent demonstration student restoration failed safely.' })}\n`);
  process.exitCode = 1;
} finally {
  await adapter?.close?.();
}
