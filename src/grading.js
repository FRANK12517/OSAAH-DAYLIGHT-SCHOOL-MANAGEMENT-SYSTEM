export const JHS_TERMINAL_SCALE = Object.freeze([
  [80, 1, 'HIGHEST'], [70, 2, 'HIGHER'], [60, 3, 'HIGH'], [55, 4, 'HIGH AVERAGE'],
  [50, 5, 'AVERAGE'], [45, 6, 'LOW AVERAGE'], [40, 7, 'LOW'], [35, 8, 'LOWER'], [0, 9, 'LOWEST'],
]);

export function gradeForTotal(total, { classId = '', examination = 'TERMINAL' } = {}) {
  const score = Number(total);
  if (!Number.isFinite(score)) return [null, 'Not recorded'];
  if (String(classId).toUpperCase().startsWith('JHS') && String(examination).toUpperCase() === 'TERMINAL') {
    const match = JHS_TERMINAL_SCALE.find(([minimum]) => score >= minimum);
    return [match[1], match[2]];
  }
  return score >= 80 ? ['A', 'Excellent'] : score >= 70 ? ['B', 'Very Good'] : score >= 60 ? ['C', 'Good'] : score >= 50 ? ['D', 'Pass'] : ['F', 'Needs Support'];
}
