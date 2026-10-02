import { normalizeStudentGender } from './student-gender.js';
import { STUDENT_STATUSES } from './attendance.js';

const CANONICAL_CLASSES = Object.freeze(['Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3']);
const PRESENT = new Set(['PRESENT', 'LATE', 'CHECKED_IN']);
const ABSENT = new Set(['ABSENT', 'UNEXCUSED_ABSENCE', 'SICK_ABSENCE']);
const EXCUSED = new Set(['EXCUSED_ABSENCE', 'EXCUSED', 'ON_LEAVE']);
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HISTOGRAM = Object.freeze([
  { label: '0–19%', lower: 0, upper: 19 },
  { label: '20–39%', lower: 20, upper: 39 },
  { label: '40–59%', lower: 40, upper: 59 },
  { label: '60–79%', lower: 60, upper: 79 },
  { label: '80–100%', lower: 80, upper: 100 }
]);

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const rows = (value) => Array.isArray(value) ? value : [];
const round = (value) => Math.round(Number(value || 0) * 100) / 100;
const fail = (message, status = 400, code = 'ATTENDANCE_ANALYTICS_ERROR') => { throw Object.assign(new Error(message), { status, code }); };
const statusOf = (row) => upper(row.status ?? row.attendanceStatus ?? row.attendance_status);
const dateOf = (row) => text(row.date ?? row.attendanceDate ?? row.attendance_date);
const genderOf = (value) => { const gender = normalizeStudentGender(value); return gender === 'Male' ? 'BOYS' : gender === 'Female' ? 'GIRLS' : 'UNSPECIFIED'; };

function validateFilters(input = {}) {
  const filters = { ...input };
  if (filters.week && !WEEK_RE.test(text(filters.week))) fail('Week must use ISO YYYY-Www format.');
  if (filters.month && !MONTH_RE.test(text(filters.month))) fail('Month must use YYYY-MM format.');
  if (filters.startDate && !DATE_RE.test(text(filters.startDate))) fail('Invalid startDate; use YYYY-MM-DD.');
  if (filters.endDate && !DATE_RE.test(text(filters.endDate))) fail('Invalid endDate; use YYYY-MM-DD.');
  if (filters.startDate !== undefined && filters.endDate === undefined || filters.endDate !== undefined && filters.startDate === undefined) fail('Custom Date Range requires startDate and endDate.');
  if ([filters.week, filters.month, filters.startDate].filter(Boolean).length > 1) fail('Choose only one of week, month, or custom date range.');
  if (filters.status && !STUDENT_STATUSES.includes(upper(filters.status))) fail('Invalid attendance status filter.');
  if (filters.gender && !['BOYS', 'GIRLS', 'UNSPECIFIED', 'MALE', 'FEMALE'].includes(upper(filters.gender))) fail('Gender must be boys, girls, or unspecified.');
  return filters;
}

