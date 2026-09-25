import mysql from 'mysql2/promise';

const expectedDatabase = 'osaahdaylightschool';
const tables = ['schools', 'users', 'roles', 'classes', 'levels', 'students', 'student_profiles', 'student_enrollments', 'subjects', 'class_subjects', 'subject_class_assignments', 'academic_years', 'terms', 'assessment_scores', 'exam_scores', 'academic_score_records', 'report_cards', 'result_publications'];
const safeError = (error) => ({ ok: false, error: { code: error?.code ?? 'SCORE_ENTRY_AUDIT_FAILED', errno: error?.errno ?? null, sqlState: error?.sqlState ?? null } });
const asCount = (row) => Number(row?.count ?? 0);
const has = (columns, name) => columns.has(name);

if (!process.env.DATABASE_URL) {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code: 'DATABASE_URL_MISSING' } })}\n`);
  process.exitCode = 1;
} else {
  const pool = mysql.createPool({ uri: process.env.DATABASE_URL, ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, waitForConnections: true, connectionLimit: 1, connectTimeout: 15000 });
  try {
    const [[database]] = await pool.query('SELECT DATABASE() AS database_name');
    if (database?.database_name !== expectedDatabase) throw Object.assign(new Error('Unexpected production database target.'), { code: 'DATABASE_TARGET_MISMATCH' });
    const [tableRows] = await pool.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    const present = new Set(tableRows.map((row) => String(row.TABLE_NAME)));
    const [columnRows] = await pool.query('SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?)', [tables]);
    const columns = new Map();
    for (const row of columnRows) (columns.get(row.TABLE_NAME) ?? columns.set(row.TABLE_NAME, new Set()).get(row.TABLE_NAME)).add(row.COLUMN_NAME);
    const result = { ok: true, mode: 'READ_ONLY_SCORE_ENTRY_AUDIT', connectedDatabase: database.database_name, tablePresence: Object.fromEntries(tables.map((table) => [table, present.has(table)])), columns: Object.fromEntries([...columns].map(([table, names]) => [table, [...names]])), countsBySchool: {}, relationships: {}, productionWrites: 'NONE' };
    const countBySchool = async (table, schoolColumn = 'school_id') => {
      if (!present.has(table) || !has(columns.get(table) ?? new Set(), schoolColumn)) return null;
      const [rows] = await pool.query(`SELECT ${schoolColumn} AS schoolId, COUNT(*) AS count FROM ${table} GROUP BY ${schoolColumn} ORDER BY ${schoolColumn}`);
      return rows.map((row) => ({ schoolId: row.schoolId, count: asCount(row) }));
    };
    for (const table of ['schools', 'users', 'roles', 'classes', 'levels', 'students', 'student_profiles', 'subjects', 'academic_years', 'terms', 'assessment_scores', 'exam_scores', 'academic_score_records', 'report_cards', 'result_publications']) result.countsBySchool[table] = await countBySchool(table);
    if (present.has('student_enrollments') && has(columns.get('student_enrollments') ?? new Set(), 'student_id') && present.has('students') && has(columns.get('students') ?? new Set(), 'school_id')) {
      const [rows] = await pool.query('SELECT s.school_id AS schoolId, COUNT(*) AS count FROM student_enrollments e JOIN students s ON s.id=e.student_id GROUP BY s.school_id ORDER BY s.school_id');
      result.countsBySchool.student_enrollments = rows.map((row) => ({ schoolId: row.schoolId, count: asCount(row) }));
    } else result.countsBySchool.student_enrollments = null;
    if (present.has('class_subjects')) result.countsBySchool.class_subjects = await countBySchool('class_subjects');
    if (present.has('subject_class_assignments')) result.countsBySchool.subject_class_assignments = await countBySchool('subject_class_assignments');

    if (present.has('classes') && has(columns.get('classes') ?? new Set(), 'school_id')) {
      const [rows] = await pool.query('SELECT school_id AS schoolId, id AS classId, name, level FROM classes WHERE school_id IS NOT NULL ORDER BY school_id, name, id');
      result.relationships.classesBySchool = rows.map((row) => ({ schoolId: row.schoolId, classId: row.classId, name: row.name, level: row.level ?? null }));
    }
    if (present.has('students') && present.has('student_enrollments')) {
      const enrollmentColumns = columns.get('student_enrollments') ?? new Set();
      const yearColumn = enrollmentColumns.has('academic_year') ? 'e.academic_year' : enrollmentColumns.has('academic_year_id') ? 'e.academic_year_id' : 'NULL';
      const classColumn = enrollmentColumns.has('class_name') ? 'e.class_name' : 'e.class_id';
      const [rows] = await pool.query(`SELECT s.school_id AS schoolId, ${yearColumn} AS academicYear, ${classColumn} AS classRef, COUNT(*) AS count FROM student_enrollments e JOIN students s ON s.id=e.student_id GROUP BY s.school_id, ${yearColumn}, ${classColumn} ORDER BY s.school_id, academicYear, classRef`);
      result.relationships.enrollmentsBySchoolYearClass = rows.map((row) => ({ schoolId: row.schoolId, academicYear: row.academicYear, classRef: row.classRef, count: asCount(row) }));
    }
    const mappingTable = present.has('class_subjects') ? 'class_subjects' : present.has('subject_class_assignments') ? 'subject_class_assignments' : null;
    if (mappingTable && present.has('classes') && present.has('subjects')) {
      const mappingColumns = columns.get(mappingTable) ?? new Set();
      const schoolPredicate = mappingColumns.has('school_id') ? `m.school_id = c.school_id` : '1=1';
      const activePredicate = mappingColumns.has('active') ? 'AND m.active=1' : '';
      const [rows] = await pool.query(`SELECT c.school_id AS schoolId, c.name AS className, c.level AS classLevel, s.id AS subjectId, s.name AS subjectName, COUNT(*) AS count FROM ${mappingTable} m JOIN classes c ON c.id=m.class_id JOIN subjects s ON s.id=m.subject_id AND s.school_id=c.school_id WHERE ${schoolPredicate} ${activePredicate} GROUP BY c.school_id, c.name, c.level, s.id, s.name ORDER BY c.school_id, c.name, s.name`);
      result.relationships.subjectsByClass = rows.map((row) => ({ schoolId: row.schoolId, className: row.className, classLevel: row.classLevel, subjectId: row.subjectId, subjectName: row.subjectName, count: asCount(row) }));
    }
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify(safeError(error))}\n`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
