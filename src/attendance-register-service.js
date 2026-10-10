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
    if (sampleMode) {
      return students.listStudents({ requestedSchoolId: schoolId, includeTestRecords: true })
        .filter((student) => student.isTestRecord && (!student.classId || matchesClass(student.classId)))
        .sort((a, b) => String(a.surname).localeCompare(String(b.surname)) || String(a.firstName).localeCompare(String(b.firstName)) || String(a.id).localeCompare(String(b.id)))
        .map((student) => ({ studentId: student.id, permanentStudentId: student.permanentStudentId, firstName: student.firstName, middleName: student.middleName, surname: student.surname, gender: student.gender ?? null, isTestRecord: true }));
    }
    if (database?.query) {
      const result = rows(await database.query(`SELECT DISTINCT sp.id AS studentId,s.permanent_student_id AS permanentStudentId,
        COALESCE(NULLIF(sp.first_name,''),s.first_name) AS firstName,sp.middle_name AS middleName,
        COALESCE(NULLIF(sp.surname,''),s.last_name) AS surname,COALESCE(sp.gender,s.gender) AS gender
        FROM student_enrollments e
        JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id
        JOIN student_profiles sp ON sp.school_id=s.school_id AND (sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id)
        WHERE e.school_id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=?
          AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,1)=1
          AND COALESCE(s.student_status,'ACTIVE')='ACTIVE' AND COALESCE(s.is_test_record,0)=0
        ORDER BY surname,firstName,studentId`, [schoolId, classId, period.yearId, period.termId]));
      return result.map((student) => ({ ...student, isTestRecord: false }));
    }
    return students.listStudents({ requestedSchoolId: schoolId }).filter((student) => student.history?.some((entry) =>
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

  async function isEnrolled({ schoolId, studentId, classId, period }) {
    if (database?.query) {
      const match = rows(await database.query(`SELECT sp.id AS studentId FROM student_enrollments e
        JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id
        JOIN student_profiles sp ON sp.school_id=s.school_id AND (sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id)
        WHERE e.school_id=? AND sp.id=? AND e.class_id=? AND e.academic_year_id=? AND e.term_id=?
          AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,1)=1
          AND COALESCE(s.student_status,'ACTIVE')='ACTIVE' AND COALESCE(s.is_test_record,0)=0 LIMIT 1`, [schoolId, studentId, classId, period.yearId, period.termId]));
      return match.length > 0;
    }
    const student = students.getStudent(studentId, { requestedSchoolId: schoolId });
    return Boolean(student && !student.isTestRecord && student.history?.some((item) => String(item.academicYearId ?? '') === String(period.yearName) && String(item.termId ?? '') === String(period.termName) && String(item.classId) === String(classId)));
  }

  return Object.freeze({ today, resolvePeriod, enrolledStudents, savedSampleAttendance, saveSampleAttendance, isEnrolled });
}
