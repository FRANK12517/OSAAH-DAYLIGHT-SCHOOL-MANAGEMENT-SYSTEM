import { randomUUID } from 'node:crypto';
import { CORE_LEVELS } from './students.js';
import { isValidGhanaPhone } from './ghana-phone.js';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (value) => Array.isArray(value) ? value : [];
const actorId = (actor) => actor?.id ?? actor?.userId ?? null;
const canManage = (actor) => ['PROPRIETOR', 'HEADTEACHER'].includes(actor?.roleKey) || actor?.permissions?.has?.('signatures.manage') || actor?.permissions?.has?.('*');
const text = (value) => String(value ?? '').trim();
const safeStorageKey = (value) => { const key = text(value); return Boolean(key) && key.startsWith('signatures/') && !key.includes('..') && !/[\\\s]/.test(key) && !/^https?:/i.test(key); };

export function createSignatureService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight', staff = null, classes = CORE_LEVELS, database = null } = {}) {
  const signatures = new Map();
  const classOptions = () => [...new Set(classes)].filter(Boolean);
  const activeStaff = () => (staff?.listProfiles?.() ?? []).filter((item) => item.schoolId === schoolId && item.employmentStatus === 'ACTIVE');
  const teacherFor = (id) => activeStaff().find((item) => item.id === id && item.roleKey === 'TEACHER');
  const headteacherFor = (actor) => activeStaff().find((item) => item.roleKey === 'HEADTEACHER') ?? activeStaff().find((item) => item.roleKey === 'PROPRIETOR') ?? activeStaff().find((item) => item.id === actorId(actor));
  const assignmentMatches = (teacherId, classId, academicYear, term) => (staff?.assignments?.() ?? []).some((item) => item.schoolId === schoolId && item.staffId === teacherId && item.classId === classId && (!academicYear || !item.academicYearId || String(item.academicYearId) === academicYear) && (!term || !item.termId || String(item.termId) === term));
  function assertActor(actor) { if (!actor || actor.schoolId !== schoolId || !canManage(actor)) throw new Error('Forbidden.'); }
  function validate(input, actor) {
    const signatoryRole = text(input?.signatoryRole).toUpperCase();
    const mimeType = text(input?.mimeType ?? input?.documentType ?? 'image/png').toLowerCase();
    const processedImageData = text(input?.processedImageData ?? input?.data);
    const size = Number(input?.size ?? input?.documentSize ?? Math.floor(processedImageData.length * 3 / 4));
    if (!['HEADTEACHER', 'CLASS_TEACHER'].includes(signatoryRole)) throw new Error('Unsupported signatory role.');
    if (!ALLOWED_TYPES.has(mimeType)) throw new Error('Only processed PNG signatures or existing secure references are supported.');
    if (!Number.isFinite(size) || size <= 0) throw new Error('Signature image is invalid.');
    let storageKey = text(input.storageKey ?? input.fileReference);
    if (processedImageData) {
      if (mimeType !== 'image/png' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(processedImageData)) throw new Error('Upload a valid processed PNG signature image.');
      if (!Buffer.from(processedImageData.slice(processedImageData.indexOf(',') + 1), 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Signature image is not a valid PNG.');
      storageKey = `signatures/${randomUUID()}.png`;
    } else if (!safeStorageKey(storageKey)) throw new Error('A valid secure signature reference is required.');
    const academicYear = text(input?.academicYear);
    const term = text(input?.term);
    const classId = text(input?.classId);
    const teacherId = text(input?.teacherId);
    let identity = null;
    if (signatoryRole === 'CLASS_TEACHER') {
      if (!classId || !classOptions().includes(classId)) throw new Error('A registered class is required.');
      if (!teacherId || !teacherFor(teacherId)) throw new Error('An active class teacher is required.');
      if (!academicYear || !term) throw new Error('Academic year and term are required.');
      if (staff && !assignmentMatches(teacherId, classId, academicYear, term)) throw new Error('Teacher is not assigned to this class and academic context.');
      identity = teacherFor(teacherId);
    } else {
      identity = headteacherFor(actor);
    }
    const fullName = text(input?.fullName ?? identity?.fullName);
    const phone = text(input?.phone ?? identity?.phone);
    if (!fullName) throw new Error('Full name is required.');
    if (!phone) throw new Error('Phone number is required.');
    if (!isValidGhanaPhone(phone)) throw new Error('Invalid Ghana phone number.');
    return { signatoryRole, mimeType, size, storageKey, processedImageData, fullName, phone, academicYear: academicYear || null, term: term || null, classId: signatoryRole === 'CLASS_TEACHER' ? classId : null, teacherId: signatoryRole === 'CLASS_TEACHER' ? teacherId : identity?.id ?? null };
  }
  function list(actor) { assertActor(actor); return [...signatures.values()].map(({ data, processedImageData, ...safe }) => ({ ...clone(safe), data: data ?? processedImageData })); }
  async function listDurable(actor) {
    assertActor(actor);
    if (!database?.query) return list(actor);
    return rows(await database.query(`SELECT id,school_id AS schoolId,signatory_role AS signatoryRole,storage_key AS storageKey,mime_type AS mimeType,document_size AS size,
      active AS active,uploaded_by AS uploadedBy,uploaded_at AS uploadedAt,updated_at AS updatedAt,staff_id AS teacherId,full_name AS fullName,phone_number AS phone,
      class_id AS classId,academic_year AS academicYear,term AS term,CASE WHEN active=1 THEN processed_image_data ELSE NULL END AS data
      FROM result_signatures WHERE school_id=? ORDER BY active DESC,uploaded_at DESC,id`, [schoolId])).map((item) => ({ ...item, active: Boolean(item.active), name: item.fullName }));
  }
  function upload(input, actor) {
    assertActor(actor);
    const meta = validate(input, actor);
    const record = { id: randomUUID(), schoolId, ...meta, data: meta.processedImageData, name: meta.fullName, active: true, uploadedBy: actorId(actor), uploadedAt: now(), updatedAt: now() };
    for (const item of signatures.values()) if (item.schoolId === schoolId && item.signatoryRole === meta.signatoryRole && item.active && item.academicYear === meta.academicYear && item.term === meta.term && item.classId === meta.classId && item.teacherId === meta.teacherId) item.active = false;
    signatures.set(record.id, record);
    const { data, processedImageData, ...safeRecord } = record;
    return clone(safeRecord);
  }
  async function uploadDurable(input, actor) {
    assertActor(actor);
    if (!text(input?.processedImageData ?? input?.data)) throw new Error('Upload a processed signature image.');
    const meta = validate(input, actor), id = randomUUID(), timestamp = now();
    if (!database?.execute) return upload(input, actor);
    const params = [schoolId, meta.signatoryRole, meta.classId, meta.academicYear, meta.term, meta.teacherId];
    const deactivate = `UPDATE result_signatures SET active=0,updated_at=? WHERE school_id=? AND signatory_role=? AND ((class_id IS NULL AND ? IS NULL) OR class_id=?) AND ((academic_year IS NULL AND ? IS NULL) OR academic_year=?) AND ((term IS NULL AND ? IS NULL) OR term=?) AND ((staff_id IS NULL AND ? IS NULL) OR staff_id=?) AND active=1`;
    await database.transaction(async (tx) => {
      await tx.execute(deactivate, [timestamp, schoolId, meta.signatoryRole, meta.classId, meta.classId, meta.academicYear, meta.academicYear, meta.term, meta.term, meta.teacherId, meta.teacherId]);
      await tx.execute(`INSERT INTO result_signatures (id,school_id,signatory_role,storage_key,mime_type,document_size,active,uploaded_by,uploaded_at,updated_at,staff_id,full_name,phone_number,class_id,academic_year,term,processed_image_data)
        VALUES (?,?,?,?,?,?,1,?,?,?,?,?,?,?,?,?,?)`, [id, schoolId, meta.signatoryRole, meta.storageKey, 'image/png', meta.size, actorId(actor), timestamp, timestamp, meta.teacherId, meta.fullName, meta.phone, meta.classId, meta.academicYear, meta.term, meta.processedImageData]);
    });
    const { processedImageData, ...safeMeta } = meta;
    return { id, schoolId, ...safeMeta, mimeType: 'image/png', active: true, uploadedBy: actorId(actor), uploadedAt: timestamp, updatedAt: timestamp };
  }
  async function removeDurable(id, actor) {
    assertActor(actor);
    if (database?.execute) {
      const result = await database.execute('UPDATE result_signatures SET active=0,updated_at=? WHERE id=? AND school_id=?', [now(), id, schoolId]);
      if (!Number(result?.affectedRows ?? result?.rowCount ?? 0)) throw new Error('Signature not found.');
      return { id, active: false };
    }
    return remove(id, actor);
  }
  async function resolveForStudentDurable(student, context = {}) {
    if (!database?.query) return resolveForStudent(student, context);
    if (student?.schoolId && student.schoolId !== schoolId) throw new Error('Forbidden.');
    const classId = text(student?.classId ?? student?.class_id);
    const assignment = (staff?.assignments?.() ?? []).find((item) => item.schoolId === schoolId && (String(item.classId) === classId || canonicalClass(item.classId) === canonicalClass(classId)) && (!context.academicYear || !item.academicYearId || String(item.academicYearId) === String(context.academicYear)) && (!context.term || !item.termId || String(item.termId) === String(context.term)) && teacherFor(item.staffId));
    const teacher = assignment ? teacherFor(assignment.staffId) : null;
    const find = async (role, scopedClass, staffId) => rows(await database.query(`SELECT id,school_id AS schoolId,signatory_role AS signatoryRole,storage_key AS storageKey,mime_type AS mimeType,document_size AS size,
      staff_id AS teacherId,full_name AS fullName,phone_number AS phone,class_id AS classId,academic_year AS academicYear,term,processed_image_data AS data,active,uploaded_at AS uploadedAt,updated_at AS updatedAt
      FROM result_signatures WHERE school_id=? AND signatory_role=? AND active=1 AND (class_id IS NULL OR class_id=?)
        AND (staff_id IS NULL OR staff_id=?) AND (academic_year IS NULL OR academic_year=?) AND (term IS NULL OR term=?)
      ORDER BY CASE WHEN class_id IS NULL THEN 1 ELSE 0 END,CASE WHEN academic_year IS NULL THEN 1 ELSE 0 END,uploaded_at DESC LIMIT 1`, [schoolId, role, scopedClass, staffId, context.academicYear ?? null, context.term ?? null]))[0] ?? null;
    const [classSignature, headSignature] = await Promise.all([find('CLASS_TEACHER', classId, teacher?.id ?? null), find('HEADTEACHER', null, headteacherFor()?.id ?? null)]);
    return {
      classTeacher: { name: classSignature?.fullName ?? teacher?.fullName ?? null, phone: classSignature?.phone ?? teacher?.phone ?? null, signature: classSignature },
      headteacher: { name: headSignature?.fullName ?? headteacherFor()?.fullName ?? null, phone: headSignature?.phone ?? headteacherFor()?.phone ?? null, signature: headSignature }
    };
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
    if (student?.schoolId && student.schoolId !== schoolId) throw new Error('Forbidden.');
    const classTeacher = (staff?.assignments?.() ?? []).find((item) => item.schoolId === schoolId && item.classId === student?.classId && (!context.academicYear || !item.academicYearId || String(item.academicYearId) === String(context.academicYear)) && (!context.term || !item.termId || String(item.termId) === String(context.term)) && teacherFor(item.staffId));
    const teacher = classTeacher ? teacherFor(classTeacher.staffId) : null;
    const classSignature = activeFor('CLASS_TEACHER', { ...context, classId: student?.classId, teacherId: teacher?.id });
    const headSignature = activeFor('HEADTEACHER', context);
    return { classTeacher: { name: classSignature?.fullName ?? teacher?.fullName ?? null, phone: classSignature?.phone ?? teacher?.phone ?? null, signature: classSignature }, headteacher: { name: headSignature?.fullName ?? headteacherFor()?.fullName ?? null, phone: headSignature?.phone ?? headteacherFor()?.phone ?? null, signature: headSignature } };
  }
  function options(actor) { assertActor(actor); const head = headteacherFor(actor); const assignments = staff?.assignments?.() ?? []; return { classes: classOptions(), teachers: activeStaff().filter((item) => item.roleKey === 'TEACHER').map((item) => ({ id: item.id, name: item.fullName, phone: item.phone ?? null, classIds: [...new Set(assignments.filter((assignment) => assignment.schoolId === schoolId && assignment.staffId === item.id).map((assignment) => assignment.classId))] })), headteacher: head ? { id: head.id, name: head.fullName, phone: head.phone ?? null } : null }; }
  return { list, listDurable, upload, uploadDurable, replace: upload, remove, removeDurable, activeFor, resolveForStudent, resolveForStudentDurable, options, validate };
}

function canonicalClass(value) { return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^basic/, 'primary'); }
