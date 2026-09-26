import { randomUUID } from 'node:crypto';
import { CORE_LEVELS } from './students.js';
import { isValidGhanaPhone } from './ghana-phone.js';

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/svg+xml']);
const EXTENSIONS = Object.freeze({ 'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'image/svg+xml': ['svg'] });
const MAX_BYTES = 2 * 1024 * 1024;
const clone = (value) => JSON.parse(JSON.stringify(value));
const actorId = (actor) => actor?.id ?? actor?.userId ?? null;
const canManage = (actor) => ['PROPRIETOR', 'HEADTEACHER'].includes(actor?.roleKey) || actor?.permissions?.has?.('signatures.manage') || actor?.permissions?.has?.('*');
const text = (value) => String(value ?? '').trim();
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

function safeStorageKey(value, mimeType) {
  const key = text(value);
  if (!/^signatures\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(key) || key.includes('..') || key.includes('//') || /[\\\s?#%]/.test(key) || /^https?:/i.test(key)) return false;
  const extension = key.split('.').at(-1)?.toLowerCase();
  return EXTENSIONS[mimeType]?.includes(extension) ?? false;
}

function validateMetadata(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('A signature profile is required.');
  const signatoryRole = text(input.signatoryRole).toUpperCase();
  const mimeType = text(input.mimeType ?? input.documentType).toLowerCase();
  const size = Number(input.size ?? input.documentSize ?? 0);
  const storageKey = text(input.storageKey ?? input.signatureUrl ?? input.fileReference);
  if (!['HEADTEACHER', 'CLASS_TEACHER'].includes(signatoryRole)) fail('Unsupported signatory role.');
  if (!ALLOWED_TYPES.has(mimeType)) fail('Only PNG, JPEG, and SVG signatures are supported.');
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) fail('Signature file is too large or invalid.');
  if (!safeStorageKey(storageKey, mimeType)) fail('A valid secure signature reference with a matching image extension is required.');
  // This management contract accepts references to already stored assets, not
  // image bytes. Do not silently discard or persist a client-provided payload.
  if (['data', 'content', 'imageData', 'base64', 'file'].some((key) => input[key] != null && input[key] !== '')) fail('Upload the image to secure signature storage and provide its reference.');
  return { signatoryRole, mimeType, size, storageKey };
}

export function createSignatureService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight', staff = null, classes = CORE_LEVELS, database = null, idFactory = randomUUID } = {}) {
  const signatures = new Map();
  const classOptions = () => [...new Set(classes)].filter(Boolean);
  const activeStaff = () => (staff?.listProfiles?.() ?? []).filter((item) => item.schoolId === schoolId && item.employmentStatus === 'ACTIVE');
  const teacherFor = (id) => activeStaff().find((item) => item.id === id && item.roleKey === 'TEACHER');
  const headteacherFor = (actor) => activeStaff().find((item) => item.roleKey === 'HEADTEACHER') ?? activeStaff().find((item) => item.roleKey === 'PROPRIETOR') ?? activeStaff().find((item) => item.id === actorId(actor));
  const assignmentMatches = (teacherId, classId, academicYear, term) => (staff?.assignments?.() ?? []).some((item) => item.schoolId === schoolId && item.staffId === teacherId && item.classId === classId && (!academicYear || !item.academicYearId || String(item.academicYearId) === academicYear) && (!term || !item.termId || String(item.termId) === term));
  function assertActor(actor) { if (!actor || actor.schoolId !== schoolId || !canManage(actor)) fail('Forbidden.', 403); }

  function validate(input, actor) {
    assertActor(actor);
    const metadata = validateMetadata(input);
    const academicYear = text(input.academicYear);
    const term = text(input.term);
    const classId = text(input.classId);
    const teacherId = text(input.teacherId);
    let identity = null;
    if (metadata.signatoryRole === 'CLASS_TEACHER') {
      if (!classId || !classOptions().includes(classId)) fail('A registered class is required.');
      identity = teacherId ? teacherFor(teacherId) : null;
      if (!identity) fail('An active class teacher is required.');
      if (!academicYear || !term) fail('Academic year and term are required.');
      if (staff && !assignmentMatches(teacherId, classId, academicYear, term)) fail('Teacher is not assigned to this class and academic context.');
    } else identity = headteacherFor(actor);
    const fullName = text(input.fullName ?? identity?.fullName);
    const phone = text(input.phone ?? identity?.phone);
    if (!fullName) fail('Full name is required.');
    if (!phone) fail('Phone number is required.');
    if (!isValidGhanaPhone(phone)) fail('Invalid Ghana phone number.');
    return { ...metadata, fullName, phone, academicYear: academicYear || null, term: term || null, classId: metadata.signatoryRole === 'CLASS_TEACHER' ? classId : null, teacherId: metadata.signatoryRole === 'CLASS_TEACHER' ? teacherId : identity?.id ?? null };
  }

  async function durableIdentityFor(input, actor, metadata) {
    assertActor(actor);
    if (!database?.query || !database?.execute) fail('Durable signature database is unavailable.', 503);
    if (actor.schoolId !== schoolId) fail('Forbidden.', 403);
    if (metadata.signatoryRole === 'CLASS_TEACHER') {
      const classId = text(input.classId), year = text(input.academicYear), term = text(input.term), teacherId = text(input.teacherId);
      if (!classId || !year || !term || !teacherId) fail('Class, teacher, academic year, and term are required.');
      const classRows = await database.query('SELECT id FROM classes WHERE id=? AND school_id=? LIMIT 1', [classId, schoolId]);
      if (!classRows.length) fail('Class not found.');
      const yearRow = (await database.query('SELECT id,name FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, year, year]))[0];
      if (!yearRow) fail('Academic year not found.');
      const termRow = (await database.query('SELECT t.id FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? AND y.id=? AND (t.id=? OR t.name=?) LIMIT 1', [schoolId, yearRow.id, term, term]))[0];
      if (!termRow) fail('Term not found.');
      const identity = (await database.query(`SELECT sp.id AS staffId,u.full_name AS fullName,u.phone
        FROM staff_profiles sp JOIN users u ON u.id=sp.user_id AND u.school_id=sp.school_id AND u.status='ACTIVE'
        JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id
        WHERE sp.id=? AND sp.school_id=? AND r.role_key='TEACHER'`, [teacherId, schoolId]))[0];
      if (!identity) fail('An active class teacher in this school is required.');
      const assignment = await database.query(`SELECT a.id FROM staff_assignments a
        JOIN staff_profiles sp ON sp.id=a.staff_id AND sp.school_id=?
        JOIN users u ON u.id=sp.user_id AND u.school_id=sp.school_id AND u.status='ACTIVE'
        JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id AND r.role_key='TEACHER'
        WHERE a.staff_id=? AND a.class_id=? AND a.academic_year_id=? AND a.term_id=? AND a.subject_id IS NULL LIMIT 1`,
      [schoolId, identity.staffId, classId, yearRow.id, termRow.id]);
      if (!assignment.length) fail('Teacher is not assigned to this class and academic context.');
      return { ...identity, classId, academicYear: yearRow.name, termId: termRow.id, academicYearId: yearRow.id };
    }
    const heads = await database.query(`SELECT DISTINCT sp.id AS staffId,u.full_name AS fullName,u.phone
      FROM staff_profiles sp JOIN users u ON u.id=sp.user_id AND u.school_id=sp.school_id AND u.status='ACTIVE'
      JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id
      WHERE sp.school_id=? AND r.role_key='HEADTEACHER'`, [schoolId]);
    if (heads.length !== 1) fail('A single active official Headteacher is required.');
    return heads[0];
  }

  async function validateDurable(input, actor) {
    const metadata = validateMetadata(input);
    const identity = await durableIdentityFor(input, actor, metadata);
    const fullName = text(identity.fullName), phone = text(identity.phone);
    if (!fullName) fail('The staff full name is not recorded.');
    if (!phone) fail('The staff phone number is not recorded.');
    if (!isValidGhanaPhone(phone)) fail('The staff phone number is invalid.');
    return { ...metadata, staffId: identity.staffId, fullName, phone,
      classId: metadata.signatoryRole === 'CLASS_TEACHER' ? identity.classId : null,
      academicYear: metadata.signatoryRole === 'CLASS_TEACHER' ? identity.academicYear : null };
  }

  function logicalScope(metadata, staffId, classId, academicYear) {
    if (metadata.signatoryRole === 'CLASS_TEACHER') return { clause: 'school_id=? AND staff_id=? AND signature_type=? AND class_id=? AND academic_year=?', params: [schoolId, staffId, metadata.signatoryRole, classId, academicYear] };
    return { clause: 'school_id=? AND staff_id=? AND signature_type=? AND class_id IS NULL AND academic_year IS NULL', params: [schoolId, staffId, metadata.signatoryRole] };
  }

  async function durableList(actor) {
    assertActor(actor);
    return database.query(`SELECT rs.id,rs.school_id AS schoolId,rs.staff_id AS staffId,rs.signature_type AS signatoryRole,
      rs.class_id AS classId,rs.academic_year AS academicYear,rs.signature_url AS signatureUrl,
      rs.is_active AS active,rs.uploaded_by AS uploadedBy,rs.uploaded_at AS uploadedAt,
      rs.deactivated_by AS deactivatedBy,rs.deactivated_at AS deactivatedAt,
      u.full_name AS fullName,u.phone
      FROM result_signatures rs JOIN staff_profiles sp ON sp.id=rs.staff_id AND sp.school_id=rs.school_id
      JOIN users u ON u.id=sp.user_id AND u.school_id=sp.school_id
      WHERE rs.school_id=? ORDER BY rs.created_at DESC,rs.id`, [schoolId]);
  }

  async function durableOptions(actor) {
    assertActor(actor);
    const [classRows, teachers, heads] = await Promise.all([
      database.query('SELECT id,name FROM classes WHERE school_id=? ORDER BY name,id', [schoolId]),
      database.query(`SELECT DISTINCT sp.id,u.full_name AS name,u.phone FROM staff_profiles sp
        JOIN users u ON u.id=sp.user_id AND u.school_id=sp.school_id AND u.status='ACTIVE'
        JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id
        WHERE sp.school_id=? AND r.role_key='TEACHER' ORDER BY u.full_name,sp.id`, [schoolId]),
      database.query(`SELECT DISTINCT sp.id,u.full_name AS name,u.phone FROM staff_profiles sp
        JOIN users u ON u.id=sp.user_id AND u.school_id=sp.school_id AND u.status='ACTIVE'
        JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id
        WHERE sp.school_id=? AND r.role_key='HEADTEACHER' ORDER BY u.full_name,sp.id`, [schoolId])
    ]);
    return { classes: classRows, teachers, headteacher: heads.length === 1 ? heads[0] : null };
  }

  async function durableUpload(input, actor) {
    const normalized = await validateDurable(input, actor);
    const { staffId, fullName, phone, classId, academicYear, signatoryRole, storageKey } = normalized;
    const scope = logicalScope(normalized, staffId, classId, academicYear);
    const timestamp = now();
    const id = idFactory();
    const write = async (tx) => {
      // Serialize signature changes for this school on a stable tenant row so
      // concurrent first uploads cannot create two active rows in one scope.
      if (tx.supportsRowLocks) {
        const school = await tx.query('SELECT id FROM schools WHERE id=? FOR UPDATE', [schoolId]);
        if (!school.length) fail('School not found.', 403);
      }
      const activeRows = await tx.query(`SELECT id,signature_url AS signatureUrl,uploaded_by AS uploadedBy,uploaded_at AS uploadedAt
        FROM result_signatures WHERE ${scope.clause} AND is_active=1 ORDER BY created_at DESC,id`, scope.params);
      const existingSame = activeRows.find((item) => item.signatureUrl === storageKey);
      if (existingSame) {
        // Repair any pre-existing duplicate-active state while treating this
        // retry as idempotent and preserving the matching historical record.
        if (activeRows.length > 1) await tx.execute(`UPDATE result_signatures SET is_active=0,deactivated_by=?,deactivated_at=?,updated_at=?
          WHERE ${scope.clause} AND is_active=1 AND id<>?`, [actorId(actor), timestamp, timestamp, ...scope.params, existingSame.id]);
        return { id: existingSame.id, schoolId, staffId, signatoryRole,
          classId, academicYear, signatureUrl: existingSame.signatureUrl, active: true, uploadedBy: existingSame.uploadedBy,
          uploadedAt: existingSame.uploadedAt, fullName, phone, created: false };
      }
      await tx.execute(`UPDATE result_signatures SET is_active=0,deactivated_by=?,deactivated_at=?,updated_at=?
        WHERE ${scope.clause} AND is_active=1`, [actorId(actor), timestamp, timestamp, ...scope.params]);
      await tx.execute(`INSERT INTO result_signatures
        (id,school_id,staff_id,signature_type,class_id,academic_year,signature_url,is_active,uploaded_by,uploaded_at,deactivated_by,deactivated_at,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,1,?,?,NULL,NULL,?,?)`, [id, schoolId, staffId, signatoryRole, classId, academicYear,
        storageKey, actorId(actor), timestamp, timestamp, timestamp]);
      return { id, schoolId, staffId, signatoryRole, classId, academicYear,
        signatureUrl: storageKey, active: true, uploadedBy: actorId(actor), uploadedAt: timestamp, fullName, phone, created: true };
    };
    return database.transaction ? database.transaction(write) : write(database);
  }

  async function durableRemove(id, actor) {
    assertActor(actor);
    const timestamp = now();
    const record = (await database.query(`SELECT id,staff_id AS staffId,signature_type AS signatoryRole,class_id AS classId,
      academic_year AS academicYear,signature_url AS signatureUrl,is_active AS active
      FROM result_signatures WHERE id=? AND school_id=? LIMIT 1`, [id, schoolId]))[0];
    if (!record) fail('Signature not found.', 404);
    if (Number(record.active)) await database.execute(`UPDATE result_signatures SET is_active=0,deactivated_by=?,deactivated_at=?,updated_at=?
      WHERE id=? AND school_id=? AND is_active=1`, [actorId(actor), timestamp, timestamp, id, schoolId]);
    return { ...record, schoolId, active: false, deactivatedBy: actorId(actor), deactivatedAt: timestamp };
  }

  function mapUpload(input, actor) {
    const meta = validate(input, actor);
    const record = { id: idFactory(), schoolId, ...meta, name: meta.fullName, data: null, active: true, uploadedBy: actorId(actor), uploadedAt: now(), updatedAt: now() };
    for (const item of signatures.values()) if (item.schoolId === schoolId && item.signatoryRole === meta.signatoryRole && item.active && item.academicYear === meta.academicYear && item.term === meta.term && item.classId === meta.classId && item.teacherId === meta.teacherId) item.active = false;
    signatures.set(record.id, record);
    return clone(record);
  }

  function activeFor(role, context = {}) {
    if (database) return null;
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
    if (student?.schoolId && student.schoolId !== schoolId) fail('Forbidden.', 403);
    if (database) return { classTeacher: { name: null, phone: null, signature: null }, headteacher: { name: null, phone: null, signature: null } };
    const classTeacher = (staff?.assignments?.() ?? []).find((item) => item.schoolId === schoolId && item.classId === student?.classId && (!context.academicYear || !item.academicYearId || String(item.academicYearId) === String(context.academicYear)) && (!context.term || !item.termId || String(item.termId) === String(context.term)) && teacherFor(item.staffId));
    const teacher = classTeacher ? teacherFor(classTeacher.staffId) : null;
    const classSignature = activeFor('CLASS_TEACHER', { ...context, classId: student?.classId, teacherId: teacher?.id });
    const headSignature = activeFor('HEADTEACHER', context);
    return { classTeacher: { name: classSignature?.fullName ?? teacher?.fullName ?? null, phone: classSignature?.phone ?? teacher?.phone ?? null, signature: classSignature }, headteacher: { name: headSignature?.fullName ?? headteacherFor()?.fullName ?? null, phone: headSignature?.phone ?? headteacherFor()?.phone ?? null, signature: headSignature } };
  }

  function mapOptions(actor) {
    assertActor(actor);
    const head = headteacherFor(actor);
    return { classes: classOptions(), teachers: activeStaff().filter((item) => item.roleKey === 'TEACHER').map((item) => ({ id: item.id, name: item.fullName, phone: item.phone ?? null })), headteacher: head ? { id: head.id, name: head.fullName, phone: head.phone ?? null } : null };
  }

  return {
    list: (actor) => database ? durableList(actor) : (assertActor(actor), [...signatures.values()].map(({ data, ...safe }) => clone(safe))),
    options: (actor) => database ? durableOptions(actor) : mapOptions(actor),
    upload: (input, actor) => database ? durableUpload(input, actor) : mapUpload(input, actor),
    replace: (input, actor) => database ? durableUpload(input, actor) : mapUpload(input, actor),
    remove: (id, actor) => database ? durableRemove(id, actor) : (() => { assertActor(actor); const record = signatures.get(id); if (!record || record.schoolId !== schoolId) fail('Signature not found.', 404); record.active = false; record.updatedAt = now(); return clone(record); })(),
    activeFor,
    resolveForStudent,
    validate: (input, actor) => database ? validateDurable(input, actor) : validate(input, actor),
    durable: Boolean(database)
  };
}
