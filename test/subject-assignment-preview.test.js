import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { CANONICAL_CLASS_IDS } from '../src/student-classes.js';
import { buildSubjectAssignmentPreview } from '../src/platform/subject-assignment-preview.js';

const classes = CANONICAL_CLASS_IDS.map((name, index) => ({ id: `class-${index + 1}`, name }));
const subjects = [
  { id: 'english', name: 'English Language', subjectType: 'CORE', isActive: 1 },
  { id: 'math', name: 'Mathematics', subjectType: 'CORE', isActive: 1 },
  { id: 'numeracy', name: 'Numeracy', subjectType: 'CORE', isActive: 1 },
  { id: 'dup-english', name: ' english language ', subjectType: 'CORE', isActive: 1 },
  { id: 'french', name: 'French', subjectType: 'ELECTIVE', isActive: 1 }
];
const assignments = [
  { id: 'nursery-english', classId: 'class-1', className: 'Nursery 1', subjectId: 'english', subjectName: 'English Language', academicYearId: null, active: 1 },
  { id: 'nursery-inactive', classId: 'class-1', className: 'Nursery 1', subjectId: 'math', subjectName: 'Mathematics', academicYearId: null, active: 0 },
  { id: 'kg-english', classId: 'class-3', className: 'KG1', subjectId: 'english', subjectName: 'English Language', academicYearId: null, active: 1 },
  { id: 'kg-numeracy-inactive', classId: 'class-3', className: 'KG1', subjectId: 'numeracy', subjectName: 'Numeracy', academicYearId: null, active: 0 }
];

test('preview covers all thirteen canonical classes and expected curriculum bands', () => {
  const preview = buildSubjectAssignmentPreview({ classes, subjects, assignments, academicYear: { id: 'year-current', name: '2026/2027' } });
  assert.equal(preview.classCount, 13);
  assert.equal(preview.presentClassCount, 13);
  assert.deepEqual(preview.missingClasses, []);
  assert.deepEqual(preview.classes.map((row) => row.className), CANONICAL_CLASS_IDS);
  assert.ok(preview.classes.some((row) => row.className === 'KG1'));
  assert.ok(preview.classes.some((row) => row.className === 'Primary 1'));
  assert.ok(preview.classes.some((row) => row.className === 'Primary 4'));
  assert.ok(preview.classes.some((row) => row.className === 'JHS 1'));
});

test('Nursery rows remain unchanged and every proposed assignment uses the default academic-year scope', () => {
  const preview = buildSubjectAssignmentPreview({ classes, subjects, assignments, academicYear: { id: 'year-current', name: '2026/2027' } });
  assert.equal(preview.expectedChanges.existingNurseryRowsToChange, 0);
  assert.deepEqual(preview.preservedNurseryAssignments.map((row) => [row.subjectName, row.active]).sort(), [['English Language', true], ['Mathematics', false]]);
  assert.equal(preview.proposedAssignments.some((row) => row.className === 'Nursery 1' && row.subjectName === 'Mathematics'), false);
  assert.ok(preview.proposedAssignments.every((row) => row.academicYearId === null && row.academicYearScope === 'SCHOOL_DEFAULT_ALL_YEARS'));
  assert.equal(preview.academicYearScope.currentAcademicYearId, 'year-current');
  assert.equal(preview.academicYearScope.proposedAssignmentsUseAcademicYearId, null);
});

test('preview reports existing and proposed subjects, duplicates, missing approvals, and expected changes', () => {
  const preview = buildSubjectAssignmentPreview({ classes, subjects, assignments, academicYear: null });
  assert.ok(preview.existingSubjects.some((row) => row.name === 'English Language'));
  assert.ok(preview.proposedSubjects.some((row) => row.name === 'Integrated Science' && row.action === 'CREATE_SUBJECT'));
  assert.ok(preview.proposedAssignments.length > 0);
  assert.ok(preview.duplicateDetection.duplicateSubjects.some((row) => row.normalizedName === 'english language'));
  assert.ok(preview.missingApprovals.length > 0);
  assert.equal(preview.expectedChanges.assignmentRowsToCreate, preview.proposedAssignments.filter((row) => row.action === 'CREATE_ASSIGNMENT').length);
  assert.equal(preview.expectedChanges.assignmentRowsToReactivate, preview.proposedAssignments.filter((row) => row.action === 'REACTIVATE_EXISTING_ASSIGNMENT').length);
  assert.equal(preview.expectedChanges.totalProposedAssignmentActions, preview.proposedAssignments.length);
  assert.equal(preview.productionWrites, 'NONE');
  assert.equal(preview.expectedChanges.productionWrites, 0);
});

test('inactive non-Nursery defaults are proposed for explicit reactivation rather than duplicate insertion', () => {
  const preview = buildSubjectAssignmentPreview({ classes, subjects, assignments, academicYear: { id: 'year-current', name: '2026/2027' } });
  const proposal = preview.proposedAssignments.find((row) => row.className === 'KG1' && row.subjectName === 'Numeracy');
  assert.equal(proposal.id, 'kg-numeracy-inactive');
  assert.equal(proposal.action, 'REACTIVATE_EXISTING_ASSIGNMENT');
  assert.ok(preview.missingApprovals.some((item) => item.reason === 'SEPARATE_ASSIGNMENT_REACTIVATION_APPROVAL_REQUIRED'));
});

test('multiple inactive assignment scopes are reported for review rather than inserted', () => {
  const ambiguous = [
    ...assignments,
    { id: 'kg-numeracy-inactive-year', classId: 'class-3', className: 'KG1', subjectId: 'numeracy', subjectName: 'Numeracy', academicYearId: 'year-current', active: 0 }
  ];
  const preview = buildSubjectAssignmentPreview({ classes, subjects, assignments: ambiguous, academicYear: { id: 'year-current', name: '2026/2027' } });
  assert.equal(preview.proposedAssignments.some((row) => row.className === 'KG1' && row.subjectName === 'Numeracy'), false);
  assert.ok(preview.missingApprovals.some((item) => item.className === 'KG1' && item.subjectName === 'Numeracy' && item.reason === 'MULTIPLE_EXISTING_ASSIGNMENT_SCOPES_REQUIRE_HUMAN_REVIEW'));
});

test('production preview script is query-only and does not contain database writes or subject seeding', async () => {
  const script = await readFile(new URL('../scripts/production-subject-assignment-preview.mjs', import.meta.url), 'utf8');
  assert.match(script, /buildSubjectAssignmentPreview/);
  assert.match(script, /adapter\.query\(/);
  assert.doesNotMatch(script, /adapter\.execute\(|INSERT\s+INTO|UPDATE\s+subjects|DELETE\s+FROM|configureDefaultSubjects/i);
});
