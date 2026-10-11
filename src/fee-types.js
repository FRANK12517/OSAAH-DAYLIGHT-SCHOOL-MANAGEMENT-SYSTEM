import { randomUUID } from 'node:crypto';

export const CANONICAL_FEE_TYPES = Object.freeze([
  ['TUITION', 'School Fees / Tuition Fees'], ['ADMISSION', 'Admission Fee'], ['APPLICATION', 'Application / Admission Form Fee'],
  ['REGISTRATION', 'Registration / Enrolment Fee'], ['EXAMINATION', 'Examination Fee'], ['MOCK_EXAMINATION', 'Mock Examination Fee'],
  ['BECE_REGISTRATION', 'BECE Registration Fee'], ['PTA', 'PTA Levy / PTA Dues'], ['DEVELOPMENT', 'Development Levy'], ['MAINTENANCE', 'Maintenance Fee'],
  ['UTILITIES', 'Utilities Fee'], ['ICT', 'ICT / Computer Lab Fee'], ['SCIENCE_PRACTICAL', 'Science / Practical Fee'], ['TEXTBOOKS', 'Textbooks Fee'],
  ['EXERCISE_BOOKS', 'Exercise Books Fee'], ['STATIONERY', 'Stationery / Learning Materials Fee'], ['FEEDING', 'Feeding Fee'], ['CANTEEN', 'Canteen'],
  ['TRANSPORT', 'Transport / School Bus Fee'], ['EXTRA_CLASSES', 'Extra Classes'], ['VACATION_CLASSES', 'Vacation Classes'], ['SATURDAY_CLASSES', 'Saturday Classes'],
  ['HOSTEL', 'Boarding / Hostel Fee'], ['UNIFORM', 'Uniform Fee'], ['PE_SPORTSWEAR', 'PE / Sportswear Fee'], ['SPORTS', 'Sports Fee'],
  ['EXTRACURRICULAR', 'Extracurricular Activities Fee'], ['CLUBS', 'Clubs Fee'], ['FIELD_TRIP', 'Field Trip / Excursion Fee'], ['EDUCATIONAL_TRIP', 'Educational Trip Fee'],
  ['GRADUATION', 'Graduation Fee'], ['ID_CARD', 'ID Card Fee'], ['REPORT_MATERIALS', 'Report / Assessment Materials Fee'], ['LEARNING_SUPPORT', 'Learning Support Fee'],
  ['SPECIAL_PROGRAMME', 'Special Programme Fee'], ['SCHOOL_EVENT', 'School Events Fee'], ['DAMAGES', 'Damages / Replacement Fee'], ['ARREARS', 'Arrears / Outstanding Balance'],
  ['OTHER', 'Other']
].map(([code, name]) => Object.freeze({ code, name, category: code === 'OTHER' ? 'OTHER' : 'FEE', isSystem: true })));

