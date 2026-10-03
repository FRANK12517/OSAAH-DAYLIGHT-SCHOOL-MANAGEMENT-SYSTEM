export const PRIMARY_SCALE = Object.freeze([
  [80, 1, 'HIGHEST'], [70, 2, 'HIGHER'], [60, 3, 'HIGH'], [55, 4, 'HIGH AVERAGE'],
  [50, 5, 'AVERAGE'], [40, 6, 'LOW AVERAGE'], [35, 8, 'LOWER'], [0, 9, 'LOWEST']
]);
export const JHS_SCALE = Object.freeze([
  [80, 1, 'EXCELLENT / HIGHEST'], [70, 2, 'VERY GOOD / HIGHER'], [60, 3, 'GOOD / HIGH'], [50, 4, 'CREDIT / HIGH AVERAGE'],
  [45, 5, 'CREDIT / AVERAGE'], [40, 6, 'CREDIT / LOW AVERAGE'], [35, 7, 'PASS / LOW'], [25, 8, 'PASS / LOWER'], [0, 9, 'FAIL / LOWEST']
]);
export const SCORE_MAXIMUM = 100;
export const KG_SUBJECT_COUNT = 4;
export const KG_TOTAL_MAXIMUM = SCORE_MAXIMUM * KG_SUBJECT_COUNT;

function scaleForClass(classId = '', examination = 'TERMINAL') {
  const value = String(classId).trim().toUpperCase();
  if (value.startsWith('JHS') && ['TERMINAL', 'MOCK'].includes(String(examination).toUpperCase())) return JHS_SCALE;
  if (/^(PRIMARY|BASIC)\s*[1-6]$/.test(value)) return PRIMARY_SCALE;
  return null;
}
export function validateScore(value, { maximum = SCORE_MAXIMUM, field = 'Score', allowNull = false } = {}) {
  if (allowNull && (value === null || value === undefined || value === '')) return null;
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > maximum) throw new RangeError(`${field} must be between 0 and ${maximum}.`);
  return score;
}
export function gradeScaleForClass(classId = '', examination = 'TERMINAL') { return scaleForClass(classId, examination); }
function gradeFromScale(score, scale) { const match = scale.find(([minimum]) => score >= minimum); return [match[1], match[2]]; }
export function gradeForTotal(total, { classId = '', examination = 'TERMINAL' } = {}) {
  const score = validateScore(total);
  const scale = scaleForClass(classId, examination);
  if (scale) return gradeFromScale(score, scale);
  return score >= 80 ? ['A', 'Excellent'] : score >= 70 ? ['B', 'Very Good'] : score >= 60 ? ['C', 'Good'] : score >= 50 ? ['D', 'Pass'] : ['F', 'Needs Support'];
}
