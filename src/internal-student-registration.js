import { randomUUID } from 'node:crypto';
import { normalizeGhanaPhone } from './ghana-phone.js';
import { requireStudentGender } from './student-gender.js';
import { canonicalClassId, transferPreviousClassLabel, TRANSFER_PREVIOUS_CLASS_VALUES } from './student-classes.js';
import { tidbInsertIfAbsent } from './tidb-conflict.js';

const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, status = 400, fields = null) => { throw Object.assign(new Error(message), { code, status, ...(fields ? { fields } : {}) }); };
const text = (value, max = 255) => { const result = String(value ?? '').trim(); return result ? result.slice(0, max) : null; };
const normalizeName = (value) => String(value ?? '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const canonicalTerm = (value) => ({ '1st term': '1st Term', 'first term': '1st Term', 'term 1': '1st Term', '2nd term': '2nd Term', 'second term': '2nd Term', 'term 2': '2nd Term', '3rd term': '3rd Term', 'third term': '3rd Term', 'term 3': '3rd Term' })[String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')] ?? null;
function normalizedPhone(value) { try { return normalizeGhanaPhone(value); } catch { return null; } }
const retryableTransactionError = (error) => ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(error?.code) || [1213, 1205].includes(Number(error?.errno));
const DUPLICATE_ERROR_CODES = new Set(['ER_DUP_ENTRY', '1062']);
const DATABASE_UNAVAILABLE_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'ENOTFOUND', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'PROTOCOL_CONNECTION_LOST', 'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR', 'ER_CON_COUNT_ERROR', 'ER_LOCK_WAIT_TIMEOUT', 'ER_QUERY_TIMEOUT']);
const DATABASE_UNAVAILABLE_ERRNOS = new Set([1040, 1205, 2002, 2003, 2006, 2013, 2026, 2055, 3024]);
const VALIDATION_FIELDS = Object.freeze({
  ADMISSION_CATEGORY_INVALID: ['admissionType'], EXISTING_ID_CHOICE_NOT_ALLOWED: ['existingIdChoice'], EXISTING_ID_CHOICE_INVALID: ['existingIdChoice'],
  STUDENT_NAME_REQUIRED: ['fullName'], DATE_OF_BIRTH_INVALID: ['dateOfBirth'], GENDER_INVALID: ['gender'], CLASS_REQUIRED: ['classId'], CLASS_INVALID: ['classId'],
  PARENT_DETAILS_REQUIRED: ['parentName', 'parentPhone'], PARENT_PHONE_INVALID: ['parentPhone'], ADDRESS_REQUIRED: ['homeAddress', 'parentAddress'],
  PARENT_EMAIL_INVALID: ['parentEmail'], ACADEMIC_PERIOD_REQUIRED: ['academicYearId', 'termId'], ACADEMIC_PERIOD_INVALID: ['academicYearId', 'termId'], ACADEMIC_TERM_INVALID: ['termId']
});

function deepestCause(error) {
  let current = error;
  const seen = new Set();
  while (current?.cause && !seen.has(current.cause)) { seen.add(current); current = current.cause; }
  return current ?? error;
}