function percentage(numerator, denominator) { return denominator ? round(Number(numerator) / Number(denominator) * 100) : null; }
function bucketFor(value) { const rate = Math.max(0, Math.min(100, Number(value))); return HISTOGRAM.find((bucket, index) => rate >= bucket.lower && (rate <= bucket.upper || index === HISTOGRAM.length - 1)); }
function isoWeek(date) { const value = new Date(`${date}T00:00:00Z`); const day = value.getUTCDay() || 7; value.setUTCDate(value.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1)); const week = Math.ceil((((value - yearStart) / 86400000) + 1) / 7); return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`; }
function monthOf(date) { return text(date).slice(0, 7); }
function effectiveMarks(input) {
  const result = new Map();
  for (const row of rows(input)) {
    const date = dateOf(row); const studentId = text(row.profileId ?? row.studentId ?? row.student_id); const status = statusOf(row);
    if (!studentId || !date || !status || row.isTestRecord || upper(row.provenance) === 'TEST') continue;
    const key = `${studentId}\u0000${date}`; const current = result.get(key);
    const version = Number(row.version ?? 0); const currentVersion = Number(current?.version ?? -1);
    const updated = text(row.updatedAt ?? row.updated_at ?? row.recordedAt ?? row.recorded_at);
    const currentUpdated = text(current?.updatedAt ?? current?.updated_at ?? current?.recordedAt ?? current?.recorded_at);
    if (!current || version > currentVersion || version === currentVersion && updated >= currentUpdated) result.set(key, { ...row, status });
  }
  return [...result.values()];
}
function summarizeMarks(input) {
  const marks = effectiveMarks(input); const counts = { present: 0, absent: 0, excused: 0, unmarked: 0, other: 0 };
  for (const row of marks) { if (PRESENT.has(row.status)) counts.present += 1; else if (ABSENT.has(row.status)) counts.absent += 1; else if (EXCUSED.has(row.status)) counts.excused += 1; else counts.other += 1; }
  return { ...counts, marked: marks.length, attendanceRate: percentage(counts.present, counts.present + counts.absent + counts.other) };
}
function distribution(summary, unit = 'student-days') {
  const items = [['Present', summary.present], ['Absent', summary.absent], ['Excused/Recognized', summary.excused], ['Other Marked', summary.other], ['Unmarked', summary.unmarked]];
  const total = items.reduce((sum, [, value]) => sum + Number(value || 0), 0);
  return { unit, total, items: items.map(([label, count]) => ({ label, count: Number(count || 0), percentage: percentage(count, total) })) };
}
function periodMeta(report, filters) { return { filters, label: report?.periodLabel ?? `${filters.startDate ?? 'selected'} – ${filters.endDate ?? 'selected'}`, source: 'TiDB-backed canonical attendance services' }; }

export function createAttendanceAnalyticsService({ database = null, studentOverview = null, staffOverview = null, attendanceRepository = null, attendance = null, schoolId = 'school-osaah-daylight', now = () => new Date().toISOString(), rawProvider = null } = {}) {
  function withinScope(records, filters) {
    const start = text(filters.startDate); const end = text(filters.endDate); const classId = text(filters.classId);
    return rows(records).filter((row) => (!start || dateOf(row) >= start) && (!end || dateOf(row) <= end) && (!classId || text(row.classId ?? row.class_id) === classId) && (!filters.allowedClassIds?.length || filters.allowedClassIds.map(String).includes(text(row.classId ?? row.class_id))));
  }
  async function rawStudentRecords(actor, filters) {
    if (rawProvider?.studentRecords) return rows(await rawProvider.studentRecords(actor, filters));
    if (attendanceRepository?.listStudentRecords) return withinScope(await attendanceRepository.listStudentRecords({ schoolId: actor.schoolId, academicYear: filters.academicYear?.id ?? filters.academicYear, term: filters.term?.id ?? filters.term }), filters);
    return withinScope(rows(attendance?.listStudentRecords?.()).filter((row) => row.schoolId === actor.schoolId), filters);
  }
  async function rawStaffRecords(actor, filters) {
    if (rawProvider?.staffRecords) return rows(await rawProvider.staffRecords(actor, filters));
    if (attendanceRepository?.listStaffRecords) return withinScope(await attendanceRepository.listStaffRecords({ schoolId: actor.schoolId, academicYear: filters.academicYear?.id ?? filters.academicYear, term: filters.term?.id ?? filters.term }), filters);
    return withinScope(rows(attendance?.listStaffRecords?.()).filter((row) => row.schoolId === actor.schoolId), filters);
  }
  function authorize(actor) {
    if (!actor || actor.portal === 'parent' || actor.portal === 'student' || actor.schoolId !== schoolId) fail('Forbidden.', 403, 'ATTENDANCE_SCOPE_DENIED');
    if (!(actor.permissions?.has?.('*') || actor.permissions?.has?.('attendance.read') || upper(actor.roleKey) === 'PROPRIETOR')) fail('Forbidden.', 403, 'ATTENDANCE_PERMISSION_REQUIRED');
    if (upper(actor.roleKey) === 'TEACHER' && (!Array.isArray(actor.assignedClassIds) || actor.assignedClassIds.length === 0)) fail('Forbidden.', 403, 'ATTENDANCE_CLASS_SCOPE_REQUIRED');
  }
  function staffCanRead(actor) { return Boolean(actor.permissions?.has?.('*') || actor.permissions?.has?.('staff.attendance.read') || ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'].includes(upper(actor.roleKey))); }
  function scopedFilters(filters, actor) { const next = { ...filters }; if (upper(actor.roleKey) === 'TEACHER') next.allowedClassIds = actor.assignedClassIds; return next; }
  function trends(marks, type = 'student') {
    const effective = effectiveMarks(marks); const byDay = new Map();
    for (const row of effective) { const date = dateOf(row); if (!date) continue; if (!byDay.has(date)) byDay.set(date, []); byDay.get(date).push(row); }
    const daily = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayRows]) => { const summary = summarizeMarks(dayRows); return { period: date, observed: dayRows.length, present: summary.present, absent: summary.absent, unmarked: 0, attendanceRate: summary.attendanceRate, unit: type === 'student' ? 'student-days' : 'staff-days' }; });
    const aggregate = (keyFn, label) => { const groups = new Map(); for (const row of effective) { const key = keyFn(dateOf(row)); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(row); } return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, group]) => ({ period, ...summarizeMarks(group), unit: type === 'student' ? 'student-days' : 'staff-days', granularity: label })); };
    return { daily, weekly: aggregate(isoWeek, 'weekly'), monthly: aggregate(monthOf, 'monthly'), term: aggregate(() => 'selected-term', 'term') };
  }
  function histogram(marks) {
    const byPerson = new Map(); for (const row of effectiveMarks(marks)) { const person = text(row.profileId ?? row.studentId ?? row.staffId); if (!person) continue; if (!byPerson.has(person)) byPerson.set(person, []); byPerson.get(person).push(row); }
    const counts = new Map(HISTOGRAM.map((bucket) => [bucket.label, 0])); for (const personRows of byPerson.values()) { const summary = summarizeMarks(personRows); const rate = percentage(summary.present, summary.present + summary.absent + summary.other); if (rate == null) continue; counts.set(bucketFor(rate).label, counts.get(bucketFor(rate).label) + 1); }
    const total = [...counts.values()].reduce((sum, value) => sum + value, 0); return { eligiblePopulation: total, buckets: HISTOGRAM.map((bucket) => ({ ...bucket, count: counts.get(bucket.label), percentage: percentage(counts.get(bucket.label), total) })) };
  }
  async function overview(inputFilters = {}, actor) {
    authorize(actor); const filters = scopedFilters(validateFilters(inputFilters), actor);
    if (!studentOverview?.overview) fail('TiDB student attendance reporting is unavailable.', 503, 'STUDENT_ANALYTICS_UNAVAILABLE');
    const student = await studentOverview.overview(filters, actor); const effectiveFilters = { ...filters, ...(student.filters ?? {}) }; const studentMarks = await rawStudentRecords(actor, effectiveFilters); const studentSummary = student.summary ?? summarizeMarks(studentMarks);
    const staff = staffCanRead(actor) && staffOverview?.overview ? await staffOverview.overview(filters, actor) : null; const staffMarks = staff ? await rawStaffRecords(actor, { ...effectiveFilters, ...(staff.filters ?? {}) }) : [];
    const staffSummary = staff ? { present: Number(staff.summary?.present ?? 0), absent: Number(staff.summary?.absent ?? 0), excused: Number(staff.summary?.leave ?? 0), unmarked: Number(staff.staff?.reduce((sum, row) => sum + Number(row.missingDays ?? 0), 0) ?? 0), other: 0 } : { present: 0, absent: 0, excused: 0, unmarked: 0, other: 0 };
    const classRows = rows(student.classes).filter((row) => row.canonicalClassId).map((row) => ({ classId: row.classId, className: row.className, attendanceRate: row.eligibleStudentDays ? row.attendancePercentage : null, presentStudentDays: row.totalPresent, absentStudentDays: row.totalAbsent, unmarkedStudentDays: row.unmarkedStudentDays, eligibleStudentDays: row.eligibleStudentDays, boys: { enrolled: row.totalBoysEnrolled, present: row.boysPresent, rate: percentage(row.boysPresent, row.boysPresent + row.boysAbsent) }, girls: { enrolled: row.totalGirlsEnrolled, present: row.girlsPresent, rate: percentage(row.girlsPresent, row.girlsPresent + row.girlsAbsent) } }));
    const classes = upper(actor.roleKey) === 'TEACHER' ? classRows : CANONICAL_CLASSES.map((className) => classRows.find((row) => row.className === className) ?? ({ className, attendanceRate: null, noData: true, boys: { rate: null }, girls: { rate: null } }));
    const gender = ['BOYS', 'GIRLS', 'UNSPECIFIED'].map((label) => { const present = rows(student.classes).reduce((sum, row) => sum + Number(row[`${label === 'BOYS' ? 'boys' : label === 'GIRLS' ? 'girls' : 'unspecifiedGender'}Present`] ?? 0), 0); const absent = rows(student.classes).reduce((sum, row) => sum + Number(row[`${label === 'BOYS' ? 'boys' : label === 'GIRLS' ? 'girls' : 'unspecifiedGender'}Absent`] ?? 0), 0); return { label, present, absent, rate: percentage(present, present + absent) }; });
    return { generatedAt: now(), authoritative: true, period: periodMeta(student, filters), coverage: { students: student.calculationPolicy ?? null, staff: staff?.source ?? null }, summary: { students: { totalEnrolled: studentSummary.totalEnrolledStudents, presentStudentDays: studentSummary.presentStudentDays, absentStudentDays: studentSummary.absentStudentDays, unmarkedStudentDays: studentSummary.unmarkedStudentDays, attendanceRate: studentSummary.attendancePercentage }, staff: { totalRegisteredStaff: staff?.staff?.length ?? 0, presentStaffDays: staffSummary.present, absentStaffDays: staffSummary.absent, approvedLeave: staffSummary.excused, unmarkedStaffDays: staffSummary.unmarked, attendanceRate: percentage(staffSummary.present, staffSummary.present + staffSummary.absent) } }, studentDistribution: distribution({ ...studentSummary, present: studentSummary.presentStudentDays, absent: studentSummary.absentStudentDays, unmarked: studentSummary.unmarkedStudentDays, excused: studentSummary.excusedStudentDays, other: studentSummary.otherMarkedStudentDays }), staffDistribution: distribution(staffSummary, 'staff-days'), genderDistribution: { unit: 'attendance person-days', items: gender }, classAttendance: classes, genderByClass: classes, staffComparison: { presentRate: percentage(staffSummary.present, staffSummary.present + staffSummary.absent + staffSummary.excused), absentRate: percentage(staffSummary.absent, staffSummary.present + staffSummary.absent + staffSummary.excused), leaveRate: percentage(staffSummary.excused, staffSummary.present + staffSummary.absent + staffSummary.excused) }, monthlyComparison: { students: trends(studentMarks).monthly, staff: staff ? trends(staffMarks, 'staff').monthly : [] }, histogram: histogram(studentMarks), trends: { students: trends(studentMarks), staff: staff ? trends(staffMarks, 'staff') : null } };
  }
  return Object.freeze({ overview, validateFilters, histogram });
}
export default createAttendanceAnalyticsService;
