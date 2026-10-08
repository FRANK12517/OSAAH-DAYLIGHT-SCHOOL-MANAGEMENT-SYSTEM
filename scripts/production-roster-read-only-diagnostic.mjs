import mysql from 'mysql2/promise';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TARGET_RELEASE_SHA = '2b9bab37bc73f3b4bc78f6609447b14bc4beef75';
const EXPECTED_DATABASE = 'osaahdaylightschool';
const RELEASE_SOURCE_DIR = resolve(process.env.RELEASE_SOURCE_DIR || '.');
const safeColumns = new Set(['e.enrollment_status', 'e.is_current']);

function safeError(error) {
  const rawMessage = String(error?.message ?? 'Database error');
  const match = rawMessage.match(/unknown column\s+['"`]([^'"`]+)['"`]\s+in\s+['"`]([^'"`]+)['"`]/i);
  const column = match?.[1] ?? '';
  const clause = match?.[2] ?? '';
  const knownColumn = [...safeColumns].find((candidate) => candidate.toLowerCase() === column.toLowerCase());
  return {
    code: typeof error?.code === 'string' ? error.code : null,
    errno: error?.errno !== undefined && error?.errno !== null && Number.isFinite(Number(error.errno)) ? Number(error.errno) : null,
    sqlState: typeof error?.sqlState === 'string' ? error.sqlState : null,
    message: knownColumn && /^[a-z ]+$/i.test(clause)
      ? `Unknown column '${knownColumn}' in '${clause}'`
      : /unknown column/i.test(rawMessage) ? 'Unknown column error (details suppressed)' : 'Database error (message suppressed)'
  };
}

function hasOptionalEnrollmentPredicates(sql) {
  return /e\.enrollment_status/i.test(sql) || /e\.is_current/i.test(sql);
}

function safeAttempt(attempt) {
  return {
    containsEnrollmentStatus: /e\.enrollment_status/i.test(attempt.sql),
    containsIsCurrent: /e\.is_current/i.test(attempt.sql),
    status: attempt.status,
    ...(attempt.error ? { error: attempt.error } : {})
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
    process.exitCode = 1;
    return;
  }

  const [{ createDurableAcademicService }, { DEFAULT_PRODUCTION_SCHOOL_ID }] = await Promise.all([
    import(pathToFileURL(resolve(RELEASE_SOURCE_DIR, 'src/durable-academic.js')).href),
    import(pathToFileURL(resolve(RELEASE_SOURCE_DIR, 'src/school-context.js')).href)
  ]);
  const databaseUrl = process.env.DATABASE_URL;
  const pool = mysql.createPool({
    uri: databaseUrl,
    ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 1,
    connectTimeout: 15000
  });
  let executeAttempts = 0;

  try {
    const [[databaseRow]] = await pool.query('SELECT DATABASE() AS database_name');
    const databaseMatches = databaseRow?.database_name === EXPECTED_DATABASE;
    if (!databaseMatches) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        mode: 'EXPLAIN_ONLY_NO_STUDENT_ROWS',
        databaseMatches: false,
        productionWrites: 'NONE',
        error: { code: 'DATABASE_NAME_MISMATCH' }
      })}\n`);
      process.exitCode = 1;
      return;
    }

    const configuredSchoolId = String(process.env.OSAAH_SCHOOL_ID ?? '').trim();
    const schoolId = configuredSchoolId || DEFAULT_PRODUCTION_SCHOOL_ID;
    const [[schoolRow]] = await pool.query('SELECT id FROM schools WHERE id=? LIMIT 1', [schoolId]);
    const schoolValid = Boolean(schoolRow);
    if (!schoolValid) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        mode: 'EXPLAIN_ONLY_NO_STUDENT_ROWS',
        databaseMatches: true,
        context: {
          schoolValid: false,
          academicYearValid: false,
          termValid: false,
          classValid: false,
          subjectValid: false,
          enrollmentContextExists: false
        },
        productionWrites: 'NONE',
        error: { code: 'SCHOOL_CONTEXT_NOT_FOUND' }
      })}\n`);
      process.exitCode = 1;
      return;
    }

    const [contexts] = await pool.query(`
      SELECT y.id AS academicYearId,t.id AS termId,c.id AS classId,a.subject_id AS subjectId
      FROM academic_years y
      JOIN terms t ON t.school_id=y.school_id AND t.academic_year_id=y.id
      JOIN classes c ON c.school_id=y.school_id
      JOIN subject_class_assignments a ON a.school_id=y.school_id AND a.class_id=c.id
        AND (a.academic_year_id IS NULL OR a.academic_year_id=y.id)
      JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      WHERE y.school_id=? AND a.active=1 AND COALESCE(s.is_active,1)=1 AND COALESCE(s.is_scoring,1)=1
      ORDER BY y.is_current DESC,t.is_current DESC,y.starts_on DESC,t.starts_on DESC,y.id,t.id,c.id,a.subject_id
      LIMIT 1`, [schoolId]);
    const context = contexts[0];
    if (!context) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        mode: 'EXPLAIN_ONLY_NO_STUDENT_ROWS',
        databaseMatches: true,
        context: {
          schoolValid: true,
          academicYearValid: false,
          termValid: false,
          classValid: false,
          subjectValid: false,
          enrollmentContextExists: false
        },
        productionWrites: 'NONE',
        error: { code: 'ACADEMIC_CONTEXT_NOT_FOUND' }
      })}\n`);
      process.exitCode = 1;
      return;
    }

    const [[enrollmentContextRow]] = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM student_enrollments
        WHERE school_id=? AND academic_year_id=? AND term_id=? AND class_id=?
      ) AS context_exists`, [schoolId, context.academicYearId, context.termId, context.classId]);

    const traces = { scoreEntry: { attempts: [] }, resultSlip: { attempts: [] } };
    let activeTrace = null;
    const diagnosticDatabase = {
      async query(sql, params = []) {
        if (!/^\s*SELECT\b/i.test(sql) || /;\s*\S/.test(sql)) {
          throw Object.assign(new Error('Diagnostic blocked a non-single-SELECT statement.'), { code: 'READ_ONLY_GUARD_BLOCKED' });
        }
        const isRosterQuery = /FROM\s+student_enrollments\s+e\s+JOIN\s+students\s+s/i.test(sql);
        const touchesStudentTables = /\b(?:students|student_enrollments|student_profiles|academic_score_records|academic_result_records)\b/i.test(sql);
        if (touchesStudentTables && !isRosterQuery) {
          throw Object.assign(new Error('Diagnostic blocked an unexpected student-table query.'), { code: 'READ_ONLY_GUARD_BLOCKED' });
        }
        if (isRosterQuery) {
          if (!activeTrace) throw Object.assign(new Error('Roster EXPLAIN ran without a diagnostic trace.'), { code: 'TRACE_REQUIRED' });
          const attempt = { sql, status: 'PENDING', error: null };
          activeTrace.attempts.push(attempt);
          try {
            // EXPLAIN validates the exact SELECT structure but does not return student rows.
            await pool.query(`EXPLAIN ${sql}`, params);
            attempt.status = 'SUCCEEDED';
            return [];
          } catch (error) {
            attempt.status = 'FAILED';
            attempt.error = safeError(error);
            throw error;
          }
        }
        const [rows] = await pool.query(sql, params);
        return rows;
      },
      async execute() {
        executeAttempts += 1;
        throw Object.assign(new Error('Read-only diagnostic refused a write operation.'), { code: 'READ_ONLY_GUARD_BLOCKED' });
      }
    };

    const service = createDurableAcademicService({ database: diagnosticDatabase, schoolId });
    const actor = { id: 'protected-read-only-diagnostic', schoolId, roleKey: 'DIAGNOSTIC', permissions: new Set(['results.read']) };
    const endpointResults = {};
    for (const [name, run] of [
      ['scoreEntry', () => service.roster({ ...context }, actor)],
      ['resultSlip', () => service.resultStudents({ ...context }, actor)]
    ]) {
      const trace = traces[name];
      activeTrace = trace;
      try {
        await run();
        trace.resolverStatus = 'COMPLETED';
      } catch (error) {
        trace.resolverStatus = 'FAILED';
        trace.finalError = safeError(error);
      } finally {
        activeTrace = null;
      }
      const initial = trace.attempts[0];
      const retry = trace.attempts[1];
      endpointResults[name] = {
        resolverStatus: trace.resolverStatus,
        initialQuery: initial ? safeAttempt(initial) : { status: 'NOT_REACHED' },
        compatibilityRetryAttempted: Boolean(retry),
        ...(retry ? { compatibilityFiltersRemoved: hasOptionalEnrollmentPredicates(initial.sql) && !hasOptionalEnrollmentPredicates(retry.sql) } : {}),
        ...(retry ? { retry: safeAttempt(retry) } : {}),
        ...(trace.finalError ? { remainingError: trace.finalError } : {}),
        queryAttemptCount: trace.attempts.length
      };
    }

    const allResolversCompleted = Object.values(endpointResults).every((result) => result.resolverStatus === 'COMPLETED');
    const noWriteAttempts = executeAttempts === 0;
    const report = {
      ok: allResolversCompleted && noWriteAttempts,
      mode: 'EXPLAIN_ONLY_NO_STUDENT_ROWS',
      targetReleaseSha: TARGET_RELEASE_SHA,
      databaseMatches: true,
      schoolScopeSource: configuredSchoolId ? 'protected-environment-variable' : 'release-default',
      context: {
        schoolValid,
        academicYearValid: Boolean(context.academicYearId),
        termValid: Boolean(context.termId),
        classValid: Boolean(context.classId),
        subjectValid: Boolean(context.subjectId),
        enrollmentContextExists: Number(enrollmentContextRow?.context_exists ?? 0) === 1
      },
      scoreEntry: endpointResults.scoreEntry,
      resultSlip: endpointResults.resultSlip,
      studentRowsReturned: false,
      productionWrites: noWriteAttempts ? 'NONE' : 'BLOCKED'
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      mode: 'EXPLAIN_ONLY_NO_STUDENT_ROWS',
      error: safeError(error),
      productionWrites: executeAttempts === 0 ? 'NONE' : 'BLOCKED'
    })}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

await main();
