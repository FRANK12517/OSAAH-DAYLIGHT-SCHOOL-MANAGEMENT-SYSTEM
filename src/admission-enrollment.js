import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { admissionYearFor } from './permanent-student-id.js';
import { requireStudentGender } from './student-gender.js';
import { canonicalClassId } from './student-classes.js';
import { ghanaPhoneLookupValues, normalizeGhanaPhone } from './auth/parent-auth-service.js';

import { tidbInsertIfAbsent } from './tidb-conflict.js';

function fail(code, message, status = 400) { throw Object.assign(new Error(message), { code, status }); }
function value(...items) { return items.find((item) => item !== undefined && item !== null && item !== '') ?? null; }
function json(valueToEncode) { return JSON.stringify(valueToEncode ?? {}); }
function rows(result) { return Array.isArray(result) ? result : []; }

/**
 * Durable database final step for the existing admission review workflow. The
 * application service remains responsible for validation and the decision;
 * this service atomically materializes the accepted application as a student.
 */
export function createAdmissionEnrollmentService({ database, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.transaction) fail('DATABASE_ADAPTER_REQUIRED', 'Enrollment persistence is unavailable.', 503);

  async function enroll() { fail('LEGACY_ADMISSION_WORKFLOW_RETIRED', 'Use the unified student registration workflow at /admissions/register.', 410); }

  async function linkPhoneMatchedStudents({ parentUserId, schoolId, permanentStudentId = null } = {}) {
    if (!parentUserId || !schoolId) return;
    return database.transaction(async (tx) => {
      const account = rows(await tx.query("SELECT phone,username FROM users WHERE id=? AND school_id=? AND UPPER(COALESCE(status,'ACTIVE'))='ACTIVE' LIMIT 1", [parentUserId, schoolId]))[0];
      const normalized = normalizeGhanaPhone(account?.phone) ?? normalizeGhanaPhone(account?.username);
      if (!normalized) return;
      const schemaColumns = rows(await tx.query("SELECT TABLE_NAME AS tableName,COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN (?,?)", ['students', 'student_family_contacts']));
      const allowedStudentPhoneColumns = new Set(['parent_phone', 'registered_parent_phone', 'guardian_phone', 'mother_phone', 'father_phone']);
      const studentColumns = new Set(schemaColumns.filter((column) => String(column.tableName ?? column.TABLE_NAME).toLowerCase() === 'students').map((column) => String(column.columnName ?? column.COLUMN_NAME).toLowerCase()));
      const familyColumns = new Set(schemaColumns.filter((column) => String(column.tableName ?? column.TABLE_NAME).toLowerCase() === 'student_family_contacts').map((column) => String(column.columnName ?? column.COLUMN_NAME).toLowerCase()));
      const familyTableExists = schemaColumns.some((column) => String(column.tableName ?? column.TABLE_NAME).toLowerCase() === 'student_family_contacts') && familyColumns.has('student_id');
      const phoneFields = [
        ...[...allowedStudentPhoneColumns].filter((column) => studentColumns.has(column)).map((column) => `s.${column}`),
        ...(familyTableExists ? ['telephone', 'alternative_phone'].filter((column) => familyColumns.has(column)).map((column) => `fc.${column}`) : [])
      ];
      if (!phoneFields.length) return;
      const lookupValues = [...new Set(ghanaPhoneLookupValues(normalized).map((value) => value.replace(/\D/g, '')))];
      const phonePlaceholders = lookupValues.map(() => '?').join(',');
      const normalizeSql = (field) => `REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(${field},''),' ',''),CHAR(9),''),CHAR(10),''),CHAR(13),''),'-',''),'(',''),')',''),'+',''),'.','')`;
      const phoneMatches = phoneFields.map((field) => `${normalizeSql(field)} IN (${phonePlaceholders})`).join(' OR ');
      const parameters = [schoolId, ...phoneFields.flatMap(() => lookupValues), ...(permanentStudentId ? [permanentStudentId] : []), parentUserId];
      const studentFilter = permanentStudentId ? ' AND s.permanent_student_id=?' : '';
      const candidates = rows(await tx.query(`SELECT DISTINCT s.id AS id,s.permanent_student_id AS permanentStudentId,sp.id AS studentProfileId
        FROM students s JOIN student_profiles sp ON sp.school_id=s.school_id
          AND (sp.student_master_id=s.id OR (sp.student_master_id IS NULL AND sp.student_id=s.permanent_student_id))
        ${familyTableExists ? 'LEFT JOIN student_family_contacts fc ON fc.student_id=sp.id' : ''}
        WHERE s.school_id=? AND s.is_test_record IS FALSE
          AND UPPER(COALESCE(s.student_status,'ACTIVE')) NOT IN ('INACTIVE','WITHDRAWN','TRANSFERRED','TRANSFERRED_OUT','COMPLETED','GRADUATED','DELETED','ARCHIVED')
          AND UPPER(COALESCE(sp.enrollment_status,'ACTIVE')) NOT IN ('INACTIVE','WITHDRAWN','TRANSFERRED','TRANSFERRED_OUT','COMPLETED','GRADUATED','DELETED','ARCHIVED')
          AND (${phoneMatches})${studentFilter}
          AND NOT EXISTS (SELECT 1 FROM parent_student_links existing_link WHERE existing_link.parent_user_id=? AND existing_link.student_id=sp.id)`, parameters));
      const timestamp = clock();
      for (const student of candidates) {
        await tidbInsertIfAbsent(tx, {
          insertSql: 'INSERT INTO parent_student_links (parent_user_id,student_id,permanent_student_id,telephone,relationship,relationship_type,link_status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
          insertParameters: [parentUserId, student.studentProfileId, student.permanentStudentId ?? null, normalized, 'Parent/Guardian', 'GUARDIAN', 'ACTIVE', timestamp, timestamp],
          conflictSql: 'SELECT parent_user_id FROM parent_student_links WHERE parent_user_id=? AND student_id=? LIMIT 1 FOR UPDATE',
          conflictParameters: [parentUserId, student.studentProfileId]
        });
      }
    });
  }

  async function authorizeParentStudent({ parentUserId, permanentStudentId, schoolId }) {
    if (!parentUserId || !permanentStudentId || !schoolId) fail('PARENT_STUDENT_SCOPE_REQUIRED', 'Parent, student, and school scope are required.', 400);
    const requestedId = String(permanentStudentId).trim();
    const findLinkedStudent = async () => rows(await database.query(`SELECT s.id AS id,s.id AS studentId,s.id AS student_id,
      s.permanent_student_id AS permanentStudentId,s.permanent_student_id,s.gender,
      s.student_status AS studentStatus,sp.id AS studentProfileId,sp.id AS student_profile_id,
      sp.class_id AS classId,sp.class_id
      FROM students s
      JOIN student_profiles sp ON sp.school_id=s.school_id
        AND (sp.student_master_id=s.id OR (sp.student_master_id IS NULL AND sp.student_id=s.permanent_student_id))
      JOIN parent_student_links psl ON psl.student_id=sp.id AND psl.parent_user_id=? AND psl.link_status='ACTIVE'
      WHERE s.school_id=? AND (s.permanent_student_id=? OR s.id=?) AND s.is_test_record IS FALSE
      LIMIT 1`, [parentUserId, schoolId, requestedId, requestedId]))[0];
    let result = await findLinkedStudent();
    if (!result) {
      await linkPhoneMatchedStudents({ parentUserId, schoolId, permanentStudentId: requestedId });
      result = await findLinkedStudent();
    }
    if (!result) fail('PARENT_STUDENT_FORBIDDEN', 'You are not authorized to access this student.', 403);
    return result;
  }

  async function listParentStudents({ parentUserId, schoolId, parentPhone } = {}) {
    if (!parentUserId || !schoolId) fail('PARENT_STUDENT_SCOPE_REQUIRED', 'Parent and school scope are required.', 400);
    await linkPhoneMatchedStudents({ parentUserId, schoolId });
    return rows(await database.query(`SELECT s.id AS id,s.id AS studentId,s.id AS student_id,
      s.permanent_student_id AS permanentStudentId,s.permanent_student_id,
      sp.id AS studentProfileId,sp.id AS student_profile_id,sp.class_id AS classId,sp.class_id,
      s.first_name AS firstName,s.last_name AS lastName,s.gender,s.student_status AS studentStatus,
      c.name AS className
      FROM parent_student_links psl
      JOIN users pu ON pu.id=psl.parent_user_id AND pu.school_id=?
      JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=pu.school_id
      JOIN students s ON s.school_id=sp.school_id
        AND (s.id=sp.student_master_id OR (sp.student_master_id IS NULL AND sp.student_id=s.permanent_student_id))
      LEFT JOIN classes c ON c.id=sp.class_id AND c.school_id=pu.school_id
      WHERE psl.parent_user_id=? AND psl.link_status='ACTIVE' AND s.school_id=? AND s.is_test_record IS FALSE
      ORDER BY s.permanent_student_id,s.id`, [schoolId, parentUserId, schoolId]));
  }

  async function parentEnrolledInClass({ parentUserId, schoolId, permanentStudentId, academicYearId, termId, termName, classId, recordType = 'student-summary', legacyTermEvidence = null } = {}) {
    if (!parentUserId || !schoolId || !permanentStudentId || !academicYearId || !termId || !classId) return false;
    const result = rows(await database.query(`SELECT e.class_id AS classId
      ,e.term_id AS termId
      FROM parent_student_links psl
      JOIN users pu ON pu.id=psl.parent_user_id AND pu.school_id=? AND UPPER(COALESCE(pu.status,'ACTIVE'))='ACTIVE'
      JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=pu.school_id
      JOIN students s ON s.school_id=sp.school_id
        AND (s.id=sp.student_master_id OR (sp.student_master_id IS NULL AND sp.student_id=s.permanent_student_id))
      JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
      WHERE psl.parent_user_id=? AND psl.link_status='ACTIVE' AND s.school_id=?
        AND s.permanent_student_id=? AND e.academic_year_id=? AND e.class_id=?
        AND (e.term_id=? OR e.term_id IS NULL)
        AND s.is_test_record IS FALSE LIMIT 1`, [schoolId, parentUserId, schoolId, permanentStudentId, academicYearId, classId, termId]));
    const enrollment = result[0];
    if (!enrollment) return false;
    if (enrollment.termId !== null && enrollment.termId !== undefined && String(enrollment.termId) !== String(termId)) return false;
    if (enrollment.termId !== null && enrollment.termId !== undefined) return true;
    if (recordType === 'student-summary') return true;
    return typeof legacyTermEvidence === 'function' && Boolean(await legacyTermEvidence({ parentUserId, schoolId, permanentStudentId, academicYearId, termId, termName, classId, recordType }));
  }

  return Object.freeze({ enroll, authorizeParentStudent, listParentStudents, parentEnrolledInClass });
}
