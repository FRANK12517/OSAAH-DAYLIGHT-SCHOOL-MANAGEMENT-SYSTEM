import { TEST_PARENT_STUDENT_IDS } from './test-parent-fixture.js';

const rows = (value) => Array.isArray(value) ? value : [];
const NAME_BY_ID = new Map([
  [TEST_PARENT_STUDENT_IDS[0], ['OSAAH Demo', 'Student One']],
  [TEST_PARENT_STUDENT_IDS[1], ['OSAAH Demo', 'Student Two']]
]);

function validContext(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function model(row, classId) {
  const permanentStudentId = String(row.permanentStudentId ?? row.permanent_student_id ?? '');
  const fallbackName = NAME_BY_ID.get(permanentStudentId) ?? [];
  return {
    id: row.studentId ?? row.id,
    studentId: row.studentId ?? row.id,
    permanentStudentId,
    firstName: row.firstName ?? row.first_name ?? fallbackName[0] ?? 'Sample',
    surname: row.surname ?? row.last_name ?? fallbackName[1] ?? 'Demonstration Student',
    studentName: [row.firstName ?? row.first_name ?? fallbackName[0], row.middleName ?? row.middle_name, row.surname ?? row.last_name ?? fallbackName[1]].filter(Boolean).join(' '),
    classId: row.classId ?? row.class_id ?? classId,
    schoolId: row.schoolId ?? row.school_id,
    isTestRecord: true,
    isDemonstrationStudent: true
  };
}

export function createDemoStudentAssignmentRepository({ database, schoolId = 'sch_default_01' } = {}) {
  if (!database?.query) return null;
  async function listForClass(classId, requestedSchoolId = schoolId) {
    const contextClassId = validContext(classId, 'Class');
    const contextSchoolId = validContext(requestedSchoolId, 'School');
    const result = await database.query(`SELECT DISTINCT s.id AS studentId,s.permanent_student_id AS permanentStudentId,
        s.first_name AS firstName,s.middle_name AS middleName,s.last_name AS surname,
        d.class_id AS classId,s.school_id AS schoolId
      FROM demo_student_class_assignments d
      JOIN students s ON s.id=d.student_id AND s.school_id=d.school_id
      JOIN student_profiles sp ON sp.school_id=s.school_id AND sp.student_master_id=s.id
        AND sp.student_id=s.permanent_student_id AND sp.enrollment_status='ACTIVE'
      WHERE d.school_id=? AND d.class_id=? AND s.student_status='ACTIVE' AND s.is_test_record=TRUE
        AND s.permanent_student_id IN (?,?)
      ORDER BY s.permanent_student_id,s.id`, [contextSchoolId, contextClassId, ...TEST_PARENT_STUDENT_IDS]);
    return rows(result).map((row) => model(row, contextClassId));
  }
  async function hasAssignment({ studentId, permanentStudentId, classId, schoolId: requestedSchoolId = schoolId } = {}) {
    const contextClassId = validContext(classId, 'Class');
    const contextSchoolId = validContext(requestedSchoolId, 'School');
    const identity = String(permanentStudentId ?? '').trim();
    const masterStudentId = String(studentId ?? '').trim();
    if (identity && !TEST_PARENT_STUDENT_IDS.includes(identity)) return false;
    if (!identity && !masterStudentId) return false;
    const result = await database.query(`SELECT s.id
      FROM demo_student_class_assignments d JOIN students s ON s.id=d.student_id AND s.school_id=d.school_id
      WHERE d.school_id=? AND d.class_id=? AND s.student_status='ACTIVE' AND s.is_test_record=TRUE
        AND s.permanent_student_id IN (?,?) AND (s.id=? OR s.permanent_student_id=?) LIMIT 1`, [contextSchoolId, contextClassId, ...TEST_PARENT_STUDENT_IDS, masterStudentId || identity, identity]);
    return rows(result).length === 1;
  }
  return Object.freeze({ listForClass, hasAssignment });
}
