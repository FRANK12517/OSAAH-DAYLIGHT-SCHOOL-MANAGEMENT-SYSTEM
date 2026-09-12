export const PERMANENT_STUDENT_ID_PATTERN = /^OSAAH\/(\d{4})\/(\d{4,})$/;

export function isPermanentStudentId(value) {
  return PERMANENT_STUDENT_ID_PATTERN.test(String(value ?? '').trim());
}

export function admissionYearFor(input, fallback = new Date().getFullYear()) {
  const value = String(input ?? '').trim();
  const match = value.match(/^(\d{4})/);
  if (!match) throw new Error('A verifiable four-digit admission year is required.');
  return Number(match[1]);
}

/**
 * In-process counterpart of the database yearly allocator. Production adapters
 * must execute allocation inside a transaction and lock the yearly row.
 */
export function createPermanentStudentIdAllocator({ sequences = new Map(), issued = new Set(), clock = () => new Date() } = {}) {
  function reserve(yearInput) {
    const year = admissionYearFor(yearInput, clock().getFullYear());
    let next = sequences.get(year) ?? 0;
    do { next += 1; } while (issued.has(`OSAAH/${year}/${String(next).padStart(4, '0')}`));
    if (next > 9999) throw new Error('Annual permanent Student ID capacity exceeded.');
    const permanentStudentId = `OSAAH/${year}/${String(next).padStart(4, '0')}`;
    sequences.set(year, next);
    issued.add(permanentStudentId);
    return permanentStudentId;
  }
  function register(value) {
    const id = String(value ?? '').trim();
    const match = PERMANENT_STUDENT_ID_PATTERN.exec(id);
    if (!match) throw new Error('Permanent Student ID is malformed.');
    if (issued.has(id)) throw new Error('Permanent Student ID already exists.');
    issued.add(id);
    const year = Number(match[1]), sequence = Number(match[2]);
    sequences.set(year, Math.max(sequences.get(year) ?? 0, sequence));
    return id;
  }
  return Object.freeze({ reserve, register, issued: () => new Set(issued), sequences: () => new Map(sequences) });
}

export function reconcilePermanentStudentIds(students, { allocate, admissionYear } = {}) {
  if (typeof allocate !== 'function' || typeof admissionYear !== 'function') throw new Error('Backfill requires server-owned allocation and admission-year resolution.');
  const report = { totalStudents: students.length, validExisting: 0, missing: 0, duplicates: 0, malformed: 0, uncertainAdmissionYear: 0, assigned: 0, ambiguities: [] };
  const seen = new Set();
  for (const student of students) {
    const id = String(student.permanentStudentId ?? '').trim();
    if (id && isPermanentStudentId(id) && !seen.has(id)) { seen.add(id); report.validExisting += 1; continue; }
    if (id && seen.has(id)) { report.duplicates += 1; report.ambiguities.push({ studentId: student.id, reason: 'DUPLICATE_PERMANENT_STUDENT_ID' }); continue; }
    if (id) { report.malformed += 1; report.ambiguities.push({ studentId: student.id, reason: 'MALFORMED_PERMANENT_STUDENT_ID' }); continue; }
    report.missing += 1;
    const year = admissionYear(student);
    if (!year) { report.uncertainAdmissionYear += 1; report.ambiguities.push({ studentId: student.id, reason: 'UNCERTAIN_ADMISSION_YEAR' }); continue; }
    student.permanentStudentId = allocate(year); seen.add(student.permanentStudentId); report.assigned += 1;
  }
  return Object.freeze(report);
}