const aliases = new Map([
  ['SCHOOL_FEE', 'TUITION'], ['SCHOOL_FEES', 'TUITION'], ['TUITION_FEE', 'TUITION'],
  ['EXAMINATION_FEE', 'EXAMINATION'], ['EXAMINATION_FEES', 'EXAMINATION'],
  ['SPORTS_FEES', 'SPORTS'], ['CANTEEN_FEEDING_FEES', 'FEEDING'],
  ['EXTRA_CLASS', 'EXTRA_CLASSES'], ['EXTRA_CLASSES_FEES', 'EXTRA_CLASSES'],
  ['TRANSPORT_FEE', 'TRANSPORT'], ['BUS_TRANSPORT_FEES', 'TRANSPORT'], ['SCHOOL_BUS', 'TRANSPORT'],
  ['HOSTEL_BOARDING_FEES', 'HOSTEL'], ['ADMISSION_FEES', 'ADMISSION'],
  ['REGISTRATION_FEES', 'REGISTRATION'], ['PTA_DUES', 'PTA'],
  ['DEVELOPMENT_LEVY', 'DEVELOPMENT'], ['ICT_COMPUTER_LABORATORY_FEES', 'ICT'],
  ['SCIENCE_LABORATORY_FEES', 'SCIENCE_PRACTICAL'], ['UNIFORM_FEES', 'UNIFORM'],
  ['ACTIVITY_EXTRACURRICULAR_FEES', 'EXTRACURRICULAR'],
  ['EDUCATIONAL_TRIP_EXCURSION_FEES', 'EDUCATIONAL_TRIP'], ['GRADUATION_FEES', 'GRADUATION'],
  ['MAINTENANCE_FEES', 'MAINTENANCE'], ['UTILITIES_FEES', 'UTILITIES'], ['ID_CARD_FEES', 'ID_CARD'],
  ['MOCK_EXAMINATION_FEES', 'MOCK_EXAMINATION'], ['STATIONERY_FEES', 'STATIONERY']
]);
const slug = (value) => String(value ?? '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

export function normalizeFeeType(input = {}) {
  const raw = slug(input.code ?? input.feeType ?? input.collectionType ?? input.name);
  const code = aliases.get(raw) ?? raw;
  if (code === 'OTHER') {
    const customName = String(input.customName ?? input.displayName ?? (input.name !== 'Other' ? input.name : '') ?? '').trim();
    if (!customName) throw Object.assign(new Error('Custom fee type name is required for Other.'), { code: 'CUSTOM_FEE_TYPE_REQUIRED' });
    return { id: input.id ?? `OTHER_${slug(customName)}`, code: 'OTHER', name: customName, displayName: customName, category: 'OTHER', customName, isSystem: false };
  }
  const known = CANONICAL_FEE_TYPES.find((type) => type.code === code);
  if (known) return { ...known, id: input.id ?? code, displayName: known.name, customName: null };
  if (String(input.category ?? '').toUpperCase() === 'OTHER') {
    const customName = String(input.customName ?? input.displayName ?? input.name ?? '').trim();
    if (!customName) throw Object.assign(new Error('Custom fee type name is required for Other.'), { code: 'CUSTOM_FEE_TYPE_REQUIRED' });
    return { id: input.id ?? `OTHER_${slug(customName)}`, code: 'OTHER', name: customName, displayName: customName, category: 'OTHER', customName, isSystem: false };
  }
  if (!code) throw Object.assign(new Error('Fee type is required.'), { code: 'FEE_TYPE_REQUIRED' });
  return { id: input.id ?? code, code, name: String(input.name ?? input.displayName ?? code).trim(), displayName: String(input.name ?? input.displayName ?? code).trim(), category: input.category ?? 'CUSTOM', customName: null, isSystem: false };
}

export function createFeeTypeRegistry({ schoolId = 'school-osaah-daylight', now = () => new Date().toISOString() } = {}) {
  const types = new Map(CANONICAL_FEE_TYPES.map((type) => [`${schoolId}:${type.code}`, { ...type, id: type.code, schoolId, createdAt: now(), updatedAt: now() }]));
  function list({ includeInactive = false } = {}) { return [...types.values()].filter((type) => includeInactive || type.isActive !== false).map((type) => ({ ...type })); }
  function register(input, actor = {}) { if (actor.schoolId && actor.schoolId !== schoolId) throw Object.assign(new Error('Forbidden.'), { status: 403 }); const type = normalizeFeeType(input); const key = `${schoolId}:${type.code}:${type.customName ?? ''}`; const row = { ...type, id: type.id ?? randomUUID(), schoolId, isActive: true, createdBy: actor.id ?? null, createdAt: now(), updatedAt: now() }; types.set(key, row); return { ...row }; }
  function resolve(input) { return normalizeFeeType(input); }
  return { list, register, resolve, canonical: () => CANONICAL_FEE_TYPES.map((type) => ({ ...type })) };
}
