import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateAggregate, calculateStudentResult, calculateClassPositions, lowerPrimaryGradePoint } from '../src/result-calculation.js';
import { gradeForTotal } from '../src/grading.js';

test('JHS grade boundaries use the authoritative scale', () => {
  const expected = [[100,1],[80,1],[79,2],[70,2],[69,3],[60,3],[59,4],[55,4],[54,5],[50,5],[49,6],[45,6],[44,7],[40,7],[39,8],[35,8],[34,9],[0,9]];
  for (const [mark, grade] of expected) assert.equal(gradeForTotal(mark, { classId: 'JHS 1', examination: 'TERMINAL' })[0], grade);
});

test('JHS aggregate includes Core Four and best two eligible electives', () => {
  const rows = [
    ['English Language', 1], ['Mathematics', 2], ['Science', 1], ['Social Studies', 3],
    ['RME', 1], ['Fantse', 2], ['Creative Arts', 4], ['Computing', 1],
  ].map(([subjectName, grade]) => ({ subjectId: subjectName, subjectName, grade, totalScore: 90 }));
  const result = calculateAggregate(rows, { classId: 'JHS 2' });
  assert.equal(result.aggregate, 10); assert.deepEqual(result.aggregateSubjects.map((row) => row.subjectName), ['English Language', 'Mathematics', 'Science', 'Social Studies', 'RME', 'Fantse']);
});

test('KG has no aggregate and ranks by raw total score', () => {
  assert.equal(calculateAggregate([{ subjectName: 'Language', totalScore: 90 }], { classId: 'KG1' }).aggregate, null);
  const positions = calculateClassPositions([{ studentId: 'a', totalScore: 355 }, { studentId: 'b', totalScore: 340 }, { studentId: 'c', totalScore: 330 }], { classId: 'KG1' });
  assert.equal(positions.get('a'), '1st'); assert.equal(positions.get('c'), '3rd');
});

test('Lower Primary grade-point mapping uses the approved A through I values', () => {
  for (const [grade, point] of Object.entries({ A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, I: 9 })) assert.equal(lowerPrimaryGradePoint(grade), point);
  assert.throws(() => lowerPrimaryGradePoint('Z'), /Invalid Lower Primary letter grade/);
  assert.throws(() => lowerPrimaryGradePoint(''), /Invalid Lower Primary letter grade/);
});

test('Lower Primary Best Six sums compulsory Core Four and the two best eligible grade points', () => {
  const makeRows = (grades) => ['English Language', 'Mathematics', 'Science', 'History', 'RME', 'Creative Arts', 'Fantse']
    .map((subjectName, index) => ({ subjectName, subjectId: subjectName, totalScore: 90 - index, grade: grades[index] }));
  const allA = calculateAggregate(makeRows(['A', 'A', 'A', 'A', 'A', 'A', 'I']), { classId: 'Primary 1' });
  assert.equal(allA.aggregate, 6);
  assert.equal(allA.aggregateSubjects.length, 6);
  assert.equal(allA.aggregateSubjects.some((row) => row.subjectName === 'Fantse'), false);
  assert.equal(Number.isNaN(allA.aggregate), false);
  assert.equal(JSON.parse(JSON.stringify({ aggregate: allA.aggregate })).aggregate, 6);

  const mixed = calculateAggregate(makeRows(['A', 'B', 'B', 'C', 'C', 'D', 'I']), { classId: 'Basic 2' });
  assert.equal(mixed.aggregate, 15);
  assert.equal(mixed.aggregateSubjects.length, 6);
  assert.equal(mixed.aggregateSubjects.some((row) => row.subjectName === 'Fantse'), false);
  assert.equal(JSON.parse(JSON.stringify({ aggregate: mixed.aggregate })).aggregate, 15);
});

test('Lower Primary qualifying aggregate rejects an unknown letter instead of assigning a point', () => {
  const rows = ['English Language', 'Mathematics', 'Science', 'History', 'RME', 'Creative Arts']
    .map((subjectName, index) => ({ subjectId: subjectName, subjectName, totalScore: 90 - index, grade: index === 4 ? 'Z' : 'A' }));
  assert.throws(() => calculateAggregate(rows, { classId: 'Primary 1' }), /Invalid Lower Primary/);
  assert.throws(() => lowerPrimaryGradePoint(5), /Invalid Lower Primary letter grade/);
});

test('approved Lower Primary aggregate conversion does not alter KG or JHS calculation', () => {
  assert.equal(calculateAggregate([{ subjectId: 'Language', subjectName: 'Language', totalScore: 90, grade: 'A' }], { classId: 'Nursery1' }).aggregate, null);
  assert.equal(calculateAggregate([{ subjectName: 'Language', totalScore: 90, grade: 'A' }], { classId: 'KG1' }).aggregate, null);
  assert.equal(calculateAggregate([{ subjectId: 'Language', subjectName: 'Language', totalScore: 90, grade: 'A' }], { classId: 'Primary 4' }).aggregate, null);
  const jhsRows = [['English Language', 1], ['Mathematics', 2], ['Science', 1], ['Social Studies', 3], ['RME', 1], ['Fantse', 2]]
    .map(([subjectName, grade]) => ({ subjectId: subjectName, subjectName, grade, totalScore: 90 }));
  assert.equal(calculateAggregate(jhsRows, { classId: 'JHS 1' }).aggregate, 10);
});

test('JHS class position ranks by lower aggregate, then higher selected-six total', () => {
  const positions = calculateClassPositions([{ studentId: 'a', aggregate: 10, aggregateTotal: 500, aggregateCoreGradeSum: 7, totalScore: 600 }, { studentId: 'b', aggregate: 10, aggregateTotal: 490, aggregateCoreGradeSum: 7, totalScore: 610 }, { studentId: 'c', aggregate: 12, aggregateTotal: 600, aggregateCoreGradeSum: 8, totalScore: 700 }], { classId: 'JHS 1' });
  assert.equal(positions.get('a'), '1st'); assert.equal(positions.get('b'), '2nd'); assert.equal(positions.get('c'), '3rd');
});

test('result slip and existing report table expose canonical summary fields', () => {
  const renderer = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8'); const report = fs.readFileSync(new URL('../public/reports-academic.html', import.meta.url), 'utf8');
  for (const label of ['TOTAL SCORE', 'AGGREGATE', 'CLASS POSITION', 'SUBJECTS SAT', 'AVERAGE SCORE']) assert.match(renderer, new RegExp(label));
  for (const label of ['OSAAH STUDENT INDEX', 'STUDENT NAME', 'TOTAL SCORE', 'AGGREGATE', 'CLASS POSITION']) assert.match(report, new RegExp(label));
});
