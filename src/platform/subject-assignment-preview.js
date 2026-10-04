import { CANONICAL_CLASS_IDS } from '../student-classes.js';
import { defaultSubjectsForClass, canonicalAcademicClass } from '../default-subject-catalog.js';

const normalize = (value) => String(value ?? '').trim().toLocaleLowerCase('en');
const idText = (value) => String(value ?? '').trim();

/** Build a proposal only. This function never receives a database adapter. */
export function buildSubjectAssignmentPreview({ classes = [], subjects = [], assignments = [], legacyMappings = [], academicYear = null } = {}) {
  const classRows = classes.map((row) => ({ ...row, canonicalId: canonicalAcademicClass(row.name ?? row.className ?? row.id) }))
    .filter((row) => row.canonicalId && CANONICAL_CLASS_IDS.includes(row.canonicalId));
  const classByCanonical = new Map(classRows.map((row) => [row.canonicalId, row]));
  const registryByName = new Map();
  for (const subject of subjects) {
    const key = normalize(subject.name);
    if (!key) continue;
    if (!registryByName.has(key)) registryByName.set(key, []);
    registryByName.get(key).push(subject);
  }

  const activeScopes = new Map();
  const allScopes = new Map();
  const normalizedRows = assignments.map((row) => ({ ...row, source: 'subject_class_assignments' }));
  const legacyRows = legacyMappings.map((row) => ({ ...row, active: 1, academicYearId: null, source: 'class_subjects' }));
  const canonicalOf = (row) => canonicalAcademicClass(row.className ?? row.class_name ?? classRows.find((item) => idText(item.id) === idText(row.classId ?? row.class_id))?.name ?? row.classId ?? row.class_id);
  const subjectNameOf = (row) => row.subjectName ?? row.subject_name ?? subjects.find((item) => idText(item.id) === idText(row.subjectId ?? row.subject_id))?.name;
  const normalizedMappingKeys = new Set(normalizedRows.map((row) => `${canonicalOf(row)}\u0000${normalize(subjectNameOf(row))}\u0000${row.academicYearId ?? row.academic_year_id ?? ''}`));
  const mappedRows = [...normalizedRows, ...legacyRows.filter((row) => !normalizedMappingKeys.has(`${canonicalOf(row)}\u0000${normalize(subjectNameOf(row))}\u0000`))];
  const duplicateAssignmentKeys = new Map();
  const preservedNurseryAssignments = [];
  for (const row of mappedRows) {
    const className = row.className ?? row.class_name ?? classRows.find((item) => idText(item.id) === idText(row.classId ?? row.class_id))?.name;
    const classCanonical = canonicalAcademicClass(className ?? row.classId ?? row.class_id);
    const subjectName = subjectNameOf(row);
    if (!classCanonical || !subjectName) continue;
    const classId = idText(row.classId ?? row.class_id ?? classByCanonical.get(classCanonical)?.id);
    const subjectId = idText(row.subjectId ?? row.subject_id);
    const yearId = row.academicYearId ?? row.academic_year_id ?? null;
    const isActive = Number(row.active ?? 1) !== 0;
    const key = `${classCanonical}\u0000${normalize(subjectName)}\u0000${yearId ?? ''}`;
    duplicateAssignmentKeys.set(key, (duplicateAssignmentKeys.get(key) ?? 0) + 1);
    const activeKey = `${classCanonical}\u0000${normalize(subjectName)}`;
    if (!allScopes.has(activeKey)) allScopes.set(activeKey, []);
    allScopes.get(activeKey).push({ id: row.id ?? null, classId, classCanonical, subjectId, subjectName, academicYearId: yearId, active: isActive, source: row.source });
    if (classCanonical.startsWith('Nursery')) preservedNurseryAssignments.push({ classId, classCanonical, subjectId, subjectName, academicYearId: yearId, active: isActive, source: row.source, action: 'PRESERVE_UNCHANGED' });
    if (!isActive) continue;
    if (yearId && academicYear?.id && String(yearId) !== String(academicYear.id)) continue;
    if (!activeScopes.has(activeKey)) activeScopes.set(activeKey, []);
    activeScopes.get(activeKey).push({ classId, classCanonical, subjectId, subjectName, academicYearId: yearId, source: row.source });
  }

  const duplicateSubjects = [...registryByName.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([normalizedName, rows]) => ({ normalizedName, subjects: rows.map((row) => ({ id: row.id, name: row.name })) }));
  const duplicateAssignments = [...duplicateAssignmentKeys.entries()]
    .filter(([, count]) => count > 1)
    .map(([key, count]) => {
      const [classCanonical, normalizedName, academicYearId] = key.split('\u0000');
      return { classId: classByCanonical.get(classCanonical)?.id ?? classCanonical, className: classCanonical, normalizedSubjectName: normalizedName, academicYearId: academicYearId || null, count };
    });

  const proposedSubjectsByName = new Map();
  const proposedAssignments = [];
  const missingApprovals = [];
  const classReports = [];
  for (const classId of CANONICAL_CLASS_IDS) {
    const classRow = classByCanonical.get(classId) ?? null;
    const currentSubjects = subjects.filter((subject) => {
      const matching = activeScopes.get(`${classId}\u0000${normalize(subject.name)}`) ?? [];
      return matching.length > 0;
    }).map((subject) => ({ id: subject.id, name: subject.name, subjectType: subject.subjectType ?? subject.subject_type ?? null }));
    const proposedSubjects = [];
    const classProposedAssignments = [];
    const skippedOptional = [];

    for (const definition of defaultSubjectsForClass(classId)) {
      if (definition.activeByDefault === false) { skippedOptional.push(definition.name); continue; }
      const matches = registryByName.get(normalize(definition.name)) ?? [];
      const active = activeScopes.get(`${classId}\u0000${normalize(definition.name)}`) ?? [];
      if (active.length > 0) continue;
      const knownAssignments = (allScopes.get(`${classId}\u0000${normalize(definition.name)}`) ?? [])
        .filter((row) => !row.academicYearId || !academicYear?.id || String(row.academicYearId) === String(academicYear.id));
      // Nursery rows are approved historical setup; preserve active and
      // inactive mappings without attempting an implicit reactivation.
      if (classId.startsWith('Nursery') && knownAssignments.length > 0) continue;
      if (knownAssignments.length > 1) {
        missingApprovals.push({ classId: classRow?.id ?? null, className: classId, subjectName: definition.name, reason: 'MULTIPLE_EXISTING_ASSIGNMENT_SCOPES_REQUIRE_HUMAN_REVIEW' });
        continue;
      }

      if (matches.length > 1) {
        missingApprovals.push({ classId, className: classId, subjectName: definition.name, reason: 'DUPLICATE_SUBJECT_RECORDS_REQUIRE_HUMAN_SELECTION' });
        continue;
      }
      const existingSubject = matches[0] ?? null;
      const subjectPlan = existingSubject
        ? { id: existingSubject.id, name: existingSubject.name, action: 'REUSE_EXISTING' }
        : { id: null, name: definition.name, action: 'CREATE_SUBJECT' };
      if (!existingSubject && !proposedSubjectsByName.has(normalize(definition.name))) {
        proposedSubjectsByName.set(normalize(definition.name), {
          name: definition.name,
          subjectType: definition.subjectType,
          isScoring: definition.isScoring !== false,
          active: true,
          assessmentComponents: definition.assessmentComponents ?? [],
          action: 'CREATE_SUBJECT'
        });
      }
      proposedSubjects.push(subjectPlan);
      const assignment = {
        id: knownAssignments.length === 1 ? knownAssignments[0].id : null,
        classId: classRow?.id ?? null,
        className: classId,
        subjectId: existingSubject?.id ?? null,
        subjectName: definition.name,
        action: knownAssignments.length === 1 ? 'REACTIVATE_EXISTING_ASSIGNMENT' : 'CREATE_ASSIGNMENT',
        active: true,
        academicYearId: knownAssignments.length === 1 ? knownAssignments[0].academicYearId : null,
        academicYearScope: knownAssignments.length === 1 && knownAssignments[0].academicYearId ? 'EXISTING_CURRENT_YEAR' : 'SCHOOL_DEFAULT_ALL_YEARS',
        configurationVersion: definition.configurationVersion
      };
      classProposedAssignments.push(assignment);
      proposedAssignments.push(assignment);
      missingApprovals.push({ classId: classRow?.id ?? null, className: classId, subjectName: definition.name, reason: knownAssignments.length === 1 ? 'SEPARATE_ASSIGNMENT_REACTIVATION_APPROVAL_REQUIRED' : 'SEPARATE_SUBJECT_SEED_APPROVAL_REQUIRED' });
    }

    classReports.push({
      classId: classRow?.id ?? null,
      className: classId,
      classRecordPresent: Boolean(classRow),
      existingSubjects: currentSubjects,
      proposedSubjects,
      proposedAssignments: classProposedAssignments,
      skippedOptionalSubjects: skippedOptional,
      nurseryAssignmentsPreserved: classId.startsWith('Nursery') ? (preservedNurseryAssignments.filter((row) => row.classCanonical === classId).length) : 0
    });
  }

  const missingClasses = CANONICAL_CLASS_IDS.filter((classId) => !classByCanonical.has(classId));
  const proposedSubjects = [...proposedSubjectsByName.values()];
  return Object.freeze({
    mode: 'READ_ONLY_PREVIEW',
    productionWrites: 'NONE',
    classCount: CANONICAL_CLASS_IDS.length,
    presentClassCount: classRows.length,
    missingClasses,
    academicYearScope: {
      currentAcademicYearId: academicYear?.id ?? null,
      currentAcademicYearName: academicYear?.name ?? null,
      proposedAssignmentsUseAcademicYearId: null,
      proposedAssignmentsScope: 'school-wide default; current/year-specific rows are retained'
    },
    existingSubjects: subjects.map((subject) => ({ id: subject.id, name: subject.name, subjectType: subject.subjectType ?? subject.subject_type ?? null, active: Number(subject.isActive ?? subject.is_active ?? 1) !== 0 })),
    proposedSubjects,
    proposedAssignments,
    preservedNurseryAssignments,
    duplicateDetection: { duplicateSubjects, duplicateAssignments },
    missingApprovals,
    expectedChanges: {
      subjectRecordsToCreate: proposedSubjects.length,
      assignmentRowsToCreate: proposedAssignments.filter((row) => row.action === 'CREATE_ASSIGNMENT').length,
      assignmentRowsToReactivate: proposedAssignments.filter((row) => row.action === 'REACTIVATE_EXISTING_ASSIGNMENT').length,
      totalProposedAssignmentActions: proposedAssignments.length,
      existingNurseryRowsToChange: 0,
      productionWrites: 0
    },
    classes: classReports
  });
}
