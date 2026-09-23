import { normalizeStudentGender } from './student-gender.js';
import { STUDENT_STATUSES } from './attendance.js';

export const ATTENDANCE_REPORT_PERIODS = ['DAILY', 'WEEKLY', 'MONTHLY', 'TERM'];
const EXCUSED_STATUSES = new Set(['EXCUSED_ABSENCE', 'SICK_ABSENCE']);
const PRESENT_STATUSES = new Set(['PRESENT', 'LATE']);
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function asDate(value) { const date = new Date(`${value}T00:00:00Z`); return Number.isNaN(date.getTime()) ? null : date; }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function weekRange(week) {
  const value = String(week ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) { const start = asDate(value); const end = new Date(start); end.setUTCDate(end.getUTCDate() + 6); return { start, end, label: value }; }
  const match = /^(\d{4})-W(\d{1,2})$/.exec(value); if (!match) return null;
  const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4)); const day = jan4.getUTCDay() || 7; const start = new Date(jan4); start.setUTCDate(jan4.getUTCDate() - day + 1 + (Number(match[2]) - 1) * 7); const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6); return { start, end, label: value };
}
function dateInRange(date, start, end) { const value = asDate(date); return value && value >= start && value <= end; }
function monthRange(month) { const match = /^(\d{4})-(\d{2})$/.exec(String(month ?? '')); if (!match) return null; const start = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1)); const end = new Date(Date.UTC(Number(match[1]), Number(match[2]), 0)); return { start, end, label: `${match[1]}-${match[2]}` }; }
function genderOf(student) { const gender = normalizeStudentGender(student?.gender); return gender === 'Male' ? 'BOYS' : gender === 'Female' ? 'GIRLS' : 'UNKNOWN'; }

export function attendancePercentage(rows = []) {
  const eligible = rows.filter((row) => !EXCUSED_STATUSES.has(row.status));
  return eligible.length ? Math.round((eligible.filter((row) => PRESENT_STATUSES.has(row.status)).length / eligible.length) * 10000) / 100 : 0;
}

export function createAttendanceAggregationService({ attendance, students, schoolId = 'school-osaah-daylight', now = () => new Date().toISOString() } = {}) {
  function records() { return attendance?.listStudentRecords?.().filter((record) => record.schoolId === schoolId) ?? []; }
  function studentMap({ academicYear, term, classId, studentIds } = {}) {
    const source = students?.listStudents?.({ requestedSchoolId: schoolId, includeTestRecords: false }) ?? []; const result = new Map();
    for (const student of source) {
      if (studentIds && !studentIds.includes(student.id)) continue;
      const history = Array.isArray(student.history) ? student.history.filter((entry) => entry.classId === classId && entry.academicYearId != null && entry.termId != null) : [];
      const scoped = !classId || history.length === 0 || history.some((entry) => String(entry.academicYearId) === String(academicYear) && String(entry.termId) === String(term));
      if (student.status !== 'COMPLETED' && (!classId || (student.classId === classId && scoped))) result.set(student.id, student);
    }
    return result;
  }
  function scopedRecords(filters = {}) {
    return records().filter((row) => (!filters.academicYear || String(row.academicYear) === String(filters.academicYear)) && (!filters.term || String(row.term) === String(filters.term)) && (!filters.classId || row.classId === filters.classId) && (!filters.studentId || row.studentId === filters.studentId));
  }
  function counts(rows, studentsById) {
    const result = { boysPresent: 0, girlsPresent: 0, totalPresent: 0, boysAbsent: 0, girlsAbsent: 0, totalAbsent: 0, boysLate: 0, girlsLate: 0, totalLate: 0, boysExcused: 0, girlsExcused: 0, totalExcused: 0, other: 0 };
    for (const row of rows) { const gender = genderOf(studentsById.get(row.studentId)); const prefix = gender === 'BOYS' ? 'boys' : gender === 'GIRLS' ? 'girls' : null; if (PRESENT_STATUSES.has(row.status)) { result.totalPresent += 1; if (prefix) result[`${prefix}Present`] += 1; if (row.status === 'LATE') { result.totalLate += 1; if (prefix) result[`${prefix}Late`] += 1; } } else if (EXCUSED_STATUSES.has(row.status)) { result.totalExcused += 1; if (prefix) result[`${prefix}Excused`] += 1; } else if (row.status === 'ABSENT' || row.status === 'UNEXCUSED_ABSENCE') { result.totalAbsent += 1; if (prefix) result[`${prefix}Absent`] += 1; } else result.other += 1; }
    return result;
  }
  function base(filters, rows, period, range = null) {
    const studentsById = studentMap(filters); const scoped = rows.filter((row) => studentsById.has(row.studentId)); const metric = counts(scoped, studentsById); const enrolled = { boys: 0, girls: 0, total: studentsById.size };
    for (const student of studentsById.values()) { const gender = genderOf(student); if (gender === 'BOYS') enrolled.boys += 1; if (gender === 'GIRLS') enrolled.girls += 1; }
    return { schoolId, period, academicYear: filters.academicYear ?? null, term: filters.term ?? null, classId: filters.classId ?? null, range: range ? { start: isoDate(range.start), end: isoDate(range.end), label: range.label } : null, enrolled, ...metric, totalStudents: enrolled.total, attendanceDays: new Set(scoped.map((row) => row.date)).size, attendancePercentage: attendancePercentage(scoped), generatedAt: now() };
  }
  function daily(filters = {}) { const rows = scopedRecords(filters).filter((row) => !filters.date || row.date === filters.date); return base(filters, rows, 'DAILY'); }
  function weekly(filters = {}) { const range = weekRange(filters.week); if (!range) throw new Error('A valid Week is required. Use YYYY-W## or a week start date.'); const rows = scopedRecords(filters).filter((row) => dateInRange(row.date, range.start, range.end)); const report = base(filters, rows, 'WEEKLY', range); report.days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].map((name, index) => { const date = new Date(range.start); date.setUTCDate(range.start.getUTCDate() + index); const dayRows = rows.filter((row) => row.date === isoDate(date)); return { day: name, date: isoDate(date), ...counts(dayRows, studentMap(filters)), attendancePercentage: attendancePercentage(dayRows) }; }); return report; }
  function monthly(filters = {}) { const range = monthRange(filters.month); if (!range) throw new Error('A valid Month is required. Use YYYY-MM.'); const rows = scopedRecords(filters).filter((row) => dateInRange(row.date, range.start, range.end)); return base(filters, rows, 'MONTHLY', range); }
  function term(filters = {}) { const rows = scopedRecords(filters); return base(filters, rows, 'TERM'); }
  function report(filters = {}) { const period = String(filters.period ?? 'DAILY').toUpperCase(); if (!ATTENDANCE_REPORT_PERIODS.includes(period)) throw new Error('Invalid attendance report period'); return ({ DAILY: daily, WEEKLY: weekly, MONTHLY: monthly, TERM: term })[period](filters); }
  return { daily, weekly, monthly, term, report, records, attendancePercentage, statuses: () => [...STUDENT_STATUSES] };
}

export default createAttendanceAggregationService;
