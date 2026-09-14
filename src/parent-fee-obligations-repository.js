const PARENT_ROLES = new Set(['PARENT']);

export function createParentFeeObligationsRepository(database) {
  if (!database?.query) throw new Error('A durable database adapter is required.');
  return {
    async listForParent(actor, filters = {}) {
      if (!actor?.id || !PARENT_ROLES.has(actor.roleKey) || actor.portal !== 'parent') throw new Error('Parent access required.');
      const conditions = ['psl.parent_user_id=?', "psl.link_status='ACTIVE'", 's.is_test_record=0'];
      const params = [actor.id];
      for (const [key, column] of [['academicYearId', 'fo.academic_year_id'], ['termId', 'fo.term_id'], ['feeStructureId', 'fo.fee_structure_id'], ['status', 'fo.status']]) {
        if (filters[key] !== undefined && filters[key] !== '') { conditions.push(`${column}=?`); params.push(filters[key]); }
      }
      const rows = await database.query(`SELECT psl.student_id AS studentId,s.permanent_student_id AS permanentStudentId,s.first_name AS firstName,s.middle_name AS middleName,s.surname AS surname,sp.class_id AS classId,s.school_id AS schoolId,fo.id AS obligationId,fo.fee_structure_id AS feeStructureId,fo.academic_year_id AS academicYearId,fo.term_id AS termId,fo.due_date AS dueDate,fo.amount_minor AS amountMinor,fo.status FROM parent_student_links psl JOIN student_profiles sp ON sp.id=psl.student_id JOIN students s ON s.id=sp.student_master_id LEFT JOIN fee_obligations fo ON fo.student_id=sp.student_master_id AND fo.school_id=s.school_id WHERE ${conditions.join(' AND ')}`, params);
      const children = new Map();
      for (const row of rows) {
        if (!children.has(row.studentId)) children.set(row.studentId, { student: { id: row.studentId, permanentStudentId: row.permanentStudentId, name: [row.firstName, row.middleName, row.surname].filter(Boolean).join(' '), classId: row.classId, schoolId: row.schoolId }, obligations: [] });
        if (row.obligationId) children.get(row.studentId).obligations.push({ id: row.obligationId, feeStructureId: row.feeStructureId, academicYearId: row.academicYearId, termId: row.termId, dueDate: row.dueDate, amountMinor: row.amountMinor, status: row.status, allocation_status: 'NOT_EVALUATED' });
      }
      return { children: [...children.values()] };
    }
  };
}
