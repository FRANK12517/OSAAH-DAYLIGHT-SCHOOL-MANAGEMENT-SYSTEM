import { randomUUID } from 'node:crypto';
import { CORE_LEVELS } from './students.js';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const MAX_BYTES = 2 * 1024 * 1024;
const clone = (value) => JSON.parse(JSON.stringify(value));
const actorId = (actor) => actor?.id ?? actor?.userId ?? null;
const canManage = (actor) => ['PROPRIETOR', 'HEADTEACHER'].includes(actor?.roleKey) || actor?.permissions?.has?.('signatures.manage') || actor?.permissions?.has?.('*');
const text = (value) => String(value ?? '').trim();

export function createSignatureService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight', staff = null, classes = CORE_LEVELS } = {}) {
  const signatures = new Map();
  const classOptions = () => [...new Set(classes)].filter(Boolean);
  const activeStaff = () => (staff?.listProfiles?.() ?? []).filter((item) => item.schoolId === schoolId && item.employmentStatus === 'ACTIVE');
  const teacherFor = (id) => activeStaff().find((item) => item.id === id && item.roleKey === 'TEACHER');
  const assignmentMatches = (teacherId, classId, academicYear, term) => (staff?.assignments?.() ?? []).some((item) => item.schoolId !== schoolId ? false : item.staffId === teacherId && item.classId === classId && (!academicYear || !item.academicYearId || String(item.academicYearId) === academicYear) && (!term || !item.termId || String(item.termId) === term));
  function assertActor(actor) { if (!actor || actor.schoolId !== schoolId || !canManage(actor)) throw new Error('Forbidden.'); }
  function validate(input) {
    const signatoryRole = text(input?.signatoryRole).toUpperCase();
    const mimeType = text(input?.mimeType ?? input?.documentType).toLowerCase();
    const size = Number(input?.size ?? input?.documentSize ?? 0);
    if (!['HEADTEACHER', 'CLASS_TEACHER'].includes(signatoryRole)) throw new Error('Unsupported signatory role.');
    if (!ALLOWED_TYPES.has(mimeType)) throw new Error('Only PNG, JPEG, and SVG signatures are supported.');
    if (!Number.isFinite(size) || size < 0 || size > MAX_BYTES) throw new Error('Signature file is too large or invalid.');
    const academicYear = text(input?.academicYear);
    const term = text(input?.term);
    const classId = text(input?.classId);
    const teacherId = text(input?.teacherId);
    if (signatoryRole === 'CLASS_TEACHER') {
      if (!classId || !classOptions().includes(classId)) throw new Error('A registered class is required.');
      if (!teacherId || !teacherFor(teacherId)) throw new Error('An active class teacher is required.');
      if (!academicYear || !term) throw new Error('Academic year and term are required.');
      if (staff && !assignmentMatches(teacherId, classId, academicYear, term)) throw new Error('Teacher is not assigned to this class and academic context.');
    }
    return { signatoryRole, mimeType, size, academicYear: academicYear || null, term: term || null, classId: signatoryRole === 'CLASS_TEACHER' ? classId : null, teacherId: signatoryRole === 'CLASS_TEACHER' ? teacherId : null };
  }
  function list(actor) { assertActor(actor); return [...signatures.values()].map(({ data, ...safe }) => clone(safe)); }
  function upload(input, actor) {
    assertActor(actor);
    const meta = validate(input);
    const record = { id: randomUUID(), schoolId, ...meta, storageKey: text(input.storageKey ?? input.fileReference) || null, data: input.data ?? null, active: true, uploadedBy: actorId(actor), uploadedAt: now(), updatedAt: now() };
    for (const item of signatures.values()) if (item.schoolId === schoolId && item.signatoryRole === meta.signatoryRole && item.active && item.academicYear === meta.academicYear && item.term === meta.term && item.classId === meta.classId && item.teacherId === meta.teacherId) item.active = false;
    signatures.set(record.id, record);
    return clone(record);
  }
  function remove(id, actor) { assertActor(actor); const record = signatures.get(id); if (!record || record.schoolId !== schoolId) throw new Error('Signature not found.'); record.active = false; record.updatedAt = now(); return clone(record); }
  function activeFor(role, context = {}) {
    const signatoryRole = text(role).toUpperCase();
    const academicYear = text(context.academicYear) || null;
    const term = text(context.term) || null;
    const classId = text(context.classId) || null;
    const teacherId = text(context.teacherId) || null;
    const scoped = [...signatures.values()].filter((item) => item.schoolId === schoolId && item.signatoryRole === signatoryRole && item.active);
    const exact = scoped.find((item) => item.academicYear === academicYear && item.term === term && (signatoryRole !== 'CLASS_TEACHER' || (item.classId === classId && item.teacherId === teacherId)));
    const legacy = scoped.find((item) => !item.academicYear && !item.term && (signatoryRole !== 'CLASS_TEACHER' || (item.classId === classId && item.teacherId === teacherId)));
    return clone(exact ?? legacy ?? null);
  }
  function resolveForStudent(student, context = {}) {
    const classTeacher = (staff?.assignments?.() ?? []).find((item) => item.schoolId === schoolId && item.classId === student?.classId && (!context.academicYear || !item.academicYearId || String(item.academicYearId) === String(context.academicYear)) && (!context.term || !item.termId || String(item.termId) === String(context.term)) && teacherFor(item.staffId));
    const teacher = classTeacher ? teacherFor(classTeacher.staffId) : null;
    return { classTeacher: { name: teacher?.fullName ?? null, signature: activeFor('CLASS_TEACHER', { ...context, classId: student?.classId, teacherId: teacher?.id }) }, headteacher: { name: activeStaff().find((item) => ['HEADTEACHER', 'PROPRIETOR'].includes(item.roleKey))?.fullName ?? null, signature: activeFor('HEADTEACHER', context) } };
  }
  function options(actor) { assertActor(actor); return { classes: classOptions(), teachers: activeStaff().filter((item) => item.roleKey === 'TEACHER').map((item) => ({ id: item.id, name: item.fullName })) }; }
  return { list, upload, replace: upload, remove, activeFor, resolveForStudent, options, validate };
}
