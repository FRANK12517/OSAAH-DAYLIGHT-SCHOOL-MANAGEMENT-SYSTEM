import { createHash, randomUUID } from 'node:crypto';
import { CORE_LEVELS } from './students.js';
import { canonicalAcademicClass } from './default-subject-catalog.js';

const rows = (value) => Array.isArray(value) ? value : [];
const text = (value) => String(value ?? '').trim();
const fail = (message, status = 400, code = 'PROMOTION_ERROR') => { throw Object.assign(new Error(message), { status, code }); };
const authorized = (actor) => actor?.roleKey === 'PROPRIETOR' || actor?.permissions?.has?.('*') || actor?.permissions?.has?.('promotion.write');
const idempotencyKey = (studentId, yearId, classId, termId) => createHash('sha256').update([studentId, yearId, classId, termId].join('\u001f')).digest('hex');

export function createDurablePromotionService({ database, schoolId, idFactory = randomUUID, clock = () => new Date().toISOString() } = {}) {
  if (!database?.query || !database?.execute || !database?.transaction) throw Object.assign(new Error('Durable promotion database is unavailable.'), { status: 503, code: 'DURABLE_PROMOTION_REQUIRED' });
  const assertActor = (actor) => {
    if (!actor?.schoolId || actor.schoolId !== schoolId || !authorized(actor)) fail('Forbidden.', 403, 'PROMOTION_FORBIDDEN');
  };
  const assertClassScope = (classId, className, actor) => {
    if (actor?.roleKey !== 'TEACHER') return;
    const assigned = Array.isArray(actor.assignedClassIds) ? actor.assignedClassIds.map(String) : [];
    if (!assigned.length || (!assigned.includes(String(classId)) && !assigned.includes(String(className)))) fail('Class is outside your assignment.', 403, 'PROMOTION_CLASS_SCOPE_DENIED');
  };
  async function resolvePeriod(input = {}) {
    const yearValue = text(input.academicYearId ?? input.academicYear);
    const termValue = text(input.termId ?? input.term);
    const year = rows(await database.query('SELECT id,name,starts_on AS startsOn,ends_on AS endsOn FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, yearValue, yearValue]))[0];
    if (!year) fail('Academic year is invalid for this school.', 400, 'PROMOTION_YEAR_INVALID');
    const term = rows(await database.query('SELECT id,name,academic_year_id AS academicYearId FROM terms WHERE academic_year_id=? AND (id=? OR name=?) LIMIT 1', [year.id, termValue, termValue]))[0];
    if (!term) fail('Term is invalid for the selected academic year.', 400, 'PROMOTION_TERM_INVALID');
    return { year, term };
  }
  async function optionLists(actor) {
    assertActor(actor);
    const [years, terms, classes] = await Promise.all([
      database.query('SELECT id,name,starts_on AS startsOn,ends_on AS endsOn,is_current AS isCurrent FROM academic_years WHERE school_id=? ORDER BY starts_on,id', [schoolId]),
      database.query('SELECT t.id,t.name,t.academic_year_id AS academicYearId,t.starts_on AS startsOn,t.ends_on AS endsOn FROM terms t JOIN academic_years y ON y.id=t.academic_year_id WHERE y.school_id=? ORDER BY t.starts_on,t.id', [schoolId]),
      database.query('SELECT id,name FROM classes WHERE school_id=? ORDER BY name,id', [schoolId])
    ]);
    return { academicYears: rows(years), terms: rows(terms), classes: rows(classes).filter((item) => actor?.roleKey !== 'TEACHER' || (Array.isArray(actor.assignedClassIds) && actor.assignedClassIds.some((value) => String(value) === String(item.id) || String(value) === String(item.name)))) };
  }
  async function options(input = {}, actor) {
    const lists = await optionLists(actor);
    const yearValue = text(input.academicYearId ?? input.academicYear);
    const classValue = text(input.classId);
    const termValue = text(input.termId ?? input.term);
    if (!yearValue || !classValue || !termValue) return { ...lists, students: [] };
    const { year, term } = await resolvePeriod(input);
    const klass = rows(await database.query('SELECT id,name FROM classes WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, classValue, classValue]))[0];
    if (!klass) fail('Class is invalid for this school.', 400, 'PROMOTION_CLASS_INVALID');
    assertClassScope(klass.id, klass.name, actor);
    const roster = await database.query(`SELECT s.id AS id,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS lastName,e.class_id AS classId
      FROM student_enrollments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id
      WHERE e.school_id=? AND e.academic_year_id=? AND e.term_id=? AND e.class_id=?
        AND COALESCE(e.enrollment_status,'ACTIVE')='ACTIVE' AND COALESCE(e.is_current,1)=1
        AND COALESCE(s.student_status,'ACTIVE')='ACTIVE' AND COALESCE(s.is_test_record,0)=0
      ORDER BY s.last_name,s.first_name,s.id`, [schoolId, year.id, term.id, klass.id]);
    return { ...lists, students: rows(roster).map((item) => ({ id: item.id, name: [item.firstName, item.middleName, item.lastName].filter(Boolean).join(' '), permanentStudentId: item.permanentStudentId, classId: item.classId, isTestRecord: false })) };
  }
  async function nextPeriod(tx, year) {
    const following = rows(await tx.query('SELECT id,name,starts_on AS startsOn FROM academic_years WHERE school_id=? AND starts_on>? ORDER BY starts_on,id LIMIT 1', [schoolId, year.startsOn ?? '']))[0];
    if (!following) fail('The next academic year is not configured.', 409, 'NEXT_ACADEMIC_YEAR_REQUIRED');
    const firstTerm = rows(await tx.query('SELECT id,name FROM terms WHERE academic_year_id=? ORDER BY starts_on,id LIMIT 1', [following.id]))[0];
    if (!firstTerm) fail('The next academic year has no configured term.', 409, 'NEXT_ACADEMIC_TERM_REQUIRED');
    return { year: following, term: firstTerm };
  }
  async function bulkDecide(input = {}, actor) {
    assertActor(actor);
    const classValue = text(input.classId);
    const decision = text(input.decision).toUpperCase();
    const ids = input.studentIds;
    if (!classValue || !Array.isArray(ids) || !ids.length) fail('Class and at least one selected student are required.');
    if (new Set(ids.map(String)).size !== ids.length) fail('Duplicate student IDs are not allowed.');
    if (!['PROMOTED','REPEAT','HOLD','TRANSFER','GRADUATED'].includes(decision)) fail('Invalid promotion decision.');
    const { year, term } = await resolvePeriod(input);
    const klass = rows(await database.query('SELECT id,name FROM classes WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, classValue, classValue]))[0];
    if (!klass) fail('Class is invalid for this school.', 400, 'PROMOTION_CLASS_INVALID');
    assertClassScope(klass.id, klass.name, actor);
    const classRows = rows(await database.query('SELECT id,name FROM classes WHERE school_id=? ORDER BY name,id', [schoolId]));
    const progression = CORE_LEVELS.map((name) => canonicalAcademicClass(name));
    const currentIndex = progression.indexOf(canonicalAcademicClass(klass.name));
    const isJhs3 = currentIndex === progression.length - 1;
    if (decision === 'GRADUATED' && !isJhs3) fail('Only JHS 3 students can be completed.');
    if (decision === 'PROMOTED' && (isJhs3 || currentIndex < 0)) fail('No configured progression class is available; JHS 3 must use the Completed/Archive workflow.');
    const stamp = clock();
    const dbStamp = stamp.replace(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(?:\.\d+)?Z?$/, '$1 $2');
    return database.transaction(async (tx) => {
      const result = [];
      for (const submittedId of ids) {
        const studentId = text(submittedId);
        if (!studentId) fail('Student ID is required.');
        const student = rows(await tx.query(`SELECT s.id AS id,s.permanent_student_id AS permanentStudentId,s.is_test_record AS isTestRecord,s.student_status AS studentStatus,
            sp.id AS profileId,e.id AS enrollmentId,e.class_id AS classId,e.academic_year_id AS academicYearId,e.term_id AS termId,e.enrollment_status AS enrollmentStatus,e.is_current AS isCurrent
          FROM students s JOIN student_profiles sp ON sp.school_id=s.school_id AND (sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id)
          JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
          WHERE s.school_id=? AND s.id=? AND e.academic_year_id=? AND e.term_id=? AND e.class_id=?
          ORDER BY e.enrolled_at DESC,e.id DESC LIMIT 1 FOR UPDATE`, [schoolId, studentId, year.id, term.id, klass.id]))[0];
        if (!student) fail(`Student ${studentId} is not enrolled in the selected school, year, term, and class.`, 400, 'PROMOTION_STUDENT_CONTEXT_INVALID');
        if (Number(student.isTestRecord) === 1) fail('Sample/test students cannot enter official promotion.', 400, 'PROMOTION_SAMPLE_STUDENT_DENIED');
        const existing = rows(await tx.query('SELECT id,decision,to_class_id AS toClassId,next_academic_year_id AS nextAcademicYearId,completion_year AS completionYear,decided_at AS decidedAt FROM promotion_decisions WHERE school_id=? AND student_id=? AND academic_year_id=? AND class_id=? AND term_id=? LIMIT 1 FOR UPDATE', [schoolId, student.profileId, year.id, klass.id, term.id]))[0];
        if (existing) {
          if (String(existing.decision).toUpperCase() !== decision) fail(`A different promotion decision already exists for student ${studentId}.`, 409, 'PROMOTION_DECISION_CONFLICT');
          result.push({ id: existing.id, studentId, permanentStudentId: student.permanentStudentId, decision, classId: klass.id, termId: term.id, academicYearId: year.id, toClassId: existing.toClassId ?? null, nextAcademicYearId: existing.nextAcademicYearId ?? null, completionYear: existing.completionYear ?? null, decidedAt: existing.decidedAt, duplicate: true });
          continue;
        }
        if (String(student.studentStatus ?? 'ACTIVE').toUpperCase() !== 'ACTIVE') fail('Inactive students cannot enter official promotion.', 400, 'PROMOTION_STUDENT_INACTIVE');
        if (String(student.enrollmentStatus ?? 'ACTIVE').toUpperCase() !== 'ACTIVE' || Number(student.isCurrent ?? 1) !== 1) fail(`Student ${studentId} is not actively enrolled in the selected context.`, 400, 'PROMOTION_STUDENT_NOT_ACTIVE');
        const id = idFactory();
        let destination = klass;
        let next = null;
        let completionYear = null;
        if (decision === 'PROMOTED' || decision === 'REPEAT') {
          next = await nextPeriod(tx, year);
          if (decision === 'PROMOTED') {
            const nextCanonicalClass = progression[currentIndex + 1];
            destination = classRows.find((item) => canonicalAcademicClass(item.name) === nextCanonicalClass);
            if (!destination) fail('The canonical next class is not configured for this school.', 409, 'PROMOTION_NEXT_CLASS_NOT_CONFIGURED');
          }
        } else if (decision === 'GRADUATED') {
          completionYear = String(year.name);
        }
        await tx.execute(`INSERT INTO promotion_decisions (id,school_id,student_id,academic_year_id,class_id,term_id,decision,comment,decided_by,decided_at,to_class_id,next_academic_year_id,next_term_id,completion_year,source_enrollment_id,idempotency_key)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [id, schoolId, student.profileId, year.id, klass.id, term.id, decision, text(input.comment) || null, actor.id, stamp, ['PROMOTED','REPEAT'].includes(decision) ? destination.id : null, next?.year.id ?? null, next?.term.id ?? null, completionYear, student.enrollmentId, idempotencyKey(student.profileId, year.id, klass.id, term.id)]);
        if (['PROMOTED','REPEAT','GRADUATED'].includes(decision)) {
          const enrollmentStatus = decision === 'PROMOTED' ? 'PROMOTED' : decision === 'REPEAT' ? 'REPEATED' : 'COMPLETED';
          await tx.execute('UPDATE student_enrollments SET is_current=0,enrollment_status=?,completed_at=? WHERE school_id=? AND student_id=? AND academic_year_id=? AND class_id=? AND is_current=1', [enrollmentStatus, decision === 'GRADUATED' ? dbStamp : null, schoolId, student.id, year.id, klass.id]);
          if (decision === 'GRADUATED') {
            await tx.execute("UPDATE students SET student_status='COMPLETED',current_class_id=NULL,updated_at=? WHERE id=? AND school_id=?", [stamp, student.id, schoolId]);
            await tx.execute("UPDATE student_profiles SET enrollment_status='COMPLETED',class_id=NULL,updated_at=? WHERE id=? AND school_id=?", [stamp, student.profileId, schoolId]);
          } else {
            const nextEnrollmentId = idFactory();
            await tx.execute(`INSERT INTO student_enrollments (id,student_id,school_id,permanent_student_id,academic_year_id,academic_year,class_id,class_name,term_id,enrollment_status,is_current,enrolled_at)
              VALUES (?,?,?,?,?,?,?,?,?,'ACTIVE',1,?)`, [nextEnrollmentId, student.id, schoolId, student.permanentStudentId, next.year.id, next.year.name, destination.id, destination.name, next.term.id, dbStamp]);
            await tx.execute('UPDATE students SET current_class_id=?,updated_at=? WHERE id=? AND school_id=?', [destination.id, stamp, student.id, schoolId]);
            await tx.execute("UPDATE student_profiles SET class_id=?,enrollment_status='ACTIVE',updated_at=? WHERE id=? AND school_id=?", [destination.id, stamp, student.profileId, schoolId]);
          }
        }
        result.push({ id, studentId, permanentStudentId: student.permanentStudentId, decision, academicYearId: year.id, termId: term.id, classId: klass.id, toClassId: ['PROMOTED','REPEAT'].includes(decision) ? destination.id : null, nextAcademicYearId: next?.year.id ?? null, nextTermId: next?.term.id ?? null, completionYear, decidedAt: stamp, duplicate: false });
      }
      return result;
    });
  }
  return Object.freeze({ options, bulkDecide });
}
