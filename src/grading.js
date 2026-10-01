export const PRIMARY_SCALE = Object.freeze([
  [80, 1, 'HIGHEST'], [70, 2, 'HIGHER'], [60, 3, 'HIGH'], [55, 4, 'HIGH AVERAGE'],
  [50, 5, 'AVERAGE'], [40, 6, 'LOW AVERAGE'], [35, 8, 'LOWER'], [0, 9, 'LOWEST']
]);
export const JHS_SCALE = Object.freeze([
  [80, 1, 'EXCELLENT / HIGHEST'], [70, 2, 'VERY GOOD / HIGHER'], [60, 3, 'GOOD / HIGH'], [50, 4, 'CREDIT / HIGH AVERAGE'],
  [45, 5, 'CREDIT / AVERAGE'], [40, 6, 'CREDIT / LOW AVERAGE'], [35, 7, 'PASS / LOW'], [25, 8, 'PASS / LOWER'], [0, 9, 'FAIL / LOWEST']
]);
function gradeFromScale(score, scale) { const match = scale.find(([minimum]) => score >= minimum); return [match[1], match[2]]; }
export function gradeForTotal(total, { classId = '', examination = 'TERMINAL' } = {}) {
  const score = Number(total);
  if (!Number.isFinite(score)) return [null, 'Not recorded'];
  if (String(classId).toUpperCase().startsWith('JHS') && ['TERMINAL', 'MOCK'].includes(String(examination).toUpperCase())) return gradeFromScale(score, JHS_SCALE);
  if (/^(PRIMARY|BASIC)\s*[1-6]$/i.test(String(classId))) return gradeFromScale(score, PRIMARY_SCALE);
  return score >= 80 ? ['A', 'Excellent'] : score >= 70 ? ['B', 'Very Good'] : score >= 60 ? ['C', 'Good'] : score >= 50 ? ['D', 'Pass'] : ['F', 'Needs Support'];
}
