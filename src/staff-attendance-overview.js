import { STAFF_ATTENDANCE_STATUSES } from './staff-leave-reconciliation.js';

const DAY = 86_400_000;
const LEADERSHIP_ROLES = new Set(['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER']);
const STATUS_PRIORITY = ['PRESENT', 'CHECKED_IN', 'LATE', 'ABSENT', 'ON_LEAVE', 'EXCUSED', 'CHECKED_OUT'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^(\d{4})-W(\d{2})$/;
const MONTH_RE = /^(\d{4})-(\d{2})$/;

function rows(value) { return Array.isArray(value) ? value : []; }
function text(value) { return String(value ?? '').trim(); }
function isoDate(value, label = 'date') {
  const result = text(value);
  if (!DATE_RE.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) throw new Error(`Invalid ${label}`);
  return result;
}
function dateValue(value) { return new Date(`${value}T00:00:00.000Z`); }
function dateString(value) { return value.toISOString().slice(0, 10); }
function addDays(value, amount) { const result = dateValue(value); result.setUTCDate(result.getUTCDate() + amount); return dateString(result); }
function minDate(a, b) { return a < b ? a : b; }
function maxDate(a, b) { return a > b ? a : b; }
function inRange(value, start, end) { return value >= start && value <= end; }
function rangeForWeek(value) {
  const match = WEEK_RE.exec(text(value));
  if (!match) throw new Error('Week must use YYYY-Www format');
  const year = Number(match[1]); const week = Number(match[2]);
  if (week < 1 || week > 53) throw new Error('Week must use YYYY-Www format');
  const jan4 = dateValue(`${year}-01-04`); const day = jan4.getUTCDay() || 7;
  const monday = dateString(new Date(jan4.valueOf() - (day - 1) * DAY + (week - 1) * 7 * DAY));
  return { start: monday, end: addDays(monday, 6) };
}
function rangeForMonth(value) {
  const match = MONTH_RE.exec(text(value));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error('Month must use YYYY-MM format');
  const start = `${match[1]}-${match[2]}-01`;
  return { start, end: dateString(new Date(Date.UTC(Number(match[1]), Number(match[2]), 0))) };
}
function normalizeStaff(row, schoolId) {
  return {
    id: row.id ?? row.staffId,
    name: row.fullName ?? row.name ?? [row.firstName, row.lastName, row.surname].filter(Boolean).join(' '),
    phone: row.phone ?? row.telephone ?? row.registeredPhone ?? null,
    role: row.roleKey ?? row.role ?? 'Staff',
    schoolId: row.schoolId ?? row.school_id ?? schoolId,
    joinedOn: row.joinedOn ?? row.appointmentDate ?? row.appointment_date ?? null,
    departedOn: row.departedOn ?? row.departureDate ?? row.departure_date ?? null,
    isTestRecord: Boolean(row.isTestRecord ?? row.is_test_record)
  };
}
function normalizeLeave(row) { return { ...row, staffId: row.staffId ?? row.staff_id, startsOn: row.startsOn ?? row.starts_on, endsOn: row.endsOn ?? row.ends_on, state: text(row.state).toUpperCase() }; }
function statusOf(row) { return text(row.status ?? row.attendanceStatus ?? row.attendance_status).toUpperCase(); }
function effectiveRecords(records) {
  const groups = new Map();
  for (const row of rows(records)) {
    if (row.isTestRecord || text(row.provenance).toUpperCase() === 'TEST') continue;
    const status = statusOf(row); if (!status || !row.staffId || !row.date) continue;
    const key = `${row.staffId}:${row.date}`;
    const current = groups.get(key);
    const rank = STATUS_PRIORITY.indexOf(status); const currentRank = current ? STATUS_PRIORITY.indexOf(statusOf(current)) : 999;
    if (!current || (rank >= 0 && (currentRank < 0 || rank < currentRank)) || (rank === currentRank && text(row.updatedAt ?? row.recordedAt ?? row.createdAt) > text(current.updatedAt ?? current.recordedAt ?? current.createdAt))) groups.set(key, { ...row, status });
  }
  return [...groups.values()];
}
function emptyCounts() { return { present: 0, absent: 0, leave: 0, excused: 0, late: 0, marked: 0, eligibleDays: 0 }; }
function summarize(records, leaveRows, staff, start, end, holidays) {
  const result = emptyCounts();
  const eligible = new Set();
  const approvedLeaveDates = new Set();
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const weekday = dateValue(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !holidays.has(day) && (!staff.joinedOn || day >= staff.joinedOn) && (!staff.departedOn || day <= staff.departedOn)) eligible.add(day);
  }
  result.eligibleDays = eligible.size;
  for (const leave of leaveRows) if (leave.staffId === staff.id && leave.state === 'APPROVED') {
    for (let day = maxDate(leave.startsOn, start); day <= minDate(leave.endsOn, end); day = addDays(day, 1)) if (eligible.has(day)) approvedLeaveDates.add(day);
  }
  for (const row of records.filter((item) => item.staffId === staff.id && eligible.has(item.date))) {
    result.marked += 1;
    if (['PRESENT', 'CHECKED_IN', 'LATE'].includes(row.status)) result.present += 1;
    if (row.status === 'LATE') result.late += 1;
    if (row.status === 'ABSENT' && !approvedLeaveDates.has(row.date)) result.absent += 1;
    if (['ON_LEAVE', 'EXCUSED'].includes(row.status)) { if (row.status === 'ON_LEAVE') approvedLeaveDates.add(row.date); result.excused += 1; }
  }
  result.leave = approvedLeaveDates.size;
  result.leave = Math.min(result.leave, result.eligibleDays);
  result.percentage = result.present + result.absent ? Math.round(result.present / (result.present + result.absent) * 10000) / 100 : 0;
  return result;
}
function metricName(prefix, metric) { return `${prefix}${metric[0].toUpperCase()}${metric.slice(1)}`; }

