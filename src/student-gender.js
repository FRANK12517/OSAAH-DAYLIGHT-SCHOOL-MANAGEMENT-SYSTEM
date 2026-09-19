const NORMALIZED = Object.freeze({
  M: 'Male',
  MALE: 'Male',
  F: 'Female',
  FEMALE: 'Female',
  'NOT RECORDED': null,
  UNKNOWN: null,
  UNSPECIFIED: null,
  '': null,
});

export const STUDENT_GENDERS = Object.freeze(['Male', 'Female']);

export function normalizeStudentGender(value) {
  if (value === null || value === undefined) return null;
  const key = String(value).trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(NORMALIZED, key) ? NORMALIZED[key] : null;
}

export function requireStudentGender(value) {
  const normalized = normalizeStudentGender(value);
  if (!normalized) throw new Error('Gender is required and must be Male or Female.');
  return normalized;
}

export function displayStudentGender(value) {
  return normalizeStudentGender(value) ?? 'Not Recorded';
}
