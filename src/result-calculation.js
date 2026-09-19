import { gradeForTotal } from './grading.js';
import { ordinalPosition, subjectPositions, validSubjectRows } from './result-slip.js';

const CORE_FOUR = ['english language', 'mathematics', 'science', 'integrated science', 'social studies'];
const JHS_CORE = ['english language', 'mathematics', 'science', 'integrated science', 'social studies'];
const LOWER_CORE = ['english language', 'mathematics', 'science', 'history'];
const JHS_EXCLUDED = new Set(['computing', 'french']);
const NON_SCORING = new Set(['physical education', 'pe']);
const nameOf = (row) => String(row.subjectName ?? row.name ?? row.subjectId ?? '').trim().toLowerCase();
const levelOf = (classId) => { const value = String(classId ?? '').toUpperCase(); if (value.startsWith('JHS')) return 'JHS'; if (value.startsWith('KG')) return 'KG'; if (/^(PRIMARY|BASIC)\s*[1-3]$/.test(value)) return 'LOWER_PRIMARY'; return value.startsWith('PRIMARY') || value.startsWith('BASIC') ? 'UPPER_PRIMARY' : 'OTHER'; };
const scoring = (rows) => validSubjectRows(rows).filter((row) => !NON_SCORING.has(nameOf(row)));
const numericGrade = (row, classId, examination) => { const value = Number(row.grade); return Number.isFinite(value) ? value : Number(gradeForTotal(row.totalScore, { classId, examination })[0]); };

export function calculateAggregate(rows, { classId = '', examination = 'TERMINAL' } = {}) {
  const level = levelOf(classId); if (level === 'KG' || level === 'OTHER' || level === 'UPPER_PRIMARY') return { aggregate: null, aggregateSubjects: [], qualifying: false };
  const eligible = scoring(rows); const coreSpecs = level === 'JHS' ? [['english language'], ['mathematics'], ['science', 'integrated science'], ['social studies']] : LOWER_CORE.map((name) => [name]); const core = coreSpecs.map((names) => eligible.find((row) => names.includes(nameOf(row)))); const coreNames = coreSpecs.flat();
  if (core.some((row) => !row)) return { aggregate: null, aggregateSubjects: core.filter(Boolean), qualifying: false };
  const electives = eligible.filter((row) => !coreNames.includes(nameOf(row)) && !(level === 'JHS' && JHS_EXCLUDED.has(nameOf(row))));
  if (electives.length < 2) return { aggregate: null, aggregateSubjects: core, qualifying: false };
  const best = [...electives].sort((a, b) => numericGrade(a, classId, examination) - numericGrade(b, classId, examination)).slice(0, 2);
  const selected = [...core, ...best]; return { aggregate: selected.reduce((sum, row) => sum + numericGrade(row, classId, examination), 0), aggregateSubjects: selected, qualifying: true };
}

export function calculateStudentResult(rows = [], options = {}) {
  const valid = scoring(rows); const totalScore = valid.reduce((sum, row) => sum + Number(row.totalScore), 0); const average = valid.length ? Number((totalScore / valid.length).toFixed(2)) : null; const aggregate = calculateAggregate(rows, options); return { totalScore, average, subjectsSat: valid.length, ...aggregate };
}

export function calculateClassPositions(studentResults = [], { classId = '' } = {}) {
  const level = levelOf(classId); const sorted = [...studentResults].sort((a, b) => { if (level === 'JHS' && a.aggregate != null && b.aggregate != null && a.aggregate !== b.aggregate) return a.aggregate - b.aggregate; if (level === 'JHS' && a.aggregate != null && b.aggregate != null && a.aggregate === b.aggregate && a.aggregateTotal !== b.aggregateTotal) return b.aggregateTotal - a.aggregateTotal; if (level === 'JHS' && a.aggregateCoreGradeSum != null && b.aggregateCoreGradeSum != null && a.aggregateCoreGradeSum !== b.aggregateCoreGradeSum) return a.aggregateCoreGradeSum - b.aggregateCoreGradeSum; return Number(b.totalScore || 0) - Number(a.totalScore || 0); });
  const positionFor = (index) => { if (index === 0) return 1; const previous = sorted[index - 1]; const current = sorted[index]; const same = level === 'JHS' && previous.aggregate === current.aggregate ? previous.aggregateTotal === current.aggregateTotal && previous.aggregateCoreGradeSum === current.aggregateCoreGradeSum : Number(previous.totalScore || 0) === Number(current.totalScore || 0); return same ? sorted.findIndex((item) => item === previous) + 1 : index + 1; };
  return new Map(sorted.map((item, index) => [item.studentId, ordinalPosition(positionFor(index))]));
}

export function calculateCanonicalResult(rows, options = {}) { const result = calculateStudentResult(rows, options); const positionedSubjects = subjectPositions(rows, options.cohortRows ?? []); return { ...result, subjects: positionedSubjects }; }
export { levelOf, nameOf };
