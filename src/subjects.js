import { randomUUID } from 'node:crypto';
import { CORE_LEVELS } from './students.js';
import { defaultSubjectsForClass } from './default-subject-catalog.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function actorId(actor) { return actor?.id ?? actor?.userId ?? null; }
function canManage(actor) { return ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'].includes(actor?.roleKey) || actor?.permissions?.has?.('subjects.manage') || actor?.permissions?.has?.('*'); }

export function createSubjectService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight', classes = CORE_LEVELS } = {}) {
  const records = new Map();
  let sequence = 0;
  const signatures = new Map();
  for (const classId of classes) {
    for (const definition of defaultSubjectsForClass(classId)) {
      const signature = JSON.stringify([definition.name, definition.subjectType, definition.isScoring, definition.mandatory, definition.optional, definition.assessmentComponents]);
      let id = signatures.get(signature);
      if (!id) {
        id = `SUBJ-${String(++sequence).padStart(4, '0')}`;
        signatures.set(signature, id);
        records.set(id, {
          id, schoolId, code: definition.name.slice(0, 3).toUpperCase(), name: definition.name,
          subjectType: definition.subjectType, isScoring: definition.isScoring,
          mandatory: Boolean(definition.mandatory), optional: Boolean(definition.optional),
          active: true, classIds: [], maximumMarks: definition.maximumMarks,
          configurationVersion: definition.configurationVersion,
          assessmentComponents: [...definition.assessmentComponents], createdAt: now(), updatedAt: now()
        });
      }
      const record = records.get(id);
      record.classIds.push(classId);
    }
  }

  function assertSchool(actor) { if (!actor || actor.schoolId !== schoolId) throw new Error('Forbidden.'); }
  function list({ classId, includeInactive = false } = {}, actor = {}) {
    assertSchool(actor);
    if (classId && actor?.assignedClassIds?.length && !actor.assignedClassIds.includes(classId)) throw new Error('Forbidden.');
    const configured = [...records.values()].filter((item) => item.schoolId === schoolId && (includeInactive || item.active) && (!classId || item.classIds.includes(classId)));
    if (!classId) configured.sort((left, right) => right.classIds.length - left.classIds.length || left.name.localeCompare(right.name));
    return configured.map(clone);
  }
  function get(id, actor = {}) { assertSchool(actor); const record = records.get(id); return record && record.schoolId === schoolId ? clone(record) : null; }
  function create(input, actor) {
    assertSchool(actor); if (!canManage(actor)) throw new Error('Forbidden.');
    if (!String(input?.name ?? '').trim()) throw new Error('Subject name is required.');
    if ([...records.values()].some((item) => item.schoolId === schoolId && item.name.toLowerCase() === String(input.name).trim().toLowerCase())) throw new Error('Subject already exists.');
    const id = `SUBJ-${String(++sequence).padStart(4, '0')}`;
    const record = { id, schoolId, code: String(input.code ?? input.name.slice(0, 3)).trim().toUpperCase(), name: String(input.name).trim(), subjectType: input.subjectType ?? 'ELECTIVE', isScoring: input.isScoring !== false, mandatory: false, optional: false, classIds: [...new Set(input.classIds ?? classes)], active: true, maximumMarks: 100, configurationVersion: null, assessmentComponents: [], createdAt: now(), updatedAt: now(), updatedBy: actorId(actor) };
    records.set(id, record); return clone(record);
  }
  function update(id, input, actor) {
    assertSchool(actor); if (!canManage(actor)) throw new Error('Forbidden.');
    const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Subject not found.');
    if (record.mandatory && (input.isScoring === false || input.isScoring === 0 || input.subjectType === 'NON_SCORING')) throw new Error('Mandatory core subjects must remain scoring subjects.');
    for (const field of ['name', 'code']) if (input[field] !== undefined) record[field] = String(input[field]).trim();
    if (input.subjectType !== undefined) record.subjectType = String(input.subjectType).toUpperCase();
    if (input.isScoring !== undefined) record.isScoring = Boolean(input.isScoring);
    if (input.classIds) {
      const requested = [...new Set(input.classIds)];
      if (record.mandatory && record.classIds.some((classId) => !requested.includes(classId))) throw new Error('Mandatory subjects cannot be removed from a class.');
      record.classIds = requested;
    }
    record.updatedAt = now(); record.updatedBy = actorId(actor); return clone(record);
  }
  function setActive(id, active, actor) {
    assertSchool(actor); if (!canManage(actor)) throw new Error('Forbidden.');
    const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Subject not found.');
    if (!active && record.mandatory) throw new Error('Mandatory core subjects cannot be deactivated.');
    record.active = Boolean(active); record.updatedAt = now(); record.updatedBy = actorId(actor); return clone(record);
  }
  function remove(id, actor, { hasHistoricalRecords = false } = {}) {
    assertSchool(actor); if (!canManage(actor)) throw new Error('Forbidden.');
    const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Subject not found.');
    if (record.mandatory) throw new Error('Mandatory core subjects cannot be removed.');
    if (hasHistoricalRecords) return setActive(id, false, actor);
    records.delete(id); return { ok: true };
  }
  return { list, get, create, update, activate: (id, actor) => setActive(id, true, actor), deactivate: (id, actor) => setActive(id, false, actor), remove, classes: () => [...classes] };
}
