import { randomUUID } from 'node:crypto';
import { normalizeGhanaPhone } from './ghana-phone.js';
import { requireStudentGender } from './student-gender.js';
import { canonicalClassId } from './student-classes.js';
import { tidbInsertIfAbsent } from './tidb-conflict.js';
import { ghanaPhoneLookupValues } from './utils/normalize-phone.js';

const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const text = (value, max = 255) => { const result = String(value ?? '').trim(); return result ? result.slice(0, max) : null; };
const normalizeName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const canonicalTerm = (value) => ({ '1st term': '1st Term', 'first term': '1st Term', 'term 1': '1st Term', '2nd term': '2nd Term', 'second term': '2nd Term', 'term 2': '2nd Term', '3rd term': '3rd Term', 'third term': '3rd Term', 'term 3': '3rd Term' })[String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
function normalizedPhone(value) { try { return normalizeGhanaPhone(value); } catch { return null; } }

export function createInternalStudentRegistrationService({ database, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.transaction) fail('DATABASE_ADAPTER_REQUIRED', 'Internal registration persistence is unavailable.', 503);

  async function findExistingStudent(identity, schoolId) {
    const lookup = typeof identity === 'string' ? { permanentStudentId: identity } : (identity ?? {});
    const permanentStudentId = text(lookup.permanentStudentId, 128);
    const studentId = text(lookup.studentId, 64);
    const admissionNumber = text(lookup.admissionNumber, 128);
    const firstName = text(lookup.firstName, 100);
    const lastName = text(lookup.lastName, 100);
    const dateOfBirth = text(lookup.dateOfBirth, 10);
    let sql, params;
    if (permanentStudentId) {
      sql = `SELECT s.id AS studentId,s.permanent_student_id AS masterPermanentStudentId,s.admission_number AS admissionNumber,
        s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS lastName,s.date_of_birth AS dateOfBirth,
        s.current_class_id AS currentClassId FROM students s WHERE s.school_id=? AND s.is_test_record IS NOT TRUE
        AND (s.permanent_student_id=? OR s.admission_number=? OR EXISTS
          (SELECT 1 FROM student_profiles sp WHERE sp.school_id=s.school_id AND sp.student_master_id=s.id AND sp.student_id=?)) LIMIT 2`;
      params = [schoolId, permanentStudentId, permanentStudentId, permanentStudentId];
    } else if (studentId) {
      sql = `SELECT s.id AS studentId,s.permanent_student_id AS masterPermanentStudentId,s.admission_number AS admissionNumber,
        s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS lastName,s.date_of_birth AS dateOfBirth,
        s.current_class_id AS currentClassId FROM students s WHERE s.school_id=? AND s.id=? AND s.is_test_record IS NOT TRUE LIMIT 2`;
      params = [schoolId, studentId];
    } else if (admissionNumber) {
      sql = `SELECT s.id AS studentId,s.permanent_student_id AS masterPermanentStudentId,s.admission_number AS admissionNumber,
        s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS lastName,s.date_of_birth AS dateOfBirth,
        s.current_class_id AS currentClassId FROM students s WHERE s.school_id=? AND s.admission_number=? AND s.is_test_record IS NOT TRUE LIMIT 2`;
      params = [schoolId, admissionNumber];
    } else if (firstName && lastName && dateOfBirth) {
      sql = `SELECT s.id AS studentId,s.permanent_student_id AS masterPermanentStudentId,s.admission_number AS admissionNumber,
        s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS lastName,s.date_of_birth AS dateOfBirth,
        s.current_class_id AS currentClassId FROM students s WHERE s.school_id=? AND s.is_test_record IS NOT TRUE
        AND LOWER(s.first_name)=LOWER(?) AND LOWER(s.last_name)=LOWER(?) AND s.date_of_birth=? LIMIT 2`;
      params = [schoolId, firstName, lastName, dateOfBirth];
    } else {
      fail('STUDENT_LOOKUP_IDENTITY_REQUIRED', 'Enter an existing Student ID, or provide the student’s full name and date of birth.', 400);
    }
    let found;
    try {
      found = rows(await database.query(sql, params));
    } catch { fail('STUDENT_LOOKUP_FAILED', 'Existing student details could not be checked. Please retry.', 503); }
    if (found.length > 1) fail('STUDENT_IDENTITY_AMBIGUOUS', 'More than one student matches these details. Use the student’s unique ID or ask the proprietor to reconcile the records.', 409);
    const student = found[0];
    if (!student) return null;
    let profiles;
    try {
      profiles = rows(await database.query(`SELECT id AS profileId,student_id AS profileStudentId,class_id AS profileClassId,
        first_name AS profileFirstName,middle_name AS profileMiddleName,surname AS profileLastName,
        date_of_birth AS profileDateOfBirth FROM student_profiles WHERE school_id=? AND student_master_id=?
        ORDER BY updated_at DESC,id DESC LIMIT 2`, [schoolId, student.studentId]));
    } catch { fail('STUDENT_LOOKUP_FAILED', 'Existing student details could not be checked. Please retry.', 503); }
    const profile = profiles[0] ?? null;
    if (student.masterPermanentStudentId && profile?.profileStudentId && String(student.masterPermanentStudentId) !== String(profile.profileStudentId)) fail('STUDENT_ID_PROFILE_CONFLICT', 'The student and profile contain different IDs. Ask the proprietor to reconcile the record.', 409);
    return {
      ...student,
      permanentStudentId: student.masterPermanentStudentId ?? profile?.profileStudentId ?? (permanentStudentId && student.admissionNumber === permanentStudentId ? permanentStudentId : null),
      profileId: profile?.profileId ?? null,
      classId: student.currentClassId ?? profile?.profileClassId ?? null,
      firstName: student.firstName ?? profile?.profileFirstName,
      middleName: student.middleName ?? profile?.profileMiddleName,
      lastName: student.lastName ?? profile?.profileLastName,
      dateOfBirth: student.dateOfBirth ?? profile?.profileDateOfBirth
    };
  }

  async function resolveExistingParent(tx, { schoolId, parentEmail, parentPhone, timestamp }) {
    const candidates = rows(await tx.query(`SELECT DISTINCT u.id,u.email,u.phone,u.username FROM users u
      JOIN user_roles ur ON ur.user_id=u.id
      JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id AND r.role_key='PARENT'
      WHERE u.school_id=? AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE'`, [schoolId]));
    const matched = candidates.filter((item) => (parentEmail && String(item.email ?? '').trim().toLowerCase() === parentEmail.toLowerCase())
      || normalizedPhone(item.phone) === parentPhone || String(item.username ?? '') === parentPhone);
    if (matched.length > 1) fail('PARENT_IDENTITY_AMBIGUOUS', 'More than one parent account matches these contact details. Reconcile the parent accounts before linking the student.', 409);
    if (matched[0]) return matched[0].id;
    const role = rows(await tx.query("SELECT id FROM roles WHERE school_id=? AND role_key='PARENT' LIMIT 1 FOR UPDATE", [schoolId]))[0];
    if (!role) fail('PARENT_ROLE_NOT_CONFIGURED', 'Parent Portal access is not configured for this school. Ask an administrator to configure the Parent role before completing registration.', 503);
    const parentUserId = idFactory();
    await tx.execute(`INSERT INTO users (id,school_id,username,email,phone,password_hash,status,created_at,updated_at)
      VALUES (?,?,?,?,?,NULL,'ACTIVE',?,?)`, [parentUserId, schoolId, parentPhone, parentEmail, parentPhone, timestamp, timestamp]);
    await tx.execute('INSERT INTO user_roles (id,user_id,role_id,created_at) VALUES (?,?,?,?)', [idFactory(), parentUserId, role.id, timestamp]);
    return parentUserId;
  }

  async function reserve({ actorId, reservationToken: requestedToken } = {}) {
    const admissionYear = new Date(clock()).getUTCFullYear();
    if (!Number.isInteger(admissionYear) || admissionYear < 2000 || admissionYear > 9999) fail('ADMISSION_YEAR_INVALID', 'A valid four-digit admission year is required.');
    if (!actorId) fail('ACTOR_REQUIRED', 'An authorized staff account is required.', 401);
    if (requestedToken != null && !/^[A-Za-z0-9-]{1,64}$/.test(String(requestedToken))) fail('STUDENT_ID_RESERVATION_TOKEN_INVALID', 'The ID request could not be verified. Please retry.');
    const timestamp = clock(), token = String(requestedToken ?? idFactory()), reservationId = idFactory();
    try {
      return await database.transaction(async (tx) => {
        if (requestedToken) {
          const existing = rows(await tx.query('SELECT * FROM student_id_reservations WHERE reservation_token=? FOR UPDATE', [token]))[0];
          if (existing) {
            if (String(existing.reserved_by) !== String(actorId)) fail('STUDENT_ID_RESERVATION_FORBIDDEN', 'This reserved Student ID is unavailable to this registration.', 409);
            return { permanentStudentId: existing.permanent_student_id, reservationToken: token, admissionYear: Number(existing.admission_year), status: existing.reservation_status };
          }
        }
        await tidbInsertIfAbsent(tx, { insertSql: 'INSERT INTO student_id_sequences (admission_year,next_sequence,updated_at) VALUES (?,?,?)', insertParameters: [admissionYear, 1, timestamp], conflictSql: 'SELECT admission_year FROM student_id_sequences WHERE admission_year=?', conflictParameters: [admissionYear] });
        const sequenceRow = rows(await tx.query('SELECT next_sequence FROM student_id_sequences WHERE admission_year=? FOR UPDATE', [admissionYear]))[0];
        if (requestedToken) {
          const existing = rows(await tx.query('SELECT * FROM student_id_reservations WHERE reservation_token=? FOR UPDATE', [token]))[0];
          if (existing) {
            if (String(existing.reserved_by) !== String(actorId)) fail('STUDENT_ID_RESERVATION_FORBIDDEN', 'This reserved Student ID is unavailable to this registration.', 409);
            return { permanentStudentId: existing.permanent_student_id, reservationToken: token, admissionYear: Number(existing.admission_year), status: existing.reservation_status };
          }
        }
        let sequence = Number(sequenceRow?.next_sequence);
        if (!Number.isSafeInteger(sequence) || sequence < 1) fail('STUDENT_ID_SEQUENCE_INVALID', 'Annual permanent Student ID sequence is invalid.', 409);
        const alreadyIssued = rows(await tx.query('SELECT permanent_student_id FROM students WHERE permanent_student_id LIKE ? FOR UPDATE', [`OSAAH/${admissionYear}/%`])).map((row) => String(row.permanent_student_id ?? ''));
        const profileIds = rows(await tx.query('SELECT student_id FROM student_profiles WHERE student_id LIKE ? FOR UPDATE', [`OSAAH/${admissionYear}/%`])).map((row) => String(row.student_id ?? ''));
        const reserved = rows(await tx.query('SELECT permanent_student_id FROM student_id_reservations WHERE admission_year=? FOR UPDATE', [admissionYear])).map((row) => String(row.permanent_student_id ?? ''));
        const sequences = [...alreadyIssued, ...profileIds, ...reserved].map((value) => {
          const match = new RegExp(`^OSAAH/${admissionYear}/(\\d+)$`).exec(value);
          if (!match || !Number.isSafeInteger(Number(match[1]))) fail('STUDENT_ID_SEQUENCE_CONFLICT', 'Existing Student IDs require reconciliation before another ID can be issued.', 409);
          return Number(match[1]);
        });
        sequence = Math.max(sequence, ...sequences.map((value) => value + 1));
        const permanentStudentId = `OSAAH/${admissionYear}/${String(sequence).padStart(3, '0')}`;
        await tx.execute('UPDATE student_id_sequences SET next_sequence=?,updated_at=? WHERE admission_year=?', [sequence + 1, timestamp, admissionYear]);
        await tx.execute(`INSERT INTO student_id_reservations
          (id,reservation_token,permanent_student_id,admission_year,sequence_number,reservation_status,student_id,reserved_by,created_at,consumed_at)
          VALUES (?,?,?,?,?,'RESERVED',NULL,?,?,NULL)`, [reservationId, token, permanentStudentId, admissionYear, sequence, actorId, timestamp]);
        return { permanentStudentId, reservationToken: token, admissionYear };
      });
    } catch (error) { if (error?.status) throw error; fail('STUDENT_ID_RESERVATION_FAILED', 'A permanent Student ID could not be reserved. Please retry.', 503); }
  }

  async function register(input, { schoolId, actorId } = {}) {
    if (!schoolId || !actorId) fail('ACTOR_REQUIRED', 'An authorized school staff account is required.', 401);
    const category = String(input?.admissionType ?? '').trim().toUpperCase().replace(/[ -]+/g, '_');
    if (!['FIRST_TIME', 'TRANSFER', 'ALREADY_ENROLLED'].includes(category)) fail('ADMISSION_CATEGORY_INVALID', 'Select an admission category.');
    const firstName = text(input.firstName ?? input.studentFirstName, 100), middleName = text(input.middleName, 100), lastName = text(input.lastName ?? input.studentSurname, 100);
    if (!firstName || !lastName) fail('STUDENT_NAME_REQUIRED', 'Pupil first and last names are required.');
    const dateOfBirth = text(input.dateOfBirth, 10);
    const parsedDate = dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ? new Date(`${dateOfBirth}T00:00:00Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateOfBirth) fail('DATE_OF_BIRTH_INVALID', 'Enter a valid date of birth.');
    const gender = requireStudentGender(input.gender);
    let classId = String(input.classId ?? '').trim();
    if (!classId) fail('CLASS_REQUIRED', 'Select a class.');
    const parentName = text(input.parentName, 255), parentPhoneRaw = text(input.parentPhone, 50);
    if (!parentName || !parentPhoneRaw) fail('PARENT_DETAILS_REQUIRED', 'Parent/guardian name and phone number are required.');
    const parentPhone = normalizeGhanaPhone(parentPhoneRaw);
    if (!parentPhone) fail('PARENT_PHONE_INVALID', 'Enter a valid Ghanaian mobile number.');
    const homeAddress = text(input.homeAddress, 500), parentAddress = text(input.parentAddress, 500);
    if (!homeAddress || !parentAddress) fail('ADDRESS_REQUIRED', 'Pupil home and parent/guardian residential addresses are required.');
    const parentEmail = text(input.parentEmail, 254);
    if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) fail('PARENT_EMAIL_INVALID', 'Enter a valid parent/guardian email address.');
    const emergencyPhoneRaw = text(input.emergencyPhone, 50);
    const emergencyPhone = emergencyPhoneRaw ? normalizeGhanaPhone(emergencyPhoneRaw) : null;
    const academicYearId = text(input.academicYearId, 64), termId = text(input.termId, 64);
    if (!academicYearId || !termId) fail('ACADEMIC_PERIOD_REQUIRED', 'Select the academic year and one term for class registration.');
    const timestamp = clock(), admissionDate = timestamp.slice(0, 10);
    try {
      return await database.transaction(async (tx) => {
        const registrationYear = new Date(timestamp).getUTCFullYear();
        await tidbInsertIfAbsent(tx, { insertSql: 'INSERT INTO student_id_sequences (admission_year,next_sequence,updated_at) VALUES (?,?,?)', insertParameters: [registrationYear, 1, timestamp], conflictSql: 'SELECT admission_year FROM student_id_sequences WHERE admission_year=?', conflictParameters: [registrationYear] });
        const registrationLock = rows(await tx.query('SELECT admission_year FROM student_id_sequences WHERE admission_year=? FOR UPDATE', [registrationYear]))[0];
        if (!registrationLock) fail('STUDENT_REGISTRATION_LOCK_UNAVAILABLE', 'Student registration is temporarily unavailable. Please retry.', 503);
        const period = rows(await tx.query(`SELECT y.id AS academicYearId,y.name AS academicYearName,y.starts_on AS academicYearStartsOn,t.id AS termId,t.name AS termName FROM academic_years y
          JOIN terms t ON t.academic_year_id=y.id WHERE y.school_id=? AND y.id=? AND t.id=? LIMIT 1`, [schoolId, academicYearId, termId]))[0];
        if (!period) fail('ACADEMIC_PERIOD_INVALID', 'Select a valid academic year and term.');
        if (!canonicalTerm(period.termName)) fail('ACADEMIC_TERM_INVALID', 'Choose 1st Term, 2nd Term, or 3rd Term.');
        const academicYear = String(period.academicYearStartsOn ?? period.academicYearName ?? '').match(/\d{4}/)?.[0];
        if (!academicYear) fail('ACADEMIC_YEAR_INVALID', 'The selected academic year does not have a valid start year.', 409);

        let student, profile, created = false, isExistingStudent = false;
        let reservation = null;
        if (category === 'ALREADY_ENROLLED') {
          const existingStudentId = String(input.existingStudentId ?? '').trim();
          const existingPermanentStudentId = String(input.existingPermanentStudentId ?? '').trim();
          if (!existingStudentId && !existingPermanentStudentId) fail('EXISTING_STUDENT_ID_REQUIRED', 'Find the existing student before completing registration.');
          const matches = existingStudentId
            ? rows(await tx.query(`SELECT id AS studentId,permanent_student_id AS permanentStudentId,admission_number AS admissionNumber,
                first_name AS firstName,middle_name AS middleName,last_name AS lastName,date_of_birth AS dateOfBirth,
                current_class_id AS currentClassId,gender,student_status AS studentStatus FROM students WHERE school_id=? AND id=? AND is_test_record IS NOT TRUE FOR UPDATE`, [schoolId, existingStudentId]))
            : rows(await tx.query(`SELECT id AS studentId,permanent_student_id AS permanentStudentId,admission_number AS admissionNumber,
                first_name AS firstName,middle_name AS middleName,last_name AS lastName,date_of_birth AS dateOfBirth,
                current_class_id AS currentClassId,gender,student_status AS studentStatus FROM students WHERE school_id=?
                AND (permanent_student_id=? OR admission_number=?) AND is_test_record IS NOT TRUE FOR UPDATE`, [schoolId, existingPermanentStudentId, existingPermanentStudentId]));
          if (matches.length !== 1) fail('EXISTING_STUDENT_NOT_FOUND', 'Student ID not found. Please verify the ID number and try again.', 404);
          student = matches[0];
          if (normalizeName([student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')) !== normalizeName([firstName, middleName, lastName].filter(Boolean).join(' ')) || String(student.dateOfBirth ?? '').slice(0, 10) !== dateOfBirth) fail('EXISTING_STUDENT_IDENTITY_MISMATCH', 'The name and date of birth do not match this existing student ID.', 409);
          profile = rows(await tx.query('SELECT id,student_id AS permanentStudentId,class_id AS classId FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY updated_at DESC,id DESC LIMIT 1 FOR UPDATE', [schoolId, student.studentId]))[0] ?? null;
          const masterId = String(student.permanentStudentId ?? '').trim() || null;
          const profileId = String(profile?.permanentStudentId ?? '').trim() || null;
          if (masterId && profileId && masterId !== profileId) fail('STUDENT_ID_PROFILE_CONFLICT', 'The student and profile contain different IDs. Ask the proprietor to reconcile the record.', 409);
          let permanentStudentId = masterId ?? profileId ?? null;
          if (existingPermanentStudentId && permanentStudentId && existingPermanentStudentId !== permanentStudentId) fail('EXISTING_STUDENT_IDENTITY_MISMATCH', 'The entered ID does not match this student’s existing ID.', 409);
          if (!permanentStudentId && existingPermanentStudentId && student.admissionNumber === existingPermanentStudentId) permanentStudentId = existingPermanentStudentId;
          if (!permanentStudentId) {
            if (String(input.existingIdChoice ?? '').toUpperCase() !== 'NO_ID') fail('EXISTING_STUDENT_ID_REQUIRED', 'Choose I DO NOT HAVE AN ID to generate an ID for this existing student.');
            const token = String(input.reservationToken ?? '').trim();
            if (!token) fail('STUDENT_ID_RESERVATION_REQUIRED', 'A permanent Student ID reservation is required for an existing student without an ID.');
            reservation = rows(await tx.query('SELECT * FROM student_id_reservations WHERE reservation_token=? FOR UPDATE', [token]))[0];
            if (!reservation || reservation.reservation_status !== 'RESERVED' || String(reservation.reserved_by) !== String(actorId)) fail('STUDENT_ID_RESERVATION_FORBIDDEN', 'This reserved Student ID is unavailable to this registration.', 409);
            if (Number(reservation.admission_year) !== new Date(timestamp).getUTCFullYear()) fail('STUDENT_ID_YEAR_MISMATCH', 'This Student ID reservation is not from the current calendar year. Generate a new ID.', 409);
            permanentStudentId = reservation.permanent_student_id;
          } else if (reservation) {
            fail('STUDENT_ID_ALREADY_EXISTS', 'This student already has an ID. The existing ID will be retained.', 409);
          }
          if (!masterId && permanentStudentId) {
            await tx.execute('UPDATE students SET permanent_student_id=?,updated_at=? WHERE school_id=? AND id=? AND (permanent_student_id IS NULL OR permanent_student_id=\'\')', [permanentStudentId, timestamp, schoolId, student.studentId]);
            const confirmed = rows(await tx.query('SELECT permanent_student_id AS permanentStudentId FROM students WHERE school_id=? AND id=? LIMIT 1 FOR UPDATE', [schoolId, student.studentId]))[0];
            const confirmedId = String(confirmed?.permanentStudentId ?? '').trim();
            if (!confirmedId) fail('STUDENT_ID_PERSISTENCE_FAILED', 'The permanent Student ID could not be saved. Please retry.', 503);
            permanentStudentId = confirmedId;
          }
          if (!profile) {
            const profileId = idFactory();
            await tx.execute(`INSERT INTO student_profiles (id,student_master_id,student_id,school_id,admission_number,first_name,middle_name,surname,gender,date_of_birth,class_id,qr_code,enrollment_status,created_at,updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [profileId, student.studentId, permanentStudentId, schoolId, student.admissionNumber, student.firstName, student.middleName, student.lastName, student.gender ?? gender, student.dateOfBirth, student.currentClassId ?? classId, `osaah:student:${profileId}`, student.studentStatus ?? 'ACTIVE', timestamp, timestamp]);
            profile = { id: profileId, permanentStudentId, classId: student.currentClassId ?? classId };
          } else if (!profile.permanentStudentId) {
            await tx.execute('UPDATE student_profiles SET student_id=?,updated_at=? WHERE school_id=? AND id=? AND (student_id IS NULL OR student_id=\'\')', [permanentStudentId, timestamp, schoolId, profile.id]);
            profile.permanentStudentId = permanentStudentId;
          }
          if (reservation) await tx.execute(`UPDATE student_id_reservations SET reservation_status='CONSUMED',student_id=?,consumed_at=? WHERE id=? AND reservation_status='RESERVED'`, [student.studentId, timestamp, reservation.id]);
          student.permanentStudentId = permanentStudentId;
          classId = String(student.currentClassId ?? profile.classId ?? classId);
          if (!student.currentClassId) await tx.execute('UPDATE students SET current_class_id=?,updated_at=? WHERE school_id=? AND id=? AND current_class_id IS NULL', [classId, timestamp, schoolId, student.studentId]);
          if (!profile.classId) await tx.execute('UPDATE student_profiles SET class_id=?,updated_at=? WHERE school_id=? AND id=? AND class_id IS NULL', [classId, timestamp, schoolId, profile.id]);
          isExistingStudent = true;
        } else {
          const token = String(input.reservationToken ?? '').trim();
          if (!token) fail('STUDENT_ID_RESERVATION_REQUIRED', 'Generate a permanent Student ID before submitting the registration.');
          reservation = rows(await tx.query('SELECT * FROM student_id_reservations WHERE reservation_token=? FOR UPDATE', [token]))[0];
          if (!reservation) fail('STUDENT_ID_RESERVATION_NOT_FOUND', 'Generate a new permanent Student ID before submitting.');
          if (reservation.reservation_status === 'CONSUMED' && reservation.student_id) {
            const existing = rows(await tx.query('SELECT id AS studentId,permanent_student_id AS permanentStudentId,first_name AS firstName,last_name AS lastName FROM students WHERE id=? AND school_id=? LIMIT 1', [reservation.student_id, schoolId]))[0];
            if (existing) return { student: existing, permanentStudentId: existing.permanentStudentId, created: false };
            fail('STUDENT_ID_RESERVATION_INCONSISTENT', 'This Student ID was already consumed but its student record is unavailable.', 409);
          }
          if (reservation.reservation_status !== 'RESERVED' || String(reservation.reserved_by) !== String(actorId)) fail('STUDENT_ID_RESERVATION_FORBIDDEN', 'This reserved Student ID is unavailable to this registration.', 409);
          if (Number(reservation.admission_year) !== new Date(timestamp).getUTCFullYear()) fail('STUDENT_ID_YEAR_MISMATCH', 'This Student ID reservation is not from the current calendar year. Generate a new ID.', 409);
          const duplicatePhones = [...new Set(ghanaPhoneLookupValues(parentPhone).map((value) => value.replace(/\D/g, '')))];
          const duplicatePhoneSlots = duplicatePhones.map(() => '?').join(',');
          const duplicate = rows(await tx.query(`SELECT s.id FROM students s WHERE s.school_id=?
            AND LOWER(TRIM(CONCAT_WS(' ',s.first_name,s.middle_name,s.last_name)))=? AND s.date_of_birth=?
            AND (REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(s.parent_phone,''),' ',''),'-',''),'(',''),')',''),'+','') IN (${duplicatePhoneSlots})
              OR EXISTS (SELECT 1 FROM student_profiles sp JOIN student_family_contacts fc ON fc.student_id=sp.id
                WHERE sp.school_id=s.school_id AND sp.student_master_id=s.id AND fc.contact_type='PRIMARY_GUARDIAN'
                AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(fc.telephone,''),' ',''),'-',''),'(',''),')',''),'+','') IN (${duplicatePhoneSlots})))
            LIMIT 1 FOR UPDATE`, [schoolId, normalizeName([firstName, middleName, lastName].filter(Boolean).join(' ')), dateOfBirth, ...duplicatePhones, ...duplicatePhones]))[0];
          if (duplicate) fail('POSSIBLE_DUPLICATE_STUDENT', 'A student with this name and date of birth already exists. Use Existing OSAAH Student and verify their permanent ID.', 409);
          const studentId = idFactory(), profileId = idFactory(), permanentStudentId = reservation.permanent_student_id;
          await tx.execute(`INSERT INTO students (id,permanent_student_id,school_id,admission_number,current_class_id,first_name,middle_name,last_name,full_name,gender,date_of_birth,parent_guardian_name,parent_phone,admission_date,admission_type,student_status,is_test_record,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [studentId, permanentStudentId, schoolId, permanentStudentId, classId, firstName, middleName, lastName, [firstName, middleName, lastName].filter(Boolean).join(' '), gender, dateOfBirth, parentName, parentPhone, admissionDate, category, 'ACTIVE', false, timestamp, timestamp]);
          await tx.execute(`INSERT INTO student_profiles (id,student_master_id,student_id,school_id,admission_number,class_id,admission_date,first_name,middle_name,surname,gender,date_of_birth,place_of_birth,home_address,nationality,previous_school,admission_type,qr_code,enrollment_status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [profileId, studentId, permanentStudentId, schoolId, permanentStudentId, classId, admissionDate, firstName, middleName, lastName, gender, dateOfBirth, text(input.placeOfBirth), homeAddress, text(input.nationality, 100) ?? 'Ghanaian', text(input.previousSchool), category, `osaah:student:${profileId}`, 'ACTIVE', timestamp, timestamp]);
          await tx.execute(`UPDATE student_id_reservations SET reservation_status='CONSUMED',student_id=?,consumed_at=? WHERE id=? AND reservation_status='RESERVED'`, [studentId, timestamp, reservation.id]);
          student = { studentId, permanentStudentId, firstName, lastName };
          profile = { id: profileId };
          created = true;
        }

        const classRow = rows(await tx.query("SELECT id,name FROM classes WHERE id=? AND school_id=? AND status='ACTIVE' LIMIT 1 FOR UPDATE", [classId, schoolId]))[0];
        if (!classRow || !canonicalClassId(classRow.name)) fail('CLASS_INVALID', 'Select an active school class.');

        if (!created && !isExistingStudent) {
          await tx.execute(`UPDATE students SET current_class_id=?,first_name=?,middle_name=?,last_name=?,full_name=?,gender=?,date_of_birth=?,parent_guardian_name=?,parent_phone=?,student_status='ACTIVE',updated_at=? WHERE id=? AND school_id=?`, [classId, firstName, middleName, lastName, [firstName, middleName, lastName].filter(Boolean).join(' '), gender, dateOfBirth, parentName, parentPhone, timestamp, student.studentId, schoolId]);
          await tx.execute(`UPDATE student_profiles SET class_id=?,first_name=?,middle_name=?,surname=?,gender=?,date_of_birth=?,place_of_birth=?,home_address=?,nationality=?,admission_type=?,enrollment_status='ACTIVE',updated_at=? WHERE id=? AND school_id=?`, [classId, firstName, middleName, lastName, gender, dateOfBirth, text(input.placeOfBirth), homeAddress, text(input.nationality, 100) ?? 'Ghanaian', category, timestamp, profile.id, schoolId]);
        }

        if (!isExistingStudent) {
        const guardian = rows(await tx.query("SELECT id FROM student_family_contacts WHERE student_id=? AND contact_type='PRIMARY_GUARDIAN' LIMIT 1 FOR UPDATE", [profile.id]))[0];
        const guardianValues = [parentName, text(input.relationship, 100) ?? 'Parent/Guardian', parentPhone, parentAddress, parentEmail, text(input.occupation), text(input.parentNationalId, 100), timestamp];
        if (guardian) await tx.execute('UPDATE student_family_contacts SET full_name=?,relationship=?,telephone=?,address=?,email=?,occupation=?,national_id=?,updated_at=? WHERE id=?', [...guardianValues, guardian.id]);
        else await tx.execute(`INSERT INTO student_family_contacts (id,student_id,contact_type,full_name,relationship,telephone,address,email,occupation,national_id,created_at,updated_at)
          VALUES (?,?,'PRIMARY_GUARDIAN',?,?,?,?,?,?,?,?,?)`, [idFactory(), profile.id, ...guardianValues, timestamp]);
        const emergency = rows(await tx.query("SELECT id FROM student_family_contacts WHERE student_id=? AND contact_type='EMERGENCY_CONTACT' LIMIT 1 FOR UPDATE", [profile.id]))[0];
        const emergencyValues = [text(input.emergencyContactName), emergencyPhone, timestamp];
        if (emergency) await tx.execute('UPDATE student_family_contacts SET full_name=?,telephone=?,updated_at=? WHERE id=?', [...emergencyValues, emergency.id]);
        else if (emergencyValues[0] || emergencyValues[1]) await tx.execute(`INSERT INTO student_family_contacts (id,student_id,contact_type,full_name,telephone,created_at,updated_at)
          VALUES (?,?,'EMERGENCY_CONTACT',?,?,?,?)`, [idFactory(), profile.id, emergencyValues[0] ?? 'Emergency Contact', emergencyValues[1], timestamp, timestamp]);
        const health = rows(await tx.query('SELECT student_id FROM student_health_records WHERE student_id=? FOR UPDATE', [profile.id])).length > 0;
        const healthValues = [text(input.allergies, 2000), text(input.medicalConditions, 2000), text(input.medications, 2000), [text(input.emergencyContactName, 255), emergencyPhone].filter(Boolean).join(' · ') || null, timestamp];
        if (health) await tx.execute('UPDATE student_health_records SET allergies=?,conditions=?,medications=?,emergency_notes=?,updated_at=? WHERE student_id=?', [...healthValues, profile.id]);
        else await tx.execute('INSERT INTO student_health_records (student_id,allergies,conditions,medications,emergency_notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [profile.id, ...healthValues, timestamp]);

        const existingParentId = await resolveExistingParent(tx, { schoolId, parentEmail, parentPhone, timestamp });
        if (existingParentId) await tidbInsertIfAbsent(tx, {
          insertSql: 'INSERT INTO parent_student_links (parent_user_id,student_id,permanent_student_id,telephone,relationship,relationship_type,link_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          insertParameters: [existingParentId, profile.id, student.permanentStudentId ?? student.permanent_student_id, parentPhone, text(input.relationship, 100) ?? 'Parent/Guardian', text(input.relationship, 100) ?? 'GUARDIAN', 'ACTIVE', timestamp, timestamp],
          conflictSql: 'SELECT parent_user_id FROM parent_student_links WHERE parent_user_id=? AND student_id=?',
          conflictParameters: [existingParentId, profile.id]
        });
        }

        await tx.execute('UPDATE student_enrollments SET is_current=0,enrollment_status=\'HISTORICAL\' WHERE school_id=? AND student_id=? AND is_current=1 AND (academic_year_id<>? OR term_id<>?)', [schoolId, student.studentId ?? student.id, academicYearId, termId]);
        const current = rows(await tx.query('SELECT id FROM student_enrollments WHERE school_id=? AND student_id=? AND academic_year_id=? AND term_id=? ORDER BY is_current DESC,enrolled_at DESC,id DESC LIMIT 1 FOR UPDATE', [schoolId, student.studentId ?? student.id, academicYearId, termId]))[0];
        if (current) await tx.execute("UPDATE student_enrollments SET class_id=?,enrollment_status='ACTIVE',is_current=1,enrolled_at=? WHERE id=?", [classId, timestamp, current.id]);
        else await tx.execute(`INSERT INTO student_enrollments (id,student_id,school_id,class_id,academic_year_id,term_id,enrollment_status,is_current,enrolled_at)
          VALUES (?,?,?,?,?,?,'ACTIVE',1,?)`, [idFactory(), student.studentId ?? student.id, schoolId, classId, academicYearId, termId, timestamp]);
        return { student, permanentStudentId: student.permanentStudentId ?? student.permanent_student_id, classId, className: classRow.name, created };
      });
    } catch (error) { if (error?.status) throw error; if (error?.code === 'ER_DUP_ENTRY' || error?.code === '1062') fail('STUDENT_REGISTRATION_CONFLICT', 'A student ID or class enrollment already exists. Reload the form and verify the student record.', 409); const failure = Object.assign(new Error('Student registration could not be completed. Please retry.'), { code: 'STUDENT_REGISTRATION_FAILED', status: 503, cause: error }); throw failure; }
  }

  return Object.freeze({ reserve, register, findExistingStudent });
}
