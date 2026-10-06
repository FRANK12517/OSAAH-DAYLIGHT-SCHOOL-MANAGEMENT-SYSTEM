import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateAggregate, calculateStudentResult, calculateClassPositions } from '../src/result-calculation.js';
import { gradeForTotal } from '../src/grading.js';

test('JHS grade boundaries use the authoritative scale', () => {
  const expected = [[100,1],[80,1],[79,2],[70,2],[69,3],[60,3],[59,4],[55,4],[54,4],[50,4],[49,5],[45,5],[44,6],[40,6],[39,7],[35,7],[34,8],[25,8],[24,9],[0,9]];
  for (const [mark, grade] of expected) assert.equal(gradeForTotal(mark, { classId: 'JHS 1', examination: 'TERMINAL' })[0], grade);
});

test('JHS aggregate includes Core Four and best two eligible electives', () => {
  const rows = [
    ['English Language', 1], ['Mathematics', 2], ['Science', 1], ['Social Studies', 3],
    ['RME', 1], ['Fantse', 2], ['Creative Arts', 4], ['Computing', 1],
  ].map(([subjectName, grade]) => ({ subjectId: subjectName, subjectName, grade, totalScore: 90 }));
  const result = calculateAggregate(rows, { classId: 'JHS 2' });
  assert.equal(result.aggregate, 9); assert.deepEqual(result.aggregateSubjects.map((row) => row.subjectName), ['English Language', 'Mathematics', 'Science', 'Social Studies', 'RME', 'Computing']);
});

test('KG has no aggregate and ranks by raw total score', () => {
  assert.equal(calculateAggregate([{ subjectName: 'Language', totalScore: 90 }], { classId: 'KG1' }).aggregate, null);
  const positions = calculateClassPositions([{ studentId: 'a', totalScore: 355 }, { studentId: 'b', totalScore: 340 }, { studentId: 'c', totalScore: 330 }], { classId: 'KG1' });
  assert.equal(positions.get('a'), '1st'); assert.equal(positions.get('c'), '3rd');
});

test('canonical subject metadata excludes non-scoring subjects without relying on display names', () => {
  const result = calculateStudentResult([
    { subjectId: 'sports', subjectName: 'Sports and Wellness', subjectType: 'NON_SCORING', isScoring: 0, totalScore: 100 },
    { subjectId: 'english', subjectName: 'English Language', subjectType: 'CORE', isScoring: 1, totalScore: 80 }
  ], { classId: 'Primary 4' });
  assert.equal(result.subjectsSat, 2);
  assert.equal(result.totalScore, 80);
});

test('Subjects Sat counts valid submitted subjects, not only scoring subjects or Best Six selections', () => {
  const rows = [
    ['English Language', 80], ['Mathematics', 80], ['Science', 80], ['Social Studies', 80],
    ['RME', 80], ['Computing', 80], ['Physical Education', 80], ['French', 80]
  ].map(([subjectName, totalScore]) => ({ subjectId: subjectName, subjectName, totalScore }));
  const result = calculateStudentResult(rows, { classId: 'JHS 2' });
  assert.equal(result.subjectsSat, 8);
  assert.equal(result.aggregateSubjects.length, 6);
});

test('Subjects Sat is dynamic, ignores missing rows, preserves zero, and counts one duplicate subject once', () => {
  const result = calculateStudentResult([
    { subjectId: 'a', totalScore: 0 }, { subjectId: 'b', totalScore: 1 }, { subjectId: 'c', totalScore: 2 },
    { subjectId: 'd', totalScore: 3 }, { subjectId: 'e', totalScore: 4 }, { subjectId: 'f', totalScore: 5 },
    { subjectId: 'g', totalScore: 6 }, { subjectId: 'h', totalScore: 7 }, { subjectId: 'h', totalScore: 7 },
    { subjectId: 'missing', totalScore: null }, { subjectId: 'blank', totalScore: 10, submitted: false },
    { subjectId: 'placeholder', totalScore: 10, placeholder: true }
  ], { classId: 'Primary 4' });
  assert.equal(result.subjectsSat, 8);
  assert.equal(result.totalScore, 35);
  const seven = calculateStudentResult(Array.from({ length: 7 }, (_, index) => ({ subjectId: `s${index}`, totalScore: 50 })), { classId: 'Primary 4' });
  assert.equal(seven.subjectsSat, 7);
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