export function createStaffAttendanceOverviewService({ database = null, attendanceRepository = null, attendance = null, staffProvider = null, leaveProvider = null, calendarProvider = null, schoolId = 'school-osaah-daylight', now = () => new Date().toISOString() } = {}) {
  const query = async (sql, params = []) => database?.query ? rows(await database.query(sql, params)) : [];
  async function loadStaff() {
    if (staffProvider) return rows(await staffProvider(schoolId)).map((row) => normalizeStaff(row, schoolId));
    if (database?.query) {
      let result = await query(`SELECT sp.id,sp.staff_id AS staffId,sp.full_name AS fullName,sp.phone,sp.role_key AS roleKey,sp.appointment_date AS appointmentDate,sp.departure_date AS departureDate,sp.school_id AS schoolId FROM staff_profiles sp WHERE sp.school_id=? ORDER BY sp.full_name,sp.id`, [schoolId]);
      if (!result.length) result = await query(`SELECT s.id,s.staff_number AS employeeId,TRIM(CONCAT_WS(' ',s.first_name,s.last_name)) AS fullName,u.phone,r.role_key AS roleKey,s.school_id AS schoolId FROM staff s LEFT JOIN users u ON u.id=s.user_id LEFT JOIN user_roles ur ON ur.user_id=s.user_id LEFT JOIN roles r ON r.id=ur.role_id WHERE s.school_id=? ORDER BY fullName,s.id`, [schoolId]);
      return result.map((row) => normalizeStaff(row, schoolId));
    }
    return [];
  }
  async function loadLeaves() {
    if (leaveProvider) return rows(await leaveProvider(schoolId)).map(normalizeLeave);
    return database?.query ? (await query(`SELECT id,staff_id AS staffId,academic_year AS academicYear,term,starts_on AS startsOn,ends_on AS endsOn,state FROM staff_leave WHERE school_id=? AND state='APPROVED'`, [schoolId])).map(normalizeLeave) : [];
  }
  async function loadHolidays(start, end) {
    if (calendarProvider) return new Set(rows(await calendarProvider(schoolId, start, end)).filter((row) => /HOLIDAY|NON.?WORKING/i.test(`${row.category} ${row.eventType} ${row.title}`)).map((row) => row.startDate ?? row.start_date ?? row.date));
    if (!database?.query) return new Set();
    const result = await query(`SELECT start_date AS startDate,end_date AS endDate,category,title FROM academic_calendar_events WHERE school_id=? AND start_date<=? AND end_date>=?`, [schoolId, end, start]);
    const set = new Set(); for (const row of result) if (/HOLIDAY|NON.?WORKING/i.test(`${row.category} ${row.title}`)) for (let day = maxDate(row.startDate, start); day <= minDate(row.endDate ?? row.startDate, end); day = addDays(day, 1)) set.add(day); return set;
  }
  async function defaultRange(filters, records) {
    if (filters.startDate || filters.endDate) { if (!filters.startDate || !filters.endDate) throw new Error('Custom Date Range requires startDate and endDate'); return { start: isoDate(filters.startDate, 'startDate'), end: isoDate(filters.endDate, 'endDate') }; }
    if (filters.week) return rangeForWeek(filters.week);
    if (filters.month) return rangeForMonth(filters.month);
    if (filters.academicYear && database?.query) { const year = (await query('SELECT starts_on AS startsOn,ends_on AS endsOn FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, filters.academicYear, filters.academicYear]))[0]; if (year?.startsOn && year?.endsOn) return { start: year.startsOn, end: year.endsOn }; }
    const dates = effectiveRecords(records).map((row) => row.date).sort(); const end = isoDate(filters.asOfDate ?? text(now()).slice(0, 10), 'asOfDate'); return { start: dates[0] ?? end, end };
  }
  async function overview(filters = {}, actor = null) {
    if (actor && actor.schoolId && actor.schoolId !== schoolId) throw Object.assign(new Error('Forbidden.'), { status: 403 });
    if (filters.status && !STAFF_ATTENDANCE_STATUSES.includes(text(filters.status).toUpperCase())) throw new Error('Invalid attendance status filter');
    if (filters.role && !text(filters.role)) throw new Error('Invalid staff role filter');
    const [staffRows, leaveRows, allRecords] = await Promise.all([loadStaff(), loadLeaves(), attendanceRepository ? attendanceRepository.listStaffRecords({ schoolId }) : attendance?.listStaffRecords?.() ?? []]);
    const records = effectiveRecords(allRecords).filter((row) => row.schoolId === schoolId);
    const base = await defaultRange(filters, records); if (base.start > base.end) throw new Error('Date range is invalid');
    const holidays = await loadHolidays(base.start, base.end);
    const selected = staffRows.filter((member) => !member.isTestRecord && (!filters.role || text(member.role).toUpperCase() === text(filters.role).toUpperCase()));
    const asOf = base.end; const week = rangeForWeek(filters.week ?? `${dateValue(asOf).getUTCFullYear()}-W${String(getIsoWeek(asOf)).padStart(2, '0')}`); const month = rangeForMonth(filters.month ?? asOf.slice(0, 7));
    const rowsOut = selected.map((member) => {
      const metrics = { base: summarize(records, leaveRows, member, base.start, base.end, holidays), week: summarize(records, leaveRows, member, maxDate(base.start, week.start), minDate(base.end, week.end), holidays), month: summarize(records, leaveRows, member, maxDate(base.start, month.start), minDate(base.end, month.end), holidays) };
      if (filters.status && !records.some((row) => row.staffId === member.id && row.status === text(filters.status).toUpperCase() && inRange(row.date, base.start, base.end))) return null;
      const item = { staffId: member.id, staffName: member.name || member.id, registeredPhoneNumber: member.phone, staffRole: member.role, totalPresentInWeek: metrics.week.present, totalPresentInMonth: metrics.month.present, totalAbsentInWeek: metrics.week.absent, totalAbsentInMonth: metrics.month.absent, totalPresentInTerm: metrics.base.present, totalAbsentInTerm: metrics.base.absent, totalPresentInAcademicYear: metrics.base.present, totalAbsentInAcademicYear: metrics.base.absent, approvedLeave: metrics.base.leave, attendancePercentage: metrics.base.percentage, eligibleDays: metrics.base.eligibleDays, missingDays: Math.max(0, metrics.base.eligibleDays - metrics.base.marked - metrics.base.leave) };
      return item;
    }).filter(Boolean);
    const summary = rowsOut.reduce((acc, row) => { acc.present += row.totalPresentInTerm; acc.absent += row.totalAbsentInTerm; acc.leave += row.approvedLeave; return acc; }, { present: 0, absent: 0, leave: 0 });
    return { filters: { ...filters, startDate: base.start, endDate: base.end }, staff: rowsOut, summary: { ...summary, attendancePercentage: summary.present + summary.absent ? Math.round(summary.present / (summary.present + summary.absent) * 10000) / 100 : 0 }, source: 'TiDB/staff_attendance', authoritative: true, studentAggregation: 'UNAVAILABLE_PENDING_PART_3' };
  }
  return { overview };
}
function getIsoWeek(value) { const date = dateValue(value); const day = date.getUTCDay() || 7; date.setUTCDate(date.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1)); return Math.ceil((((date - yearStart) / DAY) + 1) / 7); }
export default createStaffAttendanceOverviewService;
