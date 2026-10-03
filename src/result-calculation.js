import { gradeForTotal, KG_TOTAL_MAXIMUM, validateScore } from './grading.js';
import { ordinalPosition, subjectPositions, validSubjectRows } from './result-slip.js';

const CORE_BY_LEVEL = Object.freeze({
  JHS: [['english language'], ['mathematics'], ['integrated science', 'science'], ['social studies']],
  LOWER_PRIMARY: [['english language'], ['mathematics'], ['science'], ['history']],
  UPPER_PRIMARY: [['english language'], ['mathematics'], ['integrated science'], ['history']]
});
const NON_SCORING = new Set(['physical education', 'pe']);
const KG_PARENT_SUBJECTS = new Set(['language and literacy', 'numeracy', 'our world, our people', 'creative arts']);
const nameOf = (row) => String(row.subjectName ?? row.name ?? row.subjectId ?? '').trim().toLowerCase().replace(/[&/]/g, ' ').replace(/\s+/g, ' ');
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const levelOf = (classId) => {
  const value = String(classId ?? '').toUpperCase().trim();
  if (value.startsWith('JHS')) return 'JHS';
  if (value.startsWith('KG')) return 'KG';
  if (/^(PRIMARY|BASIC)\s*[1-3]$/.test(value)) return 'LOWER_PRIMARY';
  if (/^(PRIMARY|BASIC)\s*[4-6]$/.test(value)) return 'UPPER_PRIMARY';
  return 'OTHER';
};
const scoring = (rows) => validSubjectRows(rows).filter((row) => {
  const subjectType = String(row.subjectType ?? row.subject_type ?? '').trim().toUpperCase();
  if (row.active === false || Number(row.active) === 0 || row.isScoring === false || Number(row.isScoring) === 0 || subjectType === 'NON_SCORING' || NON_SCORING.has(nameOf(row))) return false;
  return subjectType || row.isScoring !== undefined ? true : !NON_SCORING.has(nameOf(row));
});
const numericGrade = (row, classId, examination) => {
  const supplied = Number(row.grade);
  if (Number.isInteger(supplied) && supplied >= 1 && supplied <= 9) return supplied;
  return Number(gradeForTotal(validateScore(row.totalScore), { classId, examination })[0]);
};
const stableId = (item) => String(item.studentId ?? item.id ?? '');

export function calculateAggregate(rows, { classId = '', examination = 'TERMINAL' } = {}) {
  const level = levelOf(classId);
  if (level === 'KG') return { aggregate: null, aggregateSubjects: [], aggregateTotal: null, aggregateMaximum: KG_TOTAL_MAXIMUM, qualifying: true, aggregateStatus: 'KG_TOTAL' };
  if (!CORE_BY_LEVEL[level]) return { aggregate: null, aggregateSubjects: [], qualifying: false, aggregateStatus: 'INCOMPLETE' };
  const eligible = scoring(rows);
  const coreSpecs = CORE_BY_LEVEL[level];
  const core = coreSpecs.map((names) => eligible.find((row) => names.includes(nameOf(row))));
  const coreNames = coreSpecs.flat();
  if (core.some((row) => !row)) return { aggregate: null, aggregateSubjects: core.filter(Boolean), qualifying: false, aggregateStatus: 'INCOMPLETE' };
  const electives = eligible.filter((row) => !coreNames.includes(nameOf(row)));
  if (electives.length < 2) return { aggregate: null, aggregateSubjects: core, qualifying: false, aggregateStatus: 'INCOMPLETE' };
  // Grade points decide first. Only when grade points tie do higher raw marks
  // win; exact ties resolve by normalized subject name, then canonical ID.
  const best = [...electives].sort((a, b) => numericGrade(a, classId, examination) - numericGrade(b, classId, examination)
    || validateScore(b.totalScore) - validateScore(a.totalScore)
    || compareText(nameOf(a), nameOf(b))
    || compareText(String(a.subjectId ?? a.id ?? ''), String(b.subjectId ?? b.id ?? ''))).slice(0, 2);
  const selected = [...core, ...best];
  const aggregate = selected.reduce((sum, row) => sum + numericGrade(row, classId, examination), 0);
  const aggregateTotal = selected.reduce((sum, row) => sum + validateScore(row.totalScore), 0);
  return { aggregate, aggregateSubjects: selected, aggregateTotal, aggregateCoreGradeSum: core.reduce((sum, row) => sum + numericGrade(row, classId, examination), 0), aggregateMaximum: 54, qualifying: true, aggregateStatus: 'COMPLETE' };
}

export function calculateStudentResult(rows = [], options = {}) {
  const level = levelOf(options.classId);
  const allScoring = scoring(rows);
  const seenKgSubjects = new Set();
  const valid = level === 'KG' ? allScoring.filter((row) => {
    const name = nameOf(row);
    if (!KG_PARENT_SUBJECTS.has(name) || seenKgSubjects.has(name)) return false;
    seenKgSubjects.add(name);
    return true;
  }) : allScoring;
  const totalScore = valid.reduce((sum, row) => sum + validateScore(row.totalScore), 0);
  const average = valid.length ? Number((totalScore / valid.length).toFixed(2)) : null;
  const aggregate = calculateAggregate(rows, options);
  const percentage = level === 'KG' && valid.length === KG_PARENT_SUBJECTS.size ? Number(((totalScore / KG_TOTAL_MAXIMUM) * 100).toFixed(2)) : null;
  return { totalScore, totalMaximum: level === 'KG' ? KG_TOTAL_MAXIMUM : null, percentage, average, subjectsSat: valid.length, ...aggregate };
}

export function calculateClassPositions(studentResults = [], { classId = '' } = {}) {
  const level = levelOf(classId);
  const aggregateRanking = level === 'JHS' || level === 'LOWER_PRIMARY' || level === 'UPPER_PRIMARY';
  const sorted = [...studentResults].sort((a, b) => {
    if (aggregateRanking && a.aggregate != null && b.aggregate != null && a.aggregate !== b.aggregate) return a.aggregate - b.aggregate;
    if (aggregateRanking && a.aggregate != null && b.aggregate != null && a.aggregate === b.aggregate && a.aggregateTotal !== b.aggregateTotal) return b.aggregateTotal - a.aggregateTotal;
    if (aggregateRanking && a.aggregateCoreGradeSum != null && b.aggregateCoreGradeSum != null && a.aggregateCoreGradeSum !== b.aggregateCoreGradeSum) return a.aggregateCoreGradeSum - b.aggregateCoreGradeSum;
    return Number(b.totalScore || 0) - Number(a.totalScore || 0) || stableId(a).localeCompare(stableId(b));
  });
  const positionFor = (index) => {
    if (index === 0) return 1;
    const previous = sorted[index - 1]; const current = sorted[index];
    const same = aggregateRanking && previous.aggregate != null && previous.aggregate === current.aggregate
      ? previous.aggregateTotal === current.aggregateTotal && previous.aggregateCoreGradeSum === current.aggregateCoreGradeSum
      : Number(previous.totalScore || 0) === Number(current.totalScore || 0);
    return same ? sorted.findIndex((item) => item === previous) + 1 : index + 1;
  };
  return new Map(sorted.map((item, index) => [item.studentId, ordinalPosition(positionFor(index))]));
}
export function calculateCanonicalResult(rows, options = {}) {
  const result = calculateStudentResult(rows, options);
  return { ...result, subjects: subjectPositions(rows, options.cohortRows ?? []) };
}
export { levelOf, nameOf };
