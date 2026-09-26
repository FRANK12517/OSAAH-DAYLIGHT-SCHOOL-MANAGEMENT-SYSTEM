import { randomUUID } from 'node:crypto';
import { gradeForTotal } from './grading.js';
import { canonicalClassId } from './student-classes.js';
import { calculateStudentResult, calculateClassPositions } from './result-calculation.js';
import { subjectPositions } from './result-slip.js';
import { normalizeStudentGender } from './student-gender.js';

const rows = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();
const fail = (message, status = 400, code = 'ACADEMIC_DATA_ERROR') => { throw Object.assign(new Error(message), { status, code }); };

function authorized(actor, permission) {
  return actor?.permissions?.has?.('*') || actor?.permissions?.has?.(permission) || actor?.roleKey === 'PROPRIETOR';
}

export function createDurableAcademicService({ database, schoolId, signatures = null, idFactory = randomUUID, clock = () => new Date().toISOString() } = {}) {
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

  async function listSubjects(filters = {}, actor, { allowLegacyMapping = false } = {}) {
    assertActor(actor);
    const classId = text(filters.classId);
    if (!classId) return [];
    const academicYearId = text(filters.academicYearId || filters.academicYear);
    const params = [schoolId, classId];
    let yearClause = '';
    if (academicYearId) { yearClause = ' AND (a.academic_year_id IS NULL OR a.academic_year_id=?)'; params.push(academicYearId); }
    let result;
    try { result = await database.query(`SELECT s.id,s.code,s.name,s.department_id AS departmentId,a.class_id AS classId,a.academic_year_id AS academicYearId
      FROM subject_class_assignments a JOIN subjects s ON s.id=a.subject_id AND s.school_id=a.school_id
      WHERE a.school_id=? AND a.class_id=? AND a.active=1${yearClause} ORDER BY s.name,s.id`, params); }
    catch (error) {
      if (!['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes(error.code)) throw error;
      // The recorded production inventory has class_subjects. Inspect its real
      // columns before adapting the legacy mapping; never guess optional fields.
      if (!allowLegacyMapping && error.code !== 'ER_NO_SUCH_TABLE' && !/no such table.*subject_class_assignments/i.test(error.message ?? '')) throw error;
      // Production inventory confirms class_subjects(id,class_id,subject_id,teacher_id).
      // Introspection also preserves optional scope columns on legacy installations.
      const columnsFor = async (table) => {
        try { return rows(await database.query(`SHOW COLUMNS FROM ${table}`)).map((item) => item.Field); }
        catch (metadataError) {
          if (metadataError.code !== 'ERR_SQLITE_ERROR' && !/SQLite/i.test(metadataError.message ?? '')) throw metadataError;
          return rows(await database.query(`PRAGMA table_info(${table})`)).map((item) => item.name);
        }
      };
      const columns = await columnsFor('class_subjects');
      const subjectColumns = await columnsFor('subjects');
      if (!['class_id', 'subject_id'].every((name) => columns.includes(name)) || !['id', 'school_id', 'name'].every((name) => subjectColumns.includes(name))) {
        if (allowLegacyMapping) fail('Sample result is unavailable for the selected class.', 404);
        fail('Subjects are unavailable for the selected class.', 503);
      }
      const clauses = ['s.school_id=?', 'a.class_id=?']; const values = [schoolId, classId];
      if (columns.includes('school_id')) { clauses.push('a.school_id=?'); values.push(schoolId); }
      if (columns.includes('academic_year_id') && academicYearId) { clauses.push('(a.academic_year_id IS NULL OR a.academic_year_id=?)'); values.push(academicYearId); }
      if (columns.includes('term_id') && text(filters.termId)) { clauses.push('(a.term_id IS NULL OR a.term_id=?)'); values.push(text(filters.termId)); }
      for (const [alias, available] of [['a', columns], ['s', subjectColumns]]) {
        if (available.includes('active')) clauses.push(`${alias}.active=1`);
        if (available.includes('status')) clauses.push(`(${alias}.status IS NULL OR ${alias}.status='ACTIVE')`);
      }
      result = await database.query(`SELECT DISTINCT s.id,s.name,a.class_id AS classId FROM class_subjects a JOIN subjects s ON s.id=a.subject_id WHERE ${clauses.join(' AND ')} ORDER BY s.name,s.id`, values);
    }
    return rows(result);
  }

  async function assertClassSubject(classId, subjectId, actor) {
    if (actor.roleKey === 'TEACHER' && actor.assignedClassIds?.length && !actor.assignedClassIds.includes(classId)) fail('Forbidden.', 403);
    if (actor.roleKey === 'TEACHER' && actor.assignedSubjectIds?.length && !actor.assignedSubjectIds.includes(subjectId)) fail('Forbidden.', 403);
    const configured = await listSubjects({ classId }, actor, { allowLegacyMapping: true });
    if (!configured.some((subject) => subject.id === subjectId)) fail('Subject is not assigned to the selected class.', 400);
  }

  async function sampleContext(input, actor) {
    assertActor(actor);
    if (!authorized(actor, 'results.generate') && !authorized(actor, 'marks.write')) fail('Forbidden.', 403);
    const classRecord = (await optionClasses(actor)).find((item) => item.id === text(input.classId));
    if (!classRecord) fail('Forbidden.', 403);
    const legacyClassId = canonicalClassId(classRecord.name);
    if (!legacyClassId) fail('Sample result is unavailable for the selected class.', 404);
    const period = await resolvePeriod(input);
    const subjects = await listSubjects({ classId: classRecord.id, academicYearId: period.yearId, termId: period.termId }, actor, { allowLegacyMapping: true });
    if (!subjects.length) fail('Sample result is unavailable for the selected class.', 404);
    if (actor.roleKey === 'TEACHER' && actor.assignedSubjectIds?.length && subjects.some((subject) => !actor.assignedSubjectIds.includes(subject.id))) fail('Forbidden.', 403);
    return { schoolId, classRecord, legacyClassId, period, subjects };
  }

  async function resultStudents(input = {}, actor) {
    assertActor(actor);
    if (!['academics.read', 'results.read', 'examinations.read'].some((permission) => authorized(actor, permission))) fail('Forbidden.', 403);
    const classId = text(input.classId);
    if (!classId) fail('Class is required.');
    // Reuse Part 1's canonical ownership and teacher assignment checks, including
    // its legacy class schema compatibility. Client school IDs are never used.
    if (!(await optionClasses(actor)).some((item) => item.id === classId)) fail('Forbidden.', 403);
    const period = await resolvePeriod(input);
    // Production enrollments have only id/student_id/class_id/academic_year_id.
    // Read optional legacy membership fields without naming absent SQL columns.
    const memberships = rows(await database.query(`SELECT e.*,s.id AS canonicalStudentId,
      s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,
      s.middle_name AS middleName,s.last_name AS lastName,s.is_test_record AS isTestRecord
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id
      WHERE s.school_id=? AND e.class_id=? AND e.academic_year_id=?
      ORDER BY s.last_name,s.first_name,s.id`, [schoolId, classId, period.yearId]));
    const seen = new Set();
    return memberships.filter((item) => {
      if (item.school_id != null && item.school_id !== schoolId) return false;
      // Legacy term-specific rows coexist with year-wide rows. Do not impose a
      // term or current-year filter on the production year-based membership.
      if (item.term_id != null && item.term_id !== period.termId) return false;
      if (seen.has(item.canonicalStudentId)) return false;
      seen.add(item.canonicalStudentId);
      return true;
    }).map((item) => ({
      id: item.canonicalStudentId,
      permanentStudentId: item.permanentStudentId,
      name: [item.firstName, item.middleName, item.lastName].filter(Boolean).join(' '),
      classId,
      academicYearId: period.yearId,
      isTestRecord: Boolean(Number(item.isTestRecord))
    }));
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
    if (!(await optionClasses(actor)).some((item) => item.id === classId)) fail('Forbidden.', 403);
    const period = await resolvePeriod(input);
    await assertClassSubject(classId, text(input.subjectId), actor);
    const result = await database.query(`SELECT s.id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,
      e.class_id AS classId,r.class_score AS caScore,r.exam_score AS examScore,r.total_score AS totalScore,r.id AS scoreId
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id
      LEFT JOIN canonical_academic_scores r ON r.school_id=s.school_id AND r.student_id=s.id AND r.subject_id=? AND r.class_id=e.class_id AND r.academic_year_id=e.academic_year_id AND r.term_id=?
      WHERE s.school_id=? AND e.class_id=? AND e.academic_year_id=? AND COALESCE(s.is_test_record,0)=0
      ORDER BY s.last_name,s.first_name,s.id`, [text(input.subjectId), period.termId, schoolId, classId, period.yearId]);
    const seen = new Set();
    return rows(result).filter((item) => { if (seen.has(item.studentId)) return false; seen.add(item.studentId); return true; }).map((item) => ({ studentId: item.studentId, permanentStudentId: item.permanentStudentId, studentName: [item.firstName, item.middleName, item.surname].filter(Boolean).join(' '), classId: item.classId, caScore: item.caScore == null ? null : Number(item.caScore), examScore: item.examScore == null ? null : Number(item.examScore), totalScore: item.totalScore == null ? null : Number(item.totalScore), saved: Boolean(item.scoreId) }));
  }

  async function saveScore(input = {}, actor) {
    assertActor(actor, 'marks.write');
    const classId = text(input.classId), subjectId = text(input.subjectId), studentId = text(input.studentId);
    const caScore = Number(input.caScore), examScore = Number(input.examScore);
    if (!classId || !subjectId || !studentId || !Number.isFinite(caScore) || !Number.isFinite(examScore)) fail('Student, class, subject, CA, and Exam are required.');
    if (caScore < 0 || caScore > 50) fail('CA score must be between 0 and 50.');
    if (examScore < 0 || examScore > 50) fail('Exam score must be between 0 and 50.');
    const period = await resolvePeriod(input);
    const allowedClasses = await optionClasses(actor);
    const classRecord = allowedClasses.find((item) => item.id === classId);
    if (!classRecord) fail('Class not found.', 404);
    const enrolled = rows(await database.query(`SELECT s.id AS student_id,s.permanent_student_id,c.name AS className
      FROM student_enrollments e JOIN students s ON s.id=e.student_id
      JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id
      JOIN classes c ON c.id=e.class_id
      WHERE s.school_id=? AND e.student_id=? AND e.class_id=? AND e.academic_year_id=? AND COALESCE(s.is_test_record,0)=0 LIMIT 1`, [schoolId, studentId, classId, period.yearId]))[0];
    if (!enrolled) fail('Student is not enrolled in the selected class and academic year.', 400);
    await assertClassSubject(classId, subjectId, actor);
    const totalScore = caScore + examScore;
    const [grade, remark] = gradeForTotal(totalScore, { classId: enrolled.className, examination: 'TERMINAL' });
    const now = clock();
    const persist = async (tx) => {
      const existing = rows(await tx.query('SELECT id FROM canonical_academic_scores WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND subject_id=? LIMIT 1', [schoolId, studentId, classId, period.yearId, period.termId, subjectId]))[0];
      const scoreId = existing?.id ?? idFactory();
      if (existing) await tx.execute('UPDATE canonical_academic_scores SET class_score=?,exam_score=?,total_score=?,updated_at=? WHERE id=? AND school_id=?', [caScore, examScore, totalScore, now, scoreId, schoolId]);
      else await tx.execute('INSERT INTO canonical_academic_scores (id,school_id,student_id,class_id,academic_year_id,term_id,subject_id,class_score,exam_score,total_score,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [scoreId, schoolId, studentId, classId, period.yearId, period.termId, subjectId, caScore, examScore, totalScore, now, now]);
      return scoreId;
    };
    let scoreId;
    try { scoreId = database.transaction ? await database.transaction(persist) : await persist(database); }
    catch (error) {
      if (!['ER_DUP_ENTRY', 'SQLITE_CONSTRAINT_UNIQUE'].includes(error.code)) throw error;
      const existing = rows(await database.query('SELECT id FROM canonical_academic_scores WHERE school_id=? AND student_id=? AND class_id=? AND academic_year_id=? AND term_id=? AND subject_id=? LIMIT 1', [schoolId, studentId, classId, period.yearId, period.termId, subjectId]))[0];
      if (!existing) throw error;
      scoreId = existing.id;
      await database.execute('UPDATE canonical_academic_scores SET class_score=?,exam_score=?,total_score=?,updated_at=? WHERE id=? AND school_id=?', [caScore, examScore, totalScore, now, scoreId, schoolId]);
    }
    return { id: scoreId, schoolId, studentId, permanentStudentId: enrolled.permanent_student_id, classId, subjectId, academicYear: period.yearName, term: period.termName, caScore, examScore, totalScore, grade, remark, saved: true };
  }

  async function listCanonicalScores(filters = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'results.read') && !authorized(actor, 'marks.write') && !authorized(actor, 'results.generate')) fail('Forbidden.', 403);
    const period = await resolvePeriod(filters);
    const classId = text(filters.classId);
    if (!(await optionClasses(actor)).some((item) => item.id === classId)) fail('Forbidden.', 403);
    if (actor.roleKey === 'TEACHER' && actor.assignedClassIds?.length && !actor.assignedClassIds.includes(classId)) fail('Forbidden.', 403);
    const classesForSchool = await optionClasses(actor);
    const classRecord = classesForSchool.find((item) => item.id === classId);
    if (!classRecord) fail('Forbidden.', 403);
    const result = await database.query(`SELECT r.id,r.student_id AS studentId,s.permanent_student_id AS permanentStudentId,
      s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,s.gender,
      r.class_id AS classId,r.subject_id AS subjectId,sub.name AS subjectName,
      r.class_score AS caScore,r.exam_score AS examScore,r.total_score AS totalScore,
      r.academic_year_id AS academicYearId,r.term_id AS termId,r.created_at AS createdAt,r.updated_at AS updatedAt
      FROM canonical_academic_scores r JOIN students s ON s.id=r.student_id AND s.school_id=r.school_id
      JOIN subjects sub ON sub.id=r.subject_id AND sub.school_id=r.school_id
      WHERE r.school_id=? AND r.student_id=? AND r.class_id=? AND r.academic_year_id=? AND r.term_id=? AND COALESCE(s.is_test_record,0)=0
        AND EXISTS (SELECT 1 FROM student_enrollments e JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id WHERE e.student_id=s.id AND e.class_id=r.class_id AND e.academic_year_id=r.academic_year_id)
      ORDER BY sub.name,sub.id`, [schoolId, text(filters.studentId), classId, period.yearId, period.termId]);
    return { rows: rows(result).map((item) => ({ ...item, caScore: Number(item.caScore), examScore: Number(item.examScore), totalScore: Number(item.totalScore), grade: gradeForTotal(Number(item.totalScore), { classId: classRecord.name, examination: 'TERMINAL' })[0] })), period, classRecord };
  }

  async function result(filters = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'results.read') && !authorized(actor, 'results.generate')) fail('Forbidden.', 403);
    if ([true, 'true', 1, '1'].includes(filters.sample)) fail('Sample results must use the isolated sample workflow.', 403, 'SAMPLE_RESULT_ROUTE_REQUIRED');
    const { rows: scores, period, classRecord } = await listCanonicalScores(filters, actor);
    if (!scores.length) fail('No result scores are recorded for the selected student and academic context.', 404, 'ACADEMIC_RESULT_NOT_FOUND');
    const subjectStudent = scores[0];
    const classRows = rows(await database.query(`SELECT r.student_id AS studentId,r.subject_id AS subjectId,sub.name AS subjectName,
      r.class_score AS caScore,r.exam_score AS examScore,r.total_score AS totalScore
      FROM canonical_academic_scores r JOIN students s ON s.id=r.student_id AND s.school_id=r.school_id
      JOIN subjects sub ON sub.id=r.subject_id AND sub.school_id=r.school_id
      WHERE r.school_id=? AND r.class_id=? AND r.academic_year_id=? AND r.term_id=? AND COALESCE(s.is_test_record,0)=0
        AND EXISTS (SELECT 1 FROM student_enrollments e JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id WHERE e.student_id=s.id AND e.class_id=r.class_id AND e.academic_year_id=r.academic_year_id)`, [schoolId, text(filters.classId), period.yearId, period.termId])).map((item) => ({ ...item, caScore: Number(item.caScore), examScore: Number(item.examScore), totalScore: Number(item.totalScore), grade: gradeForTotal(Number(item.totalScore), { classId: classRecord.name, examination: 'TERMINAL' })[0] }));
    const positioned = subjectPositions(scores, classRows).map((row) => ({ ...row, remark: gradeForTotal(row.totalScore, { classId: classRecord.name, examination: 'TERMINAL' })[1] }));
    const calculated = calculateStudentResult(positioned, { classId: classRecord.name, examination: 'TERMINAL' });
    const peerGroups = new Map();
    for (const row of classRows) { if (!peerGroups.has(row.studentId)) peerGroups.set(row.studentId, []); peerGroups.get(row.studentId).push(row); }
    const peers = [...peerGroups].map(([studentId, rowsForStudent]) => ({ studentId, ...calculateStudentResult(rowsForStudent, { classId: classRecord.name, examination: 'TERMINAL' }) }));
    const positions = calculateClassPositions([{ studentId: text(filters.studentId), ...calculated }, ...peers.filter((item) => item.studentId !== text(filters.studentId))], { classId: classRecord.name });
    const membershipRows = rows(await database.query(`SELECT DISTINCT s.id,s.gender FROM student_enrollments e
      JOIN students s ON s.id=e.student_id JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id
      WHERE s.school_id=? AND e.class_id=? AND e.academic_year_id=? AND COALESCE(s.is_test_record,0)=0`, [schoolId, text(filters.classId), period.yearId]));
    const genderCounts = membershipRows.reduce((counts, item) => { const gender = normalizeStudentGender(item.gender); if (gender === 'Male') counts.totalBoys += 1; if (gender === 'Female') counts.totalGirls += 1; return counts; }, { totalBoys: 0, totalGirls: 0 });
    const subjectStudentRecord = { id: subjectStudent.studentId, schoolId, classId: text(filters.classId), permanentStudentId: subjectStudent.permanentStudentId, firstName: subjectStudent.firstName, middleName: subjectStudent.middleName, surname: subjectStudent.surname, gender: subjectStudent.gender };
    const resolved = signatures?.resolveForStudent?.(subjectStudentRecord, { academicYear: period.yearName, term: period.termName });
    const totalScore = calculated.totalScore;
    const average = calculated.average ?? 0;
    const summaryGrade = gradeForTotal(average, { classId: classRecord.name, examination: 'TERMINAL' });
    return {
      headerAsset: '/assets/osaah-result-header.png', lifecycle: { status: 'UNSAVED/INCOMPLETE', dirty: true, version: 0, savedAt: null },
      attendance: null, assessment: null, resultType: 'TERMINAL', isSample: false, sampleLabel: null,
      studentId: subjectStudent.studentId, studentIndexNumber: subjectStudent.permanentStudentId,
      studentName: [subjectStudent.firstName, subjectStudent.middleName, subjectStudent.surname].filter(Boolean).join(' '),
      gender: normalizeStudentGender(subjectStudent.gender), classGenderDistribution: { ...genderCounts, totalStudents: membershipRows.length },
      classId: text(filters.classId), className: classRecord?.name ?? text(filters.classId),
      academicYear: period.yearName, term: period.termName, subjects: positioned, totalScore, average,
      subjectsSat: calculated.subjectsSat, grade: summaryGrade[0], remark: summaryGrade[1], aggregate: calculated.aggregate,
      aggregateSubjects: calculated.aggregateSubjects.map((item) => item.subjectId), classPosition: positions.get(text(filters.studentId)) ?? '—',
      position: positions.get(text(filters.studentId)) ?? '—',
      signatures: [{ signatoryRole: 'CLASS_TEACHER', name: resolved?.classTeacher?.name, ...(resolved?.classTeacher?.signature ?? {}) }, { signatoryRole: 'HEADTEACHER', name: resolved?.headteacher?.name, ...(resolved?.headteacher?.signature ?? {}) }].filter((item) => item.id)
    };
  }

  async function broadsheet(filters = {}, actor) {
    assertActor(actor);
    if (!authorized(actor, 'results.read')) fail('Forbidden.', 403);
    const classId = text(filters.classId);
    const classesForSchool = await optionClasses(actor);
    const classRecord = classesForSchool.find((item) => item.id === classId);
    if (!classRecord) fail('Forbidden.', 403);
    if (actor.roleKey === 'TEACHER' && actor.assignedClassIds?.length && !actor.assignedClassIds.includes(classId)) fail('Forbidden.', 403);
    const period = await resolvePeriod(filters);
    const records = rows(await database.query(`SELECT r.student_id AS studentId,s.permanent_student_id AS permanentStudentId,
      s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,r.subject_id AS subjectId,
      sub.name AS subjectName,r.class_score AS caScore,r.exam_score AS examScore,r.total_score AS totalScore
      FROM canonical_academic_scores r JOIN students s ON s.id=r.student_id AND s.school_id=r.school_id
      JOIN subjects sub ON sub.id=r.subject_id AND sub.school_id=r.school_id
      WHERE r.school_id=? AND r.class_id=? AND r.academic_year_id=? AND r.term_id=? AND COALESCE(s.is_test_record,0)=0
        AND EXISTS (SELECT 1 FROM student_enrollments e JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id WHERE e.student_id=s.id AND e.class_id=r.class_id AND e.academic_year_id=r.academic_year_id)
      ORDER BY s.last_name,s.first_name,s.id,sub.name,sub.id`, [schoolId, classId, period.yearId, period.termId]));
    const classRows = records.map((item) => ({ ...item, caScore: Number(item.caScore), examScore: Number(item.examScore), totalScore: Number(item.totalScore), grade: gradeForTotal(Number(item.totalScore), { classId: classRecord.name, examination: 'TERMINAL' })[0] }));
    const byStudent = new Map();
    for (const row of classRows) { if (!byStudent.has(row.studentId)) byStudent.set(row.studentId, []); byStudent.get(row.studentId).push(row); }
    const calculations = [...byStudent].map(([studentId, studentRows]) => ({ studentId, rows: studentRows, ...calculateStudentResult(studentRows, { classId: classRecord.name, examination: 'TERMINAL' }) }));
    const positions = calculateClassPositions(calculations, { classId: classRecord.name });
    return calculations.map((student) => ({
      studentId: student.studentId, permanentStudentId: student.rows[0].permanentStudentId,
      studentName: [student.rows[0].firstName, student.rows[0].middleName, student.rows[0].surname].filter(Boolean).join(' '),
      classId, subjectTotals: Object.fromEntries(student.rows.map((row) => [row.subjectName, row.totalScore])),
      subjectGrades: Object.fromEntries(student.rows.map((row) => [row.subjectName, row.grade])), totalScore: student.totalScore,
      aggregate: student.aggregate, classPosition: positions.get(student.studentId) ?? '—', averageScore: student.average,
      subjectsSat: student.subjectsSat, isSample: false, academicYear: period.yearName, term: period.termName
    }));
  }

  return Object.freeze({ options, resultStudents, sampleContext, listSubjects, listAssignments, assignSubject, roster, saveScore, resolvePeriod, listCanonicalScores, result, broadsheet });
}

export default createDurableAcademicService;