function redactDiagnosticText(value, sensitiveValues = []) {
  if (value === null || value === undefined) return null;
  let result = String(value);
  for (const privateValue of sensitiveValues) {
    const text = String(privateValue ?? '').trim();
    if (text.length >= 3) result = result.replace(new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[redacted value]');
  }
  return result
    .replace(/(?:mysql|mariadb):\/\/[^\s]+/gi, '[redacted database URL]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(/\+?\d[\d ().-]{7,}\d/g, '[redacted number]')
    .replace(/\bOSAAH?\/\d{4}\/\d+\b/gi, '[redacted student ID]')
    .replace(/\b[A-F0-9]{8}-(?:[A-F0-9]{4}-){3}[A-F0-9]{12}\b/gi, '[redacted identifier]')
    .replace(/\b[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?(?:\s+[A-Z][a-z]+(?:[-'][A-Z]?[a-z]+)?){1,3}\b/g, '[redacted name]')
    .replace(/(['"])[^'"\r\n]*\1/g, '[redacted value]')
    .slice(0, 500);
}

export function internalRegistrationErrorLogFields(error, failingStep = null, sensitiveValues = []) {
  const cause = deepestCause(error);
  return {
    name: String(cause?.name ?? error?.name ?? 'Error').slice(0, 100),
    message: redactDiagnosticText(cause?.message ?? error?.message, sensitiveValues),
    code: cause?.code ?? error?.code ?? null,
    errno: Number.isFinite(Number(cause?.errno)) ? Number(cause.errno) : null,
    sqlState: cause?.sqlState ? String(cause.sqlState).slice(0, 16) : null,
    sqlMessage: redactDiagnosticText(cause?.sqlMessage, sensitiveValues),
    failingStep: error?.registrationStep ?? failingStep ?? 'registration.unknown'
  };
}

function registrationDatabaseStep(kind, sql) {
  const operation = String(sql ?? '').trim().match(/^([A-Za-z]+)/)?.[1]?.toLowerCase() ?? kind;
  const table = String(sql ?? '').match(/\b(?:FROM|INTO|UPDATE|JOIN)\s+`?([A-Za-z0-9_]+)`?/i)?.[1]?.toLowerCase();
  return `${operation}:${table ?? 'database'}`;
}

function isDatabaseUnavailable(error) {
  let current = error;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (DATABASE_UNAVAILABLE_CODES.has(String(current.code ?? '').toUpperCase())
      || DATABASE_UNAVAILABLE_ERRNOS.has(Number(current.errno))
      || String(current.sqlState ?? '').startsWith('08')) return true;
    current = current.cause;
  }
  return false;
}

function isDuplicateError(error) {
  let current = error;
  const seen = new Set();
  while (current && !seen.has(current)) {
    seen.add(current);
    if (DUPLICATE_ERROR_CODES.has(String(current.code ?? '')) || Number(current.errno) === 1062) return true;
    current = current.cause;
  }
  return false;
}

const DATABASE_SCHEMA_CODES = new Set(['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE', 'ER_PARSE_ERROR']);
const DATABASE_SCHEMA_ERRNOS = new Set([1054, 1064, 1146]);
const DATABASE_SCHEMA_SQL_STATES = new Set(['42S02', '42S22']);
const isTemporaryAdmissionNumber = (value) => /^REG-/i.test(String(value ?? '').trim());

function registrationFailure(error, failingStep) {
  const fields = Array.isArray(error?.fields) && error.fields.length ? error.fields : VALIDATION_FIELDS[error?.code] ?? ['registration'];
  if (error?.status === 400) return Object.assign(new Error(error.message ?? 'Check the registration details and try again.'), { code: 'VALIDATION_FAILED', status: 400, fields, registrationStep: failingStep, cause: error });
  if (isDuplicateError(error)) return Object.assign(new Error('A student record or enrollment with these details already exists.'), { code: 'DUPLICATE_STUDENT', status: 409, registrationStep: failingStep, cause: error });
  if (isDatabaseUnavailable(error)) return Object.assign(new Error('The registration database is temporarily unavailable. Please retry.'), { code: 'DB_UNAVAILABLE', status: 503, registrationStep: failingStep, cause: error });
  if ([401, 403, 404, 409].includes(Number(error?.status))) { error.registrationStep ??= failingStep; return error; }
  const cause = deepestCause(error);
  if (DATABASE_SCHEMA_CODES.has(String(cause?.code ?? '').toUpperCase()) || DATABASE_SCHEMA_ERRNOS.has(Number(cause?.errno)) || DATABASE_SCHEMA_SQL_STATES.has(String(cause?.sqlState ?? '').toUpperCase())) {
    return Object.assign(new Error('The registration database schema is not ready. Contact the system administrator.'), { code: 'DATABASE_SCHEMA_ERROR', status: 500, registrationStep: failingStep, cause: error });
  }
  if (cause?.code || cause?.errno != null || cause?.sqlState) {
    return Object.assign(new Error('The registration database operation failed. Please contact the system administrator.'), { code: 'DATABASE_OPERATION_FAILED', status: 500, registrationStep: failingStep, cause: error });
  }
  return Object.assign(new Error('Student registration could not be completed. Please contact the system administrator.'), { code: 'INTERNAL_SERVER_ERROR', status: 500, registrationStep: failingStep, cause: error });
}

export function createInternalStudentRegistrationService({ database, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.transaction) fail('DATABASE_ADAPTER_REQUIRED', 'Internal registration persistence is unavailable.', 503);

  async function transactionWithRetry(work, onStep = null) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await database.transaction(async (tx) => {
          onStep?.('transaction.begin');
          const trackedTx = {
            query(sql, ...args) { onStep?.(registrationDatabaseStep('query', sql)); return tx.query(sql, ...args); },
            execute(sql, ...args) { onStep?.(registrationDatabaseStep('execute', sql)); return tx.execute(sql, ...args); }
          };
          const result = await work(trackedTx);
          onStep?.('transaction.commit');
          return result;
        }, { onStep });
      }
      catch (error) {
        if (attempt >= 2 || !retryableTransactionError(error)) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
  }

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
        first_name AS profileFirstName,last_name AS profileLastName,date_of_birth AS profileDateOfBirth
        FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY id DESC LIMIT 2`, [schoolId, student.studentId]));
    } catch { fail('STUDENT_LOOKUP_FAILED', 'Existing student details could not be checked. Please retry.', 503); }
    const profile = profiles[0] ?? null;
    const profileIds = [profile?.profileStudentId].filter((id) => id && !isTemporaryAdmissionNumber(id)).map(String);
    if (new Set(profileIds).size > 1 || student.masterPermanentStudentId && profileIds.some((id) => String(student.masterPermanentStudentId) !== id)) fail('STUDENT_ID_PROFILE_CONFLICT', 'The student and profile contain different IDs. Ask the proprietor to reconcile the record.', 409);
    return {
      ...student,
      permanentStudentId: student.masterPermanentStudentId ?? (isTemporaryAdmissionNumber(profile?.profileStudentId) ? null : profile?.profileStudentId) ?? (permanentStudentId && student.admissionNumber === permanentStudentId ? permanentStudentId : null),
      profileId: profile?.profileId ?? null,
      classId: student.currentClassId ?? profile?.profileClassId ?? null,
      firstName: student.firstName ?? profile?.profileFirstName,
      middleName: student.middleName,
      lastName: student.lastName ?? profile?.profileLastName,
      dateOfBirth: student.dateOfBirth ?? profile?.profileDateOfBirth
    };
  }

  async function findRegistrationMatch(tx, { schoolId, fullName, dateOfBirth }) {
    const candidates = rows(await tx.query(`SELECT id AS studentId,permanent_student_id AS permanentStudentId,admission_number AS admissionNumber,
      first_name AS firstName,middle_name AS middleName,last_name AS lastName,date_of_birth AS dateOfBirth,
      current_class_id AS currentClassId,gender,student_status AS studentStatus FROM students
      WHERE school_id=? AND date_of_birth=? AND is_test_record IS NOT TRUE ORDER BY id FOR UPDATE`, [schoolId, dateOfBirth]));
    const normalizedName = normalizeName(fullName);
    const matches = candidates.filter((student) => normalizeName([student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')) === normalizedName
      && String(student.dateOfBirth ?? '').slice(0, 10) === dateOfBirth);
    if (matches.length > 1) fail('STUDENT_IDENTITY_AMBIGUOUS', 'More than one student matches this normalized full name and date of birth. Ask the proprietor to reconcile the records.', 409);
    return matches[0] ?? null;
  }

  async function resolveExistingParent(tx, { schoolId, parentEmail, parentPhone, timestamp }) {
    let role = rows(await tx.query("SELECT id FROM roles WHERE school_id=? AND role_key='PARENT' LIMIT 1 FOR UPDATE", [schoolId]))[0];
    if (!role) {
      const roleId = idFactory();
      await tidbInsertIfAbsent(tx, {
        insertSql: 'INSERT INTO roles (id,school_id,role_key,role_name,oversight_rank,created_at,updated_at) VALUES (?,?,?,?,?,?,?)',
        insertParameters: [roleId, schoolId, 'PARENT', 'Parent', 5, timestamp, timestamp],
        conflictSql: "SELECT id FROM roles WHERE school_id=? AND role_key='PARENT' LIMIT 1 FOR UPDATE",
        conflictParameters: [schoolId]
      });
      role = rows(await tx.query("SELECT id FROM roles WHERE school_id=? AND role_key='PARENT' LIMIT 1 FOR UPDATE", [schoolId]))[0];
    }
    if (!role) fail('PARENT_ROLE_PROVISION_FAILED', 'Parent Portal role could not be provisioned for this school. Please retry.', 503);
    const candidates = rows(await tx.query(`SELECT DISTINCT u.id,u.email,u.phone,u.username FROM users u
      JOIN user_roles ur ON ur.user_id=u.id
      JOIN roles r ON r.id=ur.role_id AND r.school_id=u.school_id AND r.role_key='PARENT'
      WHERE u.school_id=? AND UPPER(COALESCE(u.status,'ACTIVE'))='ACTIVE'`, [schoolId]));
    const matched = candidates.filter((item) => (normalizedPhone(item.phone) ?? normalizedPhone(item.username)) === parentPhone);
    if (matched.length > 1) fail('PARENT_IDENTITY_AMBIGUOUS', 'More than one parent account matches these contact details. Reconcile the parent accounts before linking the student.', 409);
    if (matched[0]) return matched[0].id;
    const proposedParentUserId = idFactory();
    const accountCreated = await tidbInsertIfAbsent(tx, {
      insertSql: `INSERT INTO users (id,school_id,username,email,phone,password_hash,status,created_at,updated_at)
        VALUES (?,?,?,?,?,NULL,'ACTIVE',?,?)`,
      insertParameters: [proposedParentUserId, schoolId, parentPhone, parentEmail, parentPhone, timestamp, timestamp],
      conflictSql: 'SELECT id FROM users WHERE school_id=? AND username=? LIMIT 1 FOR UPDATE',
      conflictParameters: [schoolId, parentPhone]
    });
    const parentUserId = accountCreated ? proposedParentUserId : rows(await tx.query(
      'SELECT id FROM users WHERE school_id=? AND username=? LIMIT 1 FOR UPDATE', [schoolId, parentPhone]
    ))[0]?.id;
    if (!parentUserId) fail('PARENT_ACCOUNT_PROVISION_FAILED', 'Parent Portal account could not be provisioned. Please retry.', 503);
    await tidbInsertIfAbsent(tx, {
      insertSql: 'INSERT INTO user_roles (id,user_id,role_id,created_at) VALUES (?,?,?,?)',
      insertParameters: [idFactory(), parentUserId, role.id, timestamp],
      conflictSql: 'SELECT user_id FROM user_roles WHERE user_id=? AND role_id=? LIMIT 1 FOR UPDATE',
      conflictParameters: [parentUserId, role.id]
    });
    return parentUserId;
  }

  async function registeredStudent(studentId, schoolId) {
    if (!studentId || !schoolId) fail('STUDENT_IDENTITY_REQUIRED', 'A saved student record is required before generating a permanent ID.');
    const student = rows(await database.query(`SELECT s.id AS studentId,s.school_id AS schoolId,s.permanent_student_id AS permanentStudentId,
      s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS lastName,s.admission_number AS admissionNumber,
      sp.id AS profileId,sp.student_id AS profileStudentId FROM students s
      LEFT JOIN student_profiles sp ON sp.school_id=s.school_id AND sp.student_master_id=s.id
      WHERE s.id=? AND s.school_id=? AND s.is_test_record IS NOT TRUE LIMIT 2`, [studentId, schoolId]));
    if (student.length !== 1) fail(student.length ? 'STUDENT_IDENTITY_AMBIGUOUS' : 'REGISTERED_STUDENT_NOT_FOUND', student.length ? 'This student has multiple profiles. Ask an administrator to reconcile the record.' : 'Save the student registration before requesting a permanent ID.', student.length ? 409 : 404);
    const item = student[0];
    const profileIds = [item.profileStudentId].filter((id) => id && !isTemporaryAdmissionNumber(id)).map(String);
    if (new Set(profileIds).size > 1 || item.permanentStudentId && profileIds.some((id) => id !== String(item.permanentStudentId))) fail('STUDENT_ID_PROFILE_CONFLICT', 'The student and profile contain different IDs. Ask the proprietor to reconcile the record.', 409);
    return { ...item, permanentStudentId: item.permanentStudentId ?? (isTemporaryAdmissionNumber(item.profileStudentId) ? null : item.profileStudentId) ?? null };
  }

  async function getRegisteredStudent({ studentId, schoolId } = {}) {
    try { return await registeredStudent(text(studentId, 64), schoolId); }
    catch (error) { if (error?.status) throw error; fail('STUDENT_LOOKUP_FAILED', 'The saved student registration could not be checked. Please retry.', 503); }
  }

  async function assignPermanentId({ studentId: requestedStudentId, schoolId, actorId } = {}) {
    const studentId = text(requestedStudentId, 64);
    if (!actorId) fail('ACTOR_REQUIRED', 'An authorized staff account is required.', 401);
    if (!studentId || !schoolId) fail('STUDENT_IDENTITY_REQUIRED', 'A saved student record is required before generating a permanent ID.');
    const timestamp = clock(), admissionYear = new Date(timestamp).getUTCFullYear();
    try {
      await registeredStudent(studentId, schoolId);
      const assignAttempt = () => transactionWithRetry(async (tx) => {
        await tidbInsertIfAbsent(tx, { insertSql: 'INSERT INTO student_id_sequences (admission_year,next_sequence,updated_at) VALUES (?,?,?)', insertParameters: [admissionYear, 1, timestamp], conflictSql: 'SELECT admission_year FROM student_id_sequences WHERE admission_year=?', conflictParameters: [admissionYear] });
        const sequenceRow = rows(await tx.query('SELECT next_sequence FROM student_id_sequences WHERE admission_year=? FOR UPDATE', [admissionYear]))[0];
        if (!sequenceRow) fail('STUDENT_ID_SEQUENCE_UNAVAILABLE', 'Permanent Student ID generation is temporarily unavailable. Please retry.', 503);
        const student = rows(await tx.query(`SELECT id AS studentId,school_id AS schoolId,permanent_student_id AS permanentStudentId,
          admission_number AS admissionNumber FROM students WHERE id=? AND school_id=? AND is_test_record IS NOT TRUE LIMIT 1 FOR UPDATE`, [studentId, schoolId]))[0];
        if (!student) fail('REGISTERED_STUDENT_NOT_FOUND', 'Save the student registration before requesting a permanent ID.', 404);
        const profiles = rows(await tx.query('SELECT id AS profileId,student_id AS permanentStudentId FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY id DESC FOR UPDATE', [schoolId, studentId]));
        if (!profiles.length) fail('STUDENT_PROFILE_NOT_FOUND', 'The saved student profile is incomplete. Ask an administrator to review the registration.', 409);
        const profileId = profiles[0].profileId;
        const storedIds = profiles.map((row) => row.permanentStudentId).filter((id) => id && !isTemporaryAdmissionNumber(id)).map(String);
        if (new Set(storedIds).size > 1 || student.permanentStudentId && storedIds.some((id) => id !== String(student.permanentStudentId))) fail('STUDENT_ID_PROFILE_CONFLICT', 'The student and profile contain different IDs. Ask the proprietor to reconcile the record.', 409);
        const existing = String(student.permanentStudentId ?? storedIds[0] ?? '').trim();
        if (existing) {
          if (!student.permanentStudentId) await tx.execute('UPDATE students SET permanent_student_id=?,updated_at=? WHERE school_id=? AND id=? AND (permanent_student_id IS NULL OR permanent_student_id=\'\')', [existing, timestamp, schoolId, studentId]);
          if (profiles.some((row) => !row.permanentStudentId || isTemporaryAdmissionNumber(row.permanentStudentId))) await tx.execute('UPDATE student_profiles SET student_id=CASE WHEN student_id IS NULL OR student_id=\'\' OR student_id LIKE \'REG-%\' THEN ? ELSE student_id END WHERE school_id=? AND student_master_id=?', [existing, schoolId, studentId]);
          await tx.execute('UPDATE parent_student_links SET permanent_student_id=?,updated_at=? WHERE student_id IN (SELECT id FROM student_profiles WHERE school_id=? AND student_master_id=?) AND (permanent_student_id IS NULL OR permanent_student_id=\'\')', [existing, timestamp, schoolId, studentId]);
          return { studentId, permanentStudentId: existing, created: false };
        }

        const roster = rows(await tx.query(`SELECT e.id AS enrollmentId,e.class_id AS classId,c.name AS className
          FROM student_enrollments e JOIN students s ON s.id=e.student_id AND s.school_id=e.school_id AND s.current_class_id=e.class_id
          JOIN classes c ON c.id=e.class_id AND c.school_id=e.school_id
          WHERE e.school_id=? AND e.student_id=? LIMIT 1 FOR UPDATE`, [schoolId, studentId]))[0];
        if (!roster) fail('STUDENT_ROSTER_SYNC_REQUIRED', 'The saved registration has no current class placement. Retry registration before generating the permanent ID.', 409);

        const committed = rows(await tx.query(`SELECT permanent_student_id AS permanentStudentId FROM students
          WHERE permanent_student_id IS NOT NULL AND permanent_student_id<>'' FOR UPDATE`));
        const profileIds = rows(await tx.query(`SELECT student_id AS permanentStudentId FROM student_profiles
          WHERE student_id IS NOT NULL AND student_id<>'' FOR UPDATE`));
        const validNumbers = [...committed, ...profileIds].flatMap((row) => {
          const match = /^(?:OSAA|OSAAH)\/(\d{4})\/(\d+)$/.exec(String(row.permanentStudentId ?? ''));
          if (!match) return [];
          return Number(match[1]) === admissionYear ? [Number(match[2])] : [];
        });
        const maximum = Math.max(0, ...validNumbers);
        let sequence = maximum + 1;
        if (!Number.isSafeInteger(sequence) || sequence < 1) fail('STUDENT_ID_SEQUENCE_INVALID', 'Annual permanent Student ID sequence is invalid.', 409);
        const permanentStudentId = `OSAA/${admissionYear}/${String(sequence).padStart(3, '0')}`;
        const idCollision = rows(await tx.query('SELECT id FROM students WHERE permanent_student_id=? FOR UPDATE', [permanentStudentId]));
        const profileCollision = rows(await tx.query('SELECT student_master_id AS studentId FROM student_profiles WHERE student_id=? FOR UPDATE', [permanentStudentId]));
        if (idCollision.some((row) => String(row.id) !== String(studentId)) || profileCollision.some((row) => String(row.studentId) !== String(studentId))) fail('STUDENT_ID_ASSIGNMENT_CONFLICT', 'This permanent ID is already assigned to another student record.', 409);
        if (idCollision.length || profileCollision.length) fail('STUDENT_ID_SEQUENCE_CONFLICT', 'The next Student ID is already in use. Ask an administrator to reconcile the annual sequence.', 409);
        const matchingReservation = rows(await tx.query(`SELECT id FROM student_id_reservations
          WHERE admission_year=? AND sequence_number=? AND student_id IS NULL AND reservation_status='RESERVED' LIMIT 1 FOR UPDATE`, [admissionYear, sequence]))[0];
        if (matchingReservation) {
          await tx.execute(`UPDATE student_id_reservations SET permanent_student_id=?,reservation_status='CONSUMED',student_id=?,consumed_at=? WHERE id=? AND student_id IS NULL AND reservation_status='RESERVED'`, [permanentStudentId, studentId, timestamp, matchingReservation.id]);
        } else {
          await tx.execute(`INSERT INTO student_id_reservations
            (id,reservation_token,permanent_student_id,admission_year,sequence_number,reservation_status,student_id,reserved_by,created_at,consumed_at)
            VALUES (?,?,?,?,?,'CONSUMED',?,?,?,?)`, [idFactory(), idFactory(), permanentStudentId, admissionYear, sequence, studentId, actorId, timestamp, timestamp]);
        }
        await tx.execute('UPDATE students SET permanent_student_id=?,admission_number=CASE WHEN admission_number LIKE \'REG-%\' THEN ? ELSE admission_number END,updated_at=? WHERE school_id=? AND id=? AND (permanent_student_id IS NULL OR permanent_student_id=\'\')', [permanentStudentId, permanentStudentId, timestamp, schoolId, studentId]);
        await tx.execute('UPDATE student_profiles SET student_id=?,admission_number=CASE WHEN admission_number LIKE \'REG-%\' THEN ? ELSE admission_number END WHERE school_id=? AND student_master_id=? AND (student_id IS NULL OR student_id=\'\' OR student_id LIKE \'REG-%\')', [permanentStudentId, permanentStudentId, schoolId, studentId]);
        await tx.execute('UPDATE parent_student_links SET permanent_student_id=?,updated_at=? WHERE student_id IN (SELECT id FROM student_profiles WHERE school_id=? AND student_master_id=?) AND (permanent_student_id IS NULL OR permanent_student_id=\'\')', [permanentStudentId, timestamp, schoolId, studentId]);
        const confirmed = rows(await tx.query(`SELECT s.permanent_student_id AS permanentStudentId,sp.student_id AS profileStudentId
          FROM students s JOIN student_profiles sp ON sp.school_id=s.school_id AND sp.student_master_id=s.id
          WHERE s.school_id=? AND s.id=? AND sp.id=? LIMIT 1 FOR UPDATE`, [schoolId, studentId, profileId]))[0];
        if (!confirmed || confirmed.permanentStudentId !== permanentStudentId || confirmed.profileStudentId !== permanentStudentId) fail('STUDENT_ID_PERSISTENCE_FAILED', 'The permanent Student ID could not be confirmed in the saved student record. Please retry.', 503);
        await tx.execute('UPDATE student_id_sequences SET next_sequence=?,updated_at=? WHERE admission_year=?', [sequence + 1, timestamp, admissionYear]);
        return { studentId, permanentStudentId, created: true };
      });
      let collisionRetries = 0;
      while (true) {
        try { return await assignAttempt(); }
        catch (error) {
          const collision = ['STUDENT_ID_ASSIGNMENT_CONFLICT', 'STUDENT_ID_SEQUENCE_CONFLICT', 'ER_DUP_ENTRY', '1062'].includes(error?.code);
          if (!collision || collisionRetries >= 2) throw error;
          collisionRetries += 1;
        }
      }
    } catch (error) { if (error?.status) throw error; if (error?.code === 'ER_DUP_ENTRY' || error?.code === '1062') fail('STUDENT_ID_ASSIGNMENT_CONFLICT', 'Another request assigned this Student ID. Reload the student and retry.', 409); throw Object.assign(new Error('Permanent Student ID generation failed. The saved registration remains available; retry the ID request.'), { code: 'STUDENT_ID_ASSIGNMENT_FAILED', status: 503, cause: error }); }
  }

  async function register(input, { schoolId, actorId, requestId = null } = {}) {
    if (!schoolId || !actorId) fail('ACTOR_REQUIRED', 'An authorized school staff account is required.', 401);
    const category = String(input?.admissionType ?? '').trim().toUpperCase().replace(/[ -]+/g, '_');
    if (!['FIRST_TIME', 'TRANSFER', 'ALREADY_ENROLLED'].includes(category)) fail('VALIDATION_FAILED', 'Select an admission category.', 400, ['admissionType']);
    const existingIdChoice = String(input?.existingIdChoice ?? 'NO_ID').trim().toUpperCase();
    if (category !== 'ALREADY_ENROLLED' && existingIdChoice === 'HAVE_ID') fail('VALIDATION_FAILED', 'A permanent ID choice is available only for an existing OSAAH student.', 400, ['existingIdChoice']);
    if (category === 'ALREADY_ENROLLED' && !['NO_ID', 'HAVE_ID'].includes(existingIdChoice)) fail('VALIDATION_FAILED', 'Choose whether the student has a permanent ID.', 400, ['existingIdChoice']);
    const requiresExistingId = category === 'ALREADY_ENROLLED' && existingIdChoice === 'HAVE_ID';
    const previousSchool = category === 'TRANSFER' ? (typeof input?.previousSchool === 'string' ? input.previousSchool.trim() : '') : null;
    const previousClassInput = category === 'TRANSFER' ? String(input?.previousClass ?? '').trim() : null;
    const normalizedPreviousClass = category === 'TRANSFER' ? canonicalClassId(previousClassInput) : null;
    const previousClass = normalizedPreviousClass ? transferPreviousClassLabel(normalizedPreviousClass) : null;
    const transferErrors = [];
    if (category === 'TRANSFER' && (previousSchool.length < 2 || previousSchool.length > 120)) transferErrors.push('previousSchool');
    if (category === 'TRANSFER' && (!normalizedPreviousClass || !TRANSFER_PREVIOUS_CLASS_VALUES.includes(normalizedPreviousClass))) transferErrors.push('previousClass');
    if (transferErrors.length) fail('VALIDATION_FAILED', 'Transfer admission requires a previous school name (2–120 characters) and a valid previous class.', 400, transferErrors);
    const firstName = text(input.firstName ?? input.studentFirstName, 100), middleName = text(input.middleName, 100), lastName = text(input.lastName ?? input.studentSurname, 100);
    if (!firstName || !lastName) fail('VALIDATION_FAILED', 'Pupil first and last names are required.', 400, ['fullName']);
    const dateOfBirth = text(input.dateOfBirth, 10);
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
    const parsedDate = dateOfBirth && /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ? new Date(`${dateOfBirth}T00:00:00Z`) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== dateOfBirth) fail('VALIDATION_FAILED', 'Enter a valid date of birth.', 400, ['dateOfBirth']);
    let gender;
    try { gender = requireStudentGender(input.gender); } catch { fail('VALIDATION_FAILED', 'Select a valid gender.', 400, ['gender']); }
    let classId = String(input.classId ?? '').trim();
    if (!classId) fail('VALIDATION_FAILED', 'Select a class.', 400, ['classId']);
    const parentName = text(input.parentName, 255), parentPhoneRaw = text(input.parentPhone, 50);
    if (!parentName || !parentPhoneRaw) fail('VALIDATION_FAILED', 'Parent/guardian name and phone number are required.', 400, [!parentName ? 'parentName' : 'parentPhone']);
    const parentPhone = normalizeGhanaPhone(parentPhoneRaw);
    if (!parentPhone) fail('VALIDATION_FAILED', 'Enter a valid Ghanaian mobile number.', 400, ['parentPhone']);
    const homeAddress = text(input.homeAddress, 500), parentAddress = text(input.parentAddress, 500);
    if (!homeAddress || !parentAddress) fail('VALIDATION_FAILED', 'Pupil home and parent/guardian residential addresses are required.', 400, [...(!homeAddress ? ['homeAddress'] : []), ...(!parentAddress ? ['parentAddress'] : [])]);
    const parentEmail = text(input.parentEmail, 254);
    if (parentEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parentEmail)) fail('VALIDATION_FAILED', 'Enter a valid parent/guardian email address.', 400, ['parentEmail']);
    const emergencyPhoneRaw = text(input.emergencyPhone, 50);
    const emergencyPhone = emergencyPhoneRaw ? normalizeGhanaPhone(emergencyPhoneRaw) : null;
    const academicYearId = text(input.academicYearId, 64), termId = text(input.termId, 64);
    if (!academicYearId || !termId) fail('VALIDATION_FAILED', 'Select the academic year and one term for class registration.', 400, [...(!academicYearId ? ['academicYearId'] : []), ...(!termId ? ['termId'] : [])]);
    const timestamp = clock(), admissionDate = timestamp.slice(0, 10);
    let failingStep = 'registration.transaction.begin';
    try {
      return await transactionWithRetry(async (tx) => {
        const registrationYear = new Date(timestamp).getUTCFullYear();
        if (!requiresExistingId) {
          await tidbInsertIfAbsent(tx, { insertSql: 'INSERT INTO student_id_sequences (admission_year,next_sequence,updated_at) VALUES (?,?,?)', insertParameters: [registrationYear, 1, timestamp], conflictSql: 'SELECT admission_year FROM student_id_sequences WHERE admission_year=?', conflictParameters: [registrationYear] });
          const registrationLock = rows(await tx.query('SELECT admission_year FROM student_id_sequences WHERE admission_year=? FOR UPDATE', [registrationYear]))[0];
          if (!registrationLock) fail('STUDENT_REGISTRATION_LOCK_UNAVAILABLE', 'Student registration is temporarily unavailable. Please retry.', 503);
        }
        const period = rows(await tx.query(`SELECT y.id AS academicYearId,y.name AS academicYearName,y.starts_on AS academicYearStartsOn,t.id AS termId,t.name AS termName FROM academic_years y
          JOIN terms t ON t.academic_year_id=y.id WHERE y.school_id=? AND y.id=? AND t.id=? LIMIT 1`, [schoolId, academicYearId, termId]))[0];
        if (!period) fail('ACADEMIC_PERIOD_INVALID', 'Select a valid academic year and term.');
        if (!canonicalTerm(period.termName)) fail('ACADEMIC_TERM_INVALID', 'Choose 1st Term, 2nd Term, or 3rd Term.');
        const academicYear = String(period.academicYearStartsOn ?? period.academicYearName ?? '').match(/\d{4}/)?.[0];
        if (!academicYear) fail('ACADEMIC_YEAR_INVALID', 'The selected academic year does not have a valid start year.', 409);

        const registrationToken = String(input.registrationToken ?? '').trim();
        if (category !== 'ALREADY_ENROLLED' && registrationToken) {
          if (!/^[A-Za-z0-9-]{16,64}$/.test(registrationToken)) fail('REGISTRATION_TOKEN_INVALID', 'The registration retry key could not be verified. Reload the form and retry.');
          const retry = rows(await tx.query(`SELECT id AS studentId,school_id AS schoolId,permanent_student_id AS permanentStudentId,
            first_name AS firstName,middle_name AS middleName,last_name AS lastName,date_of_birth AS dateOfBirth,current_class_id AS classId
            FROM students WHERE school_id=? AND admission_number=? AND is_test_record IS NOT TRUE LIMIT 1 FOR UPDATE`, [schoolId, `REG-${registrationToken}`]))[0];
          if (retry) {
            const retryProfile = rows(await tx.query('SELECT id FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE', [schoolId, retry.studentId]))[0];
            const retryGuardian = retryProfile ? rows(await tx.query("SELECT telephone AS parentPhone FROM student_family_contacts WHERE student_id=? AND contact_type='PRIMARY_GUARDIAN' LIMIT 1 FOR UPDATE", [retryProfile.id]))[0] : null;
            const sameIdentity = normalizeName([retry.firstName, retry.middleName, retry.lastName].filter(Boolean).join(' ')) === normalizeName([firstName, middleName, lastName].filter(Boolean).join(' '))
              && String(retry.dateOfBirth ?? '').slice(0, 10) === dateOfBirth && normalizedPhone(retryGuardian?.parentPhone) === parentPhone && String(retry.classId) === classId;
            if (!sameIdentity) fail('REGISTRATION_RETRY_CONFLICT', 'This saved retry key belongs to a different student registration. Start a new registration draft and check for duplicates.', 409);
            const className = rows(await tx.query('SELECT name FROM classes WHERE id=? AND school_id=? LIMIT 1', [retry.classId, schoolId]))[0]?.name ?? null;
            const permanentStudentId = retry.permanentStudentId ?? null;
            return {
              success: true, found: false,
              student: { ...retry, id: retry.studentId, permanentStudentId }, studentId: retry.studentId,
              registered: true, permanentStudentId, idStatus: permanentStudentId ? 'EXISTING' : 'PENDING_GENERATION',
              classId: retry.classId, className, created: false
            };
          }
        }

        let student, profile, created = false, found = false;
        const existingStudentId = text(input.existingStudentId, 64);
        const existingPermanentStudentId = text(input.existingPermanentStudentId, 128);
        if (requiresExistingId && !existingPermanentStudentId) fail('EXISTING_STUDENT_ID_REQUIRED', 'Enter the existing Student ID before submitting.');
        if (requiresExistingId) {
          const matches = existingStudentId
            ? rows(await tx.query(`SELECT id AS studentId,permanent_student_id AS permanentStudentId,admission_number AS admissionNumber,
                first_name AS firstName,middle_name AS middleName,last_name AS lastName,date_of_birth AS dateOfBirth,
                current_class_id AS currentClassId,gender,student_status AS studentStatus FROM students WHERE school_id=? AND id=? AND is_test_record IS NOT TRUE FOR UPDATE`, [schoolId, existingStudentId]))
            : rows(await tx.query(`SELECT id AS studentId,permanent_student_id AS permanentStudentId,admission_number AS admissionNumber,
                first_name AS firstName,middle_name AS middleName,last_name AS lastName,date_of_birth AS dateOfBirth,
                current_class_id AS currentClassId,gender,student_status AS studentStatus FROM students WHERE school_id=?
                AND (permanent_student_id=? OR admission_number=? OR EXISTS (SELECT 1 FROM student_profiles sp WHERE sp.school_id=students.school_id AND sp.student_master_id=students.id AND sp.student_id=?)) AND is_test_record IS NOT TRUE FOR UPDATE`, [schoolId, existingPermanentStudentId, existingPermanentStudentId, existingPermanentStudentId]));
          if (matches.length !== 1) fail('EXISTING_ID_NOT_FOUND', 'EXISTING_ID_NOT_FOUND: No student record has that permanent ID. Check the ID and try again.', 404);
          student = matches[0];
          if (existingPermanentStudentId) {
            const owner = rows(await tx.query('SELECT id FROM students WHERE permanent_student_id=? FOR UPDATE', [existingPermanentStudentId]));
            const profileOwner = rows(await tx.query('SELECT student_master_id AS studentId FROM student_profiles WHERE student_id=? FOR UPDATE', [existingPermanentStudentId]));
            if (owner.some((row) => String(row.id) !== String(student.studentId)) || profileOwner.some((row) => String(row.studentId) !== String(student.studentId))) fail('EXISTING_STUDENT_IDENTITY_MISMATCH', 'This permanent ID is already assigned to another student record.', 409);
          }
          if (normalizeName([student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')) !== normalizeName(fullName) || String(student.dateOfBirth ?? '').slice(0, 10) !== dateOfBirth) fail('EXISTING_STUDENT_IDENTITY_MISMATCH', 'The name and date of birth do not match this existing student ID.', 409);
          profile = rows(await tx.query('SELECT id,student_id AS permanentStudentId,class_id AS classId FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE', [schoolId, student.studentId]))[0] ?? null;
          const masterId = String(student.permanentStudentId ?? '').trim() || null;
          const profileIds = [profile?.permanentStudentId].filter((id) => id && !isTemporaryAdmissionNumber(id)).map(String);
          if (new Set(profileIds).size > 1 || masterId && profileIds.some((id) => id !== masterId)) fail('STUDENT_ID_PROFILE_CONFLICT', 'The student and profile contain different IDs. Ask the proprietor to reconcile the record.', 409);
          let permanentStudentId = masterId ?? profileIds[0] ?? null;
          if (existingPermanentStudentId && permanentStudentId && existingPermanentStudentId !== permanentStudentId) fail('EXISTING_STUDENT_IDENTITY_MISMATCH', 'The entered ID does not match this student’s existing ID.', 409);
          if (!permanentStudentId && student.admissionNumber && /^(?:OSAA|OSAAH)\/\d{4}\/\d+$/.test(student.admissionNumber)) permanentStudentId = student.admissionNumber;
          if (existingPermanentStudentId && permanentStudentId && existingPermanentStudentId !== permanentStudentId) fail('EXISTING_STUDENT_IDENTITY_MISMATCH', 'The entered ID does not match this student’s existing ID.', 409);
          if (!permanentStudentId) fail('EXISTING_ID_NOT_FOUND', 'EXISTING_ID_NOT_FOUND: The matching record does not have that permanent ID. Check the ID and try again.', 404);
          if (!masterId && permanentStudentId) {
            await tx.execute('UPDATE students SET permanent_student_id=?,updated_at=? WHERE school_id=? AND id=? AND (permanent_student_id IS NULL OR permanent_student_id=\'\')', [permanentStudentId, timestamp, schoolId, student.studentId]);
            const confirmed = rows(await tx.query('SELECT permanent_student_id AS permanentStudentId FROM students WHERE school_id=? AND id=? LIMIT 1 FOR UPDATE', [schoolId, student.studentId]))[0];
            const confirmedId = String(confirmed?.permanentStudentId ?? '').trim();
            if (!confirmedId) fail('STUDENT_ID_PERSISTENCE_FAILED', 'The permanent Student ID could not be saved. Please retry.', 503);
            permanentStudentId = confirmedId;
          }
          if (!profile) {
            const profileId = idFactory();
            const tempAdmissionNumber = student.admissionNumber;
            const admissionNumber = student.admissionNumber;
            const newStudentId = student.studentId;
            const safeProfileStudentId = permanentStudentId || tempAdmissionNumber || admissionNumber || newStudentId;
            await tx.execute(`INSERT INTO student_profiles (id,student_master_id,student_id,school_id,admission_number,first_name,last_name,gender,date_of_birth,class_id,enrollment_status,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [profileId, student.studentId, safeProfileStudentId, schoolId, student.admissionNumber ?? `REG-${student.studentId}`, student.firstName ?? firstName, student.lastName ?? lastName, student.gender ?? gender ?? 'NOT_SPECIFIED', student.dateOfBirth ?? dateOfBirth, student.currentClassId ?? classId, student.studentStatus ?? 'ACTIVE', timestamp]);
            profile = { id: profileId, permanentStudentId, classId: student.currentClassId ?? classId };
          } else if (permanentStudentId && (!profile.permanentStudentId || isTemporaryAdmissionNumber(profile.permanentStudentId))) {
            await tx.execute('UPDATE student_profiles SET student_id=? WHERE school_id=? AND id=? AND (student_id IS NULL OR student_id=\'\' OR student_id LIKE \'REG-%\')', [permanentStudentId, schoolId, profile.id]);
            profile.permanentStudentId = profile.permanentStudentId ?? permanentStudentId;
          }
          student.permanentStudentId = permanentStudentId;
          found = true;
        } else if (category === 'ALREADY_ENROLLED') {
          student = await findRegistrationMatch(tx, { schoolId, fullName, dateOfBirth });
          if (student) {
            found = true;
            const profileRows = rows(await tx.query('SELECT id,student_id AS permanentStudentId,class_id AS classId FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE', [schoolId, student.studentId]));
            profile = profileRows[0] ?? null;
          }
        } else if (category === 'FIRST_TIME') {
          const existing = await findRegistrationMatch(tx, { schoolId, fullName, dateOfBirth });
          if (existing) fail('STUDENT_IDENTITY_ALREADY_EXISTS', 'A student with this name and date of birth already exists. Select Existing Student to continue their record.', 409);
        }
        if (!student && requiresExistingId) fail('EXISTING_ID_NOT_FOUND', 'EXISTING_ID_NOT_FOUND: No student record has that permanent ID. Check the ID and try again.', 404);
        if (!student && category === 'ALREADY_ENROLLED' && !requiresExistingId) fail('EXISTING_STUDENT_NOT_FOUND', 'No existing student matches this name and date of birth. Check the details or ask an administrator to reconcile the student record.', 404);
        if (student && !profile) {
          const profileRows = rows(await tx.query('SELECT id,student_id AS permanentStudentId,class_id AS classId FROM student_profiles WHERE school_id=? AND student_master_id=? ORDER BY id DESC LIMIT 1 FOR UPDATE', [schoolId, student.studentId]));
          profile = profileRows[0] ?? null;
        }
        if (student && !requiresExistingId) {
          const masterId = String(student.permanentStudentId ?? '').trim() || null;
          const profileIds = [profile?.permanentStudentId].filter((id) => id && !isTemporaryAdmissionNumber(id)).map(String);
          if (new Set(profileIds).size > 1 || masterId && profileIds.some((id) => id !== masterId)) fail('STUDENT_ID_PROFILE_CONFLICT', 'The student and profile contain different IDs. Ask the proprietor to reconcile the record.', 409);
          let permanentStudentId = masterId ?? profileIds[0] ?? null;
          if (!permanentStudentId && student.admissionNumber && /^(?:OSAA|OSAAH)\/\d{4}\/\d+$/.test(student.admissionNumber)) permanentStudentId = student.admissionNumber;
          if (permanentStudentId && !masterId) {
            await tx.execute('UPDATE students SET permanent_student_id=?,updated_at=? WHERE school_id=? AND id=? AND (permanent_student_id IS NULL OR permanent_student_id=\'\')', [permanentStudentId, timestamp, schoolId, student.studentId]);
            const confirmed = rows(await tx.query('SELECT permanent_student_id AS permanentStudentId FROM students WHERE school_id=? AND id=? LIMIT 1 FOR UPDATE', [schoolId, student.studentId]))[0];
            permanentStudentId = String(confirmed?.permanentStudentId ?? '').trim() || permanentStudentId;
          }
          if (!profile) {
            const profileId = idFactory();
            const tempAdmissionNumber = student.admissionNumber;
            const admissionNumber = student.admissionNumber;
            const newStudentId = student.studentId;
            const safeProfileStudentId = permanentStudentId || tempAdmissionNumber || admissionNumber || newStudentId;
            await tx.execute(`INSERT INTO student_profiles (id,student_master_id,student_id,school_id,admission_number,first_name,last_name,gender,date_of_birth,class_id,enrollment_status,created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [profileId, student.studentId, safeProfileStudentId, schoolId, student.admissionNumber ?? `REG-${student.studentId}`, student.firstName ?? firstName, student.lastName ?? lastName, student.gender ?? gender ?? 'NOT_SPECIFIED', student.dateOfBirth ?? dateOfBirth, student.currentClassId ?? classId, student.studentStatus ?? 'ACTIVE', timestamp]);
            profile = { id: profileId, permanentStudentId, classId: student.currentClassId ?? classId };
          } else if (permanentStudentId && (!profile.permanentStudentId || isTemporaryAdmissionNumber(profile.permanentStudentId))) {
            await tx.execute('UPDATE student_profiles SET student_id=? WHERE school_id=? AND id=? AND (student_id IS NULL OR student_id=\'\' OR student_id LIKE \'REG-%\')', [permanentStudentId, schoolId, profile.id]);
            profile.permanentStudentId = profile.permanentStudentId ?? permanentStudentId;
          }
          student.permanentStudentId = permanentStudentId;
          found = true;
        }
        if (!student) {
          const newStudentId = idFactory(), profileId = idFactory(), tempAdmissionNumber = `REG-${registrationToken || newStudentId}`;
          const admissionNumber = tempAdmissionNumber;
          const permanentStudentId = null;
          const safeProfileStudentId = permanentStudentId || tempAdmissionNumber || admissionNumber || newStudentId;
          await tx.execute(`INSERT INTO students (id,permanent_student_id,school_id,admission_number,current_class_id,first_name,middle_name,last_name,gender,date_of_birth,admission_date,admission_type,student_status,is_test_record,created_at,updated_at)
            VALUES (?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [newStudentId, schoolId, admissionNumber, classId, firstName, middleName, lastName, gender || 'NOT_SPECIFIED', dateOfBirth, admissionDate, category, 'ACTIVE', false, timestamp, timestamp]);
          await tx.execute(`INSERT INTO student_profiles (id,student_master_id,student_id,school_id,admission_number,class_id,admission_date,first_name,last_name,gender,date_of_birth,home_address,previous_school,previous_class,enrollment_status,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [profileId, newStudentId, safeProfileStudentId, schoolId, admissionNumber, classId, admissionDate, firstName, lastName, gender || 'NOT_SPECIFIED', dateOfBirth, homeAddress ?? '', previousSchool ?? null, previousClass ?? null, 'ACTIVE', timestamp]);
          student = { studentId: newStudentId, permanentStudentId, admissionNumber, firstName, lastName };
          profile = { id: profileId, previousSchool: previousSchool || null, previousClass };
          created = true;
        }

        const classRow = rows(await tx.query('SELECT id,name FROM classes WHERE id=? AND school_id=? LIMIT 1 FOR UPDATE', [classId, schoolId]))[0];
        if (!classRow || !canonicalClassId(classRow.name)) fail('CLASS_INVALID', 'Select an active school class.');

        if (!created) {
          await tx.execute(`UPDATE students SET current_class_id=?,first_name=?,middle_name=?,last_name=?,gender=?,date_of_birth=?,student_status='ACTIVE',updated_at=? WHERE id=? AND school_id=?`, [classId, firstName, middleName, lastName, gender, dateOfBirth, timestamp, student.studentId, schoolId]);
          await tx.execute(`UPDATE student_profiles SET class_id=?,first_name=?,last_name=?,home_address=?,previous_school=?,previous_class=?,enrollment_status='ACTIVE' WHERE id=? AND school_id=?`, [classId, firstName, lastName, homeAddress, previousSchool || null, previousClass, profile.id, schoolId]);
        }

        {
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
          insertParameters: [existingParentId, profile.id, student.permanentStudentId ?? student.permanent_student_id ?? null, parentPhone, text(input.relationship, 100) ?? 'Parent/Guardian', text(input.relationship, 100) ?? 'GUARDIAN', 'ACTIVE', timestamp, timestamp],
          conflictSql: 'SELECT parent_user_id FROM parent_student_links WHERE parent_user_id=? AND student_id=?',
          conflictParameters: [existingParentId, profile.id]
        });
        }

        const current = rows(await tx.query('SELECT id FROM student_enrollments WHERE school_id=? AND student_id=? AND academic_year_id=? AND term_id=? LIMIT 1 FOR UPDATE', [schoolId, student.studentId ?? student.id, academicYearId, termId]))[0];
        if (current) await tx.execute('UPDATE student_enrollments SET class_id=? WHERE id=?', [classId, current.id]);
        else await tx.execute('INSERT INTO student_enrollments (id,student_id,school_id,class_id,academic_year_id,term_id) VALUES (?,?,?,?,?,?)', [idFactory(), student.studentId ?? student.id, schoolId, classId, academicYearId, termId]);
        const confirmed = rows(await tx.query(`SELECT id AS studentId,school_id AS schoolId,permanent_student_id AS permanentStudentId,
          first_name AS firstName,middle_name AS middleName,last_name AS lastName FROM students WHERE school_id=? AND id=? LIMIT 1 FOR UPDATE`, [schoolId, student.studentId ?? student.id]))[0];
        if (!confirmed) fail('STUDENT_REGISTRATION_CONFIRMATION_FAILED', 'The student record could not be confirmed after saving. Please retry.', 503);
        const permanentStudentId = confirmed.permanentStudentId ?? null;
        return {
          success: true, found,
          student: { ...confirmed, id: confirmed.studentId, permanentStudentId, previousSchool: previousSchool || null, previousClass }, studentId: confirmed.studentId,
          registered: true, permanentStudentId, idStatus: permanentStudentId ? 'EXISTING' : 'PENDING_GENERATION',
          classId, className: classRow.name, created
        };
      }, (step) => { failingStep = step; });
    } catch (error) {
      const failure = registrationFailure(error, failingStep);
      console.error('REGISTRATION_ERROR_DETAIL:', error);
      failure.databaseMessage = error.message || 'The registration database operation failed.';
      failure.databaseCause = error.cause?.message || error.toString();
      const diagnostic = internalRegistrationErrorLogFields(error, failingStep, Object.values(input ?? {}));
      console.error('Internal student registration persistence failed', {
        ...diagnostic,
        operation: 'student_registration', requestId, step: diagnostic.failingStep,
        errorName: diagnostic.name, errno: diagnostic.errno, sqlState: diagnostic.sqlState,
        sanitizedSqlMessage: diagnostic.sqlMessage ?? diagnostic.message,
        code: diagnostic.code, responseCode: failure.code, responseStatus: failure.status
      });
      throw failure;
    }
  }

  return Object.freeze({ register, assignPermanentId, getRegisteredStudent, findExistingStudent });
}
