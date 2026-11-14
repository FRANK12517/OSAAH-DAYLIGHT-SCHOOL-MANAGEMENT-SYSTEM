/** Normalize supported Ghanaian phone formats to E.164; return null when invalid. */
export function normalizeGhanaPhone(value) {
  const raw = String(value ?? '').trim().replace(/[\s().-]/g, '');
  if (!raw) return null;
  const national = raw.startsWith('+') ? raw.slice(1) : raw;
  const local = national.startsWith('233') ? national.slice(3) : national.startsWith('0') ? national.slice(1) : '';
  // Ghana mobile numbers use 20–28 and 50–59 NDCs; 29 is reserved.
  if (/^\d{9}$/.test(local) && /^(2[0-8]|5\d)/.test(local)) return `+233${local}`;
  return null;
}

export function isValidGhanaPhone(value) { return Boolean(normalizeGhanaPhone(value)); }

export function ghanaPhoneLookupValues(value) {
  const normalized = normalizeGhanaPhone(value);
  return normalized ? [normalized.slice(1), `0${normalized.slice(4)}`, normalized] : [];
}
