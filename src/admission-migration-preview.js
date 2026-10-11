import { isPermanentStudentId } from './permanent-student-id.js';

function normalized(value) { return String(value ?? '').trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
function verifiedYear(record) {
  const date = String(record.admissionDate ?? '').trim();
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(date);
  if (!match || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) return null;
  return Number(match[1]);
}

/**
 * Read-only plan builder. It only inspects the supplied canonical student snapshot
 * and returns references/reasons; it never edits records or reserves identifiers.
 */
export function previewExistingStudentMigration(records = []) {
  if (!Array.isArray(records)) throw new TypeError('Student records must be an array.');
  const idOwners = new Map();
  const identityOwners = new Map();
  for (const record of records) {
    const permanentId = String(record.permanentStudentId ?? '').trim();
    if (permanentId) idOwners.set(permanentId, [...(idOwners.get(permanentId) ?? []), record]);
    const dateOfBirth = String(record.dateOfBirth ?? '').trim();
    const identity = [normalized(record.firstName), normalized(record.surname), dateOfBirth].join('|');
    if (dateOfBirth && normalized(record.firstName) && normalized(record.surname)) identityOwners.set(identity, [...(identityOwners.get(identity) ?? []), record]);
  }

  const rows = records.map((record, index) => {
    const ref = String(record.id ?? record.admissionNumber ?? `row-${index + 1}`);
    const existingId = String(record.permanentStudentId ?? '').trim();
    const reasons = [];
    if (!record.id && !record.admissionNumber) reasons.push('MISSING_STABLE_RECORD_REFERENCE');
    if (existingId && !isPermanentStudentId(existingId)) reasons.push('MALFORMED_PERMANENT_STUDENT_ID');
    if (existingId && idOwners.get(existingId)?.length > 1) reasons.push('DUPLICATE_PERMANENT_STUDENT_ID');
    const dob = String(record.dateOfBirth ?? '').trim();
    const identity = [normalized(record.firstName), normalized(record.surname), dob].join('|');
    if (identityOwners.get(identity)?.length > 1) reasons.push('POSSIBLE_DUPLICATE_IDENTITY');
    const year = verifiedYear(record);
    if ((!existingId || !isPermanentStudentId(existingId)) && !year) reasons.push('UNVERIFIED_ADMISSION_YEAR');
    if (!normalized(record.firstName) || !normalized(record.surname)) reasons.push('INCOMPLETE_STUDENT_IDENTITY');
    const needsReview = reasons.length > 0;
    const action = needsReview ? 'MANUAL_REVIEW' : existingId ? 'PRESERVE_EXISTING_ID' : 'ASSIGN_ID_FOR_VERIFIED_YEAR';
    return { studentRef: ref, action, admissionYear: year, reasons };
  });
  const counts = {
    total: rows.length,
    eligible: rows.filter((row) => row.action === 'ASSIGN_ID_FOR_VERIFIED_YEAR').length,
    alreadyHasId: rows.filter((row) => row.action === 'PRESERVE_EXISTING_ID').length,
    manualReview: rows.filter((row) => row.action === 'MANUAL_REVIEW').length,
    skipped: rows.filter((row) => row.action === 'MANUAL_REVIEW').length
  };
  return Object.freeze({ dryRun: true, writesPerformed: 0, counts, records: rows });
}
