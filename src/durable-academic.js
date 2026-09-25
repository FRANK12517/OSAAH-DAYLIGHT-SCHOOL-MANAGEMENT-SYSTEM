import { randomUUID } from 'node:crypto';
import { gradeForTotal } from './grading.js';

const rows = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();
const fail = (message, status = 400, code = 'ACADEMIC_DATA_ERROR') => { throw Object.assign(new Error(message), { status, code }); };

function authorized(actor, permission) {
  return actor?.permissions?.has?.('*') || actor?.permissions?.has?.(permission) || actor?.roleKey === 'PROPRIETOR';
}

export function createDurableAcademicService({ database, schoolId, idFactory = randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!database?.query || !database?.execute) fail('Durable academic database is unavailable.', 503, 'DURABLE_ACADEMIC_DATABASE_REQUIRED');

  function assertActor(actor, permission = null) {
    if (!actor?.schoolId || actor.schoolId !== schoolId) fail('Forbidden.', 403, 'TENANT_SCOPE_VIOLATION');
    if (permission && !authorized(actor, permission)) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
  }

  async function options(actor) {
    assertActor(actor);
    if (!['academics.read', 'results.read', 'examinations.read'].some((permission) => authorized(actor, permission))) fail('Forbidden.', 403);
    const [academicYears, terms, classes] = await Promise.all([
      database.query('SELECT id,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM academic_years WHERE school_id=? ORDER BY starts_on DESC,id', [schoolId]),
      database.query('SELECT t.id,t.academic_year_id AS academicYearId,t.name,t.starts_on AS startsOn,t.ends_on AS endsOn,t.is_current AS isCurrent FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? ORDER BY t.starts_on ASC,t.id', [schoolId]),
      optionClasses(actor)
    ]);
    return { academicYears: rows(academicYears), terms: rows(terms), classes: rows(classes) };
  }

  async function optionClasses(actor) {
    let records;
    try {
      // Production owns classes directly; level/order/status columns are optional.
      records = await database.query('SELECT c.* FROM classes c WHERE c.school_id=? ORDER BY c.name,c.id', [schoolId]);
    } catch (error) {
      // Only the known legacy ownership contract warrants a fallback. Never hide
      // connection, permission, or missing-table failures as an empty catalogue.
      if (error.code !== 'ER_BAD_FIELD_ERROR' || !/c\.school_id/.test(error.message)) throw error;
      records = await database.query('SELECT c.*,l.name AS levelName FROM classes c JOIN levels l ON l.id=c.level_id WHERE l.school_id=? ORDER BY l.display_order,c.display_order,c.id', [schoolId]);
    }
    return rows(records)
      .filter((item) => (item.school_id == null || item.school_id === schoolId) && (item.status == null || item.status === 'ACTIVE'))
      .filter((item) => actor.roleKey !== 'TEACHER' || !actor.assignedClassIds?.length || actor.assignedClassIds.includes(item.id))
      .map((item) => ({ id: item.id, name: item.name, displayOrder: item.sort_order ?? item.display_order ?? 0, levelName: item.levelName ?? item.level ?? null }));
  }

  async function listSubjects(filters = {}, actor) {
    assertActor(actor);
    const classId = text(filters.classId);
    if (!classId) return [];
    const academicYearId = text(filters.academicYearId || filters.academicYear);
    const params = [schoolId, classId];
    let yearClause = '';
    if (academicYearId) { yearClause = ' AND (a.academic_year_id IS NULL OR a.academic_year_id=?)'; params.push(academicYearId); }
    const result = await database.query(`SELECT s.id,s.code,s.name,s.department_id AS departmentId,a.class_id AS classId,a.academic_year_id AS academicYearId
      FROM subject_class_assignments a JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      WHERE a.school_id=? AND a.class_id=? AND a.active=1${yearClause} ORDER BY s.name,s.id`, params);
    return rows(result);
  }

  async function listAssignments(subjectId, actor) {
    assertActor(actor);
    const result = await database.query(`SELECT a.id,a.subject_id AS subjectId,a.class_id AS classId,a.academic_year_id AS academicYearId,a.active,c.name AS className,l.name AS levelName
      FROM subject_class_assignments a JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      JOIN classes c ON c.id=a.class_id JOIN levels l ON l.id=c.level_id
      WHERE a.school_id=? AND a.subject_id=? ORDER BY l.display_order,c.display_order,c.id`, [schoolId, text(subjectId)]);
    return rows(result);
  }

  async function assignSubject(input = {}, actor) {
    assertActor(actor, 'subjects.manage');
    const subjectId = text(input.subjectId || input.subject_id);
    const classId = text(input.classId || input.class_id);
    const academicYearId = text(input.academicYearId || input.academic_year_id) || null;
    if (!subjectId || !classId) fail('Subject and class are required.');
    const subject = rows(await database.query('SELECT id,name FROM subjects WHERE id=? AND school_id=? LIMIT 1', [subjectId, schoolId]))[0];
    if (!subject) fail('Subject not found.', 404);
    const classRow = rows(await database.query('SELECT c.id,c.name FROM classes c JOIN levels l ON l.id=c.level_id WHERE c.id=? AND l.school_id=? LIMIT 1', [classId, schoolId]))[0];
    if (!classRow) fail('Class not found.', 404);
    const existing = rows(await database.query('SELECT id,active FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND ((academic_year_id IS NULL AND ? IS NULL) OR academic_year_id=?) LIMIT 1', [schoolId, subjectId, classId, academicYearId, academicYearId]))[0];
    if (existing) {
      if (!Number(existing.active)) await database.execute('UPDATE subject_class_assignments SET active=1,updated_at=? WHERE id=? AND school_id=?', [clock(), existing.id, schoolId]);
      return { id: existing.id, schoolId, subjectId, classId, academicYearId, active: true, created: false };
    }
    const id = idFactory();
    await database.execute('INSERT INTO subject_class_assignments (id,school_id,subject_id,class_id,academic_year_id,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)', [id, schoolId, subjectId, classId, academicYearId, 1, clock(), clock()]);
    return { id, schoolId, subjectId, classId, academicYearId, active: true, created: true };
  }

  async function resolvePeriod(input = {}) {
    const year = text(input.academicYearId || input.academicYear);
    const term = text(input.termId || input.term);
    if (!year || !term) fail('Academic year and term are required.');
    const yearRow = rows(await database.query('SELECT id,name FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, year, year]))[0];
    if (!yearRow) fail('Academic year not found.', 404);
    const termRow = rows(await database.query('SELECT t.id,t.name FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? AND y.id=? AND (t.id=? OR t.name=?) LIMIT 1', [schoolId, yearRow.id, term, term]))[0];
    if (!termRow) fail('Term not found.', 404);
    return { yearId: yearRow.id, yearName: yearRow.name, termId: termRow.id, termName: termRow.name };
  }

  async function roster(input = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'marks.write') && !authorized(actor, 'results.read')) fail('Forbidden.', 403, 'ACADEMIC_PERMISSION_REQUIRED');
    const classId = text(input.classId);
    if (!classId || !text(input.subjectId)) fail('Class and subject are required.');
    const period = await resolvePeriod(input);
    const assigned = rows(await database.query('SELECT id FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND active=1 AND (academic_year_id IS NULL OR academic_year_id=?) LIMIT 1', [schoolId, text(input.subjectId), classId, period.yearId]))[0];
    if (!assigned) return [];
    const result = await database.query(`SELECT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,
      e.class_id AS classId,r.ca_score AS caScore,r.examination_score AS examScore,r.total_score AS totalScore,r.grade,r.id AS scoreId
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      LEFT JOIN academic_score_records r ON r.school_id=e.school_id AND r.student_id IN (SELECT sp.id FROM student_profiles sp WHERE sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id) AND r.subject_id=? AND r.class_id=e.class_id AND r.academic_year_id=? AND r.term_id=? AND r.record_type='TERMINAL' AND r.mock_label IS NULL
      WHERE e.school_id=? AND e.class_id=? AND e.academic_year_id=? AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,1)=1 AND s.school_id=? AND COALESCE(s.student_status,'ACTIVE')='ACTIVE'
      ORDER BY s.last_name,s.first_name,s.id`, [text(input.subjectId), period.yearId, period.termId, schoolId, classId, period.yearId, schoolId]);
    return rows(result).map((item) => ({ studentId: item.studentId, permanentStudentId: item.permanentStudentId, studentName: [item.firstName, item.middleName, item.surname].filter(Boolean).join(' '), classId: item.classId, caScore: item.caScore == null ? null : Number(item.caScore), examScore: item.examScore == null ? null : Number(item.examScore), totalScore: item.totalScore == null ? null : Number(item.totalScore), grade: item.grade ?? null, saved: Boolean(item.scoreId) }));
  }

  async function saveScore(input = {}, actor) {
    assertActor(actor, 'marks.write');
    const classId = text(input.classId), subjectId = text(input.subjectId), studentId = text(input.studentId);
    const caScore = Number(input.caScore), examScore = Number(input.examScore);
    if (!classId || !subjectId || !studentId || !Number.isFinite(caScore) || !Number.isFinite(examScore)) fail('Student, class, subject, CA, and Exam are required.');
    if (caScore < 0 || caScore > 50) fail('CA score must be between 0 and 50.');
    if (examScore < 0 || examScore > 50) fail('Exam score must be between 0 and 50.');
    const period = await resolvePeriod(input);
    const enrolled = rows(await database.query('SELECT e.student_id,s.permanent_student_id,c.name AS className FROM student_enrollments e JOIN students s ON s.id=e.student_id JOIN classes c ON c.id=e.class_id WHERE e.school_id=? AND e.student_id=? AND e.class_id=? AND e.academic_year_id=? AND COALESCE(e.enrollment_status,"ACTIVE")="ACTIVE" AND COALESCE(e.is_current,1)=1 LIMIT 1', [schoolId, studentId, classId, period.yearId]))[0];
    if (!enrolled) fail('Student is not enrolled in the selected class and academic year.', 400);
    const assigned = rows(await database.query('SELECT id FROM subject_class_assignments WHERE school_id=? AND subject_id=? AND class_id=? AND active=1 AND (academic_year_id IS NULL OR academic_year_id=?) LIMIT 1', [schoolId, subjectId, classId, period.yearId]))[0];
    if (!assigned) fail('Subject is not assigned to the selected class.', 400);
    const totalScore = caScore + examScore;
    const [grade, remark] = gradeForTotal(totalScore, { classId: enrolled.className, examination: 'TERMINAL' });
    const existing = rows(await database.query('SELECT id FROM academic_score_records WHERE school_id=? AND record_type="TERMINAL" AND mock_label IS NULL AND academic_year_id=? AND term_id=? AND class_id=? AND student_id IN (SELECT sp.id FROM student_profiles sp WHERE sp.student_master_id=? OR sp.student_id=?) AND subject_id=? LIMIT 1', [schoolId, period.yearId, period.termId, classId, studentId, enrolled.permanent_student_id, subjectId]))[0];
    const scoreId = existing?.id ?? idFactory();
    if (existing) await database.execute('UPDATE academic_score_records SET ca_score=?,examination_score=?,total_score=?,grade=?,remark=?,entered_by=?,updated_at=? WHERE id=? AND school_id=?', [caScore, examScore, totalScore, grade, remark, actor.id, clock(), scoreId, schoolId]);
    else {
      const profile = rows(await database.query('SELECT id FROM student_profiles WHERE school_id=? AND (student_master_id=? OR student_id=?) LIMIT 1', [schoolId, studentId, enrolled.permanent_student_id]))[0];
      if (!profile) fail('Student profile is unavailable for score persistence.', 409);
      await database.execute('INSERT INTO academic_score_records (id,school_id,record_type,academic_year_id,term_id,class_id,student_id,subject_id,ca_score,ca_max,examination_score,examination_max,total_score,grade,remark,entered_by,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [scoreId, schoolId, 'TERMINAL', period.yearId, period.termId, classId, profile.id, subjectId, caScore, 50, examScore, 50, totalScore, grade, remark, actor.id, clock()]);
    }
    return { id: scoreId, schoolId, studentId, permanentStudentId: enrolled.permanent_student_id, classId, subjectId, academicYear: period.yearName, term: period.termName, caScore, examScore, totalScore, grade, remark, saved: true };
  }

  return Object.freeze({ options, listSubjects, listAssignments, assignSubject, roster, saveScore, resolvePeriod });
}

export default createDurableAcademicService;
