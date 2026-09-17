const VALID_STATUSES = new Set(['VALID', 'SUBMITTED', 'PUBLISHED', 'APPROVED']);

export function ordinalPosition(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return '—';
  const mod100 = n % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${suffix}`;
}

export function validSubjectRows(subjects = []) {
  return subjects.filter((row) => {
    const total = Number(row.totalScore ?? row.total ?? NaN);
    const subject = String(row.subjectId ?? row.subject ?? '').trim();
    return subject && Number.isFinite(total) && total >= 0 && !row.placeholder && !row.demo && row.submitted !== false;
  });
}

export function averageScore(subjects = [], precision = 2) {
  const rows = validSubjectRows(subjects);
  if (!rows.length) return null;
  const value = rows.reduce((sum, row) => sum + Number(row.totalScore ?? row.total), 0) / rows.length;
  return Number(value.toFixed(precision));
}

export function subjectPositions(rows = [], cohortRows = []) {
  const valid = validSubjectRows(rows);
  const cohort = cohortRows.length ? cohortRows : rows;
  const grouped = new Map();
  for (const row of valid) {
    const subject = String(row.subjectId ?? row.subject).trim();
    if (!grouped.has(subject)) grouped.set(subject, []);
    grouped.get(subject).push(Number(row.totalScore ?? row.total));
  }
  for (const row of validSubjectRows(cohort)) {
    const subject = String(row.subjectId ?? row.subject).trim();
    if (!grouped.has(subject)) grouped.set(subject, []);
    grouped.get(subject).push(Number(row.totalScore ?? row.total));
  }
  const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => b - a);
  return valid.map((row) => {
    const subject = String(row.subjectId ?? row.subject).trim();
    const score = Number(row.totalScore ?? row.total);
    const rank = uniqueSorted(grouped.get(subject) || []).indexOf(score) + 1;
    return { ...row, subjectPosition: ordinalPosition(rank) };
  });
}

export function assessmentStorageKey({ schoolId = '', studentId = '', academicYear = '', term = '', classId = '', examinationType = '' } = {}) {
  return ['osaah-assessment', schoolId, studentId, academicYear, term, classId, examinationType].map(String).join(':');
}

export function assessmentValues(input = {}) {
  return ['conduct', 'attitude', 'interest', 'classTeacherRemarks', 'headteacherRemarks'].reduce((out, key) => {
    if (typeof input[key] === 'string') out[key] = input[key].trim();
    return out;
  }, {});
}

export const assessmentLibraryStatus = Object.freeze({
  source: 'EduTrack active result-slip module could not be proven to expose the requested 30/30 libraries',
  positiveCount: 0,
  negativeCount: 0,
  authoritative: false
});

export function renderStaticAssessment(value) {
  return String(value ?? '').trim() || 'Not recorded';
}

export function isPublishedResult(result = {}) {
  return VALID_STATUSES.has(String(result.publicationStatus ?? result.status ?? '').toUpperCase());
}

export function termAttendance(records = [], term) {
  const filtered = records.filter((record) => !term || record.term === term || record.termId === term);
  const present = filtered.filter((record) => ['PRESENT', 'LATE', 'EXCUSED'].includes(String(record.status).toUpperCase())).length;
  const absent = filtered.filter((record) => String(record.status).toUpperCase() === 'ABSENT').length;
  return { timesPresent: present, timesAbsent: absent, totalSchoolDays: present + absent };
}

export default { ordinalPosition, validSubjectRows, averageScore, subjectPositions, assessmentStorageKey, assessmentValues, assessmentLibraryStatus, renderStaticAssessment, isPublishedResult, termAttendance };
