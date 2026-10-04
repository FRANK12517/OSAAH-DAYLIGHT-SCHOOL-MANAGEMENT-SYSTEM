import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubjectConfigurationPreview } from '../src/platform/subject-configuration-preview.js';
import { DEFAULT_ACADEMIC_CLASSES, defaultSubjectsForClass } from '../src/default-subject-catalog.js';

const classes = DEFAULT_ACADEMIC_CLASSES.map((name, index) => ({ id: `class-${index + 1}`, name }));
const subjectDefinitions = new Map();
for (const className of DEFAULT_ACADEMIC_CLASSES) {
  for (const definition of defaultSubjectsForClass(className).filter((subject) => subject.activeByDefault !== false)) {
    const key = definition.name.toLocaleLowerCase('en');
    if (!subjectDefinitions.has(key)) subjectDefinitions.set(key, { id: `subject-${subjectDefinitions.size + 1}`, name: definition.name, isActive: 1, subjectType: definition.subjectType, isScoring: definition.isScoring ? 1 : 0 });
  }
}
const subjects = [...subjectDefinitions.values()];
function assignmentsFor(yearId = null) {
  return classes.flatMap((classRow) => defaultSubjectsForClass(classRow.name)
    .filter((definition) => definition.activeByDefault !== false)
    .map((definition, index) => ({
      id: `${yearId ?? 'default'}-${classRow.id}-${index}`,
      schoolId: 'school-osaah-daylight',
      classId: classRow.id,
      className: classRow.name,
      subjectId: subjectDefinitions.get(definition.name.toLocaleLowerCase('en')).id,
      subjectName: definition.name,
      academicYearId: yearId,
      active: 1
    })));
}

const academicYear = { id: 'year-2026', name: '2026/2027' };

test('approved preview reports 13 classes, 105 assignment slots and 18 distinct subject names', () => {
  const preview = buildSubjectConfigurationPreview({ classes, subjects, assignments: assignmentsFor(), academicYear });
  assert.equal(preview.expectedBaseline.classCount, 13);
  assert.equal(preview.expectedBaseline.assignmentSlots, 105);
  assert.equal(preview.expectedBaseline.distinctSubjectNames, 18);
  assert.equal(preview.missingClasses.length, 0);
  assert.equal(preview.missingSubjects.length, 0);
  assert.equal(preview.missingAssignments.length, 0);
  assert.equal(preview.actualCounts.effectiveActiveBaselineAssignments, 105);
  assert.equal(preview.applyPreflightReady, true);
  assert.equal(preview.productionWrites, 0);
});

test('year overrides take precedence and assignments from other academic years do not leak', () => {
  const current = assignmentsFor();
  const override = { ...current[0], id: 'year-override', academicYearId: academicYear.id, active: 0 };
  const otherYear = { ...current[1], id: 'other-year', academicYearId: 'year-2027' };
  const preview = buildSubjectConfigurationPreview({ classes, subjects, assignments: [...current, override, otherYear], academicYear });
  assert.equal(preview.inactiveAssignments.some((item) => item.classId === classes[0].id && item.subjectName === current[0].subjectName), true);
  assert.equal(preview.duplicateDetection.duplicateAssignments.length, 0);
  assert.equal(preview.actualCounts.effectiveActiveBaselineAssignments, 104);
});

test('preview lists missing subjects and assignments and preserves Nursery rows without proposing changes', () => {
  const currentSubjects = subjects.slice(1);
  const currentAssignments = assignmentsFor().filter((item) => !item.className.startsWith('Nursery')).slice(1);
  const preview = buildSubjectConfigurationPreview({ classes, subjects: currentSubjects, assignments: currentAssignments, academicYear });
  assert.ok(preview.missingSubjects.length > 0);
  assert.ok(preview.missingAssignments.length > 0);
  assert.equal(preview.nurseryPreservation.rowsToChange, 0);
  assert.equal(preview.nurseryPreservation.assignments.length, 0);
  assert.equal(preview.expectedAfterCounts.effectiveBaselineAssignments, 105);
});

test('empty-school preview projects the complete approved subject and assignment baseline', () => {
  const preview = buildSubjectConfigurationPreview({ classes, subjects: [], assignments: [], academicYear });
  assert.equal(preview.missingSubjects.length, 105, 'subject gaps are reported by class while shared records are projected by name');
  assert.equal(new Set(preview.missingSubjects.map((item) => item.subjectName.toLocaleLowerCase('en'))).size, 18);
  assert.equal(preview.missingAssignments.length, 105);
  assert.equal(preview.expectedAfterCounts.subjectRecords, 18);
  assert.equal(preview.expectedAfterCounts.assignmentRowsInScope, 105);
  assert.deepEqual(preview.classes.map((item) => item.effectiveActiveSlots), Array(13).fill(0));
});

test('duplicate subject names and assignment scopes block apply preflight', () => {
  const duplicateSubject = { ...subjects[0], id: `${subjects[0].id}-duplicate` };
  const completeAssignments = assignmentsFor();
  const duplicateAssignment = { ...completeAssignments[0], id: `${completeAssignments[0].id}-duplicate` };
  const preview = buildSubjectConfigurationPreview({ classes, subjects: [...subjects, duplicateSubject], assignments: [...completeAssignments, duplicateAssignment], academicYear });
  assert.equal(preview.duplicateDetection.duplicateSubjects.length, 1);
  assert.equal(preview.duplicateDetection.duplicateAssignments.length, 1);
  assert.equal(preview.applyPreflightReady, false);
});

test('duplicate canonical class records block apply before the sync can create extra assignments', () => {
  const preview = buildSubjectConfigurationPreview({ classes: [...classes, { id: 'class-primary-1-alias', name: 'Basic 1' }], subjects, assignments: assignmentsFor(), academicYear });
  assert.deepEqual(preview.duplicateDetection.duplicateClasses, [{ canonicalName: 'Primary 1', recordIds: ['class-5', 'class-primary-1-alias'] }]);
  assert.equal(preview.applyPreflightReady, false);
});

assert.equal(classes.length, 13);
