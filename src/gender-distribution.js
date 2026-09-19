import { normalizeStudentGender } from './student-gender.js';

/**
 * Derive active class gender counts from the canonical student/enrollment source.
 * This intentionally does not count score rows and never classifies legacy gaps.
 */
export function classGenderDistribution({ students, schoolId = 'school-osaah-daylight', classId, academicYear = '', term = '', includeTestRecords = false } = {}) {
  const selectedClass = String(classId ?? '').trim();
  const selectedYear = String(academicYear ?? '').trim();
  const selectedTerm = String(term ?? '').trim();
  const source = students?.listStudents?.({ requestedSchoolId: schoolId, includeTestRecords }) ?? [];
  const active = new Map();
  for (const student of source) {
    if (student.classId !== selectedClass || student.status === 'COMPLETED') continue;
    const history = Array.isArray(student.history)
      ? student.history.filter((entry) => entry.classId === selectedClass && entry.academicYearId != null && entry.termId != null)
      : [];
    const scoped = history.length === 0 || history.some((entry) => String(entry.academicYearId) === selectedYear && String(entry.termId) === selectedTerm);
    if (scoped) active.set(student.id, student);
  }
  let totalBoys = 0;
  let totalGirls = 0;
  for (const student of active.values()) {
    const gender = normalizeStudentGender(student.gender);
    if (gender === 'Male') totalBoys += 1;
    if (gender === 'Female') totalGirls += 1;
  }
  return { totalBoys, totalGirls, totalStudents: active.size };
}
