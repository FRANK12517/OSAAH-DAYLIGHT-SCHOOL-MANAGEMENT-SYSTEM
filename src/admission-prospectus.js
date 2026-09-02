import { randomUUID } from 'node:crypto';
import { ADMISSION_CLASSES } from './admission-form.js';

export const PROSPECTUS_PERMISSION = 'admission.prospectus.manage';
export const PROSPECTUS_STATUSES = ['DRAFT', 'PUBLISHED', 'UNPUBLISHED'];
export const MAX_PROSPECTUS_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_DOCUMENTS = new Map([
  ['pdf', 'application/pdf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['txt', 'text/plain']
]);

export const DEFAULT_PROSPECTUS_TEMPLATE = `<h2>School Rules and Regulations</h2><ol><li>Students must attend school regularly and punctually.</li><li>School uniforms are compulsory on all school days.</li><li>Respect for teachers, staff, fellow students and school property is mandatory.</li><li>Bullying, fighting, or use of foul language is strictly prohibited.</li><li>No student may leave school premises during school hours without permission.</li><li>All homework and assignments must be completed on time.</li><li>Fees must be paid on or before the due date.</li></ol><h2>Termly Requirements</h2><p>Use the sections below to publish the applicable requirements for each class group.</p><h3>Crèche and Nursery</h3><ul><li>T-Roll - 1 pack</li><li>Dettol - medium size (1kg)</li><li>Baby wipes - 1</li><li>Pampers - 3</li><li>Medicated soap - 2 pieces</li></ul><h3>Kindergarten</h3><ul><li>T-Roll - 1 pack</li><li>Dettol - medium size (1kg)</li><li>Medicated soap - 2 pieces</li><li>Omo - 1 medium size</li></ul><h3>Lower Primary</h3><ul><li>T-Roll - 2 packs</li><li>Dettol - medium size (1kg)</li><li>Liquid soap - 1 big size</li><li>Omo - 1 medium size</li><li>A4 sheet - 1 pack</li></ul><h3>Upper Primary and J.H.S</h3><ul><li>T-Roll - 2 packs</li><li>Dettol - medium size (1kg)</li><li>Liquid soap - 1 big size</li><li>Omo - 1 medium size</li><li>A4 sheet - 1 pack</li></ul>`;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function normalizeKey(value) { return String(value ?? '').trim().toLowerCase(); }
function extensionFor(name) { return String(name ?? '').toLowerCase().split('.').pop(); }
function sanitizeUrl(value) { const url = String(value ?? '').trim(); return /^(https?:\/\/|\/[^/]|#)/i.test(url) ? url : null; }

export function sanitizeProspectusHtml(input) {
  let html = String(input ?? '');
  html = html.replace(/<!--[\s\S]*?-->/g, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '');
  html = html.replace(/<\s*(script|style|iframe|object|embed|form|input|button|textarea|select)[^>]*\/?>/gi, '');
  html = html.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  html = html.replace(/\s+(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, (match, doubleValue, singleValue, bareValue) => {
    const safe = sanitizeUrl(doubleValue ?? singleValue ?? bareValue);
    return safe ? ` href="${safe.replaceAll('"', '&quot;')}"` : '';
  });
  return html.replace(/<(?!\/?(?:h[1-6]|p|br|strong|b|em|i|u|ol|ul|li|table|thead|tbody|tr|th|td|a)\b)[^>]*>/gi, '');
}

export function validateProspectusDocument(input = {}) {
  const documentName = String(input.documentName ?? input.fileName ?? input.fileReference ?? '').trim();
  const documentType = String(input.documentType ?? input.mimeType ?? '').trim().toLowerCase();
  const extension = extensionFor(documentName);
  const expectedMime = ALLOWED_DOCUMENTS.get(extension);
  const size = Number(input.documentSize ?? input.size ?? 0);
  if (!documentName || !expectedMime || !ALLOWED_DOCUMENTS.has(extension)) throw new Error('Only PDF, Word, and plain text prospectus documents are supported.');
  if (documentType && documentType !== expectedMime) throw new Error('The document type does not match its file extension.');
  if (!Number.isFinite(size) || size < 0 || size > MAX_PROSPECTUS_DOCUMENT_BYTES) throw new Error('The prospectus document is too large or has an invalid size.');
  return { documentName, documentType: expectedMime, documentSize: size, extension };
}

export function createAdmissionProspectusService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight', classes = ADMISSION_CLASSES, academicYears = [] } = {}) {
  const records = new Map();
  const auditEntries = [];
  const classOptions = [...new Set(classes.map((item) => typeof item === 'string' ? { id: item, name: item } : { id: item.id, name: item.name }).filter((item) => item.id && item.name))];
  const yearOptions = [...new Set(academicYears.map((item) => typeof item === 'string' ? { id: item, name: item } : { id: item.id, name: item.name }).filter((item) => item.id && item.name))];

  function actorId(actor) { return actor?.id ?? actor?.userId ?? null; }
  function assertSchool(actor) { if (!actor || actor.portal !== 'school' || actor.schoolId !== schoolId) throw new Error('Forbidden.'); }
  function assertManager(actor) { assertSchool(actor); if (!['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ADMISSIONS_OFFICER'].includes(actor.roleKey) && !actor.permissions?.has?.(PROSPECTUS_PERMISSION) && !actor.permissions?.has?.('*')) throw new Error('Forbidden.'); }
  function assertClass(classId) { const item = classOptions.find((candidate) => candidate.id === classId || candidate.name === classId); if (!item) throw new Error('Invalid class.'); return item; }
  function assertYear(academicYearId, academicYear) { const id = String(academicYearId ?? academicYear ?? '').trim(); if (!id) throw new Error('Academic year is required.'); const item = yearOptions.find((candidate) => candidate.id === id || candidate.name === id); return item ?? { id, name: id }; }
  function audit(action, record, actor) { auditEntries.push({ id: randomUUID(), action, entity: 'AdmissionProspectus', entityId: record.id, schoolId, userId: actorId(actor), roleKey: actor?.roleKey ?? null, classId: record.classId, academicYearId: record.academicYearId, occurredAt: now() }); }
  function publicRecord(record, includeDraft = false) { if (!record || (!includeDraft && record.status !== 'PUBLISHED')) return null; return clone({ ...record, content: record.content ? sanitizeProspectusHtml(record.content) : null }); }
  function findByCombination(classId, academicYearId) { return [...records.values()].find((record) => record.schoolId === schoolId && record.classId === classId && record.academicYearId === academicYearId); }
  function listOptions() { const recordsYears = [...records.values()].map((record) => ({ id: record.academicYearId, name: record.academicYear })); return { classes: clone(classOptions), academicYears: clone([...new Map([...yearOptions, ...recordsYears].map((item) => [item.id, item])).values()]) }; }
  function list(filters = {}, actor) { const includeDraft = actor?.portal === 'school' && (['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ADMISSIONS_OFFICER'].includes(actor.roleKey) || actor.permissions?.has?.(PROSPECTUS_PERMISSION) || actor.permissions?.has?.('*')); if (actor?.portal === 'parent') return [...records.values()].filter((record) => record.schoolId === schoolId && record.status === 'PUBLISHED' && (!filters.classId || record.classId === filters.classId) && (!filters.academicYearId || record.academicYearId === filters.academicYearId)).map((record) => publicRecord(record)); assertManager(actor); return [...records.values()].filter((record) => record.schoolId === schoolId && (!filters.classId || record.classId === filters.classId) && (!filters.academicYearId || record.academicYearId === filters.academicYearId) && (includeDraft || record.status === 'PUBLISHED')).map((record) => publicRecord(record, includeDraft)); }
  function get(id, actor) { const record = records.get(id); if (!record || record.schoolId !== schoolId) return null; if (actor?.portal === 'parent') return publicRecord(record); assertManager(actor); return publicRecord(record, true); }
  function create(input, actor) { assertManager(actor); const classRecord = assertClass(input.classId); const yearRecord = assertYear(input.academicYearId, input.academicYear); const existing = findByCombination(classRecord.id, yearRecord.id); if (existing) throw new Error('A prospectus already exists for this class and academic year. Update or replace the existing record.'); const timestamp = now(); const record = { id: randomUUID(), schoolId, classId: classRecord.id, className: classRecord.name, academicYearId: yearRecord.id, academicYear: yearRecord.name, content: input.content ? sanitizeProspectusHtml(input.content) : null, documentUrl: null, documentName: null, documentType: null, documentSize: 0, status: 'DRAFT', isPublished: false, publishedAt: null, publishedBy: null, createdBy: actorId(actor), createdAt: timestamp, updatedBy: actorId(actor), updatedAt: timestamp }; records.set(record.id, record); audit('CREATED', record, actor); return publicRecord(record, true); }
  function update(id, input, actor) { assertManager(actor); const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Prospectus not found.'); if (input.classId || input.academicYearId || input.academicYear) { const classRecord = assertClass(input.classId ?? record.classId); const yearRecord = assertYear(input.academicYearId ?? record.academicYearId, input.academicYear ?? record.academicYear); const sibling = findByCombination(classRecord.id, yearRecord.id); if (sibling && sibling.id !== id) throw new Error('A prospectus already exists for this class and academic year.'); Object.assign(record, { classId: classRecord.id, className: classRecord.name, academicYearId: yearRecord.id, academicYear: yearRecord.name }); } if (input.content !== undefined) record.content = sanitizeProspectusHtml(input.content); Object.assign(record, { updatedBy: actorId(actor), updatedAt: now() }); audit('UPDATED', record, actor); return publicRecord(record, true); }
  function upload(id, input, actor, replacing = false) { assertManager(actor); const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Prospectus not found.'); const document = validateProspectusDocument(input); Object.assign(record, { documentUrl: String(input.documentUrl ?? input.fileReference ?? '').trim() || null, documentName: document.documentName, documentType: document.documentType, documentSize: document.documentSize, updatedBy: actorId(actor), updatedAt: now() }); audit(replacing ? 'DOCUMENT_REPLACED' : 'DOCUMENT_UPLOADED', record, actor); return publicRecord(record, true); }
  function publish(id, actor) { assertManager(actor); const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Prospectus not found.'); if (!record.content && !record.documentUrl) throw new Error('Add rich-text content or upload a document before publishing.'); Object.assign(record, { status: 'PUBLISHED', isPublished: true, publishedAt: now(), publishedBy: actorId(actor), updatedBy: actorId(actor), updatedAt: now() }); audit('PUBLISHED', record, actor); return publicRecord(record, true); }
  function unpublish(id, actor) { assertManager(actor); const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Prospectus not found.'); Object.assign(record, { status: 'UNPUBLISHED', isPublished: false, publishedAt: null, publishedBy: null, updatedBy: actorId(actor), updatedAt: now() }); audit('UNPUBLISHED', record, actor); return publicRecord(record, true); }
  function remove(id, actor) { assertManager(actor); const record = records.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Prospectus not found.'); records.delete(id); audit('ARCHIVED', record, actor); return { ok: true }; }
  return { listOptions, list, get, create, update, upload, replaceDocument: (id, input, actor) => upload(id, input, actor, true), publish, unpublish, remove, auditEntries: () => clone(auditEntries), sanitizeProspectusHtml, validateProspectusDocument };
}
