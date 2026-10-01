import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const clone = (value) => JSON.parse(JSON.stringify(value));
const text = (value) => String(value ?? '').trim();
const nowIso = () => new Date().toISOString();
const fail = (message, status = 400, code = 'ASSIGNMENT_ERROR') => { throw Object.assign(new Error(message), { status, code }); };

export function createAssignmentService({ database = null, subjects = null, students = null, classes = [], schoolId = 'school-osaah-daylight', now = nowIso } = {}) {
  const memory = new Map();
  const durable = Boolean(database?.query && database?.execute);
  const classSet = new Set(classes.map((item) => typeof item === 'string' ? item : item.id));

  function actorSchool(actor) { if (!actor?.schoolId || actor.schoolId !== schoolId) fail('Forbidden.', 403, 'SCHOOL_SCOPE_DENIED'); }
  function teacher(actor, classId) {
    actorSchool(actor);
    if (!['TEACHER', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'SCHOOL_ADMIN', 'PROPRIETOR'].includes(actor.roleKey)) fail('Teacher assignment access required.', 403, 'ASSIGNMENT_ROLE_DENIED');
    if (actor.roleKey === 'TEACHER' && !(actor.assignedClassIds ?? []).map(String).includes(String(classId))) fail('Class is outside your teacher assignment.', 403, 'ASSIGNMENT_CLASS_DENIED');
  }
  function validateInput(input, actor, { publish = false } = {}) {
    const classId = text(input.classId); const subjectId = text(input.subjectId);
    if (!classId || !subjectId || !text(input.title)) fail('Class, subject, and assignment title are required.');
    if (classSet.size && !classSet.has(classId)) fail('Class is not configured for this school.');
    teacher(actor, classId);
    if (input.dueDate && input.assignmentDate && String(input.dueDate) < String(input.assignmentDate)) fail('Due date cannot be before the assignment date.');
    const recipients = input.recipientScope === 'STUDENTS' ? [...new Set((input.studentIds ?? []).map(text).filter(Boolean))] : [];
    if (input.recipientScope === 'STUDENTS' && !recipients.length) fail('Select at least one authorized student.');
    const files = (input.files ?? []).map((file) => ({ fileName: text(file.fileName ?? file.name), mimeType: text(file.mimeType ?? file.type).toLowerCase(), size: Number(file.size ?? 0), storageReference: text(file.storageReference ?? file.storageKey) }));
    for (const file of files) { if (!IMAGE_TYPES.has(file.mimeType)) fail('Only JPEG, PNG, and WEBP assignment images are supported.'); if (!file.storageReference) fail('Assignment images require an approved durable storage reference.'); if (!Number.isFinite(file.size) || file.size <= 0 || file.size > 10 * 1024 * 1024) fail('Assignment image size must be between 1 byte and 10 MB.'); }
    if (publish && !files.length) fail('At least one assignment image is required before publishing.');
    return { classId, subjectId, recipients, files };
  }
  function view(record) { return clone({ ...record, files: (record.files ?? []).map(({ storageReference, ...file }) => ({ ...file, fileAvailable: Boolean(storageReference) })) }); }
  function authorizedParent(actor, student) { actorSchool(actor); if (actor.portal !== 'parent' || actor.roleKey !== 'PARENT') fail('Forbidden.', 403); const ids = [student.id, student.studentId, student.studentProfileId, student.permanentStudentId].map(text); return (actor.children ?? []).some((child) => ids.includes(text(child.id)) || ids.includes(text(child.permanentStudentId)) || ids.includes(text(child.studentProfileId))); }
  function matchesChild(record, student) { const ids = [student.id, student.studentId, student.studentProfileId, student.permanentStudentId].map(text); return record.recipientScope === 'CLASS' ? String(record.classId) === String(student.classId ?? student.class_id) : (record.studentIds ?? []).some((id) => ids.includes(text(id))); }

  async function create(input, actor) {
    const normalized = validateInput(input, actor); const record = { id: randomUUID(), schoolId, academicYearId: text(input.academicYearId), termId: text(input.termId), classId: normalized.classId, subjectId: normalized.subjectId, teacherId: actor.id, title: text(input.title), instructions: text(input.instructions) || null, assignmentDate: input.assignmentDate ?? null, dueDate: input.dueDate ?? null, recipientScope: input.recipientScope === 'STUDENTS' ? 'STUDENTS' : 'CLASS', studentIds: normalized.recipients, status: 'DRAFT', createdBy: actor.id, createdAt: now(), updatedAt: now(), publishedAt: null, files: normalized.files };
    if (durable) { await database.execute('INSERT INTO assignments (id,school_id,academic_year_id,term_id,class_id,subject_id,teacher_id,title,instructions,assignment_date,due_date,recipient_scope,recipient_student_ids,status,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [record.id, schoolId, record.academicYearId, record.termId, record.classId, record.subjectId, record.teacherId, record.title, record.instructions, record.assignmentDate, record.dueDate, record.recipientScope, JSON.stringify(record.studentIds), record.status, record.createdBy, record.createdAt, record.updatedAt]); for (const file of record.files) await database.execute('INSERT INTO assignment_files (id,assignment_id,school_id,file_name,mime_type,file_size,storage_reference,created_at) VALUES (?,?,?,?,?,?,?,?)', [randomUUID(), record.id, schoolId, file.fileName, file.mimeType, file.size, file.storageReference, record.createdAt]); } else memory.set(record.id, record);
    return view(record);
  }
  async function publish(id, actor) { const record = await getForStaff(id, actor); validateInput(record, actor, { publish: true }); record.status = 'PUBLISHED'; record.publishedBy = actor.id; record.publishedAt = now(); record.updatedAt = record.publishedAt; if (durable) await database.execute('UPDATE assignments SET status=?,published_by=?,published_at=?,updated_at=? WHERE id=? AND school_id=?', ['PUBLISHED', actor.id, record.publishedAt, record.updatedAt, id, schoolId]); else memory.set(id, record); return view(record); }
  async function getForStaff(id, actor) { actorSchool(actor); const record = durable ? await loadDurable(id) : memory.get(id); if (!record || (actor.roleKey === 'TEACHER' && !(actor.assignedClassIds ?? []).map(String).includes(String(record.classId)))) fail('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND'); return record; }
  async function loadDurable(id) { const rows = await database.query('SELECT id,school_id AS schoolId,academic_year_id AS academicYearId,term_id AS termId,class_id AS classId,subject_id AS subjectId,teacher_id AS teacherId,title,instructions,assignment_date AS assignmentDate,due_date AS dueDate,recipient_scope AS recipientScope,recipient_student_ids AS recipientStudentIds,status,created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt,published_at AS publishedAt FROM assignments WHERE id=? AND school_id=? LIMIT 1', [id, schoolId]); if (!rows[0]) return null; const files = await database.query('SELECT file_name AS fileName,mime_type AS mimeType,file_size AS size,storage_reference AS storageReference FROM assignment_files WHERE assignment_id=? AND school_id=? ORDER BY created_at,id', [id, schoolId]); const row = rows[0]; return { ...row, studentIds: typeof row.recipientStudentIds === 'string' ? JSON.parse(row.recipientStudentIds || '[]') : (row.recipientStudentIds ?? []), files }; }
  async function listForParent(actor, student, filters = {}) {
    authorizedParent(actor, student);
    const rows = durable ? await database.query(
      "SELECT id,school_id AS schoolId,academic_year_id AS academicYearId,term_id AS termId,class_id AS classId,subject_id AS subjectId,teacher_id AS teacherId,title,instructions,assignment_date AS assignmentDate,due_date AS dueDate,recipient_scope AS recipientScope,recipient_student_ids AS recipientStudentIds,status,created_by AS createdBy,created_at AS createdAt,updated_at AS updatedAt,published_at AS publishedAt FROM assignments WHERE school_id=? AND status=? AND (?='' OR academic_year_id=?) AND (?='' OR term_id=?) AND class_id=? ORDER BY due_date,created_at DESC",
      [schoolId, 'PUBLISHED', text(filters.academicYearId), text(filters.academicYearId), text(filters.termId), text(filters.termId), text(student.classId ?? student.class_id)]
    ) : [...memory.values()];
    const result = [];
    for (const raw of rows) {
      const record = durable ? {
        ...raw,
        studentIds: typeof raw.recipientStudentIds === 'string' ? JSON.parse(raw.recipientStudentIds || '[]') : (raw.recipientStudentIds ?? []),
        files: await database.query('SELECT file_name AS fileName,mime_type AS mimeType,file_size AS size,storage_reference AS storageReference FROM assignment_files WHERE assignment_id=? AND school_id=? ORDER BY created_at,id', [raw.id, schoolId])
      } : raw;
      if (record.status === 'PUBLISHED' && matchesChild(record, student)) result.push(view(record));
    }
    return result;
  }
  async function getForParent(id, actor, student) { authorizedParent(actor, student); const rows = await listForParent(actor, student); const record = rows.find((item) => item.id === id); if (!record) fail('Assignment not found.', 404, 'ASSIGNMENT_NOT_FOUND'); return record; }
  async function pdf(id, actor, student) { const record = await getForParent(id, actor, student); return new Promise((resolve, reject) => { const document = new PDFDocument({ size: 'A4', margins: { top: 48, right: 48, bottom: 48, left: 48 } }); const chunks = []; document.on('data', (chunk) => chunks.push(chunk)); document.on('end', () => resolve(Buffer.concat(chunks))); document.on('error', reject); document.font('Helvetica-Bold').fontSize(18).fillColor('#102a43').text('OSAAH DAYLIGHT SCHOOL', { align: 'center' }); document.moveDown().fontSize(14).text('ASSIGNMENT'); document.moveDown().font('Helvetica').fontSize(10); for (const [label, value] of [['Student', student.name ?? student.fullName], ['Permanent Student ID', student.permanentStudentId], ['Class', student.className ?? student.classId], ['Academic Year', record.academicYearId], ['Term', record.termId], ['Subject', record.subjectId], ['Title', record.title], ['Assignment Date', record.assignmentDate], ['Due Date', record.dueDate], ['Teacher', record.teacherId]]) document.text(`${label}: ${value ?? '—'}`); document.moveDown().font('Helvetica-Bold').text('Instructions'); document.font('Helvetica').text(record.instructions ?? '—', { width: 500 }); document.moveDown().font('Helvetica-Bold').text('Uploaded assignment images'); document.font('Helvetica').text((record.files ?? []).map((file) => `${file.fileName} (${file.mimeType})`).join('\n') || 'No image metadata available.'); document.moveDown().fillColor('#9b2c2c').font('Helvetica-Bold').text(student.isTestRecord ? 'SAMPLE DATA' : 'Authorized parent copy', { align: 'center' }); document.end(); }); }
  async function options(actor) { actorSchool(actor); const configuredSubjects = subjects?.list ? subjects.list({ includeInactive: false }, actor) : []; return { classes: [...classSet].map((id) => ({ id, name: id.replace(/^KG([12])$/, 'KG $1') })), subjects: configuredSubjects }; }
  return { create, publish, listForParent, getForParent, pdf, options, getForStaff, durable };
}
