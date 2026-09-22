import { randomUUID } from 'node:crypto';

export const STUDENT_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'EARLY_DEPARTURE', 'EXCUSED_ABSENCE', 'UNEXCUSED_ABSENCE', 'SICK_ABSENCE'];
export const ATTENDANCE_METHODS = ['MANUAL', 'STUDENT_ID', 'QR_CODE', 'BIOMETRIC'];
export const ACADEMIC_YEAR_OPTIONS = ['2024/2025', '2025/2026', '2026/2027', '2027/2028', '2028/2029', '2029/2030', '2030/2031'];
export const TERM_OPTIONS = ['1st Term', '2nd Term', '3rd Term'];

function required(value, label) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}

export function createAttendanceService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight', notify = () => {} } = {}) {
  const studentRecords = new Map(); const staffRecords = new Map(); const notificationSettings = new Map(); const listeners = new Set(); let revision = 0;
  function scope(entry) { return { academicYear: String(entry.academicYear ?? 'UNSPECIFIED').trim() || 'UNSPECIFIED', term: String(entry.term ?? 'UNSPECIFIED').trim() || 'UNSPECIFIED' }; }
  function key(entry) { const { academicYear, term } = scope(entry); return `${schoolId}:${academicYear}:${term}:${entry.date}:${entry.classId ?? ''}:${entry.studentId}:${entry.subjectId ?? 'daily'}`; }
  function saveStudentAttendance(entry, actor, { correction = false, expectedVersion = null } = {}) {
    if (!STUDENT_STATUSES.includes(entry.status)) throw new Error('Invalid attendance status');
    if (!ATTENDANCE_METHODS.includes(entry.method ?? 'MANUAL')) throw new Error('Invalid attendance method');
    const { academicYear, term } = scope(entry); const recordKey = key({ ...entry, academicYear, term }); const current = studentRecords.get(recordKey);
    if (current && !correction) throw new Error('Attendance already recorded');
    if (current && expectedVersion !== null && current.version !== expectedVersion) throw new Error('Attendance conflict: server record is newer');
    const record = { id: current?.id ?? randomUUID(), schoolId, provenance: entry.isTestRecord ? 'TEST' : 'PRODUCTION', isTestRecord: Boolean(entry.isTestRecord), academicYear, term, date: required(entry.date, 'Attendance Date'), classId: entry.classId ?? null, studentId: required(entry.studentId, 'Student'), subjectId: entry.subjectId ?? null, status: entry.status, method: entry.method ?? 'MANUAL', arrivalTime: entry.arrivalTime ?? null, departureTime: entry.departureTime ?? null, reason: entry.reason ?? null, version: (current?.version ?? 0) + 1, enteredBy: actor.userId, enteredAt: current?.enteredAt ?? now(), updatedAt: now() };
    studentRecords.set(recordKey, record); if (record.status === 'ABSENT' || record.status === 'LATE') notify({ type: record.status, studentId: record.studentId, date: record.date });
    revision += 1; for (const listener of listeners) listener({ type: 'STUDENT_ATTENDANCE_CHANGED', revision, recordId: record.id }); return { ...record };
  }
  function saveBatch(entries, actor, options = {}) { return entries.map((entry) => saveStudentAttendance(entry, actor, options)); }
  function saveStaffAttendance(entry, actor) {
    const { academicYear, term } = scope(entry); const type = required(entry.type, 'Attendance status');
    if (!['CHECK_IN', 'CHECK_OUT', 'LATE', 'ABSENT'].includes(type)) throw new Error('Invalid staff attendance type');
    const record = { id: randomUUID(), schoolId, provenance: 'PRODUCTION', academicYear, term, staffId: required(entry.staffId, 'Staff member'), date: required(entry.date, 'Attendance Date'), type, time: entry.time ?? now(), enteredBy: actor.userId, createdAt: now() };
    const recordKey = `${schoolId}:${academicYear}:${term}:${record.date}:${record.staffId}:${record.type}`; if (staffRecords.has(recordKey)) throw new Error('Staff attendance already recorded');
    staffRecords.set(recordKey, record); revision += 1; for (const listener of listeners) listener({ type: 'STAFF_ATTENDANCE_CHANGED', revision, recordId: record.id }); return { ...record };
  }
  function summary({ academicYear, term, date, classId, subjectId, studentIds } = {}) {
    const rows = [...studentRecords.values()].filter((record) => record.schoolId === schoolId && (!academicYear || record.academicYear === academicYear) && (!term || record.term === term) && (!date || record.date === date) && (!classId || record.classId === classId) && (!subjectId || record.subjectId === subjectId) && (!studentIds || studentIds.includes(record.studentId)));
    const counts = Object.fromEntries(STUDENT_STATUSES.map((status) => [status, rows.filter((row) => row.status === status).length])); const presentLike = counts.PRESENT + counts.LATE;
    return { academicYear, term, date, total: rows.length, counts, attendancePercentage: rows.length ? Math.round((presentLike / rows.length) * 10000) / 100 : 0, records: rows.map((row) => ({ ...row })) };
  }
  function setNotificationSettings(userId, settings) { notificationSettings.set(userId, { absence: Boolean(settings.absence), lateness: Boolean(settings.lateness) }); return { ...notificationSettings.get(userId) }; }
  function getRecord(entry) { const record = studentRecords.get(key(entry)); return record ? { ...record } : null; }
  return { saveStudentAttendance, saveBatch, saveStaffAttendance, summary, setNotificationSettings, getRecord, listStudentRecords: () => [...studentRecords.values()].map((record) => ({ ...record })), listStaffRecords: () => [...staffRecords.values()].map((record) => ({ ...record })), subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }, revision: () => revision, counts: () => ({ student: studentRecords.size, staff: staffRecords.size }) };
}

export default createAttendanceService;
