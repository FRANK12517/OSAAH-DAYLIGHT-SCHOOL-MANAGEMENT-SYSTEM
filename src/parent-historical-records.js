function rows(value) {
  return Array.isArray(value) ? value : [];
}

function isSchemaCompatibilityError(error) {
  return ['ER_BAD_FIELD_ERROR', 'ER_NO_SUCH_TABLE', 'ER_UNKNOWN_COLUMN'].includes(String(error?.code ?? '').toUpperCase())
    || /unknown column|doesn't exist|does not exist|schema mismatch/i.test(String(error?.message ?? ''));
}

function requireParent(actor) {
  if (actor?.portal !== 'parent' || actor?.roleKey !== 'PARENT' || !actor?.id || !actor?.schoolId ||
      !(actor?.permissions?.has?.('*') || actor?.permissions?.has?.('children.read'))) {
    throw Object.assign(new Error('Forbidden.'), { status: 403, code: 'PARENT_ACCESS_REQUIRED' });
  }
}

function requireChild(student) {
  const permanentStudentId = String(student?.permanentStudentId ?? student?.permanent_student_id ?? '').trim();
  if (!permanentStudentId) {
    throw Object.assign(new Error('An authorized child is required.'), { status: 403, code: 'PARENT_STUDENT_FORBIDDEN' });
  }
  return permanentStudentId;
}

/**
 * Read-only Parent views over the repository's existing durable history.
 * Historical enrollment scope comes from student_enrollments; promotion
 * decisions come from promotion_decisions; completion is exposed only when an
 * explicit student status or completed enrollment marker exists. No schema,
 * backfill, status inference, or generated academic-context combinations are
 * introduced here.
 */
