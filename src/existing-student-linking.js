import { randomUUID } from 'node:crypto';
import { admissionYearFor, isPermanentStudentId } from './permanent-student-id.js';

const STAFF_ROLES = new Set(['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER']);
const rows = (value) => Array.isArray(value) ? value : [];
const value = (...items) => items.find((item) => item !== undefined && item !== null && item !== '') ?? null;
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const text = (input, field = 'Value', options = {}) => {
  if (field && typeof field === 'object') { options = field; field = 'Value'; }
  const optional = options.optional ?? true;
  if (input === undefined || input === null) return optional ? null : fail('IDENTITY_REQUIRED', `${field} is required.`, 400);
  const result = String(input).trim();
  if (!result && !optional) fail('IDENTITY_REQUIRED', `${field} is required.`, 400);
  return result || null;
};
const normalize = (input) => String(input ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const same = (left, right) => normalize(left) === normalize(right);
function dateOnly(input) {
  if (input instanceof Date && Number.isFinite(input.getTime())) return `${input.getFullYear()}-${String(input.getMonth() + 1).padStart(2, '0')}-${String(input.getDate()).padStart(2, '0')}`;
  const textValue = String(input ?? '').trim();
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(textValue);
  return match?.[1] ?? textValue;
}
const sameDate = (left, right) => dateOnly(left) === dateOnly(right);
const admissionType = (input) => String(input ?? '').trim().toUpperCase().replace(/[ -]+/g, '_');
function requireReliableIdentity(input) {
  if (input.studentId || input.permanentStudentId || input.admissionNumber) return;
  if (input.firstName && (input.lastName || input.surname) && input.dateOfBirth) return;
  fail('IDENTITY_INSUFFICIENT', 'Use a student record ID, Permanent Student ID, admission number, or the complete first name, last name, and date of birth.', 400);
}

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
    dateOfBirth: dateOnly(row.date_of_birth ?? row.dateOfBirth ?? profile?.date_of_birth) || null,
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
    requireReliableIdentity({ studentId, permanentStudentId, admissionNumber, firstName, lastName, dateOfBirth });
    const predicates = [];
    const params = [schoolId];
    if (studentId) { predicates.push('s.id=?'); params.push(studentId); }
    if (permanentStudentId) { predicates.push('(s.permanent_student_id=? OR EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.student_master_id=s.id AND sp.school_id=s.school_id AND sp.student_id=?))'); params.push(permanentStudentId, permanentStudentId); }
    if (admissionNumber) { predicates.push('s.admission_number=?'); params.push(admissionNumber); }
    if (firstName) { predicates.push('LOWER(s.first_name)=LOWER(?)'); params.push(firstName); }
    if (lastName) { predicates.push('LOWER(s.last_name)=LOWER(?)'); params.push(lastName); }
    if (dateOfBirth) { predicates.push('s.date_of_birth=?'); params.push(dateOfBirth); }
    return rows(await tx.query(`SELECT s.*,(SELECT sp.student_id FROM student_profiles sp WHERE sp.student_master_id=s.id AND sp.school_id=s.school_id ORDER BY sp.updated_at DESC,sp.id DESC LIMIT 1) AS profile_permanent_student_id FROM students s WHERE s.school_id=? AND COALESCE(s.is_test_record,0)=0 AND ${predicates.join(' AND ')} FOR UPDATE`, params));
  }

  function verifyIdentity(row, input) {
    for (const [field, actual] of [['studentId', row.id], ['permanentStudentId', row.permanent_student_id ?? row.profile_permanent_student_id], ['admissionNumber', row.admission_number], ['firstName', row.first_name], ['lastName', row.last_name]]) {
      if (input[field] !== undefined && input[field] !== null && input[field] !== '' && !same(input[field], actual)) fail('IDENTITY_CONFLICT', `The supplied ${field} does not match the existing student.`, 409);
    }
    if (input.dateOfBirth && !sameDate(input.dateOfBirth, row.date_of_birth)) fail('IDENTITY_CONFLICT', 'The supplied dateOfBirth does not match the existing student.', 409);
  }

  async function loadStudent(tx, studentId) {
    const row = rows(await tx.query('SELECT * FROM students WHERE school_id=? AND id=? FOR UPDATE', [schoolId, studentId]))[0];
    if (!row) fail('STUDENT_NOT_FOUND', 'Existing student was not found in this school.', 404);
    const profile = rows(await tx.query('SELECT * FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE', [schoolId, studentId]))[0] ?? null;
    return { row, profile };
  }

  async function nextPermanentStudentId(tx, yearInput, timestamp) {
    const year = admissionYearFor(yearInput);
    await tx.execute('INSERT INTO student_id_sequences (admission_year,next_sequence,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at)', [year, 1, timestamp]);
    const sequenceRow = rows(await tx.query('SELECT next_sequence FROM student_id_sequences WHERE admission_year=? FOR UPDATE', [year]))[0];
    let sequence = Number(sequenceRow?.next_sequence);
    if (!Number.isInteger(sequence) || sequence < 1) fail('STUDENT_ID_SEQUENCE_INVALID', 'Annual permanent Student ID sequence is invalid.', 409);
    const existing = rows(await tx.query('SELECT permanent_student_id FROM students WHERE permanent_student_id LIKE ? FOR UPDATE', [`OSAAH/${year}/%`]))
      .concat(rows(await tx.query('SELECT student_id AS permanent_student_id FROM student_profiles WHERE student_id LIKE ? FOR UPDATE', [`OSAAH/${year}/%`])))
      .map((row) => String(row.permanent_student_id ?? ''));
    const existingSequences = existing.map((id) => {
      const match = new RegExp(`^OSAAH/${year}/(\\d+)$`).exec(id);
      if (!match) fail('STUDENT_ID_SEQUENCE_CONFLICT', 'Existing Student IDs for this admission year need reconciliation before another ID can be issued.', 409);
      const value = Number(match[1]);
      if (!Number.isSafeInteger(value) || value < 1) fail('STUDENT_ID_SEQUENCE_CONFLICT', 'Existing Student IDs for this admission year need reconciliation before another ID can be issued.', 409);
      return value;
    });
    sequence = Math.max(sequence, ...existingSequences.map((item) => item + 1));
    const permanentStudentId = `OSAAH/${year}/${String(sequence).padStart(3, '0')}`;
    await tx.execute('UPDATE student_id_sequences SET next_sequence=?,updated_at=? WHERE admission_year=?', [sequence + 1, timestamp, year]);
    return permanentStudentId;
  }

  async function resolveMatch(tx, input) {
    const found = await candidates(tx, input);
    if (found.length > 1) fail('AMBIGUOUS_IDENTITY', 'More than one existing student matches the supplied identity. Provide the Permanent Student ID or admission number.', 409);
    const matched = found[0];
    if (!matched) fail('STUDENT_NOT_FOUND', 'No existing student matched the supplied stable identity.', 404);
    verifyIdentity(matched, input);
    const loaded = await loadStudent(tx, matched.id);
    return { ...loaded, matched };
  }

  async function preview(input, actor) {
    authorize(actor, schoolId);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_LINK_PAYLOAD', 'A link preview payload is required.');
    return database.transaction(async (tx) => {
      const { row, profile } = await resolveMatch(tx, input);
      const enrollment = rows(await tx.query('SELECT * FROM student_enrollments WHERE school_id=? AND student_id=? AND is_current=1 ORDER BY enrolled_at DESC,id DESC LIMIT 1', [schoolId, row.id]))[0] ?? null;
      const student = publicStudent(row, profile, enrollment);
      delete student.healthInsuranceNumber;
      return { matched: true, student };
    });
  }

  async function validateApplicationLink(tx, applicationNumber, row, profile) {
    if (!applicationNumber) return null;
    const matches = rows(await tx.query('SELECT * FROM admission_applications WHERE school_id=? AND application_number=? FOR UPDATE', [schoolId, applicationNumber]));
    const application = matches[0];
    if (!application) fail('APPLICATION_NOT_FOUND', 'The selected admission application was not found in this school.', 404);
    let applicant = application.applicant_data ?? {};
    if (typeof applicant === 'string') { try { applicant = JSON.parse(applicant); } catch { fail('APPLICATION_IDENTITY_UNRESOLVED', 'The application identity cannot be verified; review it manually.', 409); } }
    if (admissionType(applicant.admissionType) !== 'ALREADY_ENROLLED') fail('APPLICATION_CATEGORY_MISMATCH', 'Only an Already-Enrolled application may be attached through existing-student linking.', 409);
    const existingId = application.student_id ?? null;
    const existingPermanentId = application.permanent_student_id ?? null;
    if (Boolean(existingId) !== Boolean(existingPermanentId)) fail('APPLICATION_LINK_INCONSISTENT', 'The application has a partial student link and requires controlled review.', 409);
    if ((existingId && existingId !== row.id) || (existingPermanentId && existingPermanentId !== (row.permanent_student_id ?? profile?.student_id ?? null))) fail('APPLICATION_ALREADY_LINKED', 'The application is already linked to a different or conflicting student record.', 409);
    const firstName = applicant.studentFirstName ?? applicant.firstName;
    const lastName = applicant.studentSurname ?? applicant.surname ?? applicant.lastName;
    const dateOfBirth = applicant.dateOfBirth ?? applicant.date_of_birth;
    const suppliedStudentId = applicant.studentId ?? applicant.student_id;
    const suppliedPermanentId = applicant.permanentStudentId ?? applicant.permanent_student_id;
    const hasStableAppIdentity = Boolean(suppliedStudentId || suppliedPermanentId);
    const hasCompleteNameIdentity = Boolean(firstName && lastName && dateOfBirth);
    if (!hasStableAppIdentity && !hasCompleteNameIdentity) fail('APPLICATION_IDENTITY_UNRESOLVED', 'The application lacks a complete reliable identity; review it manually before linking.', 409);
    if ((suppliedStudentId && suppliedStudentId !== row.id) || (suppliedPermanentId && suppliedPermanentId !== (row.permanent_student_id ?? profile?.student_id ?? null)) || (firstName && !same(firstName, row.first_name)) || (lastName && !same(lastName, row.last_name)) || (dateOfBirth && !sameDate(dateOfBirth, row.date_of_birth))) fail('APPLICATION_IDENTITY_CONFLICT', 'The application and existing student identities do not match; review them manually.', 409);
    return application;
  }

  async function link(input, actor) {
    authorize(actor, schoolId);
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('INVALID_LINK_PAYLOAD', 'A link payload is required.');
    if (input.confirmIdentity !== true || !text(input.confirmedStudentId)) fail('IDENTITY_CONFIRMATION_REQUIRED', 'Review the matched student record and confirm its identity before linking.', 400);
    return database.transaction(async (tx) => {
      const { row, profile } = await resolveMatch(tx, input);
      if (String(input.confirmedStudentId).trim() !== String(row.id)) fail('IDENTITY_CONFIRMATION_MISMATCH', 'The confirmed record does not match the current identity search. Review the student again before linking.', 409);
      const linkedApplication = await validateApplicationLink(tx, text(input.applicationNumber), row, profile);
      const timestamp = clock();
      const masterId = row.permanent_student_id ? String(row.permanent_student_id).trim() : null;
      const profileStudentId = profile?.student_id ? String(profile.student_id).trim() : null;
      if (masterId && profileStudentId && masterId !== profileStudentId) fail('PERMANENT_STUDENT_ID_CONFLICT', 'The student and profile contain different Permanent Student IDs and require controlled review.', 409);
      const establishedId = masterId ?? profileStudentId;
      if (establishedId && !isPermanentStudentId(establishedId)) fail('PERMANENT_STUDENT_ID_REVIEW_REQUIRED', 'The existing student has a malformed Permanent Student ID and requires controlled review.', 409);
      const historicalYear = text(input.historicalAdmissionYear ?? input.admissionYear ?? input.osaaAdmissionYear);
      if (linkedApplication?.permanent_student_id && linkedApplication.permanent_student_id !== establishedId) fail('APPLICATION_ALREADY_LINKED', 'The application has a different Permanent Student ID and requires controlled review.', 409);
      if (!establishedId && !historicalYear) fail('HISTORICAL_ADMISSION_YEAR_REQUIRED', 'The actual historical OSAAH admission year is required before an ID can be assigned.', 409);
      if (historicalYear && (!/^\d{4}$/.test(historicalYear) || Number(historicalYear) > new Date(timestamp).getUTCFullYear())) fail('HISTORICAL_ADMISSION_YEAR_INVALID', 'The historical OSAAH admission year must be a valid year that is not in the future.', 409);
      const permanentStudentId = establishedId ?? await nextPermanentStudentId(tx, historicalYear, timestamp);
      if (!masterId) await tx.execute('UPDATE students SET permanent_student_id=?,updated_at=? WHERE school_id=? AND id=? AND (permanent_student_id IS NULL OR TRIM(permanent_student_id)=\'\')', [permanentStudentId, timestamp, schoolId, row.id]);
      let profileId = profile?.id ?? null;
      const createdProfile = !profileId;
      if (!profileId) {
        profileId = idFactory();
        await tx.execute('INSERT INTO student_profiles (id,student_master_id,student_id,school_id,admission_number,first_name,last_name,date_of_birth,enrollment_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [profileId, row.id, permanentStudentId, schoolId, row.admission_number, row.first_name, row.last_name, row.date_of_birth ?? null, row.student_status ?? 'ACTIVE', timestamp, timestamp]);
      } else if (!profileStudentId) {
        await tx.execute('UPDATE student_profiles SET student_id=?,updated_at=? WHERE school_id=? AND id=? AND (student_id IS NULL OR TRIM(student_id)=\'\')', [permanentStudentId, timestamp, schoolId, profileId]);
        profile.student_id = permanentStudentId;
      }
      const academicYearId = text(input.academicYearId ?? input.academicYear, 'Academic year', { optional: false });
      const classId = text(input.classId, 'Class', { optional: false });
      const termId = text(input.termId);
      const classRows = rows(await tx.query('SELECT id FROM classes WHERE school_id=? AND id=? LIMIT 1', [schoolId, classId]));
      if (!classRows.length) fail('CLASS_NOT_FOUND', 'The selected class does not belong to this school.', 409);
      const yearRows = rows(await tx.query('SELECT id FROM academic_years WHERE school_id=? AND (id=? OR name=?) LIMIT 1', [schoolId, academicYearId, academicYearId]));
      if (!yearRows.length) fail('ACADEMIC_YEAR_NOT_FOUND', 'The selected academic year does not belong to this school.', 409);
      const canonicalYearId = yearRows[0].id;
      const activeEnrollments = rows(await tx.query('SELECT * FROM student_enrollments WHERE school_id=? AND student_id=? AND is_current=1 FOR UPDATE', [schoolId, row.id]));
      if (activeEnrollments.length > 1) fail('CURRENT_ENROLLMENT_AMBIGUOUS', 'The student has multiple active enrollment records and requires controlled review.', 409);
      const activeEnrollment = activeEnrollments[0] ?? null;
      if (activeEnrollment && (activeEnrollment.academic_year_id !== canonicalYearId || activeEnrollment.class_id !== classId || (activeEnrollment.term_id ?? null) !== termId)) fail('CURRENT_ENROLLMENT_CONFLICT', 'The requested class, year, or term conflicts with the student’s active enrollment; review the current school record before linking.', 409);
      const existingEnrollment = rows(await tx.query('SELECT * FROM student_enrollments WHERE school_id=? AND student_id=? AND academic_year_id=? AND class_id=? AND (term_id=? OR (term_id IS NULL AND ? IS NULL)) LIMIT 1 FOR UPDATE', [schoolId, row.id, canonicalYearId, classId, termId, termId]))[0] ?? activeEnrollment;
      let enrollment = existingEnrollment;
      if (!enrollment) {
        const enrollmentId = idFactory();
        await tx.execute('INSERT INTO student_enrollments (id,student_id,school_id,class_id,academic_year_id,term_id,enrollment_status,is_current,enrolled_at) VALUES (?,?,?,?,?,?,?,?,?)', [enrollmentId, row.id, schoolId, classId, canonicalYearId, termId, 'ACTIVE', 1, timestamp]);
        enrollment = { id: enrollmentId, student_id: row.id, school_id: schoolId, class_id: classId, academic_year_id: canonicalYearId, term_id: termId, enrollment_status: 'ACTIVE', is_current: 1 };
      }
      if (input.healthInsuranceNumber !== undefined) {
        const healthInsuranceNumber = text(input.healthInsuranceNumber);
        if (healthInsuranceNumber && healthInsuranceNumber.length > 64) fail('HEALTH_INSURANCE_NUMBER_INVALID', 'Health Insurance Number must be 64 characters or fewer.', 400);
        await tx.execute('UPDATE students SET health_insurance_number=?,updated_at=? WHERE school_id=? AND id=?', [healthInsuranceNumber, timestamp, schoolId, row.id]);
        row.health_insurance_number = healthInsuranceNumber;
      }
      if (linkedApplication && !linkedApplication.student_id && !linkedApplication.permanent_student_id) {
        const linkResult = await tx.execute('UPDATE admission_applications SET student_id=?,permanent_student_id=?,stage=?,updated_at=? WHERE school_id=? AND student_id IS NULL AND permanent_student_id IS NULL AND application_number=?', [row.id, permanentStudentId, 'ENROLLMENT', timestamp, schoolId, linkedApplication.application_number]);
        if (Number(linkResult?.affectedRows) !== 1) fail('APPLICATION_LINK_CONFLICT', 'The application changed while it was being linked; review it again.', 409);
      }
      await tx.execute('INSERT INTO audit_logs (id,school_id,user_id,action,entity,entity_id,new_value,occurred_at) VALUES (?,?,?,?,?,?,?,?)', [idFactory(), schoolId, actor.id, 'EXISTING_STUDENT_LINKED', 'Student', row.id, JSON.stringify({ profileCreated: createdProfile, enrollmentCreated: !existingEnrollment, permanentStudentIdPreserved: Boolean(row.permanent_student_id ?? profile?.student_id), academicYearId: canonicalYearId, classId }), timestamp]);
      const latest = await loadStudent(tx, row.id);
      return { linked: true, createdProfile, createdEnrollment: !existingEnrollment, student: publicStudent({ ...latest.row, permanent_student_id: permanentStudentId }, latest.profile, enrollment) };
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
  return Object.freeze({ preview, link, getStudent });
}
export { STAFF_ROLES };
