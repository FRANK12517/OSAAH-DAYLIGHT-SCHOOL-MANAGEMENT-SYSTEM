import { CORE_LEVELS } from './students.js';
import { displayStudentGender } from './student-gender.js';
import { canonicalClassId, displayClassName } from './student-classes.js';

const STAFF_ROLES = new Set(['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACCOUNTANT_BURSAR', 'ADMISSIONS_OFFICER', 'ACADEMIC_COORDINATOR', 'TEACHER']);
const DEFAULT_ACADEMIC_YEARS = Object.freeze(['2024/2025', '2025/2026', '2026/2027', '2027/2028', '2028/2029']);

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(value) { return String(value ?? '').trim(); }
function fullName(student) { return [student.firstName, student.middleName, student.surname].filter(Boolean).join(' '); }
function normalize(value) { return text(value).toLowerCase(); }
function phoneSearchValues(value) { const raw = text(value).replace(/\D/g, ''); if (!raw) return []; const local = raw.startsWith('233') ? `0${raw.slice(3)}` : raw.startsWith('0') ? raw : `0${raw.slice(-9)}`; return [raw, local, `233${local.slice(1)}`]; }
function yearKey(value) { const raw = text(value); const match = /^(\d{4})(?:\/(\d{4}))?$/.exec(raw); return match ? match[1] : raw; }
function sameAcademicYear(left, right) { return !text(right) || yearKey(left) === yearKey(right); }

