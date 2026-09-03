import { AI_DATA_PROVENANCE } from './contracts.js';

const SOURCE_PROVENANCE = Object.freeze({ TEST: 'TEST', FIXTURE: 'TEST', DEMO: 'DEMO', SAMPLE: 'DEMO', MOCK_DATA: 'DEMO', SEED: 'SEED', DEVELOPMENT: 'DEVELOPMENT', DEVELOPER_UTILITY: 'DEVELOPMENT', MIGRATION_VALIDATION: 'MIGRATION_VALIDATION' });

export function normalizeEnvironment(environment = process.env.NODE_ENV) {
  const value = String(environment ?? 'development').trim().toLowerCase();
  if (value === 'production') return 'production';
  if (value === 'test') return 'test';
  return 'development';
}

export function provenanceForCreation({ environment, source = 'WORKFLOW' } = {}) {
  const sourceKey = String(source).trim().toUpperCase();
  if (SOURCE_PROVENANCE[sourceKey]) return SOURCE_PROVENANCE[sourceKey];
  const runtime = normalizeEnvironment(environment);
  return runtime === 'production' ? 'PRODUCTION' : runtime === 'test' ? 'TEST' : 'DEVELOPMENT';
}

export function createRecordProvenance(options = {}) {
  const provenance = provenanceForCreation(options);
  if (!AI_DATA_PROVENANCE.includes(provenance)) throw new Error(`Invalid record provenance: ${provenance}`);
  return Object.freeze({ provenance, provenanceSource: String(options.source ?? 'WORKFLOW').toUpperCase() });
}

export function recordProvenance(record) {
  const value = record?.provenance ?? record?.dataProvenance ?? record?.metadata?.provenance;
  return AI_DATA_PROVENANCE.includes(value) ? value : null;
}
