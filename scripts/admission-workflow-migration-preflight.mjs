import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const expectedColumns = [
  { table: 'admission_applications', name: 'enquiry_request_id', type: 'varchar(64)', nullable: 'YES' },
  { table: 'admission_applications', name: 'permanent_student_id', type: 'varchar(128)', nullable: 'YES' }
];
const expectedIndexes = [
  { table: 'admission_applications', name: 'uq_admission_applications_enquiry_request', columns: ['school_id', 'enquiry_request_id'] },
  { table: 'admission_applications', name: 'uq_admission_application_student_id', columns: ['student_id'] },
  { table: 'admission_applications', name: 'uq_admission_application_permanent_student_id', columns: ['school_id', 'permanent_student_id'] },
  { table: 'student_enrollments', name: 'uq_student_enrollment_context', columns: ['school_id', 'student_id', 'academic_year_id', 'term_id', 'is_current'] }
];
const safeError = (error) => ({ ok: false, error: { code: error?.code ?? 'ADMISSIONS_PREFLIGHT_FAILED', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null } });

if (!process.env.DATABASE_URL) {
  process.stdout.write(`${JSON.stringify({ ok: false, mode: 'READ_ONLY_PREFLIGHT', error: { code: 'DATABASE_URL_MISSING' } })}\n`);
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try {
    const [[database]] = await pool.query('SELECT DATABASE() AS database_name');
    if (database?.database_name !== expectedDatabase) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
    const [[versionRow]] = await pool.query('SELECT VERSION() AS server_version');
    const serverVersion = String(versionRow?.server_version ?? 'unknown');
    const isTiDB = /tidb/i.test(serverVersion);
    const [tableRows] = await pool.query('SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    const [columnRows] = await pool.query('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()');
    const [indexRows] = await pool.query('SELECT TABLE_NAME,INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX,NON_UNIQUE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (\'admission_applications\',\'student_enrollments\') ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX');
    const tableTypes = new Map(tableRows.map((row) => [String(row.TABLE_NAME).toLowerCase(), String(row.TABLE_TYPE ?? '').toUpperCase()]));
    const tables = new Set(tableTypes.keys());
    const columns = new Set(columnRows.map((row) => `${String(row.TABLE_NAME).toLowerCase()}.${String(row.COLUMN_NAME).toLowerCase()}`));
    const columnMetadata = new Map(columnRows.map((row) => [`${String(row.TABLE_NAME).toLowerCase()}.${String(row.COLUMN_NAME).toLowerCase()}`, { type: String(row.COLUMN_TYPE ?? '').toLowerCase(), nullable: String(row.IS_NULLABLE ?? '').toUpperCase() }]));
    const required = {
      admission_applications: ['id','school_id','student_id','application_number','stage','applicant_data'],
      student_enrollments: ['school_id','student_id','class_id','academic_year_id','term_id','is_current'],
      students: ['id','school_id','permanent_student_id'],
      student_profiles: ['id','school_id','student_master_id','student_id','permanent_student_id'],
      classes: ['id'], academic_years: ['id','school_id'], terms: ['id','academic_year_id'],
      student_id_sequences: ['admission_year','next_sequence'],
      parent_student_links: ['parent_user_id','student_id','link_status'],
      users: ['id','school_id'], roles: ['id','school_id','role_key'],
      permissions: ['id','permission_key'], role_permissions: ['role_id','permission_id']
    };
    const missing = [];
    for (const [table, names] of Object.entries(required)) {
      if (!tables.has(table)) missing.push(`${table}.*`);
      for (const column of names) if (!columns.has(`${table}.${column}`)) missing.push(`${table}.${column}`);
    }
    const schemaObjectFindings = Object.entries(required).flatMap(([table, names]) => {
      const missingColumns = names.filter((column) => !columns.has(`${table}.${column}`));
      if (tables.has(table) && !missingColumns.length) return [];
      return [{ table, tableStatus: tables.has(table) ? 'PRESENT' : 'MISSING', tableType: tableTypes.get(table) ?? 'MISSING', missingColumns }];
    });
    const columnDefinitionMismatches = expectedColumns.flatMap(({ table, name, type, nullable }) => {
      const actual = columnMetadata.get(`${table}.${name}`);
      return actual && (actual.type !== type || actual.nullable !== nullable)
        ? [{ table, name, expectedType: type, expectedNullable: nullable, actualType: actual.type, actualNullable: actual.nullable }]
        : [];
    });
    const indexGroups = new Map();
    for (const row of indexRows) {
      const key = `${String(row.TABLE_NAME).toLowerCase()}.${String(row.INDEX_NAME)}`;
      const group = indexGroups.get(key) ?? [];
      group.push({ column: String(row.COLUMN_NAME).toLowerCase(), sequence: Number(row.SEQ_IN_INDEX), nonUnique: Number(row.NON_UNIQUE) });
      indexGroups.set(key, group);
    }
    const indexDefinitionMismatches = expectedIndexes.filter(({ table, name, columns: expected }) => {
      const actual = indexGroups.get(`${table}.${name}`);
      return actual && (actual.some((column) => column.nonUnique !== 0) || JSON.stringify(actual.map((column) => column.column)) !== JSON.stringify(expected));
    }).map(({ table, name }) => `${table}.${name}`);
    const duplicateGroups = {};
    const orphanCounts = {};
    const count = async (key, sql) => { const [[row]] = await pool.query(sql); duplicateGroups[key] = Number(row?.duplicate_groups ?? 0); };
    const orphan = async (key, sql) => { const [[row]] = await pool.query(sql); orphanCounts[key] = Number(row?.orphan_count ?? 0); };
    if (!missing.length) {
      if (columns.has('admission_applications.enquiry_request_id')) await count('enquiry_retry_identity', 'SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,enquiry_request_id FROM admission_applications WHERE enquiry_request_id IS NOT NULL GROUP BY school_id,enquiry_request_id HAVING COUNT(*)>1) d');
      else duplicateGroups.enquiry_retry_identity = 0;
      await count('application_student_identity', 'SELECT COUNT(*) AS duplicate_groups FROM (SELECT student_id FROM admission_applications WHERE student_id IS NOT NULL GROUP BY student_id HAVING COUNT(*)>1) d');
      if (columns.has('admission_applications.permanent_student_id')) await count('application_permanent_student_identity', 'SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,permanent_student_id FROM admission_applications WHERE permanent_student_id IS NOT NULL GROUP BY school_id,permanent_student_id HAVING COUNT(*)>1) d');
      else duplicateGroups.application_permanent_student_identity = 0;
      await count('enrollment_context', 'SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,student_id,academic_year_id,term_id,is_current FROM student_enrollments WHERE term_id IS NOT NULL GROUP BY school_id,student_id,academic_year_id,term_id,is_current HAVING COUNT(*)>1) d');
      await count('student_permanent_id', 'SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,permanent_student_id FROM students WHERE permanent_student_id IS NOT NULL GROUP BY school_id,permanent_student_id HAVING COUNT(*)>1) d');
      await count('profile_student_id', 'SELECT COUNT(*) AS duplicate_groups FROM (SELECT school_id,student_id FROM student_profiles WHERE student_id IS NOT NULL GROUP BY school_id,student_id HAVING COUNT(*)>1) d');
      await orphan('admission_application_students', 'SELECT COUNT(*) AS orphan_count FROM admission_applications a LEFT JOIN students s ON s.id=a.student_id WHERE a.student_id IS NOT NULL AND (s.id IS NULL OR s.school_id<>a.school_id)');
      await orphan('student_profile_master', 'SELECT COUNT(*) AS orphan_count FROM student_profiles sp LEFT JOIN students s ON s.id=sp.student_master_id WHERE sp.student_master_id IS NOT NULL AND (s.id IS NULL OR s.school_id<>sp.school_id)');
      await orphan('student_enrollment_students', 'SELECT COUNT(*) AS orphan_count FROM student_enrollments e LEFT JOIN students s ON s.id=e.student_id WHERE s.id IS NULL OR s.school_id<>e.school_id');
      await orphan('student_enrollment_classes', 'SELECT COUNT(*) AS orphan_count FROM student_enrollments e LEFT JOIN classes c ON c.id=e.class_id WHERE c.id IS NULL');
      await orphan('student_enrollment_academic_years', 'SELECT COUNT(*) AS orphan_count FROM student_enrollments e LEFT JOIN academic_years y ON y.id=e.academic_year_id WHERE y.id IS NULL OR y.school_id<>e.school_id');
      await orphan('student_enrollment_terms', 'SELECT COUNT(*) AS orphan_count FROM student_enrollments e LEFT JOIN terms t ON t.id=e.term_id WHERE e.term_id IS NOT NULL AND (t.id IS NULL OR t.academic_year_id<>e.academic_year_id)');
      await orphan('parent_student_links', 'SELECT COUNT(*) AS orphan_count FROM parent_student_links p LEFT JOIN users u ON u.id=p.parent_user_id LEFT JOIN student_profiles sp ON sp.id=p.student_id WHERE u.id IS NULL OR sp.id IS NULL OR u.school_id<>sp.school_id');
    }
    const [sequences] = tables.has('student_id_sequences') ? await pool.query('SELECT admission_year,next_sequence FROM student_id_sequences ORDER BY admission_year') : [[]];
    let existingIds = [];
    if (columns.has('students.permanent_student_id')) { const [rows] = await pool.query("SELECT permanent_student_id AS student_id FROM students WHERE permanent_student_id LIKE 'OSAAH/%'"); existingIds.push(...rows); }
    if (columns.has('student_profiles.student_id')) { const [rows] = await pool.query("SELECT student_id FROM student_profiles WHERE student_id LIKE 'OSAAH/%'"); existingIds.push(...rows); }
    const maxima = new Map(); let malformedStudentIds = 0;
    for (const row of existingIds) {
      const id = String(row.student_id ?? ''), match = /^OSAAH\/(\d{4})\/(\d+)$/.exec(id);
      if (!match || Number(match[2]) < 1 || !Number.isSafeInteger(Number(match[2]))) { malformedStudentIds += 1; continue; }
      maxima.set(match[1], Math.max(maxima.get(match[1]) ?? 0, Number(match[2])));
    }
    const annualSequenceReconciliation = [...maxima].sort(([a], [b]) => a.localeCompare(b)).map(([year, maxAllocated]) => {
      const counter = sequences.find((row) => String(row.admission_year) === year);
      return { year, maxAllocated, nextSequence: counter ? Number(counter.next_sequence) : null, counterBehind: counter ? Number(counter.next_sequence) <= maxAllocated : true };
    });
    const invalidSequenceRows = sequences.filter((row) => !/^\d{4}$/.test(String(row.admission_year)) || !Number.isSafeInteger(Number(row.next_sequence)) || Number(row.next_sequence) < 1).map((row) => String(row.admission_year));
    const counterBehindYears = annualSequenceReconciliation.filter((row) => row.counterBehind).map((row) => row.year);
    const report = {
      ok: isTiDB && missing.length === 0 && columnDefinitionMismatches.length === 0 && indexDefinitionMismatches.length === 0 && !Object.values(duplicateGroups).some(Boolean) && !Object.values(orphanCounts).some(Boolean) && malformedStudentIds === 0 && invalidSequenceRows.length === 0 && counterBehindYears.length === 0,
      mode: 'READ_ONLY_PREFLIGHT', migration: '078_admissions_leadership_access.sql', connectedDatabase: database.database_name,
      databaseEngine: isTiDB ? 'TiDB' : 'UNKNOWN', serverVersion, missingPrerequisites: missing, schemaObjectFindings,
      columnDefinitionMismatches, indexDefinitionMismatches, duplicateGroups, orphanCounts,
      existingStudentIdSequenceRows: sequences, annualSequenceReconciliation, malformedStudentIdCount: malformedStudentIds, invalidSequenceYears: invalidSequenceRows, counterBehindYears,
      indexesRelevantToMigration: indexRows.map((row) => ({ table: row.TABLE_NAME, name: row.INDEX_NAME, column: row.COLUMN_NAME, sequence: Number(row.SEQ_IN_INDEX), nonUnique: Number(row.NON_UNIQUE) })),
      constraintsToAdd: expectedIndexes, writesPerformed: false
    };
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!report.ok) process.exitCode = 2;
  } catch (error) { process.stdout.write(`${JSON.stringify(safeError(error))}\n`); process.exitCode = 1; }
  finally { await pool.end(); }
}