export function createClassDatabaseService({ students, classes = CORE_LEVELS, parentDirectory = null, schoolId = 'school-osaah-daylight', academicYears = DEFAULT_ACADEMIC_YEARS } = {}) {
  if (!students?.listStudents || !students?.parentLinksFor) fail('Canonical student service is required.', 500);
  const canonicalClasses = [...new Set(classes.map((value) => canonicalClassId(value) ?? value))].filter(Boolean);
  const configuredAcademicYears = [...new Set(academicYears.map((value) => typeof value === 'string' ? value : value.name ?? value.id).filter(Boolean))];

  function authorize(actor) {
    if (!actor || actor.portal === 'parent' || actor.portal === 'student') fail('Forbidden.', 403);
    if (actor.schoolId !== schoolId) fail('Forbidden.', 403);
    const permitted = actor.permissions?.has?.('*') || actor.permissions?.has?.('students.read') || actor.permissions?.has?.('class-database.read');
    if (!permitted && !STAFF_ROLES.has(actor.roleKey)) fail('Forbidden.', 403);
    if (actor.roleKey === 'TEACHER' && !actor.assignedClassIds?.length) fail('Forbidden.', 403);
  }

  function parentCandidates(student, actor) {
    const links = students.parentLinksFor(student.id, actor.schoolId) ?? [];
    const family = Array.isArray(student.family) ? student.family : [];
    return links.map((link) => {
      const contact = family.find((item) => item.parentId === link.parentId || item.id === link.parentId || item.telephone === link.telephone);
      const directory = parentDirectory?.(link.parentId, actor.schoolId) ?? null;
      return { ...link, fullName: link.fullName ?? link.parentName ?? contact?.fullName ?? contact?.name ?? directory?.fullName ?? directory?.name ?? null, telephone: link.telephone ?? contact?.telephone ?? directory?.phone ?? directory?.telephone ?? null, primary: Boolean(link.primary ?? link.isPrimary ?? contact?.primary ?? contact?.isPrimary ?? directory?.primary) };
    }).concat(family.filter((contact) => !links.some((link) => link.parentId && link.parentId === (contact.parentId ?? contact.id))).map((contact) => ({ fullName: contact.fullName ?? contact.name ?? null, telephone: contact.telephone ?? contact.phone ?? null, primary: Boolean(contact.primary ?? contact.isPrimary) })));
  }

  function enrollmentFor(student, academicYear, classId) {
    const history = Array.isArray(student.history) ? student.history : [];
    if (!text(academicYear)) return student.classId === classId ? { classId: student.classId, academicYear: null } : null;
    const matching = history.filter((entry) => sameAcademicYear(entry.academicYearId, academicYear) && (!classId || (canonicalClassId(entry.classId) ?? entry.classId) === classId) && entry.reason !== 'COMPLETION');
    const latest = matching.sort((a, b) => String(b.effectiveAt ?? '').localeCompare(String(a.effectiveAt ?? '')))[0];
    if (latest) return { classId: canonicalClassId(latest.classId) ?? latest.classId, academicYear };
    const hasYearHistory = history.some((entry) => text(entry.academicYearId));
    return !hasYearHistory && student.classId === classId ? { classId: student.classId, academicYear } : null;
  }

  function row(student, actor, enrollment, completionYear = null) {
    const parents = parentCandidates(student, actor);
    const parent = parents.find((item) => item.primary) ?? parents[0] ?? {};
    return { permanentStudentId: student.permanentStudentId, studentId: student.id, studentName: fullName(student), gender: displayStudentGender(student.gender), parentGuardianName: parent.fullName ?? 'Not Registered', registeredParentPhone: parent.telephone ?? 'Not Registered', classId: enrollment?.classId ?? student.classId, academicYear: enrollment?.academicYear ?? actor.academicYear ?? null, ...(completionYear ?? student.completionYear ? { completionYear: completionYear ?? student.completionYear } : {}), isTestRecord: Boolean(student.isTestRecord) };
  }

  function searchable(item, term) {
    if (!term) return true;
    const phoneTerm = term.replace(/\D/g, '');
    return [item.permanentStudentId, item.studentName, item.parentGuardianName].some((value) => normalize(value).includes(term)) || Boolean(phoneTerm && phoneSearchValues(item.registeredParentPhone).some((value) => value.includes(phoneTerm)));
  }

  function list({ classId, academicYear, search = '', includeTestRecords = false } = {}, actor) {
    authorize(actor);
    const resolvedClassId = canonicalClassId(classId) ?? classId;
    if (resolvedClassId && !canonicalClasses.includes(resolvedClassId)) fail('Invalid class.', 400);
    if (actor.roleKey === 'TEACHER' && resolvedClassId && !actor.assignedClassIds.map((value) => canonicalClassId(value) ?? value).includes(resolvedClassId)) fail('Forbidden.', 403);
    const term = normalize(search);
    return students.listStudents({ requestedSchoolId: actor.schoolId, includeTestRecords, includeCompleted: Boolean(academicYear) }).flatMap((student) => {
      const enrollment = enrollmentFor(student, academicYear, resolvedClassId);
      if (!enrollment || (actor.roleKey === 'TEACHER' && !actor.assignedClassIds.map((value) => canonicalClassId(value) ?? value).includes(enrollment.classId))) return [];
      const item = row(student, { ...actor, academicYear }, enrollment);
      return searchable(item, term) ? [item] : [];
    }).sort((a, b) => a.studentName.localeCompare(b.studentName));
  }

  function options(actor) {
    authorize(actor);
    const allowedClasses = actor.roleKey === 'TEACHER' && actor.assignedClassIds?.length ? canonicalClasses.filter((classId) => actor.assignedClassIds.map((value) => canonicalClassId(value) ?? value).includes(classId)) : canonicalClasses;
    const years = configuredAcademicYears.length ? configuredAcademicYears : [actor.academicYear ?? `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`];
    return { academicYears: years, classes: allowedClasses };
  }

  function completedOptions(actor) { authorize(actor); const years = students.completionYears?.({ requestedSchoolId: actor.schoolId }) ?? []; return { completionYears: years }; }

  function listCompleted({ completionYear, search = '', includeTestRecords = false } = {}, actor) {
    authorize(actor);
    if (!students.listCompleted) return [];
    const term = normalize(search); const phoneTerm = term.replace(/\D/g, '');
    return students.listCompleted({ requestedSchoolId: actor.schoolId, completionYear, includeTestRecords }).map((student) => row(student, actor, { classId: student.classId, academicYear: actor.academicYear }, student.completionYear)).filter((item) => !term || [item.permanentStudentId, item.studentName, item.parentGuardianName].some((value) => normalize(value).includes(term)) || (phoneTerm && phoneSearchValues(item.registeredParentPhone).some((value) => value.includes(phoneTerm)))).sort((a, b) => a.studentName.localeCompare(b.studentName));
  }

  return Object.freeze({ list, options, listCompleted, completedOptions, classes: () => [...canonicalClasses], displayClassName });
}
