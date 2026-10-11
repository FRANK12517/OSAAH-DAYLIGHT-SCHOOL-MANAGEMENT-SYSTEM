import { randomUUID } from 'node:crypto';

const STAFF_ROLES = new Set(['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER']);
const rows = (value) => Array.isArray(value) ? value : [];
const value = (...items) => items.find((item) => item !== undefined && item !== null && item !== '') ?? null;
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const text = (input, field, { optional = true } = {}) => {
  if (input === undefined || input === null) return optional ? null : fail('IDENTITY_REQUIRED', `${field} is required.`, 400);
  const result = String(input).trim();
  if (!result && !optional) fail('IDENTITY_REQUIRED', `${field} is required.`, 400);
  return result || null;
};
const normalize = (input) => String(input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const same = (left, right) => normalize(left) === normalize(right);

function authorize(actor, schoolId) {
  if (!actor?.id || actor.portal !== 'school' || actor.schoolId !== schoolId || !STAFF_ROLES.has(String(actor.roleKey ?? '').toUpperCase())) {
    fail('LINKING_FORBIDDEN', 'Only authorized school leadership staff may link an existing student.', 403);
  }
  return actor;
}

function publicStudent(row, profile, enrollment) {
  return {
    id: row.id,
    schoolId: row.school_id ?? row.schoolId,
    admissionNumber: row.admission_number ?? row.admissionNumber,
    permanentStudentId: row.permanent_student_id ?? row.permanentStudentId ?? profile?.student_id ?? null,
    firstName: row.first_name ?? row.firstName ?? profile?.first_name ?? null,
    middleName: row.middle_name ?? row.middleName ?? null,
    lastName: row.last_name ?? row.lastName ?? profile?.surname ?? profile?.last_name ?? null,
    dateOfBirth: row.date_of_birth ?? row.dateOfBirth ?? profile?.date_of_birth ?? null,
    healthInsuranceNumber: row.health_insurance_number ?? row.healthInsuranceNumber ?? null,
    profileId: profile?.id ?? null,
    enrollment: enrollment ? { id: enrollment.id, academicYearId: enrollment.academic_year_id ?? enrollment.academicYearId, termId: enrollment.term_id ?? enrollment.termId, classId: enrollment.class_id ?? enrollment.classId, status: enrollment.enrollment_status ?? enrollment.enrollmentStatus, isCurrent: enrollment.is_current ?? enrollment.isCurrent } : null
  };
}

export function createExistingStudentLinkingService({ database, schoolId, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.query || !database?.execute || !database?.transaction) return null;

  async function candidates(tx, input) {
    const permanentStudentId = text(input.permanentStudentId);
    const studentId = text(input.studentId);
    const admissionNumber = text(input.admissionNumber);
    const firstName = text(input.firstName);
    const lastName = text(input.lastName ?? input.surname);
    const dateOfBirth = text(input.dateOfBirth);
    if (!permanentStudentId && !studentId && !admissionNumber && !firstName && !lastName && !dateOfBirth) fail('IDENTITY_REQUIRED', 'Provide a stable existing identity: student ID, Permanent Student ID, admission number, or a complete name/date-of-birth identity.', 400);
    const predicates = [];
    const params = [schoolId];
    if (studentId) { predicates.push('s.id=?'); params.push(studentId); }
    if (permanentStudentId) { predicates.push('s.permanent_student_id=?'); params.push(permanentStudentId); }
    if (admissionNumber) { predicates.push('s.admission_number=?'); params.push(admissionNumber); }
    if (firstName) { predicates.push('LOWER(s.first_name)=LOWER(?)'); params.push(firstName); }
    if (lastName) { predicates.push('LOWER(s.last_name)=LOWER(?)'); params.push(lastName); }
    if (dateOfBirth) { predicates.push('s.date_of_birth=?'); params.push(dateOfBirth); }
    return rows(await tx.query(`SELECT s.*,sp.id AS profile_id,sp.student_id AS profile_permanent_student_id,sp.first_name AS profile_first_name,sp.last_name AS profile_last_name,sp.date_of_birth AS profile_date_of_birth FROM students s LEFT JOIN student_profiles sp ON sp.student_master_id=s.id AND sp.school_id=s.school_id WHERE s.school_id=? AND COALESCE(s.is_test_record,0)=0 AND ${predicates.join(' AND ')} FOR UPDATE`, params));
  }

  function verifyIdentity(row, input) {
    for (const [field, actual] of [['studentId', row.id], ['permanentStudentId', row.permanent_student_id], ['admissionNumber', row.admission_number], ['firstName', row.first_name], ['lastName', row.last_name], ['dateOfBirth', row.date_of_birth]]) {
      if (input[field] !== undefined && input[field] !== null && input[field] !== '' && !same(input[field], actual)) fail('IDENTITY_CONFLICT', `The supplied ${field} does not match the existing student.`, 409);
    }
  }

  async function loadStudent(tx, studentId) {
    const row = rows(await tx.query('SELECT * FROM students WHERE school_id=? AND id=? FOR UPDATE', [schoolId, studentId]))[0];
    if (!row) fail('STUDENT_NOT_FOUND', 'Existing student was not found in this school.', 404);
    const profile = rows(await tx.query('SELECT * FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE', [schoolId, studentId]))[0] ?? null;
    return { row, profile };
  }

  async function link(input, actor) {
    authorize(actor, schoolId);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_LINK_PAYLOAD', 'A link payload is required.');
    return database.transaction(async (tx) => {
      const found = await candidates(tx, input);
      if (found.length > 1) fail('AMBIGUOUS_IDENTITY', 'More than one existing student matches the supplied identity. Provide the Permanent Student ID or admission number.', 409);
      const matched = found[0];
      if (!matched) fail('STUDENT_NOT_FOUND', 'No existing student matched the supplied stable identity.', 404);
      verifyIdentity(matched, input);
      const { row, profile } = await loadStudent(tx, matched.id);
      const timestamp = clock();
      let profileId = profile?.id ?? null;
      const createdProfile = !profileId;
      if (!profileId) {
        profileId = idFactory();
        await tx.execute('INSERT INTO student_profiles (id,student_master_id,student_id,school_id,admission_number,first_name,last_name,date_of_birth,enrollment_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [profileId, row.id, row.permanent_student_id ?? null, schoolId, row.admission_number, row.first_name, row.last_name, row.date_of_birth ?? null, row.student_status ?? 'ACTIVE', timestamp, timestamp]);
      }
      const academicYearId = text(input.academicYearId ?? input.academicYear, { optional: false });
      const classId = text(input.classId, { optional: false });
      const termId = text(input.termId);
      const classRows = rows(await tx.query('SELECT id FROM classes WHERE school_id=? AND id=? LIMIT 1', [schoolId, classId]));
      if (!classRows.length) fail('CLASS_NOT_FOUND', 'The selected class does not belong to this school.', 409);
      const yearRows = rows(await tx.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]));
      if (!yearRows.length) fail('ACADEMIC_YEAR_NOT_FOUND', 'The selected academic year does not belong to this school.', 409);
      const canonicalYearId = yearRows[0].id;
      const existingEnrollment = rows(await tx.query('SELECT * FROM student_enrollments WHERE school_id=? AND student_id=? AND academic_year_id=? AND class_id=? AND (term_id=? OR (term_id IS NULL AND ? IS NULL)) LIMIT 1 FOR UPDATE', [schoolId, row.id, canonicalYearId, classId, termId, termId]))[0] ?? null;
      let enrollment = existingEnrollment;
      if (!enrollment) {
        const enrollmentId = idFactory();
        await tx.execute('INSERT INTO student_enrollments (id,student_id,school_id,class_id,academic_year_id,term_id,enrollment_status,is_current,enrolled_at) VALUES (?,?,?,?,?,?,?,?,?)', [enrollmentId, row.id, schoolId, classId, canonicalYearId, termId, 'ACTIVE', 1, timestamp]);
        enrollment = { id: enrollmentId, student_id: row.id, school_id: schoolId, class_id: classId, academic_year_id: canonicalYearId, term_id: termId, enrollment_status: 'ACTIVE', is_current: 1 };
      }
      if (input.healthInsuranceNumber !== undefined) {
        const healthInsuranceNumber = text(input.healthInsuranceNumber);
        await tx.execute('UPDATE students SET health_insurance_number=?,updated_at=? WHERE school_id=? AND id=?', [healthInsuranceNumber, timestamp, schoolId, row.id]);
        row.health_insurance_number = healthInsuranceNumber;
      }
      await tx.execute('UPDATE admission_applications SET student_id=?,permanent_student_id=?,stage=?,updated_at=? WHERE school_id=? AND student_id IS NULL AND permanent_student_id IS NULL AND application_number=?', [row.id, row.permanent_student_id ?? profile?.student_id ?? null, 'ENROLLMENT', timestamp, schoolId, text(input.applicationNumber)]);
      await tx.execute('INSERT INTO audit_logs (id,school_id,user_id,action,entity,entity_id,new_value,occurred_at) VALUES (?,?,?,?,?,?,?,?)', [idFactory(), schoolId, actor.id, 'EXISTING_STUDENT_LINKED', 'Student', row.id, JSON.stringify({ profileCreated: createdProfile, enrollmentCreated: !existingEnrollment, permanentStudentIdPreserved: Boolean(row.permanent_student_id ?? profile?.student_id), academicYearId: canonicalYearId, classId }), timestamp]);
      const latest = await loadStudent(tx, row.id);
      return { linked: true, createdProfile, createdEnrollment: !existingEnrollment, student: publicStudent(latest.row, latest.profile, enrollment) };
    });
  }

  async function getStudent(identifier, actor) {
    authorize(actor, schoolId);
    const id = text(identifier, { optional: false });
    const found = rows(await database.query('SELECT * FROM students WHERE school_id=? AND (id=? OR permanent_student_id=? OR admission_number=?) LIMIT 1', [schoolId, id, id, id]))[0];
    if (!found) return null;
    const profile = rows(await database.query('SELECT * FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY updated_at DESC,id DESC LIMIT 1', [schoolId, found.id]))[0] ?? null;
    return publicStudent(found, profile, null);
  }
  return Object.freeze({ link, getStudent });
}
export { STAFF_ROLES };
