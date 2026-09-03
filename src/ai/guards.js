import { AI_DATA_PROVENANCE } from './contracts.js';

export function authorizeAITool({ actor, tool, canAccess }) {
  if (!actor || !tool || typeof canAccess !== 'function') return Object.freeze({ allowed: false, reason: 'INVALID_AUTHORIZATION_CONTEXT' });
  const allowed = tool.requiredPermissions.every((permission) => canAccess(actor, permission));
  return Object.freeze({ allowed, reason: allowed ? null : 'MISSING_PERMISSION' });
}

export function enforceProductionData(records, { allowed = ['PRODUCTION'], provenanceOf = (record) => record?.provenance } = {}) {
  for (const value of allowed) if (!AI_DATA_PROVENANCE.includes(value)) throw new Error(`Invalid allowed provenance: ${value}`);
  const accepted = []; const rejected = [];
  for (const record of records ?? []) (allowed.includes(provenanceOf(record)) ? accepted : rejected).push(record);
  return Object.freeze({ accepted: Object.freeze(accepted), rejected: Object.freeze(rejected), allowed: Object.freeze([...allowed]) });
}
