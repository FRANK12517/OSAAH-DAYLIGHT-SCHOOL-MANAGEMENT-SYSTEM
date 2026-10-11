import { randomUUID } from 'node:crypto';
import { admissionYearFor } from './permanent-student-id.js';

function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function value(...items) { return items.find((item) => item !== undefined && item !== null && item !== '') ?? null; }
function json(valueToEncode) { return JSON.stringify(valueToEncode ?? {}); }
function rows(result) { return Array.isArray(result) ? result : []; }
function isValidAdmissionDate(value) { const date = String(value ?? '').slice(0, 10); return /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date; }
function sqlDateTime(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) fail('TIMESTAMP_INVALID', 'A valid timestamp is required.', 400); return date.toISOString().slice(0, 19).replace('T', ' '); }

/**
 * TiDB-backed final step for the existing admission review workflow. The
 * application service remains responsible for validation and the decision;
 * this service atomically materializes the accepted application as a student.
 */
export function createAdmissionEnrollmentService({ database, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.transaction) fail('DATABASE_ADAPTER_REQUIRED', 'Enrollment persistence is unavailable.', 503);

  async function nextStudentId() { return idFactory(); }

  async function nextPermanentStudentId(tx, schoolId, yearInput, timestamp) {
    const year = admissionYearFor(yearInput);
    const sequenceTimestamp = sqlDateTime(timestamp);
    await tx.execute('INSERT INTO student_id_sequences (admission_year,next_sequence,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE updated_at=VALUES(updated_at)', [year, 1, sequenceTimestamp]);
    const sequenceRow = rows(await tx.query('SELECT next_sequence FROM student_id_sequences WHERE admission_year=? FOR UPDATE', [year]))[0];
    let sequence = Number(sequenceRow?.next_sequence);
    if (!Number.isInteger(sequence) || sequence < 1) fail('STUDENT_ID_SEQUENCE_INVALID', 'Annual permanent Student ID sequence is invalid.', 409);
    const masterIds = rows(await tx.query('SELECT permanent_student_id FROM students WHERE school_id=? AND permanent_student_id LIKE ? FOR UPDATE', [schoolId, `OSAAH/${year}/%`])).map((row) => row.permanent_student_id);
    const profiles = rows(await tx.query('SELECT student_id,permanent_student_id FROM student_profiles WHERE school_id=? AND (student_id LIKE ? OR permanent_student_id LIKE ?) FOR UPDATE', [schoolId, `OSAAH/${year}/%`, `OSAAH/${year}/%`]));
    const seen = new Set();
    for (const existing of [...masterIds, ...profiles.flatMap((row) => [row.student_id, row.permanent_student_id])].filter(Boolean)) {
      const match = new RegExp(`^OSAAH/${year}/(\\d{4})$`).exec(String(existing));
      if (!match) fail('STUDENT_ID_SEQUENCE_CONFLICT', 'Existing Student IDs for this admission year require reconciliation.', 409);
      if (seen.has(existing)) continue;
      seen.add(existing);
      sequence = Math.max(sequence, Number(match[1]) + 1);
    }
    if (sequence > 9999) fail('STUDENT_ID_CAPACITY_EXCEEDED', 'Annual permanent Student ID capacity exceeded.', 409);
    const permanentStudentId = `OSAAH/${year}/${String(sequence).padStart(4, '0')}`;
    await tx.execute('UPDATE student_id_sequences SET next_sequence=?,updated_at=? WHERE admission_year=?', [sequence + 1, sequenceTimestamp, year]);
    return permanentStudentId;
  }

  async function resolveParent(tx, application, applicant) {
    const email = String(value(application.parent_email, applicant.primaryGuardianEmail, applicant.guardianEmail, applicant.email) ?? '').trim().toLowerCase();
    if (!email) return null;
    return rows(await tx.query(`SELECT u.id FROM users u
      JOIN user_roles ur ON ur.user_id=u.id
      JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id AND r.role_key='PARENT'
      WHERE u.school_id=? AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE' AND LOWER(u.email)=? LIMIT 1`, [application.school_id, email]))[0]?.id ?? null;
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
        const eligibleStatuses = [expectedStatus];
        if (!eligibleStatuses.includes(status)) fail('APPLICATION_NOT_ELIGIBLE', 'Admission application is not eligible for enrollment.', 409);

        let applicant = application.applicant_data;
        if (typeof applicant === 'string') { try { applicant = JSON.parse(applicant); } catch { fail('APPLICANT_DATA_INVALID', 'Admission applicant data is invalid.', 409); } }
        applicant ??= {};
        const timestamp = clock();
        const studentId = await nextStudentId();
        const admissionType = String(applicant.admissionType ?? '').trim().toUpperCase().replace(/[ -]+/g, '_');
        if (['EXISTING_STUDENT', 'ALREADY_ENROLLED'].includes(admissionType)) fail('EXISTING_STUDENT_MIGRATION_REQUIRED', 'Existing students must use the authorized migration workflow.', 409);
        const admissionDate = value(applicant.admissionDate, applicant.applicationDate);
        if (!isValidAdmissionDate(admissionDate)) fail('ADMISSION_DATE_REQUIRED', 'A verified admission date is required before issuing a permanent Student ID.', 409);
        const classId = value(applicant.officialUse?.classAssigned, applicant.classAssigned, applicant.classId);
        const admissionNumber = value(applicant.admissionNumber, application.application_number);
        const firstName = value(applicant.firstName, applicant.studentFirstName);
        const middleName = value(applicant.middleName, applicant.studentMiddleName);
        const lastName = value(applicant.lastName, applicant.surname, applicant.studentSurname);
        if (!firstName || !lastName || !classId) fail('APPLICANT_DATA_INCOMPLETE', 'Candidate name and assigned class are required for enrollment.', 409);
        const duplicate = rows(await tx.query(`SELECT id FROM students WHERE school_id=?
          AND LOWER(TRIM(first_name))=LOWER(TRIM(?)) AND LOWER(TRIM(last_name))=LOWER(TRIM(?))
          AND date_of_birth=? LIMIT 2 FOR UPDATE`, [application.school_id, firstName, lastName, value(applicant.dateOfBirth)]));
        if (duplicate.length) fail('POSSIBLE_DUPLICATE_IDENTITY', 'A matching student identity already exists; review the canonical record before enrolling.', 409);
        const permanentStudentId = await nextPermanentStudentId(tx, application.school_id, admissionDate, timestamp);

        const guardianName = value(applicant.primaryGuardianFullName);
        const guardianPhone = value(applicant.primaryGuardianPrimaryPhone);
        await tx.execute('INSERT INTO students (id,permanent_student_id,school_id,admission_number,current_class_id,first_name,middle_name,last_name,full_name,gender,date_of_birth,parent_guardian_name,parent_phone,admission_date,student_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [studentId, permanentStudentId, application.school_id, admissionNumber, classId, firstName, middleName, lastName, [firstName, middleName, lastName].filter(Boolean).join(' '), value(applicant.gender), value(applicant.dateOfBirth), guardianName, guardianPhone, admissionDate, 'ACTIVE', timestamp, timestamp]);
        const profileId = idFactory();
        await tx.execute('INSERT INTO student_profiles (id,school_id,admission_number,first_name,middle_name,surname,gender,date_of_birth,nationality,qr_code,class_id,stream_id,admission_date,previous_school,admission_type,created_at,updated_at,permanent_student_id,student_master_id,student_id,enrollment_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [profileId, application.school_id, admissionNumber, firstName, middleName, lastName, value(applicant.gender), value(applicant.dateOfBirth), value(applicant.nationality), `osaah:student:${permanentStudentId}`, classId, value(applicant.streamId), admissionDate, value(applicant.previousSchoolAttended, applicant.previousSchool), admissionType || 'FIRST_TIME', timestamp, timestamp, permanentStudentId, studentId, permanentStudentId, 'ACTIVE']);
        const enrollmentId = idFactory();
        const academicYearId = value(applicant.academicYearId);
        const termId = value(applicant.termId);
        if (!academicYearId || !termId) fail('ACADEMIC_ENROLLMENT_CONTEXT_REQUIRED', 'A verified academic year and term are required before enrollment.', 409);
        await tx.execute('INSERT INTO student_enrollments (id,student_id,school_id,class_id,academic_year_id,term_id,enrollment_status,is_current,enrolled_at) VALUES (?,?,?,?,?,?,?,?,?)', [enrollmentId, studentId, application.school_id, classId, academicYearId, termId, 'ACTIVE', 1, timestamp]);
        for (const guardian of [
          { type: 'PRIMARY_GUARDIAN', name: value(applicant.primaryGuardianFullName, application.parent_name), phone: value(applicant.primaryGuardianPrimaryPhone, application.parent_phone), alternate: applicant.primaryGuardianSecondaryPhone, relation: applicant.primaryGuardianRelationship },
          { type: 'SECONDARY_GUARDIAN', name: applicant.secondaryGuardianFullName, phone: applicant.secondaryGuardianPrimaryPhone, alternate: applicant.secondaryGuardianSecondaryPhone, relation: applicant.secondaryGuardianRelationship }
        ].filter((item) => item.name)) {
          await tx.execute('INSERT INTO student_family_contacts (id,student_id,contact_type,full_name,relationship,telephone,alternative_phone,address,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [idFactory(), profileId, guardian.type, guardian.name, value(guardian.relation, 'Guardian'), guardian.phone ?? null, guardian.alternate ?? null, value(applicant.residentialAddress), timestamp, timestamp]);
        }
        const parentUserId = await resolveParent(tx, application, applicant);
        if (parentUserId) await tx.execute('INSERT INTO parent_student_links (parent_user_id,student_id,relationship,telephone,created_at) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE relationship=COALESCE(relationship,VALUES(relationship)),telephone=COALESCE(telephone,VALUES(telephone))', [parentUserId, profileId, value(applicant.primaryGuardianRelationship, 'Guardian'), value(applicant.primaryGuardianPrimaryPhone, application.parent_phone), timestamp]);
        await tx.execute('UPDATE admission_applications SET student_id=?,permanent_student_id=?,stage=?,updated_at=? WHERE id=? AND student_id IS NULL AND permanent_student_id IS NULL', [studentId, permanentStudentId, 'ENROLLMENT', timestamp, application.id]);
        await tx.execute('INSERT INTO audit_logs (id,school_id,user_id,action,entity,entity_id,new_value,occurred_at) VALUES (?,?,?,?,?,?,?,?)', [idFactory(), application.school_id, actorId ?? null, 'ADMISSION_ENROLLMENT_CREATED', 'Student', studentId, json({ applicationId: application.id, studentId, permanentStudentId, profileId, enrollmentId, parentUserId }), timestamp]);
        return { student: { id: studentId, permanentStudentId, schoolId: application.school_id, admissionNumber, classId, firstName, middleName, lastName }, profileId, enrollmentId, parentUserId, created: true };
      });
    } catch (cause) {
      if (cause?.code && cause?.status) throw cause;
      fail('ENROLLMENT_FAILED', 'Enrollment could not be completed.', 503);
    }
  }

  async function authorizeParentStudent({ parentUserId, permanentStudentId, schoolId }) {
    if (!parentUserId || !permanentStudentId || !schoolId) fail('PARENT_STUDENT_SCOPE_REQUIRED', 'Parent, student, and school scope are required.', 400);
    const result = rows(await database.query('SELECT s.id AS student_id,s.permanent_student_id,sp.id AS student_profile_id,sp.class_id FROM students s JOIN student_profiles sp ON sp.student_master_id=s.id AND sp.student_id=s.permanent_student_id JOIN parent_student_links psl ON psl.student_id=sp.id AND psl.parent_user_id=? AND psl.link_status=? WHERE s.school_id=? AND s.permanent_student_id=? LIMIT 1', [parentUserId, 'ACTIVE', schoolId, permanentStudentId]))[0];
    if (!result) fail('PARENT_STUDENT_FORBIDDEN', 'You are not authorized to access this student.', 403);
    return result;
  }

  return Object.freeze({ enroll, authorizeParentStudent });
}
