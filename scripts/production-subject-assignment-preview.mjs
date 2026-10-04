import { buildSubjectAssignmentPreview } from '../src/platform/subject-assignment-preview.js';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';

const EXPECTED_DATABASE = 'osaahdaylightschool';
const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, details = null) => { throw Object.assign(new Error(message), { code, details }); };

async function main() {
  if (!process.env.DATABASE_URL) fail('DATABASE_URL_REQUIRED', 'Protected DATABASE_URL is required for the read-only preview.');
  const schoolId = String(process.env.SCHOOL_ID ?? '').trim();
  if (!schoolId) fail('SCHOOL_ID_REQUIRED', 'Set SCHOOL_ID to the school whose assignments should be previewed.');
  const adapter = await createDatabaseAdapter({ environment: process.env });
  try {
    const database = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
    if (database !== EXPECTED_DATABASE) fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expected: EXPECTED_DATABASE, actual: database ?? null });
    const school = rows(await adapter.query('SELECT id,name FROM schools WHERE id=? LIMIT 1', [schoolId]))[0];
    if (!school) fail('SCHOOL_NOT_FOUND', 'The requested school is not present in the selected database.');
    const years = rows(await adapter.query('SELECT id,name FROM academic_years WHERE school_id=? AND is_current=1 ORDER BY id', [schoolId]));
    if (years.length > 1) fail('CURRENT_ACADEMIC_YEAR_AMBIGUOUS', 'More than one academic year is current; preview scope is ambiguous.', { yearIds: years.map((year) => year.id) });
    const academicYear = years[0] ?? null;
    const classes = rows(await adapter.query('SELECT id,name FROM classes WHERE school_id=? ORDER BY name,id', [schoolId]));
    const subjects = rows(await adapter.query('SELECT id,name,subject_type AS subjectType,is_active AS isActive FROM subjects WHERE school_id=? ORDER BY name,id', [schoolId]));
    const availableTables = new Set(rows(await adapter.query(
      "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('subject_class_assignments','class_subjects')"
    )).map((row) => row.tableName));

    let assignments = [];
    if (availableTables.has('subject_class_assignments')) {
      assignments = rows(await adapter.query(
        `SELECT a.id,a.class_id AS classId,c.name AS className,a.subject_id AS subjectId,s.name AS subjectName,
                a.academic_year_id AS academicYearId,a.active,a.configuration_version AS configurationVersion
         FROM subject_class_assignments a
         JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
         JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
         WHERE a.school_id=? AND (a.academic_year_id IS NULL OR a.academic_year_id=?)
         ORDER BY c.name,s.name,a.academic_year_id,a.id`, [schoolId, academicYear?.id ?? null]
      ));
    }
    let legacyMappings = [];
    if (availableTables.has('class_subjects')) {
      legacyMappings = rows(await adapter.query(
        `SELECT cs.class_id AS classId,c.name AS className,cs.subject_id AS subjectId,s.name AS subjectName
         FROM class_subjects cs
         JOIN classes c ON c.id=cs.class_id
         JOIN subjects s ON s.id=cs.subject_id AND s.school_id=c.school_id
         WHERE c.school_id=? ORDER BY c.name,s.name,cs.subject_id`, [schoolId]
      ));
    }
    const preview = buildSubjectAssignmentPreview({ classes, subjects, assignments, legacyMappings, academicYear });
    return { ok: true, database, school: { id: school.id, name: school.name }, sourceTables: [...availableTables].sort(), preview };
  } finally { await adapter.close?.(); }
}

try { process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`); }
catch (error) { process.stderr.write(`${JSON.stringify({ error: error.code ?? 'SUBJECT_ASSIGNMENT_PREVIEW_FAILED', message: error.message, details: error.details ?? null })}\n`); process.exitCode = 1; }
