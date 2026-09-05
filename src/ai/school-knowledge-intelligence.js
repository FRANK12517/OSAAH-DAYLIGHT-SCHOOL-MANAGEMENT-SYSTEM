import { createHash } from 'node:crypto';
import { createAIDataQualityGuard } from './data-quality-guard.js';

export const KNOWLEDGE_SOURCE_STATUSES = Object.freeze(['ACTIVE', 'DRAFT', 'SUPERSEDED', 'ARCHIVED', 'UNAVAILABLE']);
const SECRET = /(api[_ -]?key|password|passwd|secret|access[_ -]?token|session[_ -]?token|database[_ -]?url|private[_ -]?key)\s*[:=]/i;
const words = (value) => [...new Set(String(value ?? '').toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])];
const stripHtml = (value) => String(value ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeStatus = (status) => status === 'PUBLISHED' ? 'ACTIVE' : status === 'UNPUBLISHED' ? 'SUPERSEDED' : String(status ?? 'UNAVAILABLE').toUpperCase();
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };

export function defineKnowledgeSource(input) {
  const status = normalizeStatus(input?.status);
  if (!input?.sourceId || !input.title || !input.sourceType || !input.schoolId) throw new Error('Knowledge source requires identity, title, type, and school scope.');
  if (!KNOWLEDGE_SOURCE_STATUSES.includes(status)) throw new Error(`Invalid knowledge source status: ${status}`);
  if (input.authoritative !== true) throw new Error('Only explicitly authoritative OSAAH sources may be indexed.');
  const permissionScope = input.permissionScope ?? {};
  return Object.freeze({ sourceId: input.sourceId, schoolId: input.schoolId, moduleId: input.moduleId ?? null, title: input.title, sourceType: input.sourceType, version: input.version ?? null, status, effectiveDate: input.effectiveDate ?? null, effectivePeriod: input.effectivePeriod ?? null, academicYear: input.academicYear ?? null, term: input.term ?? null, permissionScope: Object.freeze({ public: permissionScope.public === true, permissions: Object.freeze([...(permissionScope.permissions ?? [])]), roles: Object.freeze([...(permissionScope.roles ?? [])]), users: Object.freeze([...(permissionScope.users ?? [])]) }), updatedAt: input.updatedAt ?? null, expiresAt: input.expiresAt ?? null, authoritative: true, section: input.section ?? null, page: input.page ?? null, topicKey: input.topicKey ?? null, extractionComplete: input.extractionComplete !== false, content: typeof input.content === 'string' ? input.content : null, provenance: input.provenance ?? null });
}

