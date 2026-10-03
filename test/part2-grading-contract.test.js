import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAggregate, calculateClassPositions, calculateStudentResult } from '../src/result-calculation.js';
import { gradeForTotal, validateScore, KG_TOTAL_MAXIMUM } from '../src/grading.js';

const row = (subjectName, totalScore, extra = {}) => ({ subjectId: subjectName.toLowerCase().replace(/\s+/g, '-'), subjectName, totalScore, ...extra });
const lowerCore = [row('English Language', 80), row('Mathematics', 70), row('Science', 60), row('History', 55)];
const upperCore = [row('English Language', 80), row('Mathematics', 70), row('Integrated Science', 60), row('History', 55)];
const jhsCore = [row('English Language', 80), row('Mathematics', 70), row('Integrated Science', 60), row('Social Studies', 50)];

test('central score validation rejects missing, negative, and above-maximum marks while preserving decimals', () => {
  assert.equal(validateScore('79.5'), 79.5);
  assert.throws(() => validateScore(-0.01), /between 0 and 100/);
  assert.throws(() => validateScore(100.01), /between 0 and 100/);
  assert.throws(() => validateScore('not a score'), /between 0 and 100/);
});

test('KG totals four subjects out of 400 and never use Best Six', () => {
  const result = calculateStudentResult([row('Language and Literacy', 90), row('Numeracy', 85), row('Our World, Our People', 95), row('Creative Arts', 85)], { classId: 'KG2' });
  assert.equal(result.totalScore, 355);
  assert.equal(result.totalMaximum, KG_TOTAL_MAXIMUM);
  assert.equal(result.aggregate, null);
  assert.equal(result.aggregateStatus, 'KG_TOTAL');
});

test('lower and upper primary require their configured core subjects and exactly two electives', () => {
  assert.equal(calculateAggregate([...lowerCore, row('RME', 80), row('Fantse', 75)], { classId: 'Basic 1' }).aggregate, 1 + 2 + 3 + 4 + 1 + 2);
  assert.equal(calculateAggregate([...upperCore, row('RME', 80), row('Computing', 75)], { classId: 'Basic 4' }).aggregate, 1 + 2 + 3 + 4 + 1 + 2);
  assert.equal(calculateAggregate([...upperCore, row('Science', 99), row('RME', 80), row('Computing', 75)], { classId: 'Basic 4' }).aggregateStatus, 'COMPLETE');
  assert.equal(calculateAggregate([...upperCore, row('RME', 80)], { classId: 'Basic 4' }).aggregateStatus, 'INCOMPLETE');
});

test('JHS boundaries include every supplied threshold and decimal scores are consistent', () => {
  for (const [score, grade] of [[80, 1], [79.99, 2], [70, 2], [60, 3], [50, 4], [45, 5], [40, 6], [35, 7], [25, 8], [24.99, 9]]) {
    assert.equal(gradeForTotal(score, { classId: 'JHS 1', examination: 'MOCK' })[0], grade);
  }
  assert.equal(calculateAggregate([...jhsCore, row('Computing', 90), row('French', 89)], { classId: 'JHS 1' }).aggregate, 1 + 2 + 3 + 4 + 1 + 1);
});

test('equal elective grades use deterministic subject ordering and class ties remain stable', () => {
  const result = calculateAggregate([...jhsCore, row('RME', 70), row('Computing', 70), row('French', 70)], { classId: 'JHS 1' });
  assert.deepEqual(result.aggregateSubjects.slice(-2).map((item) => item.subjectName), ['RME', 'Computing']);
  const positions = calculateClassPositions([
    { studentId: 'student-b', totalScore: 90 },
    { studentId: 'student-a', totalScore: 90 }
  ], { classId: 'KG1' });
  assert.equal(positions.get('student-a'), '1st');
  assert.equal(positions.get('student-b'), '1st');
});

test('historical result rows retain their stored grade while new rules apply only to new calculations', () => {
  const historical = row('English Language', 79, { grade: 4, gradingConfigurationVersion: 0 });
  const result = calculateStudentResult([historical, row('Mathematics', 80), row('Science', 80), row('History', 80), row('RME', 80), row('Computing', 80)], { classId: 'Basic 1' });
  assert.equal(result.aggregateSubjects[0].grade, 4);
  assert.equal(result.aggregateStatus, 'COMPLETE');
});
