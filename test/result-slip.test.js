import test from 'node:test';
import assert from 'node:assert/strict';
import { averageScore, assessmentLibraryStatus, assessmentStorageKey, ordinalPosition, subjectPositions, termAttendance } from '../src/result-slip.js';

test('result-slip average excludes invalid, blank, placeholder, and unsubmitted rows', () => {
  assert.equal(averageScore([{ subjectId:'Math', totalScore:80 }, { subjectId:'English', totalScore:60 }, { subjectId:'', totalScore:100 }, { subjectId:'Science', totalScore:90, placeholder:true }, { subjectId:'ICT', totalScore:90, submitted:false }]), 70);
});

test('subject positions are isolated by subject cohort and ties share deterministic rank', () => {
  const mine = subjectPositions([{ subjectId:'Math', totalScore:90 }, { subjectId:'English', totalScore:80 }], [{ subjectId:'Math', totalScore:90 }, { subjectId:'Math', totalScore:80 }, { subjectId:'English', totalScore:80 }]);
  assert.deepEqual(mine.map((x) => x.subjectPosition), ['1st', '1st']);
  assert.equal(subjectPositions([{ subjectId:'Math', totalScore:80 }], [{ subjectId:'Math', totalScore:90 }, { subjectId:'Math', totalScore:80 }])[0].subjectPosition, '2nd');
});

test('ordinal positions and term attendance preserve readable output and term isolation', () => {
  assert.equal(ordinalPosition(1), '1st'); assert.equal(ordinalPosition(12), '12th'); assert.equal(ordinalPosition(23), '23rd');
  assert.deepEqual(termAttendance([{term:'First Term',status:'PRESENT'},{term:'First Term',status:'ABSENT'},{term:'Second Term',status:'PRESENT'}], 'First Term'), { timesPresent:1, timesAbsent:1, totalSchoolDays:2 });
});

test('assessment persistence key isolates student, year, term, class, and examination', () => {
  const a = assessmentStorageKey({ schoolId:'school-a', studentId:'student-a', academicYear:'2026/2027', term:'First Term', classId:'Primary 1', examinationType:'TERMINAL' });
  const b = assessmentStorageKey({ schoolId:'school-a', studentId:'student-a', academicYear:'2026/2027', term:'Second Term', classId:'Primary 1', examinationType:'TERMINAL' });
  assert.notEqual(a, b); assert.equal(a.split(':').length, 7);
});

test('EduTrack library audit refuses to claim unverified 30/30 parity', () => {
  assert.equal(assessmentLibraryStatus.authoritative, false);
  assert.equal(assessmentLibraryStatus.positiveCount, 0);
  assert.equal(assessmentLibraryStatus.negativeCount, 0);
});