export function createSchoolKnowledgeIntelligence({ dataQualityGuard = createAIDataQualityGuard(), chunkSize = 700, now = () => new Date().toISOString(), explain = null } = {}) {
  if (!Number.isInteger(chunkSize) || chunkSize < 100) throw new Error('Knowledge chunk size must be at least 100 characters.');
  const sources = new Map(); const chunks = new Map();
  function canRead(source, actor) { const scope = source.permissionScope; return Boolean(actor?.id && actor.schoolId === source.schoolId && (scope.public || scope.users.includes(actor.id) || scope.roles.includes(actor.roleKey) || scope.permissions.some((permission) => actor.permissions?.has?.('*') || actor.permissions?.has?.(permission)))); }
  function indexSource(input) {
    const source = defineKnowledgeSource(input); const text = stripHtml(source.content);
    const unsafe = SECRET.test(text); const indexable = source.status === 'ACTIVE' && source.authoritative && source.provenance === 'PRODUCTION' && text && !unsafe;
    sources.set(source.sourceId, Object.freeze({ ...source, content: undefined, contentHash: text ? createHash('sha256').update(text).digest('hex') : null, indexState: unsafe ? 'REJECTED_PRIVATE_CONTENT' : !text ? 'UNAVAILABLE' : source.status === 'ACTIVE' ? 'INDEXED' : 'INACTIVE' }));
    chunks.delete(source.sourceId);
    if (indexable) { const parts = []; for (let offset = 0, index = 0; offset < text.length; offset += chunkSize, index += 1) parts.push(Object.freeze({ chunkId: `${source.sourceId}:${index + 1}`, sourceId: source.sourceId, index: index + 1, text: text.slice(offset, offset + chunkSize), tokens: Object.freeze(words(text.slice(offset, offset + chunkSize))) })); chunks.set(source.sourceId, Object.freeze(parts)); }
    return Object.freeze({ sourceId: source.sourceId, indexed: indexable, indexState: sources.get(source.sourceId).indexState });
  }
  function invalidate(sourceId) { chunks.delete(sourceId); const source = sources.get(sourceId); if (source) sources.set(sourceId, Object.freeze({ ...source, indexState: 'INVALIDATED' })); return Boolean(source); }
  function remove(sourceId) { chunks.delete(sourceId); return sources.delete(sourceId); }
  async function search({ actor, query, sourceTypes = null, limit = 5 } = {}) {
    if (!actor?.id) fail('UNAUTHENTICATED', 'Authentication is required.', 401);
    if (typeof query !== 'string' || !query.trim() || query.length > 500) fail('INVALID_REQUEST', 'Enter a bounded knowledge search query.');
    const queryWords = words(query); const evidence = [];
    for (const [sourceId, sourceChunks] of chunks) { const source = sources.get(sourceId); if (!source || source.status !== 'ACTIVE' || !canRead(source, actor) || sourceTypes && !sourceTypes.includes(source.sourceType)) continue; for (const chunk of sourceChunks) { const score = queryWords.reduce((sum, token) => sum + (chunk.tokens.includes(token) ? 1 : 0), 0); if (score) evidence.push({ score, source, chunk }); } }
    evidence.sort((a, b) => b.score - a.score || String(b.source.effectiveDate ?? b.source.updatedAt ?? '').localeCompare(String(a.source.effectiveDate ?? a.source.updatedAt ?? '')) || a.chunk.chunkId.localeCompare(b.chunk.chunkId));
    let selected = evidence.slice(0, Math.min(10, Math.max(1, Number(limit) || 5))); const conflicts = [];
    const topics = new Map(); for (const item of selected) if (item.source.topicKey) topics.set(item.source.topicKey, [...(topics.get(item.source.topicKey) ?? []), item]);
    for (const [topicKey, items] of topics) { const distinct = new Set(items.map((item) => item.source.contentHash)); const resolvable = items.every((item) => item.source.version || item.source.effectiveDate); if (distinct.size > 1 && !resolvable) conflicts.push({ topicKey, sourceIds: items.map((item) => item.source.sourceId) }); else if (distinct.size > 1) { const winner = [...items].sort((a, b) => String(b.source.effectiveDate ?? b.source.version).localeCompare(String(a.source.effectiveDate ?? a.source.version), undefined, { numeric: true }))[0]; selected = selected.filter((item) => item.source.topicKey !== topicKey || item.source.sourceId === winner.source.sourceId); } }
    const stale = selected.some((item) => item.source.expiresAt && Date.parse(item.source.expiresAt) < Date.parse(now())); const incomplete = selected.some((item) => !item.source.extractionComplete); const warnings = [];
    if (!selected.length) warnings.push('No current authoritative OSAAH source was found for this information.');
    if (conflicts.length) warnings.push('Active authoritative sources conflict and require human review.');
    if (stale) warnings.push('At least one supporting source is stale.'); if (incomplete) warnings.push('At least one supporting source has incomplete extraction.');
    const status = !selected.length ? 'UNAVAILABLE' : stale ? 'STALE' : conflicts.length || incomplete ? 'PARTIAL' : 'COMPLETE';
    const quality = (await dataQualityGuard.assess({ validated: true, valid: true, sourceAvailable: selected.length > 0, sourceCount: selected.length, missingCount: conflicts.length + (incomplete ? 1 : 0), status, lastUpdatedAt: selected.map((item) => item.source.updatedAt).filter(Boolean).sort().at(-1) ?? null, assessedAt: now(), warnings })).quality;
    const results = selected.map(({ source, chunk }) => Object.freeze({ excerpt: chunk.text, source: Object.freeze({ sourceId: source.sourceId, title: source.title, sourceType: source.sourceType, section: source.section, page: source.page, chunk: chunk.index, version: source.version, effectiveDate: source.effectiveDate, effectivePeriod: source.effectivePeriod, academicYear: source.academicYear, term: source.term, updatedAt: source.updatedAt }) }));
    let explanation = null; try { explanation = explain ? await explain({ query, results }) : null; } catch { explanation = null; }
    return Object.freeze({ answerStatus: selected.length ? 'SUPPORTED_BY_SOURCES' : 'NO_AUTHORITATIVE_SOURCE', message: selected.length ? null : 'No current authoritative OSAAH source was found for this information.', results: Object.freeze(results), conflicts: Object.freeze(conflicts.map(clone)), dataQuality: quality, warnings: quality.warnings, explanation, generatedAt: now() });
  }
  return Object.freeze({ indexSource, updateSource: indexSource, invalidate, remove, search, listSources: () => [...sources.values()].map(clone), health: () => ({ sources: sources.size, indexedSources: chunks.size }) });
}

