/** Normalize supported Ghanaian phone formats to E.164; return null when invalid. */
export function normalizeGhanaPhone(value) {
  const raw = String(value ?? '').replace(/[\s()-]/g, '');
  if (!raw) return null;
  if (/^0\d{9}$/.test(raw)) return `+233${raw.slice(1)}`;
  if (/^233\d{9}$/.test(raw)) return `+${raw}`;
  if (/^\+233\d{9}$/.test(raw)) return raw;
  return null;
}

export function isValidGhanaPhone(value) { return Boolean(normalizeGhanaPhone(value)); }

export function ghanaPhoneLookupValues(value) {
  const normalized = normalizeGhanaPhone(value);
  return normalized ? [normalized.slice(1), `0${normalized.slice(4)}`, normalized] : [];
}
