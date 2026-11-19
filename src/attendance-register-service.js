import { ACADEMIC_YEAR_OPTIONS, TERM_OPTIONS } from './attendance.js';

const rows = (value) => Array.isArray(value) ? value : [];
const safeTimezone = (value) => {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date()); return value; }
  catch { return null; }
};
export function isAttendanceCalendarDate(value) {
  const text = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text;
}
function dateInRange(date, start, end, label) {
  if (start && date < String(start).slice(0, 10) || end && date > String(end).slice(0, 10)) {
    throw Object.assign(new Error(`The selected date is outside the selected ${label}.`), { status: 400, code: 'ATTENDANCE_DATE_OUTSIDE_PERIOD' });
  }
}
function authorizedSampleActor(actor, permission) {
  return { ...actor, portal: 'school', permissions: new Set([...(actor?.permissions ?? []), `sample.fixtures.${permission}`, 'sample.fixtures.read', 'sample.fixtures.write']) };
}

export function createAttendanceRegisterService({ database = null, students, attendance, attendanceRepository = null, sampleFixtureRepository = null, schoolSettings = null, fallbackTimezone = 'Africa/Accra', now = () => new Date() } = {}) {
  const rosterSchema = new Map();
  async function attendanceRosterSchema() {
    if (rosterSchema.size) return rosterSchema;
    const columns = rows(await database.query(`SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
        AND TABLE_NAME IN ('students','student_profiles','student_enrollments')`));
    for (const row of columns) {
      const table = String(row.tableName ?? row.TABLE_NAME ?? '').toLowerCase();
      if (!rosterSchema.has(table)) rosterSchema.set(table, new Set());
      rosterSchema.get(table).add(String(row.columnName ?? row.COLUMN_NAME ?? '').toLowerCase());
    }
    return rosterSchema;
  }
  function hasColumn(schema, table, column) { return schema.get(table)?.has(column) === true; }
  function firstColumn(schema, table, candidates) { return candidates.find((column) => hasColumn(schema, table, column)) ?? null; }
  function attendanceClassNames({ className, canonicalClassName }) {
    return [...new Set([className, canonicalClassName].map((value) => String(value ?? '').trim()).filter(Boolean))];
  }
  async function today(actor) {
    let configured = process.env.OSAAH_SCHOOL_TIMEZONE;
    try {
      const view = await schoolSettings?.read?.(actor);
      const schoolInformation = view?.settings?.find((item) => item.key === 'schoolInformation')?.value;
      configured = configured || view?.profile?.timezone || schoolInformation?.timezone || view?.settings?.find((item) => item.key === 'timezone')?.value;
    } catch { /* An unavailable optional setting falls back to the configured deployment default. */ }
    const timeZone = safeTimezone(configured) || safeTimezone(fallbackTimezone) || 'Africa/Accra';
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now());
    const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  async function resolvePeriod({ schoolId, academicYear, term, date }) {
    if (!academicYear || !term || !isAttendanceCalendarDate(date)) throw Object.assign(new Error('A valid academic year, term, and calendar date are required.'), { status: 400, code: 'ATTENDANCE_PERIOD_REQUIRED' });
    if (!database?.query) {
      const acceptedTerms = new Set([...TERM_OPTIONS, 'First Term', 'Second Term', 'Third Term']);
      if (!ACADEMIC_YEAR_OPTIONS.includes(String(academicYear)) || !acceptedTerms.has(String(term))) throw Object.assign(new Error('The selected academic period is unavailable.'), { status: 400, code: 'ATTENDANCE_PERIOD_NOT_FOUND' });
      return { yearId: String(academicYear), yearName: String(academicYear), yearStartsOn: null, yearEndsOn: null, termId: String(term), termName: String(term), termStartsOn: null, termEndsOn: null, date };
    }
    const matches = rows(await database.query(`SELECT y.id AS yearId,y.name AS yearName,y.starts_on AS yearStartsOn,y.ends_on AS yearEndsOn,
      t.id AS termId,t.name AS termName,t.starts_on AS termStartsOn,t.ends_on AS termEndsOn
      FROM academic_years y JOIN terms t ON t.academic_year_id=y.id
      WHERE y.school_id=? AND (y.id=? OR y.name=?) AND (t.id=? OR t.name=?) LIMIT 2`, [schoolId, academicYear, academicYear, term, term]));
    if (matches.length !== 1) throw Object.assign(new Error('The selected academic year and term do not identify one valid period.'), { status: 400, code: 'ATTENDANCE_PERIOD_NOT_FOUND' });
    const period = matches[0];
    dateInRange(date, period.yearStartsOn, period.yearEndsOn, 'academic year');
    dateInRange(date, period.termStartsOn, period.termEndsOn, 'term');
    return { ...period, date };
  }

  async function enrolledStudents({ schoolId, classId, className, canonicalClassName, period, sampleMode = false, actor }) {
    const matchesClass = (value) => String(value ?? '') === String(classId) || String(value ?? '') === String(className) || String(value ?? '') === String(canonicalClassName);
    const isDefaultStudent = (student) => String(student?.permanentStudentId ?? '').trim().toUpperCase() === 'DEFAULT_STUDENT' || String(student?.id ?? student?.studentId ?? '').trim().toUpperCase() === 'DEFAULT_STUDENT';
    if (sampleMode) {
      return students.listStudents({ requestedSchoolId: schoolId, includeTestRecords: true })
        .filter((student) => student.isTestRecord && !isDefaultStudent(student) && (!student.classId || matchesClass(student.classId)))
        .sort((a, b) => String(a.surname).localeCompare(String(b.surname)) || String(a.firstName).localeCompare(String(b.firstName)) || String(a.id).localeCompare(String(b.id)))
        .map((student) => ({ studentId: student.id, permanentStudentId: student.permanentStudentId, firstName: student.firstName, middleName: student.middleName, surname: student.surname, gender: student.gender ?? null, isTestRecord: true }));
    }
    if (database?.query) {
      return durableAttendanceRoster({ schoolId, classId, className, canonicalClassName, period });
    }
    return students.listStudents({ requestedSchoolId: schoolId }).filter((student) => !isDefaultStudent(student) && student.history?.some((entry) =>
      String(entry.academicYearId ?? '') === String(period.yearName) && String(entry.termId ?? '') === String(period.termName) && matchesClass(entry.classId)
    )).sort((a, b) => String(a.surname).localeCompare(String(b.surname)) || String(a.firstName).localeCompare(String(b.firstName)) || String(a.id).localeCompare(String(b.id)))
      .map((student) => ({ studentId: student.id, permanentStudentId: student.permanentStudentId, firstName: student.firstName, middleName: student.middleName, surname: student.surname, gender: student.gender ?? null, isTestRecord: false }));
  }

  async function savedSampleAttendance({ student, classId, period, actor }) {
    if (sampleFixtureRepository) {
      const fixture = await sampleFixtureRepository.getFixture({ schoolId: actor.schoolId, sampleStudentId: student.permanentStudentId, academicYearId: period.yearId, termId: period.termId, classId, fixtureType: 'attendance', fixtureVersion: 1 }, authorizedSampleActor(actor, 'read'));
      return rows(fixture?.fixturePayload?.records).filter((record) => record.studentId === student.permanentStudentId && record.date === period.date && String(record.classId) === String(classId));
    }
    return (attendance?.listStudentRecords?.() ?? []).filter((record) => record.isTestRecord && record.studentId === student.id && record.date === period.date && String(record.classId) === String(classId) && record.academicYear === period.yearName && record.term === period.termName);
  }

  async function saveSampleAttendance(entries, actor, period) {
    const sampleStudents = students.listStudents({ requestedSchoolId: actor.schoolId, includeTestRecords: true }).filter((student) => student.isTestRecord);
    const pending = [];
    for (const entry of entries) {
      const student = sampleStudents.find((item) => item.id === entry.studentId);
      if (!student) throw Object.assign(new Error('Student is not an authorized sample attendance record.'), { status: 400, code: 'ATTENDANCE_SAMPLE_STUDENT_INVALID' });
      const existingRows = await savedSampleAttendance({ student, classId: entry.classId, period, actor });
      const existing = existingRows[0] ?? null;
      const expected = entry.version == null || entry.version === '' ? null : Number(entry.version);
      if (existing && expected === null) throw Object.assign(new Error('Sample attendance already exists. Reload the register before saving.'), { status: 409, code: 'ATTENDANCE_VERSION_CONFLICT' });
      if (existing && expected !== Number(existing.version ?? 1)) throw Object.assign(new Error('Attendance conflict: the sample record is newer. Reload the register before saving.'), { status: 409, code: 'ATTENDANCE_VERSION_CONFLICT' });
      if (!existing && expected !== null) throw Object.assign(new Error('Attendance conflict: the sample record changed. Reload the register before saving.'), { status: 409, code: 'ATTENDANCE_VERSION_CONFLICT' });
      pending.push({ entry, student, existing });
    }
    const result = [];
    for (const { entry, student, existing } of pending) {
      const record = { id: existing?.id ?? `SAMPLE-ATT-${student.permanentStudentId}-${period.date}-${entry.classId}`, schoolId: actor.schoolId, studentId: student.permanentStudentId, permanentStudentId: student.permanentStudentId, classId: entry.classId, academicYear: period.yearName, term: period.termName, date: period.date, status: String(entry.status).toUpperCase(), reason: entry.reason ?? null, arrivalTime: entry.arrivalTime ?? null, departureTime: entry.departureTime ?? null, method: entry.method ?? 'MANUAL', source: 'TEST', isTestRecord: true, provenance: 'TEST', version: Number(existing?.version ?? 0) + 1, updatedBy: actor.id, updatedAt: new Date().toISOString() };
      if (sampleFixtureRepository) {
        const fixture = await sampleFixtureRepository.getFixture({ schoolId: actor.schoolId, sampleStudentId: student.permanentStudentId, academicYearId: period.yearId, termId: period.termId, classId: entry.classId, fixtureType: 'attendance', fixtureVersion: 1 }, authorizedSampleActor(actor, 'read'));
        const records = rows(fixture?.fixturePayload?.records).filter((item) => !(item.studentId === student.permanentStudentId && item.date === period.date && String(item.classId) === String(entry.classId)));
        await sampleFixtureRepository.ensureFixture({ schoolId: actor.schoolId, sampleStudentId: student.permanentStudentId, academicYearId: period.yearId, termId: period.termId, classId: entry.classId, fixtureType: 'attendance', fixtureVersion: 1, fixturePayload: { records: [...records, record] } }, authorizedSampleActor(actor, 'write'));
      } else {
        attendance.saveStudentAttendance({ ...record, source: 'MANUAL', studentId: student.id, academicYear: period.yearName, term: period.termName, isTestRecord: true }, actor, { correction: Boolean(existing), expectedVersion: existing ? Number(existing.version ?? 1) : null });
      }
      result.push({ ...record, studentId: student.id });
    }
    return result;
  }

  async function isEnrolled({ schoolId, studentId, classId, className = classId, canonicalClassName = className, period }) {
    if (database?.query) {
      const roster = await durableAttendanceRoster({ schoolId, classId, className, canonicalClassName, period });
      const requested = String(studentId ?? '');
      return roster.some((student) => [student.studentId, student.masterStudentId, student.permanentStudentId].some((value) => String(value ?? '') === requested));
    }
    const student = students.getStudent(studentId, { requestedSchoolId: schoolId });
    return Boolean(student && !student.isTestRecord && student.history?.some((item) => String(item.academicYearId ?? '') === String(period.yearName) && String(item.termId ?? '') === String(period.termName) && String(item.classId) === String(classId)));
  }

  async function durableAttendanceRoster({ schoolId, classId, className, canonicalClassName, period }) {
    const schema = await attendanceRosterSchema();
    const studentsTable = schema.get('students') ?? new Set();
    if (!studentsTable.has('id') || !studentsTable.has('school_id')) throw Object.assign(new Error('The student roster schema is unavailable.'), { status: 503, code: 'ATTENDANCE_ROSTER_SCHEMA_UNAVAILABLE' });
    const profilesAvailable = schema.has('student_profiles') && hasColumn(schema, 'student_profiles', 'id') && hasColumn(schema, 'student_profiles', 'school_id');
    const profileLinkFor = (alias) => {
      if (!profilesAvailable) return '';
      const links = [];
      if (hasColumn(schema, 'student_profiles', 'student_master_id')) links.push(`${alias}.student_master_id=s.id`);
      if (hasColumn(schema, 'student_profiles', 'student_id') && hasColumn(schema, 'students', 'permanent_student_id')) {
        links.push(`${hasColumn(schema, 'student_profiles', 'student_master_id') ? `(${alias}.student_master_id IS NULL AND ` : '('}${alias}.student_id=s.permanent_student_id)`);
      }
      return links.join(' OR ');
    };
    const profileLink = profileLinkFor('sp');
    const profileJoin = profilesAvailable && profileLink ? ` LEFT JOIN student_profiles sp ON sp.school_id=s.school_id AND (${profileLink})` : '';
    const profileId = profilesAvailable && profileLink ? 'sp.id' : 'NULL';
    const studentIdExpr = `COALESCE(${profileId},s.id)`;
    const profileFirst = firstColumn(schema, 'student_profiles', ['first_name']);
    const studentFirst = firstColumn(schema, 'students', ['first_name']);
    const profileMiddle = firstColumn(schema, 'student_profiles', ['middle_name']);
    const studentMiddle = firstColumn(schema, 'students', ['middle_name']);
    const profileSurname = firstColumn(schema, 'student_profiles', ['surname','last_name']);
    const studentSurname = firstColumn(schema, 'students', ['last_name','surname']);
    const profileGender = firstColumn(schema, 'student_profiles', ['gender']);
    const studentGender = firstColumn(schema, 'students', ['gender']);
    const project = (profileColumn, studentColumn, alias, fallback = 'NULL') => {
      const expressions = [];
      if (profileColumn && profilesAvailable && profileLink) expressions.push(`NULLIF(sp.${profileColumn},'')`);
      if (studentColumn) expressions.push(`NULLIF(s.${studentColumn},'')`);
      return `${expressions.length ? `COALESCE(${expressions.join(',')})` : fallback} AS ${alias}`;
    };
    const activeStudentFilters = [];
    if (hasColumn(schema, 'students', 'student_status')) activeStudentFilters.push("UPPER(COALESCE(s.student_status,'ACTIVE'))='ACTIVE'");
    if (hasColumn(schema, 'students', 'is_test_record')) activeStudentFilters.push('s.is_test_record IS NOT TRUE');
    if (hasColumn(schema, 'students', 'permanent_student_id')) activeStudentFilters.push("UPPER(COALESCE(s.permanent_student_id,'')) <> 'DEFAULT_STUDENT'");
    activeStudentFilters.push("UPPER(COALESCE(s.id,'')) <> 'DEFAULT_STUDENT'");
    const activeStudentSql = activeStudentFilters.length ? ` AND ${activeStudentFilters.join(' AND ')}` : '';
    const classNames = attendanceClassNames({ className, canonicalClassName });
    const result = [];
    const enrollmentColumns = schema.get('student_enrollments') ?? new Set();
    const hasEnrollmentRoster = enrollmentColumns.has('student_id') && enrollmentColumns.has('class_id');
    const yearPredicates = [];
    const yearParams = [];
    if (enrollmentColumns.has('academic_year_id')) { yearPredicates.push('e.academic_year_id=?'); yearParams.push(period.yearId); }
    if (enrollmentColumns.has('academic_year')) { yearPredicates.push('e.academic_year=?'); yearParams.push(period.yearName); }
    const termPredicates = [];
    const termParams = [];
    if (enrollmentColumns.has('term_id')) { termPredicates.push('(e.term_id=? OR e.term_id IS NULL)'); termParams.push(period.termId); }
    if (enrollmentColumns.has('term')) { termPredicates.push('e.term=?'); termParams.push(period.termName); }
    if (hasEnrollmentRoster && yearPredicates.length) {
      const conditions = ['s.school_id=?'];
      const params = [schoolId];
      if (enrollmentColumns.has('school_id')) conditions.push('e.school_id=s.school_id');
      conditions.push('e.student_id=s.id');
      const classPredicates = [];
      if (enrollmentColumns.has('class_id')) { classPredicates.push('e.class_id=?'); params.push(classId); }
      if (enrollmentColumns.has('class_name')) for (const name of classNames) { classPredicates.push('e.class_name=?'); params.push(name); }
      conditions.push(`(${classPredicates.join(' OR ')})`);
      if (enrollmentColumns.has('academic_year_id') && enrollmentColumns.has('term_id')) {
        // Canonical enrollment records must match the exact selected academic session.
        conditions.push('e.academic_year_id=? AND e.term_id=?');
        params.push(period.yearId, period.termId);
      } else {
        conditions.push(`(${yearPredicates.join(' OR ')})`); params.push(...yearParams);
        if (termPredicates.length) { conditions.push(`(${termPredicates.join(' OR ')})`); params.push(...termParams); }
      }
      if (enrollmentColumns.has('enrollment_status')) conditions.push("UPPER(COALESCE(e.enrollment_status,'ACTIVE'))='ACTIVE'");
      if (enrollmentColumns.has('is_current')) conditions.push('COALESCE(e.is_current,1)=1');
      if (hasColumn(schema, 'students', 'permanent_student_id')) conditions.push("UPPER(COALESCE(s.permanent_student_id,'')) <> 'DEFAULT_STUDENT'");
      const sql = `SELECT DISTINCT ${studentIdExpr} AS studentId,s.id AS masterStudentId,${hasColumn(schema,'students','permanent_student_id') ? 's.permanent_student_id' : 's.id'} AS permanentStudentId,
        ${project(profileFirst,studentFirst,'firstName')},${project(profileMiddle,studentMiddle,'middleName')},${project(profileSurname,studentSurname,'surname')},${project(profileGender,studentGender,'gender')}
        FROM student_enrollments e JOIN students s ON s.id=e.student_id${profileJoin}
        WHERE ${conditions.join(' AND ')}${activeStudentSql} ORDER BY surname,firstName,studentId`;
      result.push(...rows(await database.query(sql, params)).map((student) => ({ ...student, isTestRecord: false })));
    }
    const profileClassLink = profileLinkFor('spc');
    const profileClass = profilesAvailable && profileClassLink && hasColumn(schema,'student_profiles','class_id')
      ? `(SELECT spc.class_id FROM student_profiles spc WHERE spc.school_id=s.school_id AND (${profileClassLink}) ORDER BY spc.id DESC LIMIT 1)` : null;
    const classExpression = hasColumn(schema, 'students', 'current_class_id')
      ? `COALESCE(s.current_class_id,${profileClass ?? 'NULL'})`
      : profileClass;
    const admissionDate = firstColumn(schema,'students',['admission_date']);
    const createdAt = firstColumn(schema,'students',['created_at']);
    const studentDate = admissionDate && createdAt ? `COALESCE(s.${admissionDate},DATE(s.${createdAt}))` : admissionDate ? `s.${admissionDate}` : createdAt ? `DATE(s.${createdAt})` : null;
    if (classExpression && studentDate && period.yearStartsOn && period.yearEndsOn) {
      const classPredicates = [`${classExpression}=?`, `${classExpression}=?`];
      const params = [schoolId, classId, className];
      for (const name of classNames) { classPredicates.push(`${classExpression}=?`); params.push(name); }
      const missingEnrollmentExclusion = hasEnrollmentRoster && yearPredicates.length
        ? ` AND NOT EXISTS (SELECT 1 FROM student_enrollments prior WHERE prior.student_id=s.id${enrollmentColumns.has('school_id') ? ' AND prior.school_id=s.school_id' : ''} AND (${yearPredicates.map((clause) => clause.replace(/\be\./g, 'prior.')).join(' OR ')}))`
        : '';
      const fallback = await database.query(`SELECT ${studentIdExpr} AS studentId,s.id AS masterStudentId,${hasColumn(schema,'students','permanent_student_id') ? 's.permanent_student_id' : 's.id'} AS permanentStudentId,
        ${project(profileFirst,studentFirst,'firstName')},${project(profileMiddle,studentMiddle,'middleName')},${project(profileSurname,studentSurname,'surname')},${project(profileGender,studentGender,'gender')}
        FROM students s${profileJoin} WHERE s.school_id=? AND ${studentDate} BETWEEN ? AND ? AND (${classPredicates.join(' OR ')})${activeStudentSql}${missingEnrollmentExclusion}
        ORDER BY surname,firstName,studentId`, [schoolId, period.yearStartsOn, period.yearEndsOn, ...params.slice(1), ...yearParams]);
      const existing = new Set(result.map((student) => String(student.masterStudentId)));
      for (const student of rows(fallback)) if (!existing.has(String(student.masterStudentId))) result.push({ ...student, isTestRecord: false });
    }
    const unique = new Map();
    for (const student of result) if (!unique.has(String(student.masterStudentId ?? student.studentId))) unique.set(String(student.masterStudentId ?? student.studentId), student);
    return [...unique.values()].sort((a,b) => String(a.surname ?? '').localeCompare(String(b.surname ?? '')) || String(a.firstName ?? '').localeCompare(String(b.firstName ?? '')) || String(a.studentId).localeCompare(String(b.studentId)));
  }

  return Object.freeze({ today, resolvePeriod, enrolledStudents, savedSampleAttendance, saveSampleAttendance, isEnrolled });
}
