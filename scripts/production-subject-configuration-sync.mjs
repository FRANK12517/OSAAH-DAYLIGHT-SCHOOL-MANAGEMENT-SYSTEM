import { appendFile } from 'node:fs/promises';
import { buildSubjectConfigurationPreview } from '../src/platform/subject-configuration-preview.js';
import { assertAuthoritativeSchoolScope, AUTHORITATIVE_SCHOOL_ID, validateSubjectSyncExecution } from '../src/platform/subject-sync-guards.js';
import { createDurableAcademicService } from '../src/durable-academic.js';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';

const EXPECTED_DATABASE = 'osaahdaylightschool';
const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, details = null) => { throw Object.assign(new Error(message), { code, details }); };

async function writeSummary(report) {
  const destination = process.env.GITHUB_STEP_SUMMARY;
  if (!destination) return;
  const summary = [
    '# Production subject configuration synchronization',
    '',
    `- Mode: **${report.mode}**`,
    `- Database: \`${report.database}\``,
    `- School: ${report.school.name} (\`${report.school.id}\`)`,
    `- Academic year: ${report.academicYear.name} (\`${report.academicYear.id}\`)`,
    `- Release SHA: \`${report.releaseSha}\``,
    `- Production writes: **${report.productionWrites}**`,
    `- Expected baseline: ${report.preview.expectedBaseline.assignmentSlots} assignments across ${report.preview.expectedBaseline.distinctSubjectNames} subjects and ${report.preview.expectedBaseline.classCount} classes.`,
    `- Before: ${report.preview.actualCounts.subjectRecords} subjects; ${report.preview.actualCounts.assignmentRowsInScope} scoped assignment rows; ${report.preview.actualCounts.effectiveActiveBaselineAssignments} active baseline assignments.`,
    `- Missing subjects: ${report.preview.missingSubjects.length}; missing assignments: ${report.preview.missingAssignments.length}; inactive assignments: ${report.preview.inactiveAssignments.length}.`,
    `- Duplicate subject names: ${report.preview.duplicateDetection.duplicateSubjects.length}; duplicate assignment scopes: ${report.preview.duplicateDetection.duplicateAssignments.length}.`,
    `- Nursery assignments observed: ${report.preview.nurseryPreservation.rowsObserved}; rows changed by preview: ${report.preview.nurseryPreservation.rowsToChange}.`,
    `- Historical score/result counts before/after: \`${JSON.stringify(report.historyCounts)}\`.`,
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
    ''
  ].join('\n');
  await appendFile(destination, summary, 'utf8');
}

async function schemaColumns(adapter) {
  return rows(await adapter.query(
    'SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()'
  ));
}

async function readCounts(adapter, schoolId, academicYearId) {
  const count = async (table, where, params) => Number(rows(await adapter.query(`SELECT COUNT(*) AS rowCount FROM ${table} WHERE ${where}`, params))[0]?.rowCount ?? 0);
  const assignmentRows = Number(rows(await adapter.query(
    'SELECT COUNT(*) AS rowCount FROM subject_class_assignments WHERE school_id=? AND (academic_year_id IS NULL OR academic_year_id=?)', [schoolId, academicYearId]
  ))[0]?.rowCount ?? 0);
  const counts = {
    subjects: await count('subjects', 'school_id=?', [schoolId]),
    assignmentRowsInScope: assignmentRows,
    academicScoreRecords: null,
    academicResultRecords: null,
    publishedResults: null
  };
  const present = new Set(rows(await adapter.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('academic_score_records','academic_result_records')"
  )).map((row) => row.tableName));
  if (present.has('academic_score_records')) counts.academicScoreRecords = await count('academic_score_records', 'school_id=?', [schoolId]);
  if (present.has('academic_result_records')) {
    counts.academicResultRecords = await count('academic_result_records', 'school_id=?', [schoolId]);
    counts.publishedResults = Number(rows(await adapter.query('SELECT COUNT(*) AS rowCount FROM academic_result_records WHERE school_id=? AND status=?', [schoolId, 'PUBLISHED']))[0]?.rowCount ?? 0);
  }
  return counts;
}

