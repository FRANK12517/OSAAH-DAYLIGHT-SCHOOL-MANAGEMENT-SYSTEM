const TERM_DEFINITIONS = Object.freeze([
  Object.freeze({ label: '1st Term', aliases: ['1st term', 'first term', 'term 1', 't1'], fallback: 'First Term' }),
  Object.freeze({ label: '2nd Term', aliases: ['2nd term', 'second term', 'term 2', 't2'], fallback: 'Second Term' }),
  Object.freeze({ label: '3rd Term', aliases: ['3rd term', 'third term', 'term 3', 't3'], fallback: 'Third Term' })
]);

function normalized(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function buildTermOptions(items = []) {
  const sourceItems = Array.isArray(items) ? items : [];
  return TERM_DEFINITIONS.map((definition) => {
    const match = sourceItems.find((item) => definition.aliases.includes(normalized(item?.name ?? item?.id)));
    return { label: definition.label, value: String(match?.name ?? match?.id ?? definition.fallback) };
  });
}

export const ATTENDANCE_TERM_LABELS = Object.freeze(TERM_DEFINITIONS.map(({ label }) => label));
