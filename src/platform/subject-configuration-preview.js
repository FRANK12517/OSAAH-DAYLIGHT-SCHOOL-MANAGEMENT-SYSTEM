import {
  canonicalAcademicClass,
  defaultSubjectsForClass,
  DEFAULT_ACADEMIC_CLASSES,
  DEFAULT_SUBJECT_ASSIGNMENT_SLOTS,
  DEFAULT_DISTINCT_SUBJECT_NAMES
} from '../default-subject-catalog.js';

const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('en');
const id = (value) => String(value ?? '').trim();
const isActive = (value) => Number(value ?? 1) !== 0;

/** Build an auditable comparison only; no database adapter or write path is accepted. */
export function buildSubjectConfigurationPreview({ classes = [], subjects = [], assignments = [], academicYear = null } = {}) {
  const classByName = new Map();
  const classRows = [];
  const classGroups = new Map();
  for (const row of classes) {
    const canonicalName = canonicalAcademicClass(row.name ?? row.className ?? row.id);
    if (!canonicalName) continue;
    const group = classGroups.get(canonicalName) ?? [];
    group.push(id(row.id));
    classGroups.set(canonicalName, group);
    if (classByName.has(canonicalName)) continue;
    const normalized = { ...row, canonicalName };
    classByName.set(canonicalName, normalized);
    classRows.push(normalized);
  }
  const duplicateClasses = [...classGroups.entries()].filter(([, ids]) => ids.length > 1).map(([canonicalName, ids]) => ({ canonicalName, recordIds: ids }));

  const subjectsByName = new Map();
  for (const subject of subjects) {
    const key = normalize(subject.name);
    if (!key) continue;
    const list = subjectsByName.get(key) ?? [];
    list.push(subject);
    subjectsByName.set(key, list);
  }

  const relevantAssignments = assignments.filter((assignment) => {
    const scope = assignment.academicYearId ?? assignment.academic_year_id ?? null;
    return scope == null || String(scope) === String(academicYear?.id ?? '');
  });
  const canonicalClassOf = (assignment) => canonicalAcademicClass(
    assignment.className ?? assignment.class_name ?? classes.find((row) => id(row.id) === id(assignment.classId ?? assignment.class_id))?.name ?? assignment.classId ?? assignment.class_id
  );
  const subjectNameOf = (assignment) => assignment.subjectName ?? assignment.subject_name ?? subjects.find((subject) => id(subject.id) === id(assignment.subjectId ?? assignment.subject_id))?.name;
  const assignmentScopes = new Map();
  const allAssignmentsForNursery = [];
  for (const assignment of relevantAssignments) {
    const className = canonicalClassOf(assignment);
    const subjectName = subjectNameOf(assignment);
    if (!className || !subjectName) continue;
    const subjectId = id(assignment.subjectId ?? assignment.subject_id);
    const yearId = assignment.academicYearId ?? assignment.academic_year_id ?? null;
    const scopeKey = `${className}\u0000${normalize(subjectName)}\u0000${yearId ?? ''}`;
    const scopedRows = assignmentScopes.get(scopeKey) ?? [];
    scopedRows.push(assignment);
    assignmentScopes.set(scopeKey, scopedRows);
    if (className.startsWith('Nursery')) {
      allAssignmentsForNursery.push({ id: assignment.id ?? null, classId: id(assignment.classId ?? assignment.class_id), className, subjectId, subjectName, academicYearId: yearId, active: isActive(assignment.active), action: 'PRESERVE_UNCHANGED' });
    }
  }

  const duplicateSubjects = [...subjectsByName.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([normalizedName, records]) => ({ normalizedName, records: records.map((record) => ({ id: record.id, name: record.name })) }));
  const duplicateAssignments = [...assignmentScopes.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([key, records]) => {
      const [className, subjectName, academicYearId] = key.split('\u0000');
      return { className, subjectName, academicYearId: academicYearId || null, count: records.length };
    });

  const missingClasses = DEFAULT_ACADEMIC_CLASSES.filter((name) => !classByName.has(canonicalAcademicClass(name)));
  const missingSubjects = [];
  const missingAssignments = [];
  const inactiveAssignments = [];
  const effectiveRecords = [];
  const expectedSlotsByClass = [];

  for (const className of DEFAULT_ACADEMIC_CLASSES) {
    const canonicalName = canonicalAcademicClass(className);
    const classRow = classByName.get(canonicalName);
    const definitions = defaultSubjectsForClass(canonicalName).filter((definition) => definition.activeByDefault !== false);
    const classMissingSubjects = [];
    const classMissingAssignments = [];
    for (const definition of definitions) {
      const normalizedName = normalize(definition.name);
      const subjectRecords = subjectsByName.get(normalizedName) ?? [];
      if (subjectRecords.length > 1) continue;
      const subject = subjectRecords[0];
      if (!subject) {
        const missing = { classId: classRow?.id ?? null, className, subjectName: definition.name, subjectType: definition.subjectType, isScoring: definition.isScoring !== false, mandatory: Boolean(definition.mandatory) };
        missingSubjects.push(missing);
        classMissingSubjects.push(definition.name);
        const missingAssignment = { classId: classRow?.id ?? null, className, subjectId: null, subjectName: definition.name, academicYearId: academicYear?.id ?? null, action: 'CREATE_SUBJECT_AND_ASSIGNMENT' };
        missingAssignments.push(missingAssignment);
        classMissingAssignments.push(definition.name);
        continue;
      }
      if (!classRow) continue;
      const matchingRows = relevantAssignments.filter((assignment) => {
        const matchesClass = canonicalClassOf(assignment) === canonicalName;
        const assignedSubjectId = id(assignment.subjectId ?? assignment.subject_id);
        const assignedName = normalize(subjectNameOf(assignment));
        return matchesClass && (assignedSubjectId ? assignedSubjectId === id(subject.id) : assignedName === normalizedName);
      });
      const currentYear = matchingRows.find((row) => String(row.academicYearId ?? row.academic_year_id ?? '') === String(academicYear?.id ?? ''));
      const defaultYear = matchingRows.find((row) => (row.academicYearId ?? row.academic_year_id ?? null) == null);
      const current = currentYear ?? defaultYear;
      if (!current) {
        const missing = { classId: classRow.id, className, subjectId: subject.id, subjectName: definition.name, academicYearId: academicYear?.id ?? null, action: 'CREATE_ASSIGNMENT' };
        missingAssignments.push(missing);
        classMissingAssignments.push(definition.name);
      } else if (!isActive(current.active)) {
        inactiveAssignments.push({ classId: classRow.id, className, subjectId: subject.id, subjectName: definition.name, academicYearId: current.academicYearId ?? current.academic_year_id ?? null, mandatory: Boolean(definition.mandatory) });
      } else {
        effectiveRecords.push({ classId: classRow.id, className, subjectId: subject.id, subjectName: definition.name });
      }
    }
    expectedSlotsByClass.push({ classId: classRow?.id ?? null, className, expectedSlots: definitions.length, effectiveActiveSlots: definitions.length - classMissingAssignments.length - inactiveAssignments.filter((row) => row.className === className).length, missingSubjects: classMissingSubjects, missingAssignments: classMissingAssignments });
  }

  const assignmentRowsInScope = relevantAssignments.length;
  const proposedSubjects = [...new Set(missingSubjects.map((row) => normalize(row.subjectName)))].length;
  const proposedAssignments = missingAssignments.length;
  const baselineReady = !missingClasses.length && !duplicateClasses.length && !duplicateSubjects.length && !duplicateAssignments.length;
  return {
    mode: 'DRY_RUN_ONLY',
    productionWrites: 0,
    schoolId: null,
    academicYearScope: { id: academicYear?.id ?? null, name: academicYear?.name ?? null, includesSchoolDefaults: true, includesYearOverrides: true },
    expectedBaseline: { classCount: DEFAULT_ACADEMIC_CLASSES.length, assignmentSlots: DEFAULT_SUBJECT_ASSIGNMENT_SLOTS, distinctSubjectNames: DEFAULT_DISTINCT_SUBJECT_NAMES },
    actualCounts: { classRecords: classes.length, uniqueCanonicalClassRecords: classRows.length, subjectRecords: subjects.length, assignmentRowsInScope, effectiveActiveBaselineAssignments: effectiveRecords.length },
    expectedAfterCounts: { subjectRecords: subjects.length + proposedSubjects, assignmentRowsInScope: assignmentRowsInScope + proposedAssignments, effectiveBaselineAssignments: DEFAULT_SUBJECT_ASSIGNMENT_SLOTS },
    missingClasses,
    missingSubjects,
    missingAssignments,
    inactiveAssignments,
    duplicateDetection: { duplicateClasses, duplicateSubjects, duplicateAssignments },
    nurseryPreservation: { rowsObserved: allAssignmentsForNursery.length, rowsToChange: 0, assignments: allAssignmentsForNursery },
    classes: expectedSlotsByClass,
    applyPreflightReady: baselineReady,
    notes: [
      'Preview inspected only the requested school and academic-year scope.',
      'School-wide defaults are inherited unless the selected year has an explicit override.',
      'This workflow performs zero database writes in DRY_RUN_ONLY mode.'
    ]
  };
}
