import { canonicalClassId } from './student-classes.js';

export const DEFAULT_SUBJECT_CONFIGURATION_VERSION = 1;

const nurserySubjects = Object.freeze([
  { name: 'English Language', subjectType: 'CORE' },
  { name: 'Mathematics', subjectType: 'CORE' },
  { name: 'Science', subjectType: 'CORE' },
  { name: 'Social Studies', subjectType: 'CORE' },
  { name: 'Religious and Moral Education', subjectType: 'CORE' },
  { name: 'Computing', subjectType: 'ELECTIVE' },
  { name: 'Creative Arts', subjectType: 'ELECTIVE' },
  { name: 'French', subjectType: 'ELECTIVE' }
]);

const kgSubjects = Object.freeze([
  { name: 'Language and Literacy', subjectType: 'CORE', mandatory: true, assessmentComponents: ['Phonics & Word Building', 'Oral Language & Listening', 'Pre-Writing & Penmanship'] },
  { name: 'Numeracy', subjectType: 'CORE', mandatory: true, assessmentComponents: ['Number Operations', 'Geometry & Spatial Awareness', 'Data & Sorting'] },
  { name: 'Our World, Our People', subjectType: 'CORE', mandatory: true, assessmentComponents: ['Personal & Social Development', 'Ghanaian Values & Science'] },
  { name: 'Creative Arts', subjectType: 'CORE', mandatory: true, assessmentComponents: ['Visual Arts', 'Performing Arts & Movement'] }
]);

const lowerPrimary = Object.freeze([
  { name: 'English Language', subjectType: 'CORE', mandatory: true },
  { name: 'Mathematics', subjectType: 'CORE', mandatory: true },
  { name: 'Science', subjectType: 'CORE', mandatory: true },
  { name: 'History', subjectType: 'CORE', mandatory: true },
  { name: 'Religious and Moral Education', subjectType: 'ELECTIVE' },
  { name: 'Creative Arts', subjectType: 'ELECTIVE' },
  { name: 'Ghanaian Language (Fantse)', subjectType: 'ELECTIVE' },
  { name: 'Physical Education', subjectType: 'NON_SCORING', isScoring: false }
]);

const upperPrimary = Object.freeze([
  { name: 'English Language', subjectType: 'CORE', mandatory: true },
  { name: 'Mathematics', subjectType: 'CORE', mandatory: true },
  { name: 'Integrated Science', subjectType: 'CORE', mandatory: true },
  { name: 'History', subjectType: 'CORE', mandatory: true },
  { name: 'Religious and Moral Education', subjectType: 'ELECTIVE' },
  { name: 'Computing', subjectType: 'ELECTIVE' },
  { name: 'Career Technology', subjectType: 'ELECTIVE' },
  { name: 'Creative Arts and Design', subjectType: 'ELECTIVE' },
  { name: 'Ghanaian Language (Fantse)', subjectType: 'ELECTIVE' },
  { name: 'Physical Education', subjectType: 'NON_SCORING', isScoring: false },
  { name: 'French', subjectType: 'ELECTIVE', optional: true, activeByDefault: false }
]);

const jhs = Object.freeze([
  { name: 'English Language', subjectType: 'CORE', mandatory: true },
  { name: 'Mathematics', subjectType: 'CORE', mandatory: true },
  { name: 'Integrated Science', subjectType: 'CORE', mandatory: true },
  { name: 'Social Studies', subjectType: 'CORE', mandatory: true },
  { name: 'Computing', subjectType: 'ELECTIVE' },
  { name: 'Religious and Moral Education', subjectType: 'ELECTIVE' },
  { name: 'Career Technology', subjectType: 'ELECTIVE' },
  { name: 'Creative Arts and Design', subjectType: 'ELECTIVE' },
  { name: 'Ghanaian Language', subjectType: 'ELECTIVE' },
  { name: 'French', subjectType: 'ELECTIVE', optional: true, activeByDefault: false }
]);

const BY_LEVEL = Object.freeze({ NURSERY: nurserySubjects, KG: kgSubjects, LOWER_PRIMARY: lowerPrimary, UPPER_PRIMARY: upperPrimary, JHS: jhs });

export function canonicalAcademicClass(value) {
  const canonical = canonicalClassId(value);
  if (canonical) return canonical;
  const text = String(value ?? '').trim();
  const kg = text.match(/^KG\s*([12])$/i);
  const basic = text.match(/^(?:Basic|Primary)\s*([1-6])$/i);
  const jhsClass = text.match(/^JHS\s*([1-3])$/i);
  const nursery = text.match(/^Nursery\s*([12])$/i);
  return kg ? `KG${kg[1]}` : basic ? `Primary ${basic[1]}` : jhsClass ? `JHS ${jhsClass[1]}` : nursery ? `Nursery ${nursery[1]}` : null;
}

export function academicLevelForClass(value) {
  const classId = canonicalAcademicClass(value);
  if (!classId) return null;
  if (classId.startsWith('Nursery')) return 'NURSERY';
  if (classId.startsWith('KG')) return 'KG';
  if (/^Primary [1-3]$/.test(classId)) return 'LOWER_PRIMARY';
  if (/^Primary [4-6]$/.test(classId)) return 'UPPER_PRIMARY';
  if (classId.startsWith('JHS')) return 'JHS';
  return null;
}

export function defaultSubjectsForClass(classId) {
  const level = academicLevelForClass(classId);
  if (!level) return [];
  return BY_LEVEL[level].map((subject) => Object.freeze({
    ...subject,
    isScoring: subject.isScoring !== false,
    maximumMarks: 100,
    configurationVersion: DEFAULT_SUBJECT_CONFIGURATION_VERSION,
    assessmentComponents: subject.assessmentComponents ? [...subject.assessmentComponents] : []
  }));
}

export function defaultSubjectForClass(classId, subjectName) {
  const normalizedName = String(subjectName ?? '').trim().toLowerCase();
  return defaultSubjectsForClass(classId).find((subject) => subject.name.toLowerCase() === normalizedName) ?? null;
}