export function createParentHistoricalRecordsService({ database } = {}) {
  if (!database?.query) {
    throw Object.assign(new Error('Historical Parent records require a durable database adapter.'), {
      status: 503,
      code: 'PARENT_HISTORICAL_DATABASE_REQUIRED'
    });
  }

  async function listHistoricalContexts(actor, student) {
    requireParent(actor);
    const permanentStudentId = requireChild(student);
    const result = await database.query(`
      SELECT DISTINCT
        y.id AS academicYearId, y.name AS academicYearName,
        t.id AS termId, t.name AS termName,
        c.id AS classId, c.name AS className
      FROM parent_student_links psl
      JOIN users pu ON pu.id=psl.parent_user_id AND pu.school_id=? AND UPPER(COALESCE(pu.status,'ACTIVE'))='ACTIVE'
      JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=pu.school_id
      JOIN students s ON s.id=sp.student_master_id AND s.school_id=pu.school_id
      JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
      JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id
      JOIN terms t ON t.id=e.term_id AND t.academic_year_id=y.id
      JOIN classes c ON c.id=e.class_id AND c.school_id=s.school_id
      WHERE psl.parent_user_id=? AND psl.link_status='ACTIVE'
        AND s.school_id=? AND s.permanent_student_id=?
        AND COALESCE(s.is_test_record,0)=0
        AND e.academic_year_id IS NOT NULL AND e.term_id IS NOT NULL
      ORDER BY y.id,t.id,c.id`, [actor.schoolId, actor.id, actor.schoolId, permanentStudentId]);

    const unique = new Map();
    for (const item of rows(result)) {
      if (!item.academicYearId || !item.termId || !item.classId) continue;
      const key = [item.academicYearId, item.termId, item.classId].map(String).join('\u0000');
      unique.set(key, {
        academicYearId: String(item.academicYearId),
        academicYearName: String(item.academicYearName ?? item.academicYearId),
        termId: String(item.termId),
        termName: String(item.termName ?? item.termId),
        classId: String(item.classId),
        className: String(item.className ?? item.classId)
      });
    }
    return [...unique.values()];
  }

  async function listPromotionHistory(actor, student) {
    requireParent(actor);
    const permanentStudentId = requireChild(student);
    const result = await database.query(`
      SELECT pd.id, pd.academic_year_id AS academicYearId,
        y.name AS academicYearName, pd.decision, pd.decided_at AS decisionDate
      FROM parent_student_links psl
      JOIN users pu ON pu.id=psl.parent_user_id AND pu.school_id=? AND UPPER(COALESCE(pu.status,'ACTIVE'))='ACTIVE'
      JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=pu.school_id
      JOIN students s ON s.id=sp.student_master_id AND s.school_id=pu.school_id
      JOIN promotion_decisions pd ON pd.student_id=sp.id AND pd.school_id=s.school_id
      LEFT JOIN academic_years y ON y.id=pd.academic_year_id AND y.school_id=s.school_id
      WHERE psl.parent_user_id=? AND psl.link_status='ACTIVE'
        AND s.school_id=? AND s.permanent_student_id=?
        AND COALESCE(s.is_test_record,0)=0
      ORDER BY pd.decided_at,pd.id`, [actor.schoolId, actor.id, actor.schoolId, permanentStudentId]);

    return rows(result).map((item) => ({
      academicYearId: item.academicYearId == null ? null : String(item.academicYearId),
      academicYearName: item.academicYearName ?? item.academicYearId ?? null,
      decision: String(item.decision ?? ''),
      decisionDate: item.decisionDate ?? null
    })).filter((item) => item.decision);
  }

  async function listCompletedRecords(actor, student) {
    requireParent(actor);
    const permanentStudentId = requireChild(student);
    let result;
    try {
      result = await database.query(`
        SELECT s.student_status AS studentStatus,
          e.academic_year_id AS academicYearId, y.name AS academicYearName,
          e.term_id AS termId, t.name AS termName,
          e.class_id AS classId, c.name AS className,
          e.enrollment_status AS enrollmentStatus
        FROM parent_student_links psl
        JOIN users pu ON pu.id=psl.parent_user_id AND pu.school_id=? AND UPPER(COALESCE(pu.status,'ACTIVE'))='ACTIVE'
        JOIN student_profiles sp ON sp.id=psl.student_id AND sp.school_id=pu.school_id
        JOIN students s ON s.id=sp.student_master_id AND s.school_id=pu.school_id
        LEFT JOIN student_enrollments e ON e.student_id=s.id AND e.school_id=s.school_id
          AND UPPER(COALESCE(e.enrollment_status,''))='COMPLETED'
        LEFT JOIN academic_years y ON y.id=e.academic_year_id AND y.school_id=s.school_id
        LEFT JOIN terms t ON t.id=e.term_id AND t.academic_year_id=y.id
        LEFT JOIN classes c ON c.id=e.class_id AND c.school_id=s.school_id
        WHERE psl.parent_user_id=? AND psl.link_status='ACTIVE'
          AND s.school_id=? AND s.permanent_student_id=?
          AND COALESCE(s.is_test_record,0)=0
          AND (UPPER(COALESCE(s.student_status,'')) IN ('COMPLETED','GRADUATED') OR e.id IS NOT NULL)
        ORDER BY e.academic_year_id,e.id`, [actor.schoolId, actor.id, actor.schoolId, permanentStudentId]);
    } catch (error) {
      // Older production schemas may not yet expose a durable completion
      // marker. Empty history is safe; synthesizing completion is not.
      if (isSchemaCompatibilityError(error)) return [];
      throw error;
    }

    return rows(result).map((item) => {
      const studentStatus = String(item.studentStatus ?? '').toUpperCase();
      const completionMarker = String(item.enrollmentStatus ?? '').toUpperCase() === 'COMPLETED';
      return {
        status: ['COMPLETED', 'GRADUATED'].includes(studentStatus) ? studentStatus : completionMarker ? 'COMPLETED' : null,
        academicYearId: item.academicYearId == null ? null : String(item.academicYearId),
        academicYearName: item.academicYearName ?? item.academicYearId ?? null,
        termId: item.termId == null ? null : String(item.termId),
        termName: item.termName ?? item.termId ?? null,
        classId: item.classId == null ? null : String(item.classId),
        className: item.className ?? item.classId ?? null,
        completedAt: null
      };
    }).filter((item) => item.status);
  }

  return Object.freeze({ listHistoricalContexts, listPromotionHistory, listCompletedRecords });
}
