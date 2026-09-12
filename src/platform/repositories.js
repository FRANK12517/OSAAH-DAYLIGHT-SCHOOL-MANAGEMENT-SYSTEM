const clone = (value) => structuredClone(value);
const fail = (code, message, status = 503) => { throw Object.assign(new Error(message), { code, status }); };
const IDENTIFIER = /^[a-z][a-z0-9_]*$/;

function scope(schoolId) { if (!schoolId || typeof schoolId !== 'string') fail('SCHOOL_SCOPE_REQUIRED', 'School scope is required.', 400); return schoolId; }
function validateName(value, label) { if (!IDENTIFIER.test(value)) fail('INVALID_REPOSITORY_IDENTIFIER', `${label} is invalid.`, 500); return value; }

/**
 * Stable repository contract shared by domain services. Services receive this
 * boundary, never an adapter or SQL handle. All reads and writes require the
 * authenticated school scope and preserve provenance fields unchanged.
 */
export function createInMemoryRepository({ initial = [] } = {}) {
  const records = new Map(initial.map((item) => [item.id, clone(item)]));
  return Object.freeze({ durable: false, async healthCheck() { return { healthy: true, durable: false }; }, async get(id, schoolId) { scope(schoolId); const item = records.get(id); return item?.schoolId === schoolId ? clone(item) : null; }, async list(schoolId, { limit = 100 } = {}) { scope(schoolId); return [...records.values()].filter((item) => item.schoolId === schoolId).slice(0, Math.min(100, Math.max(1, Number(limit) || 100))).map(clone); }, async insert(record) { scope(record?.schoolId); if (!record?.id) fail('REPOSITORY_RECORD_ID_REQUIRED', 'A record ID is required.', 400); if (records.has(record.id)) fail('REPOSITORY_CONFLICT', 'The record already exists.', 409); records.set(record.id, clone(record)); return clone(record); }, async replace(id, schoolId, record) { scope(schoolId); const current = records.get(id); if (!current || current.schoolId !== schoolId) return null; records.set(id, clone({ ...record, id, schoolId })); return clone(records.get(id)); }, async remove(id, schoolId) { scope(schoolId); const current = records.get(id); if (!current || current.schoolId !== schoolId) return false; records.delete(id); return true; } });
}

export function createDatabaseRepository({ adapter, table, serialize = (record) => record, deserialize = (row) => row, idColumn = 'id', schoolColumn = 'school_id' } = {}) {
  if (!adapter || typeof adapter.query !== 'function' || typeof adapter.execute !== 'function' || typeof adapter.transaction !== 'function' || typeof adapter.healthCheck !== 'function') fail('DATABASE_ADAPTER_REQUIRED', 'A durable database adapter is required.');
  validateName(table, 'Table'); validateName(idColumn, 'ID column'); validateName(schoolColumn, 'School column');
  const safe = (record) => { const value = serialize(record); scope(value?.schoolId ?? value?.school_id); return value; };
  return Object.freeze({ durable: true, async healthCheck() { try { return await adapter.healthCheck(); } catch { return { healthy: false, durable: true }; } }, async get(id, schoolId) { scope(schoolId); try { const rows = await adapter.query(`SELECT * FROM ${table} WHERE ${idColumn} = ? AND ${schoolColumn} = ? LIMIT 1`, [id, schoolId]); return rows[0] ? clone(deserialize(rows[0])) : null; } catch { fail('PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.'); } }, async list(schoolId, { limit = 100, orderBy = 'created_at' } = {}) { scope(schoolId); validateName(orderBy, 'Order column'); const bounded = Math.min(100, Math.max(1, Number(limit) || 100)); try { const rows = await adapter.query(`SELECT * FROM ${table} WHERE ${schoolColumn} = ? ORDER BY ${orderBy} DESC LIMIT ?`, [schoolId, bounded]); return rows.map((row) => clone(deserialize(row))); } catch { fail('PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.'); } }, async insert(record) { const value = safe(record); const fields = Object.keys(value).map((field) => validateName(field, 'Column')); const placeholders = fields.map(() => '?').join(','); try { await adapter.execute(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${placeholders})`, fields.map((field) => value[field])); return clone(record); } catch { fail('PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.'); } }, async replace(id, schoolId, record) { scope(schoolId); const value = safe({ ...record, id, schoolId }); const fields = Object.keys(value).filter((field) => field !== idColumn).map((field) => validateName(field, 'Column')); try { const result = await adapter.transaction(async (tx) => tx.execute(`UPDATE ${table} SET ${fields.map((field) => `${field}=?`).join(',')} WHERE ${idColumn}=? AND ${schoolColumn}=?`, [...fields.map((field) => value[field]), id, schoolId])); return Number(result?.affectedRows ?? result?.changes ?? 0) === 1 ? clone(record) : null; } catch { fail('PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.'); } }, async remove(id, schoolId) { scope(schoolId); try { const result = await adapter.execute(`DELETE FROM ${table} WHERE ${idColumn}=? AND ${schoolColumn}=?`, [id, schoolId]); return Number(result?.affectedRows ?? result?.changes ?? 0) === 1; } catch { fail('PERSISTENCE_UNAVAILABLE', 'Durable persistence is unavailable.'); } } });
}

export function selectRepository({ environment = process.env.NODE_ENV ?? 'development', adapter = null, memory = {} } = {}) {
  if (adapter) return createDatabaseRepository({ adapter, ...memory });
  if (environment === 'production') fail('DURABLE_REPOSITORY_REQUIRED', 'Production services require durable repositories.');
  if (!memory.allowMemory) fail('MEMORY_REPOSITORY_NOT_ALLOWED', 'In-memory repositories must be explicitly enabled.');
  return createInMemoryRepository(memory);
}