async function loadScope(adapter, schoolId, yearInput) {
  const database = rows(await adapter.query('SELECT DATABASE() AS databaseName'))[0]?.databaseName;
  if (database !== EXPECTED_DATABASE) fail('DATABASE_TARGET_MISMATCH', 'Unexpected production database target.', { expected: EXPECTED_DATABASE, actual: database ?? null });
  const schoolRows = rows(await adapter.query('SELECT id,name FROM schools ORDER BY id'));
  const school = assertAuthoritativeSchoolScope({ requestedSchoolId: schoolId, schools: schoolRows });
  if (school.id !== AUTHORITATIVE_SCHOOL_ID) fail('SCHOOL_SCOPE_MISMATCH', 'The requested school is not the authoritative production school.', { schoolId });
  const academicYear = rows(await adapter.query('SELECT id,name FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, yearInput, yearInput]))[0];
  if (!academicYear) fail('ACADEMIC_YEAR_SCOPE_MISMATCH', 'The requested academic year does not belong to the selected school.', { schoolId, academicYear: yearInput });

  const tableRows = rows(await adapter.query('SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'));
  const tables = new Set(tableRows.map((row) => row.tableName));
  const requiredTables = ['schools', 'academic_years', 'classes', 'subjects', 'subject_class_assignments'];
  const missingTables = requiredTables.filter((table) => !tables.has(table));
  if (missingTables.length) fail('PREREQUISITE_SCHEMA_MISSING', 'Subject synchronization prerequisite tables are unavailable.', { missingTables });
  const columns = await schemaColumns(adapter);
  const hasColumn = (table, column) => columns.some((row) => row.tableName === table && row.columnName === column);
  const requiredColumns = {
    classes: ['id', 'school_id', 'name'],
    academic_years: ['id', 'school_id', 'name'],
    subjects: ['id', 'school_id', 'department_id', 'code', 'name', 'subject_type', 'is_scoring', 'is_active', 'assessment_components_json', 'created_at', 'updated_at'],
    subject_class_assignments: ['id', 'school_id', 'subject_id', 'class_id', 'academic_year_id', 'active', 'configuration_version', 'created_at', 'updated_at']
  };
  const missingColumns = Object.entries(requiredColumns).flatMap(([table, expected]) => expected.filter((column) => !hasColumn(table, column)).map((column) => `${table}.${column}`));
  if (missingColumns.length) fail('PREREQUISITE_SCHEMA_MISSING', 'Subject synchronization prerequisite columns are unavailable.', { missingColumns });

  const uniqueIndexes = rows(await adapter.query(
    "SELECT INDEX_NAME AS indexName,NON_UNIQUE AS nonUnique,COLUMN_NAME AS columnName,SEQ_IN_INDEX AS sequence FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='subject_class_assignments' ORDER BY INDEX_NAME,SEQ_IN_INDEX"
  ));
  const uniqueGroups = new Map();
  for (const index of uniqueIndexes.filter((item) => Number(item.nonUnique) === 0)) {
    const list = uniqueGroups.get(index.indexName) ?? [];
    list.push([Number(index.sequence), index.columnName]);
    uniqueGroups.set(index.indexName, list);
  }
  const scopedUniqueIndex = [...uniqueGroups.values()].some((parts) => parts.sort((a, b) => a[0] - b[0]).map(([, column]) => column).join(',') === 'school_id,subject_id,class_id,academic_year_id');
  if (!scopedUniqueIndex) fail('PREREQUISITE_SCHEMA_MISSING', 'A unique school/subject/class/year assignment key is required before synchronization.');

  const classes = rows(await adapter.query('SELECT id,name FROM classes WHERE school_id=? ORDER BY name,id', [schoolId]));
  const subjects = rows(await adapter.query('SELECT id,code,name,subject_type AS subjectType,is_scoring AS isScoring,is_active AS isActive,assessment_components_json AS assessmentComponentsJson FROM subjects WHERE school_id=? ORDER BY name,id', [schoolId]));
  const assignments = rows(await adapter.query(
    `SELECT a.id,a.class_id AS classId,c.name AS className,a.subject_id AS subjectId,s.name AS subjectName,
            a.academic_year_id AS academicYearId,a.active,a.configuration_version AS configurationVersion
     FROM subject_class_assignments a
     JOIN classes c ON c.id=a.class_id AND c.school_id=a.school_id
     JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
     WHERE a.school_id=? AND (a.academic_year_id IS NULL OR a.academic_year_id=?)
     ORDER BY c.name,s.name,a.academic_year_id,a.id`, [schoolId, academicYear.id]
  ));
  return { database, school, academicYear, classes, subjects, assignments };
}

async function main() {
  const mode = process.argv[2] ?? 'dry-run';
  const releaseSha = String(process.env.RELEASE_SHA ?? '').trim();
  const schoolId = String(process.env.SCHOOL_ID ?? '').trim();
  const yearInput = String(process.env.ACADEMIC_YEAR_ID ?? '').trim();
  validateSubjectSyncExecution({ mode, databaseUrl: process.env.DATABASE_URL, releaseSha, schoolId, academicYearId: yearInput, executionToken: process.env.EXECUTION_TOKEN, backupConfirmation: process.env.BACKUP_CONFIRMATION });

  const adapter = await createDatabaseAdapter({ environment: process.env });
  try {
    const scope = await loadScope(adapter, schoolId, yearInput);
    const historyBefore = await readCounts(adapter, schoolId, scope.academicYear.id);
    const plan = () => buildSubjectConfigurationPreview({
      classes: scope.classes,
      subjects: scope.subjects,
      assignments: scope.assignments,
      academicYear: scope.academicYear
    });
    let preview = plan();
    if (!preview.applyPreflightReady) fail('SUBJECT_CONFIGURATION_CONFLICT', 'Duplicate subjects, duplicate assignments, or missing classes require manual review before apply.', { duplicateDetection: preview.duplicateDetection, missingClasses: preview.missingClasses });

    if (mode === 'dry-run') {
      const historyAfter = await readCounts(adapter, schoolId, scope.academicYear.id);
      if (JSON.stringify(historyBefore) !== JSON.stringify(historyAfter)) fail('DRY_RUN_WRITE_DETECTED', 'Read-only preflight observed a database count change.', { before: historyBefore, after: historyAfter });
      const report = {
        ok: true, mode: 'DRY_RUN_ONLY', database: scope.database,
        school: { id: scope.school.id, name: scope.school.name },
        academicYear: scope.academicYear, releaseSha,
        productionWrites: 0,
        historyCounts: { before: historyBefore, after: historyAfter, unchanged: true },
        preview
      };
      await writeSummary(report);
      return report;
    }

    const service = createDurableAcademicService({ database: adapter, schoolId: scope.school.id });
    const syncResult = await service.configureDefaultSubjects({ id: 'github-production-subject-sync', roleKey: 'PROPRIETOR', schoolId: scope.school.id, permissions: new Set(['subjects.manage']) }, { academicYearId: scope.academicYear.id });
    const verifiedScope = await loadScope(adapter, scope.school.id, scope.academicYear.id);
    preview = buildSubjectConfigurationPreview({ classes: verifiedScope.classes, subjects: verifiedScope.subjects, assignments: verifiedScope.assignments, academicYear: verifiedScope.academicYear });
    const historyAfter = await readCounts(adapter, scope.school.id, scope.academicYear.id);
    if (JSON.stringify(historyBefore) !== JSON.stringify(historyAfter)) fail('HISTORICAL_RECORDS_CHANGED', 'Score or result counts changed during subject synchronization.', { before: historyBefore, after: historyAfter });
    if (!preview.applyPreflightReady || preview.missingSubjects.length || preview.missingAssignments.length) fail('POST_APPLY_VERIFICATION_FAILED', 'Subject synchronization did not satisfy the reviewed baseline.', { duplicateDetection: preview.duplicateDetection, missingClasses: preview.missingClasses, missingSubjects: preview.missingSubjects, missingAssignments: preview.missingAssignments });
    const report = {
      ok: true, mode: 'APPLY', database: verifiedScope.database,
      school: { id: verifiedScope.school.id, name: verifiedScope.school.name },
      academicYear: verifiedScope.academicYear, releaseSha,
      productionWrites: 'SUBJECTS_AND_CLASS_ASSIGNMENTS_ONLY',
      syncResult,
      historyCounts: { before: historyBefore, after: historyAfter, unchanged: true },
      preview
    };
    await writeSummary(report);
    return report;
  } finally {
    await adapter.close?.();
  }
}

try {
  process.stdout.write(`${JSON.stringify(await main(), null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.code ?? 'SUBJECT_CONFIGURATION_SYNC_FAILED', message: error.message, details: error.details ?? null })}\n`);
  process.exitCode = 1;
}
