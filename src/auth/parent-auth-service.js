import { ghanaPhoneLookupValues, normalizeGhanaPhone } from '../utils/normalize-phone.js';

/**
 * LOCKED CORE AUTHENTICATION MODULE.
 * Parent Portal sign-in is phone-only and must remain isolated from school
 * account credential handling. A caller must supply already school-scoped,
 * active-parent, active-student-link query rows.
 */
export function resolveParentPhoneLoginRows(rows, submittedPhone) {
  const normalizedPhone = normalizeGhanaPhone(submittedPhone);
  if (!normalizedPhone || !Array.isArray(rows)) return null;
  const matchingRows = rows.filter((row) => row && typeof row === 'object'
    && normalizeGhanaPhone(row.parentPhone) === normalizedPhone);
  if (matchingRows.length !== 1 || Number(matchingRows[0].phoneMatchCount) !== 1) return null;
  const row = matchingRows[0];
  if (row.id == null || row.schoolId == null || String(row.status ?? 'ACTIVE').toUpperCase() !== 'ACTIVE') return null;
  return { ...row, parentPhone: normalizedPhone };
}

export { ghanaPhoneLookupValues, normalizeGhanaPhone };
