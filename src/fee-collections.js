import { randomUUID } from 'node:crypto';

export const NORMAL_COLLECTION_TERMS = ['1st Term', '2nd Term', '3rd Term'];
export const EXTRA_CLASSES_PERIODS = [...NORMAL_COLLECTION_TERMS, 'Vacation Classes'];
export const CANTEEN_PERIODS = [...NORMAL_COLLECTION_TERMS];
const WRITE_ROLES = new Set(['ACCOUNTANT_BURSAR', 'PROPRIETOR', 'SCHOOL_ADMIN']);
const READ_ROLES = new Set([...WRITE_ROLES, 'HEADTEACHER', 'ASSISTANT_HEADTEACHER']);
const minor = (value) => { const n = Number(value); if (!Number.isInteger(n) || n < 0) throw new Error('Amount must be a non-negative integer minor-unit value.'); return n; };
function collectionPeriodFromInput(collectionType, input) { const requested = input.collectionPeriod ?? input.termId; if (requested == null || ['1st Term', '2nd Term', '3rd Term', 'Vacation Classes'].includes(String(requested))) return validateCollectionPeriod(collectionType, requested); if (input.collectionPeriod != null) return validateCollectionPeriod(collectionType, requested); return String(requested); }
export function validateCollectionPeriod(collectionType, value) {
  const type = String(collectionType ?? '').trim().toUpperCase();
  const period = value == null || value === '' ? null : String(value).trim();
  if (!['EXTRA_CLASS', 'CANTEEN'].includes(type)) throw new Error('Invalid collection type.');
  if (period && !(type === 'EXTRA_CLASS' ? EXTRA_CLASSES_PERIODS : CANTEEN_PERIODS).includes(period)) throw new Error(type === 'CANTEEN' ? 'Canteen collections support only 1st Term, 2nd Term, and 3rd Term.' : 'Invalid Extra Classes collection period.');
  return period;
}
export function createFeeCollections({ schoolId = 'school-osaah-daylight', now = () => new Date().toISOString(), audit = () => {} } = {}) {
  const obligations = [], collections = [];
  const can = (actor, roles) => actor?.schoolId === schoolId && (actor.permissions?.has?.('*') || roles.has(actor.roleKey));
  function publishObligations(input, students, actor) { if (!can(actor, WRITE_ROLES)) throw new Error('Financial write permission required.'); const eligible = students.filter(s => s.schoolId === schoolId && s.status !== 'INACTIVE' && s.status !== 'TRANSFERRED_OUT' && (!input.classId || s.classId === input.classId)); const key = s => `${input.feeStructureId}:${s.id}:${input.academicYearId ?? ''}:${input.termId ?? ''}`; let created = 0; for (const student of eligible) if (!obligations.some(o => o.idempotencyKey === key(student))) { const row = { id: randomUUID(), idempotencyKey: key(student), schoolId, feeStructureId: input.feeStructureId, academicYearId: input.academicYearId ?? null, termId: input.termId ?? null, applicabilityType: input.classId ? 'SPECIFIC_CLASS' : 'ALL_STUDENTS', classId: input.classId ?? null, studentId: student.id, amountMinor: minor(input.amountMinor), dueDate: input.dueDate ?? null, status: 'PUBLISHED', publishedBy: actor.id, publishedAt: now(), createdAt: now(), updatedAt: now() }; obligations.push(row); audit({ action: 'FEE_OBLIGATION_CREATED', schoolId, userId: actor.id, entityId: row.id }); created++; } return { created, total: eligible.length, obligations: obligations.filter(o => o.feeStructureId === input.feeStructureId) }; }
  function listObligations(actor, studentId = null) { if (!can(actor, READ_ROLES) && actor?.roleKey !== 'PARENT') throw new Error('Financial read permission required.'); if (actor.roleKey === 'PARENT' && !actor.children?.some(c => c.id === studentId)) throw new Error('Forbidden.'); return obligations.filter(o => o.schoolId === schoolId && (!studentId || o.studentId === studentId)); }
  function recordCollection(input, actor) { if (!can(actor, WRITE_ROLES)) throw new Error('Financial write permission required.'); const collectionType = String(input.collectionType ?? '').toUpperCase(); const collectionPeriod = collectionPeriodFromInput(collectionType, input); const row = { id: randomUUID(), schoolId, collectionType, classId: input.classId ?? null, collectionDate: input.collectionDate, expectedAmountMinor: input.expectedAmountMinor == null ? null : minor(input.expectedAmountMinor), amountReceivedMinor: minor(input.amountReceivedMinor), recordedBy: actor.id, notes: input.notes ?? null, academicYearId: input.academicYearId ?? null, termId: input.termId ?? collectionPeriod, collectionPeriod, createdAt: now(), updatedAt: now() }; collections.push(row); audit({ action: 'COLLECTION_CREATED', schoolId, userId: actor.id, entityId: row.id }); return { ...row }; }
  function listCollections(actor, type = null) { if (!can(actor, READ_ROLES)) throw new Error('Financial read permission required.'); return collections.filter(c => c.schoolId === schoolId && (!type || c.collectionType === type)); }
  function aggregate(actor, type, period = 'DAY') { const rows = listCollections(actor, type); const total = rows.reduce((n, r) => n + r.amountReceivedMinor, 0); const expected = rows.reduce((n, r) => n + (r.expectedAmountMinor ?? 0), 0); return { type, period, totalReceivedMinor: total, expectedAmountMinor: expected, varianceMinor: expected - total, transactionCount: rows.length, rows }; }
  return { publishObligations, listObligations, recordCollection, listCollections, aggregate };
}
