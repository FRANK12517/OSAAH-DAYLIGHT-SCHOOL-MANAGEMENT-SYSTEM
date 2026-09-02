import { randomUUID } from 'node:crypto';
import { CORE_LEVELS } from './students.js';

const DEFAULT_SUBJECTS = ['English Language', 'Mathematics', 'Science', 'Social Studies', 'Religious and Moral Education', 'Computing', 'Creative Arts', 'French'];
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function actorId(actor) { return actor?.id ?? actor?.userId ?? null; }
function canManage(actor) { return ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'].includes(actor?.roleKey) || actor?.permissions?.has?.('subjects.manage') || actor?.permissions?.has?.('*'); }

export function createSubjectService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight', classes = CORE_LEVELS } = {}) {
  const records = new Map();
  let sequence = 0;
  for (const name of DEFAULT_SUBJECTS) { const id = `SUBJ-${String(++sequence).padStart(4, '0')}`; records.set(id, { id, schoolId, code: name.slice(0, 3).toUpperCase(), name, classIds: [...classes], active: true, createdAt: now(), updatedAt: now() }); }
  function assertSchool(actor) { if (!actor || actor.schoolId !== schoolId) throw new Error('Forbidden.'); }
  function list({ classId, includeInactive = false } = {}, actor = {}) { assertSchool(actor); return [...records.values()].filter((item) => item.schoolId === schoolId && (includeInactive || item.active) && (!classId || item.classIds.includes(classId))).map(clone); }
  function get(id, actor = {}) { assertSchool(actor); const record = records.get(id); return record && record.schoolId === schoolId ? clone(record) : null; }
  function create(input, actor) { assertSchool(actor); if (!canManage(actor)) throw new Error('Forbidden.'); if (!String(input?.name ?? '').trim()) throw new Error('Subject name is required.'); if ([...records.values()].some((item) => item.schoolId === schoolId && item.name.toLowerCase() === String(input.name).trim().toLowerCase())) throw new Error('Subject already exists.'); const id = `SUBJ-${String(++sequence).padStart(4, '0')}`; const record = { id, schoolId, code: String(input.code ?? input.name.slice(0, 3)).trim().toUpperCase(), name: String(input.name).trim(), classIds: [...new Set(input.classIds ?? classes)], active: true, createdAt: now(), updatedAt: now(), updatedBy: actorId(actor) }; records.set(id, record); return clone(record); }
  function update(id, input, actor) { assertSchool(actor); if (!canManage(actor)) throw new Error('Forbidden.'); const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Subject not found.'); for (const field of ['name', 'code']) if (input[field] !== undefined) record[field] = String(input[field]).trim(); if (input.classIds) record.classIds = [...new Set(input.classIds)]; record.updatedAt = now(); record.updatedBy = actorId(actor); return clone(record); }
  function setActive(id, active, actor) { assertSchool(actor); if (!canManage(actor)) throw new Error('Forbidden.'); const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Subject not found.'); record.active = Boolean(active); record.updatedAt = now(); record.updatedBy = actorId(actor); return clone(record); }
  function remove(id, actor, { hasHistoricalRecords = false } = {}) { assertSchool(actor); if (!canManage(actor)) throw new Error('Forbidden.'); if (hasHistoricalRecords) return setActive(id, false, actor); const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Subject not found.'); records.delete(id); return { ok: true }; }
  return { list, get, create, update, activate: (id, actor) => setActive(id, true, actor), deactivate: (id, actor) => setActive(id, false, actor), remove, classes: () => [...classes] };
}
