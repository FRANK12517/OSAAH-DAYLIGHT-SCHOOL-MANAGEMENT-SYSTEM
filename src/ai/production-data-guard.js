import { dataQuality } from './contracts.js';
import { normalizeEnvironment, recordProvenance } from './provenance.js';

const PROHIBITED = new Set(['TEST', 'DEMO', 'SEED', 'DEVELOPMENT', 'MIGRATION_VALIDATION']);

export function createProductionDataGuard({ environment, legacyClassifier = () => null, provenanceOf = recordProvenance, clock = () => new Date().toISOString() } = {}) {
  const runtime = normalizeEnvironment(environment);
  function queryCondition({ productionOnly = true } = {}) { return productionOnly ? Object.freeze({ provenance: 'PRODUCTION' }) : Object.freeze({}); }
  function sanitize(records, options = {}) {
    const productionOnly = options.productionOnly !== false;
    if (runtime === 'production' && (!productionOnly || options.includeTestData === true || options.requestedProvenance && options.requestedProvenance !== 'PRODUCTION')) throw new Error('PRODUCTION_DATA_POLICY_OVERRIDE_FORBIDDEN');
    const included = []; const excluded = []; const reasons = {}; let trustedLegacyCount = 0;
    for (const record of records ?? []) {
      if (!productionOnly && runtime !== 'production') { included.push(record); continue; }
      const explicit = provenanceOf(record);
      const classified = explicit ?? legacyClassifier(record);
      if (classified === 'PRODUCTION') { included.push(record); if (!explicit) trustedLegacyCount += 1; continue; }
      const reason = PROHIBITED.has(classified) ? `PROVENANCE_${classified}` : 'UNCERTAIN_LEGACY_PROVENANCE';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      excluded.push(Object.freeze({ recordId: record?.id ?? null, reason }));
    }
    const issues = Object.entries(reasons).map(([reason, count]) => `${count} record(s) excluded: ${reason}`);
    if (trustedLegacyCount) issues.push(`${trustedLegacyCount} legacy record(s) included by the approved server policy.`);
    const status = excluded.length || trustedLegacyCount ? 'PARTIAL' : 'COMPLETE';
    return Object.freeze({
      records: Object.freeze(included),
      excluded: Object.freeze(excluded),
      diagnostics: Object.freeze({ includedCount: included.length, excludedCount: excluded.length, trustedLegacyCount, exclusionReasons: Object.freeze({ ...reasons }), productionOnly, environment: runtime }),
      quality: dataQuality(status, { assessedAt: clock(), completenessPercent: records?.length ? Math.round(included.length / records.length * 10000) / 100 : 100, issues })
    });
  }
  return Object.freeze({ environment: runtime, queryCondition, sanitize, getProductionRecords: (records, options) => sanitize(records, { ...options, productionOnly: true }).records });
}
