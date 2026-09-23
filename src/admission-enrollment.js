import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { admissionYearFor } from './permanent-student-id.js';
import { requireStudentGender } from './student-gender.js';
import { canonicalClassId } from './student-classes.js';

function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function value(...items) { return items.find((item) => item !== undefined && item !== null && item !== '') ?? null; }
function json(valueToEncode) { return JSON.stringify(valueToEncode ?? {}); }
function rows(result) { return Array.isArray(result) ? result : []; }

/**
 * TiDB-backed final step for the existing admission review workflow. The
 * application service remains responsible for validation and the decision;
 * this service atomically materializes the accepted application as a student.
 */
export function createAdmissionEnrollmentService({ database, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.transaction) fail('DATABASE_ADAPTER_REQUIRED', 'Enrollment persistence is unavailable.', 503);

  async function nextStudentId(tx) {
    const latest = rows(await tx.query("SELECT id FROM students WHERE id LIKE 'STD-%' ORDER BY id DESC LIMIT 1 FOR UPDATE"))[0]?.id;
    const sequence = /^STD-(\d+)$/.exec(String(latest ?? '')) ? Number(RegExp.$1) + 1 : 1;
    return `STD-${String(sequence).padStart(6, '0')}`;
  }

  async function nextPermanentStudentId(tx, yearInput, timestamp) {
    const year = admissionYearFor(yearInput);
    await tx.execute('INSERT INTO student_id_sequences (admission_year,next_sequence,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at)', [year, 1, timestamp]);
    const sequenceRow = rows(await tx.query('SELECT next_sequence FROM student_id_sequences WHERE admission_year=? FOR UPDATE', [year]))[0];
    const sequence = Number(sequenceRow?.next_sequence);
    if (!Number.isInteger(sequence) || sequence < 1 || sequence > 9999) fail('STUDENT_ID_CAPACITY_EXCEEDED', 'Annual permanent Student ID capacity exceeded.', 409);
    const permanentStudentId = `OSAAH/${year}/${String(sequence).padStart(4, '0')}`;
    await tx.execute('UPDATE student_id_sequences SET next_sequence=?,updated_at=? WHERE admission_year=?', [sequence + 1, timestamp, year]);
    return permanentStudentId;
  }

  async function resolveParent(tx, application, applicant, timestamp) {
    const email = String(value(application.parent_email, applicant.primaryGuardianEmail, applicant.guardianEmail, applicant.email) ?? '').trim().toLowerCase();
    if (email) {
      const parent = rows(await tx.query('SELECT id FROM users WHERE school_id=? AND LOWER(email)=? LIMIT 1', [application.school_id, email]))[0];
      if (parent) return parent.id;
    }
    if (!email) fail('PARENT_IDENTITY_REQUIRED', 'An authorized parent identity is required before enrollment.', 409);
    const parentId = idFactory();
    const passwordHash = await bcrypt.hash(randomBytes(32).toString('base64url'), 12);
    await tx.execute('INSERT INTO users (id,school_id,email,password_hash,full_name,phone,role,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)', [parentId, application.school_id, email, passwordHash, value(application.parent_name, applicant.primaryGuardianFullName, 'Parent'), value(application.parent_phone, applicant.primaryGuardianPrimaryPhone), 'PARENT', 'ACTIVE', timestamp]);
    return parentId;
  }

  async function enroll({ applicationId, applicationNumber, actorId, expectedStatus = 'ACCEPTED' }) {
    try {
      return await database.transaction(async (tx) => {
        const application = rows(await tx.query('SELECT * FROM admission_applications WHERE (id=? OR application_number=?) FOR UPDATE', [applicationId ?? '', applicationNumber ?? '']))[0];
        if (!application) fail('APPLICATION_NOT_FOUND', 'Admission application not found.', 404);
        if (application.student_id || application.permanent_student_id) {
          if (!application.student_id || !application.permanent_student_id) fail('ENROLLMENT_INCONSISTENT', 'The existing enrollment record is incomplete.', 409);
          const existing = rows(await tx.query('SELECT * FROM students WHERE id=? AND permanent_student_id=? LIMIT 1', [application.student_id, application.permanent_student_id]))[0];
          if (!existing) fail('ENROLLMENT_INCONSISTENT', 'The existing enrollment record could not be resolved.', 409);
          return { student: existing, created: false };
        }
        const status = String(value(application.status, application.stage) ?? '').toUpperCase();
        const eligibleStatuses = expectedStatus === 'ACCEPTED' ? ['SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED'] : [expectedStatus];
        if (!eligibleStatuses.includes(status)) fail('APPLICATION_NOT_ELIGIBLE', 'Admission application is not eligible for enrollment.', 409);

        let applicant = application.applicant_data;
        if (typeof applicant === 'string') { try { applicant = JSON.parse(applicant); } catch { fail('APPLICANT_DATA_INVALID', 'Admission applicant data is invalid.', 409); } }
        applicant = { ...application, ...(applicant ?? {}) };
        const timestamp = clock();
        const studentId = await nextStudentId(tx);
        const permanentStudentId = await nextPermanentStudentId(tx, value(application.academic_year_id, applicant.academicYear, application.admission_date, timestamp), timestamp);
        const requestedClassId = value(application.class_id, applicant.classAssigned, applicant.classId);
        const classId = canonicalClassId(requestedClassId) ?? requestedClassId;
        const admissionNumber = value(application.admission_number, applicant.admissionNumber, application.application_number);
        const firstName = value(applicant.firstName, applicant.studentFirstName);
        const middleName = value(applicant.middleName, applicant.studentMiddleName);
        const lastName = value(applicant.lastName, applicant.surname, applicant.studentSurname);
        if (!firstName || !lastName || !classId) fail('APPLICANT_DATA_INCOMPLETE', 'Candidate name and assigned class are required for enrollment.', 409);
        const gender = requireStudentGender(applicant.gender);

        await tx.execute('INSERT INTO students (id,permanent_student_id,school_id,admission_number,current_class_id,first_name,middle_name,last_name,gender,date_of_birth,admission_date,admission_type,student_status,is_test_record,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [studentId, permanentStudentId, application.school_id, admissionNumber, classId, firstName, middleName, lastName, gender, value(applicant.dateOfBirth), value(application.admission_date, applicant.applicationDate, timestamp.slice(0, 10)), value(applicant.admissionType, 'NEW'), 'ACTIVE', 0, timestamp, timestamp]);
        const profileId = idFactory();
        await tx.execute('INSERT INTO student_profiles (id,student_master_id,student_id,school_id,class_id,stream_id,admission_number,admission_date,first_name,last_name,gender,date_of_birth,enrollment_status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [profileId, studentId, permanentStudentId, application.school_id, classId, value(application.stream_id, applicant.streamId), admissionNumber, value(application.admission_date, applicant.applicationDate, timestamp.slice(0, 10)), firstName, lastName, gender, value(applicant.dateOfBirth), 'ACTIVE', timestamp]);
        const enrollmentId = idFactory();
        await tx.execute('INSERT INTO student_enrollments (id,student_id,class_id,academic_year_id) VALUES (?,?,?,?)', [enrollmentId, studentId, classId, value(application.academic_year_id, applicant.academicYearId, applicant.academicYear)]);
        const parentUserId = await resolveParent(tx, application, applicant, timestamp);
        await tx.execute('INSERT INTO parent_student_links (parent_user_id,student_id,permanent_student_id,telephone,relationship,relationship_type,link_status,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM parent_student_links WHERE parent_user_id=? AND student_id=?)', [parentUserId, profileId, permanentStudentId, value(applicant.primaryGuardianPrimaryPhone, applicant.guardianPhone, applicant.telephone), value(applicant.primaryGuardianRelationship, 'Guardian'), value(applicant.primaryGuardianRelationship, 'GUARDIAN'), 'ACTIVE', timestamp, timestamp, parentUserId, profileId]);
        await tx.execute('UPDATE admission_applications SET student_id=?,permanent_student_id=?,stage=?,updated_at=? WHERE id=? AND student_id IS NULL AND permanent_student_id IS NULL', [studentId, permanentStudentId, 'ENROLLMENT', timestamp, application.id]);
        await tx.execute('INSERT INTO audit_logs (id,school_id,user_id,action,entity,entity_id,details,created_at) VALUES (?,?,?,?,?,?,?,?)', [idFactory(), application.school_id, actorId ?? null, 'ADMISSION_ENROLLMENT_CREATED', 'Student', studentId, json({ applicationId: application.id, studentId, permanentStudentId, profileId, enrollmentId, parentUserId }), timestamp]);
        return { student: { id: studentId, permanentStudentId, schoolId: application.school_id, admissionNumber, classId, firstName, middleName, lastName }, profileId, enrollmentId, parentUserId, created: true };
      });
    } catch (cause) {
      if (cause?.code && cause?.status) throw cause;
      fail('ENROLLMENT_FAILED', 'Enrollment could not be completed.', 503);
    }
  }

  async function authorizeParentStudent({ parentUserId, permanentStudentId, schoolId }) {
    if (!parentUserId || !permanentStudentId || !schoolId) fail('PARENT_STUDENT_SCOPE_REQUIRED', 'Parent, student, and school scope are required.', 400);
    const result = rows(await database.query('SELECT s.id AS student_id,s.permanent_student_id,sp.id AS student_profile_id,sp.class_id FROM students s JOIN student_profiles sp ON sp.student_master_id=s.id AND (sp.student_id=s.permanent_student_id OR sp.student_id=?) JOIN parent_student_links psl ON psl.student_id=sp.id AND psl.parent_user_id=? AND psl.link_status=? WHERE s.school_id=? AND s.permanent_student_id=? AND s.is_test_record=0 LIMIT 1', [permanentStudentId, parentUserId, 'ACTIVE', schoolId, permanentStudentId]))[0];
    if (!result) fail('PARENT_STUDENT_FORBIDDEN', 'You are not authorized to access this student.', 403);
    return result;
  }

  return Object.freeze({ enroll, authorizeParentStudent });
}
