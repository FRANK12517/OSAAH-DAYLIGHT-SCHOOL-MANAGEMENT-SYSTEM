import { isConfiguredTestParentActor, isConfiguredTestStudentId, TEST_PARENT_SCHOOL_ID } from './test-parent-fixture.js';

const SAMPLE_CLASS_NAME = 'Primary 6';
const SAMPLE_TERM_NAMES = Object.freeze(['First Term', 'Second Term', 'Third Term']);

const text = (value) => String(value ?? '').trim();
const normalizeTerm = (value) => text(value).toLowerCase().replace(/^(first|1st)\s+term$/, 'first term').replace(/^(second|2nd)\s+term$/, 'second term').replace(/^(third|3rd)\s+term$/, 'third term');
const normalizeClass = (value) => text(value).toLowerCase().replace(/^basic\s+/, 'primary ').replace(/^primary\s+/, 'primary ');

function findYear(years) {
  return years.find((item) => item.isCurrent) ?? years[0] ?? null;
}

function findTerm(terms, year, name) {
  return terms.find((item) => normalizeTerm(item.name) === normalizeTerm(name) && (!item.academicYearId || String(item.academicYearId) === String(year?.id))) ?? null;
}

function findClass(classes) {
  return classes.find((item) => normalizeClass(item.name) === normalizeClass(SAMPLE_CLASS_NAME)) ?? null;
}

export function listConfiguredSampleAcademicContexts({ actor, permanentStudentId, academicYears = [], terms = [], classes = [], schoolId = TEST_PARENT_SCHOOL_ID } = {}) {
  if (!isConfiguredTestParentActor(actor, schoolId) || !isConfiguredTestStudentId(permanentStudentId)) return [];
  const year = findYear(academicYears);
  const classRecord = findClass(classes);
  if (!year || !classRecord) return [];
  return SAMPLE_TERM_NAMES.map((termName) => {
    const term = findTerm(terms, year, termName);
    if (!term) return null;
    return {
      permanentStudentId: text(permanentStudentId),
      schoolId,
      academicYearId: text(year.id),
      academicYearName: text(year.name),
      termId: text(term.id),
      termName: text(term.name),
      classId: text(classRecord.id),
      className: text(classRecord.name),
      isTestContext: true,
      provenance: 'TEST'
    };
  }).filter(Boolean);
}

export function isConfiguredSampleAcademicContext(input = {}) {
  return listConfiguredSampleAcademicContexts(input).some((context) =>
    String(context.academicYearId) === String(input.academicYearId)
    && String(context.termId) === String(input.termId)
    && String(context.classId) === String(input.classId)
  );
}

export const SAMPLE_ACADEMIC_CONTEXT_CLASS = SAMPLE_CLASS_NAME;
export const SAMPLE_ACADEMIC_CONTEXT_TERMS = SAMPLE_TERM_NAMES;
