import { CORE_LEVELS } from './students.js';

const STAFF_ROLES = new Set(['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACCOUNTANT_BURSAR', 'ADMISSIONS_OFFICER', 'ACADEMIC_COORDINATOR', 'TEACHER']);

function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
function text(value) { return String(value ?? '').trim(); }
function fullName(student) { return [student.firstName, student.middleName, student.surname].filter(Boolean).join(' '); }
function normalize(value) { return text(value).toLowerCase(); }
function phoneSearchValues(value) { const raw = text(value).replace(/\D/g, ''); if (!raw) return []; const local = raw.startsWith('233') ? `0${raw.slice(3)}` : raw.startsWith('0') ? raw : `0${raw.slice(-9)}`; return [raw, local, `233${local.slice(1)}`]; }

export function createClassDatabaseService({ students, classes = CORE_LEVELS, parentDirectory = null, schoolId = 'school-osaah-daylight' } = {}) {
  if (!students?.listStudents || !students?.parentLinksFor) fail('Canonical student service is required.', 500);
  const canonicalClasses = [...new Set(classes)].filter(Boolean);

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

  function row(student, actor, completionYear = null) {
    const parents = parentCandidates(student, actor);
    const parent = parents.find((item) => item.primary) ?? parents[0] ?? {};
    return { permanentStudentId: student.permanentStudentId, studentId: student.id, studentName: fullName(student), parentGuardianName: parent.fullName ?? 'Not Registered', registeredParentPhone: parent.telephone ?? 'Not Registered', classId: student.classId, academicYear: actor.academicYear ?? null, ...(completionYear ?? student.completionYear ? { completionYear: completionYear ?? student.completionYear } : {}), isTestRecord: Boolean(student.isTestRecord) };
  }

  function list({ classId, academicYear, search = '', includeTestRecords = false } = {}, actor) {
    authorize(actor);
    if (classId && !canonicalClasses.includes(classId)) fail('Invalid class.', 400);
    if (actor.roleKey === 'TEACHER' && classId && !actor.assignedClassIds.includes(classId)) fail('Forbidden.', 403);
    const term = normalize(search);
    return students.listStudents({ requestedSchoolId: actor.schoolId, includeTestRecords }).filter((student) => (!classId || student.classId === classId) && (actor.roleKey !== 'TEACHER' || actor.assignedClassIds.includes(student.classId))).map((student) => row(student, { ...actor, academicYear })).filter((item) => !term || [item.permanentStudentId, item.studentName, item.parentGuardianName].some((value) => normalize(value).includes(term)) || phoneSearchValues(item.registeredParentPhone).some((value) => value.includes(term.replace(/\D/g, '')))).sort((a, b) => a.studentName.localeCompare(b.studentName));
  }

  function options(actor) { authorize(actor); const allowedClasses = actor.roleKey === 'TEACHER' && actor.assignedClassIds?.length ? canonicalClasses.filter((classId) => actor.assignedClassIds.includes(classId)) : canonicalClasses; return { academicYears: [actor.academicYear ?? `${new Date().getFullYear()}/${new Date().getFullYear() + 1}`], classes: allowedClasses }; }

  function completedOptions(actor) { authorize(actor); const years = students.completionYears?.({ requestedSchoolId: actor.schoolId }) ?? []; return { completionYears: years }; }

  function listCompleted({ completionYear, search = '', includeTestRecords = false } = {}, actor) {
    authorize(actor);
    if (!students.listCompleted) return [];
    const term = normalize(search);
    return students.listCompleted({ requestedSchoolId: actor.schoolId, completionYear, includeTestRecords }).map((student) => row(student, actor, student.completionYear)).filter((item) => !term || [item.permanentStudentId, item.studentName, item.parentGuardianName].some((value) => normalize(value).includes(term)) || phoneSearchValues(item.registeredParentPhone).some((value) => value.includes(term.replace(/\D/g, '')))).sort((a, b) => a.studentName.localeCompare(b.studentName));
  }

  return Object.freeze({ list, options, listCompleted, completedOptions, classes: () => [...canonicalClasses] });
}
