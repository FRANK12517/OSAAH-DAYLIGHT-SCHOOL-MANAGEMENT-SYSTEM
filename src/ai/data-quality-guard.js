import { AI_DATA_QUALITY, dataQuality } from './contracts.js';

const numberOrNull = (value) => value === null || value === undefined ? null : Number(value);
const validCount = (value) => value === null || Number.isInteger(value) && value >= 0;
const uniqueWarnings = (warnings) => Object.freeze([...new Set((warnings ?? []).filter((warning) => typeof warning === 'string' && warning.trim()).map((warning) => warning.trim()))]);
const QUALITY_SEVERITY = Object.freeze({ COMPLETE: 0, PARTIAL: 1, STALE: 2, UNAVAILABLE: 3, INVALID: 4 });

export class AIDataQualityError extends Error {
  constructor(code, message) { super(message); this.name = 'AIDataQualityError'; this.code = code; }
}

export function validateAIDataQuality(quality) {
  if (!quality || !AI_DATA_QUALITY.includes(quality.status)) throw new AIDataQualityError('QUALITY_UNVALIDATED', 'AI result quality must use a validated quality status.');
  const completeness = quality.completenessPercent ?? null;
  if (completeness !== null && (!Number.isFinite(completeness) || completeness < 0 || completeness > 100)) throw new AIDataQualityError('QUALITY_INVALID', 'Completeness percentage must be between 0 and 100.');
  for (const field of ['missingCount', 'sourceCount']) if (!Number.isInteger(quality[field]) || quality[field] < 0) throw new AIDataQualityError('QUALITY_INVALID', `${field} must be a non-negative integer.`);
  if (!Array.isArray(quality.warnings)) throw new AIDataQualityError('QUALITY_INVALID', 'Quality warnings must be a list.');
  return quality;
}

export function createAIDataQualityGuard({ productionDataGuard, auditLogger, clock = () => new Date().toISOString(), staleAfterMs = null } = {}) {
  if (staleAfterMs !== null && (!Number.isFinite(staleAfterMs) || staleAfterMs < 0)) throw new Error('staleAfterMs must be a non-negative duration.');

  async function assess(input = {}) {
    const assessedAt = input.assessedAt ?? clock();
    const warningsInputValid = input.warnings === undefined || Array.isArray(input.warnings);
    const warnings = warningsInputValid ? [...(input.warnings ?? [])] : [];
    let records = Array.isArray(input.records) ? input.records : null;
    let excludedCount = 0;
    if (records && productionDataGuard) {
      const guarded = productionDataGuard.sanitize(records, { productionOnly: true });
      records = [...guarded.records]; excludedCount = guarded.diagnostics.excludedCount;
      warnings.push(...guarded.quality.issues);
    }
    let sourceCount = numberOrNull(input.sourceCount);
    if (sourceCount === null && records) sourceCount = records.length;
    let missingCount = numberOrNull(input.missingCount);
    const missingDerivedFromExpected = missingCount === null && numberOrNull(input.expectedCount) !== null;
    const expectedCount = numberOrNull(input.expectedCount);
    if (missingCount === null && expectedCount !== null && sourceCount !== null) missingCount = Math.max(0, expectedCount - sourceCount);
    if (missingCount === null) missingCount = 0;
    if (!missingDerivedFromExpected) missingCount += excludedCount;
    if (sourceCount === null) sourceCount = 0;

    const suppliedStatusValid = input.status === undefined || AI_DATA_QUALITY.includes(input.status);
    let valid = input.validated === true && input.valid !== false && warningsInputValid && suppliedStatusValid && Number.isFinite(Date.parse(assessedAt));
    if (![sourceCount, missingCount, expectedCount].every(validCount) || expectedCount !== null && missingCount > expectedCount) valid = false;
    const sourceAvailable = input.sourceAvailable === true;
    const lastUpdatedAt = input.lastUpdatedAt ?? null;
    const updatedTime = lastUpdatedAt === null ? null : Date.parse(lastUpdatedAt);
    if (lastUpdatedAt !== null && !Number.isFinite(updatedTime)) valid = false;
    const stale = valid && sourceAvailable && staleAfterMs !== null && updatedTime !== null && Date.parse(assessedAt) - updatedTime > staleAfterMs;
    const derivedStatus = !valid ? 'INVALID' : !sourceAvailable ? 'UNAVAILABLE' : stale ? 'STALE' : missingCount > 0 ? 'PARTIAL' : 'COMPLETE';
    const status = valid && input.status && QUALITY_SEVERITY[input.status] > QUALITY_SEVERITY[derivedStatus] ? input.status : derivedStatus;
    if (!valid) warnings.push('Quality evidence is invalid or was not validated by trusted server-side logic.');
    if (valid && !sourceAvailable) warnings.push('Required source data is unavailable.');
    if (stale) warnings.push('Source data is outside the accepted freshness window.');
    if (missingCount > 0 && status === 'PARTIAL') warnings.push(`${missingCount} required item(s) are missing or excluded.`);
    let completenessPercent = null;
    if (expectedCount !== null) completenessPercent = expectedCount === 0 ? 100 : Math.round(Math.max(0, expectedCount - missingCount) / expectedCount * 10000) / 100;
    const quality = Object.freeze({
      ...dataQuality(status, { assessedAt, sourceUpdatedAt: lastUpdatedAt, completenessPercent, issues: uniqueWarnings(warnings) }),
      missingCount, sourceCount, lastUpdatedAt, reportingPeriod: input.reportingPeriod ? Object.freeze({ ...input.reportingPeriod }) : null,
      warnings: uniqueWarnings(warnings), verifiedComplete: status === 'COMPLETE'
    });
    validateAIDataQuality(quality);
    if (auditLogger && input.requestId && input.correlationId) await auditLogger.record({
      eventType: 'AI_DATA_QUALITY_ASSESSED', requestStatus: 'COMPLETED', requestId: input.requestId, correlationId: input.correlationId,
      userId: input.userId, schoolId: input.schoolId, role: input.role, capabilityId: input.capabilityId,
      productionDataOnly: true, dataQualityStatus: status,
      metadata: { sourceRecordCount: sourceCount, excludedRecordCount: excludedCount, warningCount: quality.warnings.length }
    });
    return Object.freeze({ quality, records: records ? Object.freeze(records) : null });
  }

  function attach(result, quality) {
    validateAIDataQuality(quality);
    return Object.freeze({ ...(result ?? {}), quality });
  }

  return Object.freeze({ assess, attach, validate: validateAIDataQuality, statuses: AI_DATA_QUALITY });
}
