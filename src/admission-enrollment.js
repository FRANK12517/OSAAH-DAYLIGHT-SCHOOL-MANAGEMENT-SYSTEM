import { randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { admissionYearFor } from './permanent-student-id.js';
import { requireStudentGender } from './student-gender.js';
import { canonicalClassId } from './student-classes.js';

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

  async function authorizeParentStudent({ parentUserId, permanentStudentId, schoolId }) {
    if (!parentUserId || !permanentStudentId || !schoolId) fail('PARENT_STUDENT_SCOPE_REQUIRED', 'Parent, student, and school scope are required.', 400);
    const result = rows(await database.query('SELECT s.id AS id,s.id AS studentId,s.id AS student_id,s.permanent_student_id AS permanentStudentId,s.permanent_student_id,s.gender,s.student_status AS studentStatus,sp.id AS studentProfileId,sp.id AS student_profile_id,sp.class_id AS classId,sp.class_id,sp.enrollment_status AS profileEnrollmentStatus,(SELECT e.enrollment_status FROM student_enrollments e WHERE e.student_id=s.id AND e.school_id=s.school_id AND e.is_current IS TRUE ORDER BY e.enrolled_at DESC,e.id DESC LIMIT 1) AS enrollmentStatus FROM students s JOIN student_profiles sp ON sp.student_master_id=s.id AND (sp.student_id=s.permanent_student_id OR sp.student_id=?) JOIN parent_student_links psl ON psl.student_id=sp.id AND psl.parent_user_id=? AND psl.link_status=? WHERE s.school_id=? AND s.permanent_student_id=? AND s.is_test_record IS FALSE LIMIT 1', [permanentStudentId, parentUserId, 'ACTIVE', schoolId, permanentStudentId]))[0];
    if (!result) fail('PARENT_STUDENT_FORBIDDEN', 'You are not authorized to access this student.', 403);
    return result;
  }

  async function listParentStudents({ parentUserId, schoolId } = {}) {
    if (!parentUserId || !schoolId) fail('PARENT_STUDENT_SCOPE_REQUIRED', 'Parent and school scope are required.', 400);
    return rows(await database.query(`SELECT s.id AS id,s.id AS studentId,s.id AS student_id,
      s.permanent_student_id AS permanentStudentId,s.permanent_student_id,
      sp.id AS studentProfileId,sp.id AS student_profile_id,sp.class_id AS classId,sp.class_id,
      s.first_name AS firstName,s.last_name AS lastName,s.gender,s.student_status AS studentStatus,
      sp.enrollment_status AS profileEnrollmentStatus,
      (SELECT e.enrollment_status FROM student_enrollments e WHERE e.student_id=s.id AND e.school_id=s.school_id AND e.is_current IS TRUE ORDER BY e.enrolled_at DESC,e.id DESC LIMIT 1) AS enrollmentStatus,
      c.name AS className
      FROM parent_student_links psl
      JOIN users pu ON pu.id=psl.parent_user_id AND pu.school_id=?
      JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=pu.school_id
      JOIN students s ON s.id=sp.student_master_id AND s.school_id=pu.school_id
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
      JOIN students s ON s.id=sp.student_master_id AND s.school_id=sp.school_id
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
