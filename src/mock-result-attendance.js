const PRESENT_STATUSES = new Set(['PRESENT', 'LATE', 'EARLY_DEPARTURE']);
const ABSENT_STATUSES = new Set(['ABSENT', 'UNEXCUSED_ABSENCE', 'EXCUSED_ABSENCE', 'SICK_ABSENCE']);

function latestRecord(left, right) {
  const versionDifference = Number(right.version ?? 0) - Number(left.version ?? 0);
  if (versionDifference) return versionDifference > 0 ? right : left;
  const timeDifference = Date.parse(right.updatedAt ?? right.recordedAt ?? right.enteredAt ?? '') - Date.parse(left.updatedAt ?? left.recordedAt ?? left.enteredAt ?? '');
  if (Number.isFinite(timeDifference) && timeDifference) return timeDifference > 0 ? right : left;
  return String(right.id ?? '') > String(left.id ?? '') ? right : left;
}

export function summarizeMockAttendance(records = [], identity = {}) {
  const permanentStudentId = String(identity.permanentStudentId ?? '').trim();
  if (!permanentStudentId) throw Object.assign(new Error('The permanent student index is required to summarize attendance.'), { code: 'ATTENDANCE_PERMANENT_ID_REQUIRED' });
  const classes = new Set([identity.classId, identity.className].filter((value) => value != null).map(String));
  const years = new Set([identity.academicYearId, identity.academicYear].filter((value) => value != null).map(String));
  const terms = new Set([identity.termId, identity.term].filter((value) => value != null).map(String));
  const byDate = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    if (identity.schoolId && String(record.schoolId ?? '') !== String(identity.schoolId)) continue;
    if (String(record.permanentStudentId ?? '').trim() !== permanentStudentId) continue;
    if (classes.size && !classes.has(String(record.classId ?? ''))) continue;
    if (years.size && !years.has(String(record.academicYearId ?? record.academicYear ?? ''))) continue;
    if (terms.size && !terms.has(String(record.termId ?? record.term ?? ''))) continue;
    const date = String(record.date ?? record.attendanceDate ?? '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const status = String(record.status ?? '').toUpperCase();
    if (!PRESENT_STATUSES.has(status) && !ABSENT_STATUSES.has(status)) continue;
    byDate.set(date, byDate.has(date) ? latestRecord(byDate.get(date), record) : record);
  }
  let timesPresent = 0;
  let timesAbsent = 0;
  for (const record of byDate.values()) {
    const status = String(record.status ?? '').toUpperCase();
    if (PRESENT_STATUSES.has(status)) timesPresent += 1;
    else if (ABSENT_STATUSES.has(status)) timesAbsent += 1;
  }
  return { timesPresent, timesAbsent, totalSchoolDays: timesPresent + timesAbsent };
}