export function syncRepositoryKnowledgeSources(service, { actor, schoolProfile = null, admissionProspectus = null, communication = null, reporting = null } = {}) {
  if (schoolProfile) service.indexSource({ sourceId: `school-profile:${schoolProfile.id ?? actor.schoolId}`, schoolId: actor.schoolId, title: schoolProfile.name ?? 'OSAAH School Profile', sourceType: 'SCHOOL_PROFILE', status: 'ACTIVE', authoritative: true, content: [schoolProfile.name, schoolProfile.location, schoolProfile.motto].filter(Boolean).join('. '), permissionScope: { public: true }, updatedAt: schoolProfile.updatedAt ?? null, provenance: 'PRODUCTION' });
  if (admissionProspectus) { let records = []; try { records = admissionProspectus.list({}, actor); } catch {} for (const row of records) service.indexSource({ sourceId: `admission-prospectus:${row.id}`, schoolId: actor.schoolId, moduleId: 'admission-prospectus', title: `Admission Prospectus — ${row.className}`, sourceType: 'ADMISSION_PROSPECTUS', status: row.status, authoritative: true, content: row.content, academicYear: row.academicYear, effectivePeriod: row.academicYear, permissionScope: { public: true }, updatedAt: row.updatedAt, provenance: row.provenance }); }
  if (communication) for (const row of communication.listCalendar(actor)) service.indexSource({ sourceId: `academic-calendar:${row.id}`, schoolId: actor.schoolId, moduleId: 'calendar', title: row.title, sourceType: 'ACADEMIC_CALENDAR', status: 'ACTIVE', authoritative: true, content: `${row.title}. ${row.type}. Starts ${row.startsAt}${row.endsAt ? ` and ends ${row.endsAt}` : ''}.`, effectiveDate: row.startsAt, permissionScope: row.audience === 'SCHOOL' ? { public: true } : { roles: [row.audience] }, updatedAt: row.createdAt, provenance: row.provenance });
  if (reporting) for (const row of reporting.listDocuments(actor)) service.indexSource({ sourceId: `official-document:${row.id}`, schoolId: actor.schoolId, moduleId: 'official-documents', title: row.title, sourceType: 'OFFICIAL_DOCUMENT', status: 'ACTIVE', authoritative: true, content: row.body, effectiveDate: row.date, permissionScope: row.recipientId ? { users: [row.recipientId], roles: ['PROPRIETOR', 'SCHOOL_ADMIN'] } : { roles: ['PROPRIETOR', 'SCHOOL_ADMIN'] }, updatedAt: row.createdAt, provenance: row.provenance });
  return service.health();
}

export function createSchoolKnowledgeTools(service) {
  const definitions = [['knowledge.search', 'documents', 'documents.read', null], ['knowledge.official-document', 'documents', 'documents.read', ['OFFICIAL_DOCUMENT']], ['knowledge.admission-prospectus', 'admissions', 'admissions.read', ['ADMISSION_PROSPECTUS']], ['knowledge.academic-calendar', 'communication', 'communication.read', ['ACADEMIC_CALENDAR']]];
  return Object.freeze(definitions.map(([name, capabilityId, requiredPermission, sourceTypes]) => ({ name, capabilityId, description: `Search active authoritative OSAAH ${name.replace('knowledge.', '').replace('-', ' ')} sources.`, operationType: name === 'knowledge.search' ? 'ANALYZE' : 'READ', requiredPermission, inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 500 } }, required: ['query'], additionalProperties: false }, outputSchema: { type: 'object' }, productionDataOnly: true, schoolScoped: true, dataQualityAware: true, auditRequired: true, enabled: true, handler: async ({ input, authorization }) => ({ records: [{ ...(await service.search({ query: input.query, sourceTypes, actor: { id: authorization.context.userId, schoolId: authorization.context.schoolId, roleKey: authorization.context.role, permissions: new Set(authorization.context.permissions) } })), provenance: 'PRODUCTION' }] }) })));
}
