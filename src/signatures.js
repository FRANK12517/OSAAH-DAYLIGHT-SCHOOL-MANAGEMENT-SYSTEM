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
  let roleSchemaCache = null;
  const classOptions = () => [...new Set(classes)].filter(Boolean);
  const activeStaff = () => (staff?.listProfiles?.() ?? []).filter((item) => item.schoolId === schoolId && item.employmentStatus === 'ACTIVE');
  const teacherFor = (id) => activeStaff().find((item) => item.id === id && item.roleKey === 'TEACHER');
  const headteacherFor = (actor) => activeStaff().find((item) => item.roleKey === 'HEADTEACHER') ?? activeStaff().find((item) => item.roleKey === 'PROPRIETOR') ?? activeStaff().find((item) => item.id === actorId(actor));
  const assignmentMatches = (teacherId, classId, academicYear, term) => (staff?.assignments?.() ?? []).some((item) => item.schoolId === schoolId && item.staffId === teacherId && item.classId === classId && (!academicYear || !item.academicYearId || String(item.academicYearId) === academicYear) && (!term || !item.termId || String(item.termId) === term));
  function assertActor(actor) { if (!actor || actor.schoolId !== schoolId || !canManage(actor)) throw new Error('Forbidden.'); }
  function validate(input, actor) {
    const signatoryRole = text(input?.signatoryRole ?? input?.signatory_role ?? input?.role).toUpperCase();
    const mimeType = text(input?.mimeType ?? input?.mime_type ?? input?.documentType ?? 'image/png').toLowerCase();
    const processedImageData = text(input?.processedImageData ?? input?.processed_image_data ?? input?.data);
    const size = Number(input?.size ?? input?.documentSize ?? input?.document_size ?? Math.floor(processedImageData.length * 3 / 4));
    if (!['HEADTEACHER', 'CLASS_TEACHER'].includes(signatoryRole)) throw new Error('Unsupported signatory role.');
    if (!ALLOWED_TYPES.has(mimeType)) throw new Error('Only processed PNG signatures or existing secure references are supported.');
    if (!Number.isFinite(size) || size <= 0) throw new Error('Signature image is invalid.');
    let storageKey = text(input.storageKey ?? input.storage_key ?? input.fileReference);
    if (processedImageData) {
      if (mimeType !== 'image/png' || !/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(processedImageData)) throw new Error('Upload a valid processed PNG signature image.');
      if (!Buffer.from(processedImageData.slice(processedImageData.indexOf(',') + 1), 'base64').subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Signature image is not a valid PNG.');
      storageKey = `signatures/${randomUUID()}.png`;
    } else if (!safeStorageKey(storageKey)) throw new Error('A valid secure signature reference is required.');
    const academicYear = text(input?.academicYear ?? input?.academic_year);
    const term = text(input?.term);
    const classId = text(input?.classId ?? input?.class_id);
    const teacherId = text(input?.teacherId ?? input?.teacher_id ?? input?.staff_id);
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
    const fullName = text(input?.fullName ?? input?.full_name ?? identity?.fullName);
    const phone = text(input?.phone ?? input?.phoneNumber ?? input?.phone_number ?? identity?.phone);
    if (!fullName) throw new Error('Full name is required.');
    if (!phone) throw new Error('Phone number is required.');
    if (!isValidGhanaPhone(phone)) throw new Error('Invalid Ghana phone number.');
    return { signatoryRole, mimeType, size, storageKey, processedImageData, fullName, phone, academicYear: academicYear || null, term: term || null, classId: signatoryRole === 'CLASS_TEACHER' ? classId : null, teacherId: signatoryRole === 'CLASS_TEACHER' ? teacherId : identity?.id ?? null };
  }
  async function resultSignatureRoleSchema() {
    if (!database?.query) return { roleColumns: ['signatory_role'], roleExpression: 'signatory_role', available: null, ready: true };
    const inspectSchema = async () => {
      const inspect = async () => rows(await database.query("SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='result_signatures'"));
      const profileColumns = [
        ['signatory_role', 'VARCHAR(64) NULL'], ['staff_id', 'VARCHAR(191) NULL'],
        ['full_name', 'VARCHAR(255) NULL'], ['phone_number', 'VARCHAR(64) NULL'],
        ['class_id', 'VARCHAR(191) NULL'], ['academic_year', 'VARCHAR(64) NULL'],
        ['term', 'VARCHAR(64) NULL'], ['processed_image_data', 'LONGTEXT NULL']
      ];
      const roleCandidates = ['signatory_role', 'role', 'signature_role', 'signatory_type', 'signature_type'];
      const columnsFrom = (items) => new Set(items.map((item) => String(item.columnName ?? item.COLUMN_NAME ?? '').toLowerCase()));
      let available;
      try { available = columnsFrom(await inspect()); }
      catch (error) { return { roleColumns: [], roleExpression: null, available: new Set(), ready: false, reason: 'COLUMN_INSPECTION_UNAVAILABLE', cause: error }; }
      if (!available.size) return { roleColumns: [], roleExpression: null, available, ready: false, reason: 'RESULT_SIGNATURES_TABLE_MISSING' };

      // Migration 090 is additive. Try its idempotent columns, but runtime
      // credentials may be read-only; always re-read information_schema after
      // DDL attempts and build SQL only from columns confirmed to exist.
      const addColumn = async (column, definition) => {
        try { await database.execute(`ALTER TABLE result_signatures ADD COLUMN IF NOT EXISTS ${column === 'role' ? '`role`' : column} ${definition}`); }
        catch (error) { return error; }
        return null;
      };
      if (!roleCandidates.some((column) => available.has(column))) await addColumn('role', 'VARCHAR(64) NULL');
      for (const [column, definition] of profileColumns) if (!available.has(column)) await addColumn(column, definition);
      try { available = columnsFrom(await inspect()); }
      catch (error) { return { roleColumns: [], roleExpression: null, available: new Set(), ready: false, reason: 'COLUMN_INSPECTION_UNAVAILABLE', cause: error }; }

      const roleColumns = roleCandidates.filter((column) => available.has(column));
      const quotedRoleColumns = roleColumns.map((column) => `\`${column}\``);
      const roleExpression = quotedRoleColumns.length > 1
        ? `COALESCE(${quotedRoleColumns.map((column) => `NULLIF(${column},'')`).join(',')})`
        : quotedRoleColumns[0] ?? null;
      return { roleColumns, roleExpression, available, ready: Boolean(roleExpression), reason: !roleExpression ? 'ROLE_COLUMN_UNAVAILABLE' : null };
    };
    // Cache only a schema with a verified role field. Empty/failed inspections
    // must be retried so a later migration or permission change takes effect.
    const schema = roleSchemaCache ? await roleSchemaCache : await inspectSchema();
    roleSchemaCache = schema.roleColumns.length > 0 ? Promise.resolve(schema) : null;
    return schema;
  }
  const schemaHas = (schema, column) => !schema.available || schema.available.has(column);
  const schemaSelect = (schema, column, alias, fallback = 'NULL') => schemaHas(schema, column) ? `\`${column}\` AS ${alias}` : `${fallback} AS ${alias}`;
  function list(actor) { assertActor(actor); return [...signatures.values()].map(({ data, processedImageData, ...safe }) => ({ ...clone(safe), data: data ?? processedImageData })); }
  async function listDurable(actor) {
    assertActor(actor);
    if (!database?.query) return list(actor);
    const schema = await resultSignatureRoleSchema();
    if (!schema.ready || !schemaHas(schema, 'school_id')) return [];
    const storageKey = schemaHas(schema, 'storage_key') && schemaHas(schema, 'signature_url')
      ? "COALESCE(NULLIF(`storage_key`,''),`signature_url`) AS storageKey"
      : schemaSelect(schema, schemaHas(schema, 'storage_key') ? 'storage_key' : 'signature_url', 'storageKey', "''");
    const imageData = schemaHas(schema, 'processed_image_data')
      ? (schemaHas(schema, 'active') ? 'CASE WHEN `active`=1 THEN `processed_image_data` ELSE NULL END AS data' : '`processed_image_data` AS data')
      : 'NULL AS data';
    const orderBy = ['active', 'uploaded_at', 'id'].filter((column) => schemaHas(schema, column)).map((column) => `\`${column}\` DESC`);
    return rows(await database.query(`SELECT ${[
      schemaSelect(schema, 'id', 'id'), `${schema.roleExpression} AS signatoryRole`, storageKey,
      schemaSelect(schema, 'mime_type', 'mimeType', "'image/png'"), schemaSelect(schema, 'document_size', 'size', '0'),
      schemaSelect(schema, 'active', 'active', '1'), schemaSelect(schema, 'uploaded_by', 'uploadedBy'),
      schemaSelect(schema, 'uploaded_at', 'uploadedAt'), schemaSelect(schema, 'updated_at', 'updatedAt'),
      schemaSelect(schema, 'staff_id', 'teacherId'), schemaSelect(schema, 'full_name', 'fullName'),
      schemaSelect(schema, 'phone_number', 'phone'), schemaSelect(schema, 'class_id', 'classId'),
      schemaSelect(schema, 'academic_year', 'academicYear'), schemaSelect(schema, 'term', 'term'), imageData
    ].join(',')} FROM result_signatures WHERE school_id=?${orderBy.length ? ` ORDER BY ${orderBy.join(',')}` : ''}`, [schoolId])).map((item) => ({ ...item, active: Boolean(item.active), name: item.fullName }));
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
    const schema = await resultSignatureRoleSchema();
    const unavailable = (reason) => Object.assign(new Error(`Signature storage schema is incomplete (${reason}). Apply migration 090 or grant the database user the required ALTER privileges, then retry.`), { status: 503, code: `RESULT_SIGNATURE_${reason}` });
    if (!schema.ready) throw unavailable(schema.reason ?? 'SCHEMA_UNAVAILABLE');
    for (const column of ['id', 'school_id', 'active', 'processed_image_data']) if (!schemaHas(schema, column)) throw unavailable(`MISSING_${column.toUpperCase()}`);
    if (!schemaHas(schema, 'storage_key') && !schemaHas(schema, 'signature_url')) throw unavailable('MISSING_SIGNATURE_STORAGE_COLUMN');
    if (meta.signatoryRole === 'CLASS_TEACHER' && ['class_id', 'academic_year', 'term', 'staff_id'].some((column) => !schemaHas(schema, column))) throw unavailable('MISSING_CLASS_TEACHER_SCOPE_COLUMN');
    const assignments = ['`active`=0'];
    const deactivateParams = [];
    if (schemaHas(schema, 'updated_at')) { assignments.push('`updated_at`=?'); deactivateParams.push(timestamp); }
    const predicates = ['`school_id`=?', `${schema.roleExpression}=?`];
    deactivateParams.push(schoolId, meta.signatoryRole);
    for (const [column, value] of [['class_id', meta.classId], ['academic_year', meta.academicYear], ['term', meta.term], ['staff_id', meta.teacherId]]) {
      if (!schemaHas(schema, column)) continue;
      const identifier = `\`${column}\``;
      predicates.push(`((${identifier} IS NULL AND ? IS NULL) OR ${identifier}=?)`);
      deactivateParams.push(value, value);
    }
    predicates.push('`active`=1');
    const deactivate = `UPDATE result_signatures SET ${assignments.join(',')} WHERE ${predicates.join(' AND ')}`;
    const values = new Map([
      ['id', id], ['school_id', schoolId], ['storage_key', meta.storageKey], ['signature_url', meta.storageKey],
      ['mime_type', 'image/png'], ['document_size', meta.size], ['active', 1], ['uploaded_by', actorId(actor)],
      ['uploaded_at', timestamp], ['updated_at', timestamp], ['staff_id', meta.teacherId],
      ['full_name', meta.fullName], ['phone_number', meta.phone], ['class_id', meta.classId],
      ['academic_year', meta.academicYear], ['term', meta.term], ['processed_image_data', meta.processedImageData],
      ['signature_type', meta.signatoryRole]
    ]);
    for (const column of schema.roleColumns) values.set(column, meta.signatoryRole);
    const insertColumns = [...values.keys()].filter((column) => schemaHas(schema, column));
    const quotedInsertColumns = insertColumns.map((column) => `\`${column}\``);
    const insertValues = insertColumns.map((column) => values.get(column));
    await database.transaction(async (tx) => {
      await tx.execute(deactivate, deactivateParams);
      await tx.execute(`INSERT INTO result_signatures (${quotedInsertColumns.join(',')}) VALUES (${insertValues.map(() => '?').join(',')})`, insertValues);
    });
    const { processedImageData, ...safeMeta } = meta;
    return { id, schoolId, ...safeMeta, mimeType: 'image/png', active: true, uploadedBy: actorId(actor), uploadedAt: timestamp, updatedAt: timestamp };
  }
  async function removeDurable(id, actor) {
    assertActor(actor);
    if (database?.execute) {
      const schema = await resultSignatureRoleSchema();
      if (!schema.ready || !schemaHas(schema, 'id') || !schemaHas(schema, 'school_id') || !schemaHas(schema, 'active')) throw Object.assign(new Error('Signature storage schema cannot safely deactivate this profile.'), { status: 503, code: 'RESULT_SIGNATURE_DEACTIVATION_SCHEMA_UNAVAILABLE' });
      const assignments = ['`active`=0'];
      const params = [];
      if (schemaHas(schema, 'updated_at')) { assignments.push('`updated_at`=?'); params.push(now()); }
      params.push(id, schoolId);
      const result = await database.execute(`UPDATE result_signatures SET ${assignments.join(',')} WHERE \`id\`=? AND \`school_id\`=?`, params);
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
    const schema = await resultSignatureRoleSchema();
    const emptyResolution = () => ({ classTeacher: { name: teacher?.fullName ?? null, phone: teacher?.phone ?? null, signature: null }, headteacher: { name: headteacherFor()?.fullName ?? null, phone: headteacherFor()?.phone ?? null, signature: null } });
    if (!schema.ready || !schemaHas(schema, 'school_id') || !schemaHas(schema, 'active')) return emptyResolution();
    const find = async (signatoryRole, scopedClass, staffId) => {
      const predicates = ['`school_id`=?', `${schema.roleExpression}=?`, '`active`=1'];
      const params = [schoolId, signatoryRole];
      for (const [column, value] of [['class_id', scopedClass], ['staff_id', staffId], ['academic_year', context.academicYear ?? null], ['term', context.term ?? null]]) {
        if (!schemaHas(schema, column)) continue;
        predicates.push(`(\`${column}\` IS NULL OR \`${column}\`=?)`);
        params.push(value);
      }
      const orderBy = [
        schemaHas(schema, 'class_id') ? 'CASE WHEN `class_id` IS NULL THEN 1 ELSE 0 END' : null,
        schemaHas(schema, 'academic_year') ? 'CASE WHEN `academic_year` IS NULL THEN 1 ELSE 0 END' : null,
        schemaHas(schema, 'uploaded_at') ? '`uploaded_at` DESC' : null
      ].filter(Boolean);
      const storageKey = schemaHas(schema, 'storage_key') && schemaHas(schema, 'signature_url')
        ? "COALESCE(NULLIF(`storage_key`,''),`signature_url`) AS storageKey"
        : schemaSelect(schema, schemaHas(schema, 'storage_key') ? 'storage_key' : 'signature_url', 'storageKey', "''");
      const selected = [
        schemaSelect(schema, 'id', 'id'), `${schema.roleExpression} AS signatoryRole`, storageKey,
        schemaSelect(schema, 'mime_type', 'mimeType', "'image/png'"), schemaSelect(schema, 'document_size', 'size', '0'),
        schemaSelect(schema, 'staff_id', 'teacherId'), schemaSelect(schema, 'full_name', 'fullName'),
        schemaSelect(schema, 'phone_number', 'phone'), schemaSelect(schema, 'class_id', 'classId'),
        schemaSelect(schema, 'academic_year', 'academicYear'), schemaSelect(schema, 'term', 'term'),
        schemaSelect(schema, 'processed_image_data', 'data'), schemaSelect(schema, 'active', 'active', '1'),
        schemaSelect(schema, 'uploaded_at', 'uploadedAt'), schemaSelect(schema, 'updated_at', 'updatedAt')
      ];
      return rows(await database.query(`SELECT ${selected.join(',')} FROM result_signatures WHERE ${predicates.join(' AND ')}${orderBy.length ? ` ORDER BY ${orderBy.join(',')}` : ''} LIMIT 1`, params))[0] ?? null;
    };
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
