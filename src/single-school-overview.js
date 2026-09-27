const clone = (value) => JSON.parse(JSON.stringify(value));
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const today = (now) => new Date(now()).toISOString().slice(0, 10);
const active = (row) => !['COMPLETED', 'INACTIVE', 'ARCHIVED', 'WITHDRAWN', 'DISABLED'].includes(String(row.status ?? row.employmentStatus ?? '').toUpperCase());
const teachingRoles = new Set(['TEACHER', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACADEMIC_COORDINATOR', 'EXAMINATION_OFFICER']);
const levelOf = (classId) => {
  const value = String(classId ?? '').toLowerCase();
  if (value.includes('nursery')) return 'Nursery';
  if (value.includes('kg')) return 'KG';
  if (value.includes('primary') || value.includes('basic')) return value.includes('primary 1') || value.includes('basic 1') || value.includes('primary 2') || value.includes('basic 2') || value.includes('primary 3') || value.includes('basic 3') ? 'Lower Primary' : 'Upper Primary';
  if (value.includes('jhs')) return 'JHS';
  return 'Other';
};
const summarizeCollection = (rows, types, school, date) => {
  const currentTerm = school?.terms?.find((row) => row.isCurrent);
  const selected = rows.filter((row) => types.includes(String(row.collectionType).toUpperCase()));
  const termRows = selected.filter((row) => !currentTerm || row.termId === currentTerm.id || row.collectionPeriod === currentTerm.id || row.collectionPeriod === currentTerm.name);
  const minor = (items) => items.reduce((sum, row) => sum + number(row.amountReceivedMinor), 0);
  return { today: minor(selected.filter((row) => String(row.collectionDate).slice(0, 10) === date)) / 100, term: minor(termRows) / 100, count: selected.length, rows: selected.slice(-20).map((row) => ({ class: row.classId, date: row.collectionDate, type: row.collectionType, amount: number(row.amountReceivedMinor) / 100 })) };
};
const can = (actor, permission) => actor?.permissions?.has?.('*') || actor?.permissions?.has?.(permission);

export function createSingleSchoolOverviewService({ database = null, schoolSettings, students, attendance, attendanceRepository = null, examinations, fees, staff, communication, audit = () => {}, now = () => new Date().toISOString(), schoolId }) {
  const query = async (sql, params = []) => database?.query ? database.query(sql, params) : [];
  const optional = async (sql, params = []) => { try { return await query(sql, params); } catch { return []; } };
  const inMemoryStudents = () => students?.listStudents?.({ requestedSchoolId: schoolId }) ?? [];
  const inMemoryStaff = () => staff?.listProfiles?.().filter((row) => row.schoolId === schoolId) ?? [];

  async function getOverview(actor) {
    if (!actor?.schoolId || actor.schoolId !== schoolId) throw Object.assign(new Error('Forbidden.'), { status: 403 });
    const date = today(now);
    const [school, studentRows, staffRows, classRows, admissions, studentAttendance, staffAttendance, marks, exams, invoices, payments, incomes, expenses, leave, announcements, notifications, auditRows] = await Promise.all([
      schoolSettings.read(actor),
      optional('SELECT id,gender,class_id AS classId FROM student_profiles WHERE school_id=?', [schoolId]),
      optional('SELECT role_key AS roleKey,employment_type AS employmentStatus FROM staff_profiles WHERE school_id=?', [schoolId]),
      optional('SELECT id,name FROM classes WHERE school_id=?', [schoolId]),
      optional('SELECT stage,applicant_data AS applicantData FROM admission_applications WHERE school_id=?', [schoolId]),
      optional('SELECT student_id AS studentId,status,attendance_date AS date FROM student_attendance WHERE school_id=? AND attendance_date=?', [schoolId, date]),
      optional('SELECT staff_id AS staffId,attendance_type AS type,attendance_date AS date FROM staff_attendance WHERE school_id=? AND attendance_date=?', [schoolId, date]),
      optional('SELECT em.state,em.examination_id AS examinationId,em.student_id AS studentId,sp.class_id AS classId FROM examination_marks em LEFT JOIN student_profiles sp ON sp.id=em.student_id WHERE em.school_id=?', [schoolId]),
      optional('SELECT id,exam_type AS examType FROM examinations WHERE school_id=?', [schoolId]),
      optional('SELECT total,paid,balance,status FROM invoices WHERE school_id=?', [schoolId]),
      optional('SELECT amount,status FROM payments WHERE school_id=?', [schoolId]),
      optional('SELECT amount,status FROM general_income WHERE school_id=?', [schoolId]),
      optional('SELECT amount,status FROM general_expenses WHERE school_id=?', [schoolId]),
      optional("SELECT id FROM staff_leave WHERE school_id=? AND state='APPROVED' AND starts_on<=? AND ends_on>=?", [schoolId, date, date]),
      optional('SELECT title,created_at AS createdAt FROM announcements WHERE school_id=? ORDER BY created_at DESC LIMIT 5', [schoolId]),
      optional('SELECT type,title,status,created_at AS createdAt FROM notifications WHERE school_id=? ORDER BY created_at DESC LIMIT 5', [schoolId]),
      optional('SELECT action,entity,occurred_at AS occurredAt,user_id AS userId,role_id AS roleId FROM audit_logs WHERE school_id=? ORDER BY occurred_at DESC LIMIT 10', [schoolId])
    ]);
    const collectionRows = await optional("SELECT collection_type AS collectionType,collection_date AS collectionDate,amount_received_minor AS amountReceivedMinor,term_id AS termId,collection_period AS collectionPeriod,class_id AS classId FROM fee_collection_records WHERE school_id=? AND collection_type IN ('EXTRA_CLASS','EXTRA_CLASSES','CANTEEN')", [schoolId]);
    const dbStudents = studentRows.length ? studentRows : inMemoryStudents();
    const dbStaff = staffRows.length ? staffRows : inMemoryStaff();
    const currentStudents = dbStudents.filter(active);
    const genders = { boys: currentStudents.filter((row) => ['M', 'MALE', 'BOY'].includes(String(row.gender ?? '').toUpperCase())).length, girls: currentStudents.filter((row) => ['F', 'FEMALE', 'GIRL'].includes(String(row.gender ?? '').toUpperCase())).length };
    const byLevel = Object.fromEntries(['Nursery', 'KG', 'Lower Primary', 'Upper Primary', 'JHS'].map((level) => [level, currentStudents.filter((row) => levelOf(row.classId) === level).length]));
    const classBreakdown = (classRows.length ? classRows : [...new Set(currentStudents.map((row) => row.classId).filter(Boolean))].map((id) => ({ id, name: id }))).map((row) => {
      const enrolled = currentStudents.filter((student) => student.classId === row.id);
      return { id: row.id, name: row.name ?? row.id, boys: enrolled.filter((student) => ['M', 'MALE', 'BOY'].includes(String(student.gender ?? '').toUpperCase())).length, girls: enrolled.filter((student) => ['F', 'FEMALE', 'GIRL'].includes(String(student.gender ?? '').toUpperCase())).length, total: enrolled.length };
    });
    const studentAttendanceRows = studentAttendance.length ? studentAttendance : (attendance?.summary?.({ date })?.records ?? []);
    const staffAttendanceRows = staffAttendance.length ? staffAttendance : (attendance?.staffSummary?.({ date })?.records ?? []);
    const present = studentAttendanceRows.filter((row) => ['PRESENT', 'LATE', 'CHECKED_IN'].includes(String(row.status ?? row.type).toUpperCase()));
    const genderForStudent = (studentId) => String(currentStudents.find((student) => student.id === studentId)?.gender ?? '').toUpperCase();
    const staffPresent = staffAttendanceRows.filter((row) => ['PRESENT', 'LATE', 'CHECKED_IN'].includes(String(row.status ?? row.type).toUpperCase()));
    const validPayments = payments.filter((row) => !row.status || ['VALID', 'POSTED'].includes(String(row.status).toUpperCase()));
    const validInvoices = invoices.filter((row) => !row.status || !['VOIDED', 'CANCELLED'].includes(String(row.status).toUpperCase()));
    const financeVisible = can(actor, 'finance.read') || can(actor, 'fees.read');
    const academicVisible = can(actor, 'academics.read') || can(actor, 'results.read');
    const admissionsVisible = can(actor, 'admissions.read');
    const staffVisible = can(actor, 'staff.read') || can(actor, 'staff.attendance.read');
    const overview = {
      school: { ...(school?.profile ?? {}), schoolId: school.schoolId, academicYear: school.academicYears?.find((row) => row.isCurrent)?.name ?? null, term: school.terms?.find((row) => row.isCurrent)?.name ?? null },
      overview: { totalStudents: currentStudents.length, boys: genders.boys, girls: genders.girls, totalStaff: dbStaff.filter(active).length, teachers: dbStaff.filter((row) => teachingRoles.has(String(row.roleKey ?? '').toUpperCase()) && active(row)).length, classes: classRows.length || new Set(currentStudents.map((row) => row.classId).filter(Boolean)).size, byLevel },
      students: { totalActive: currentStudents.length, boys: genders.boys, girls: genders.girls, byLevel, classBreakdown, classes: Object.fromEntries(classBreakdown.map((row) => [row.id, row.total])) },
      attendance: { date, studentsPresent: present.length, studentsAbsent: studentAttendanceRows.filter((row) => String(row.status).toUpperCase() === 'ABSENT').length, boysPresent: present.filter((row) => ['M', 'MALE', 'BOY'].includes(genderForStudent(row.studentId))).length, girlsPresent: present.filter((row) => ['F', 'FEMALE', 'GIRL'].includes(genderForStudent(row.studentId))).length, staffPresent: staffPresent.length, staffAbsent: staffAttendanceRows.filter((row) => String(row.status ?? row.type).toUpperCase() === 'ABSENT').length, staffOnLeave: leave.length, percentage: studentAttendanceRows.length ? Math.round((present.length / studentAttendanceRows.length) * 10000) / 100 : 0 },
      admissions: admissionsVisible ? { total: admissions.length, pending: admissions.filter((row) => !['ACCEPTED', 'REJECTED'].includes(String(row.stage ?? '').toUpperCase())).length, accepted: admissions.filter((row) => String(row.stage ?? '').toUpperCase() === 'ACCEPTED').length, rejected: admissions.filter((row) => String(row.stage ?? '').toUpperCase() === 'REJECTED').length, newStudents: admissions.filter((row) => String(row.applicantData ?? '').toLowerCase().includes('new')).length, transferStudents: admissions.filter((row) => String(row.applicantData ?? '').toLowerCase().includes('transfer')).length } : null,
      academics: academicVisible ? { resultsPublished: marks.filter((row) => String(row.state).toUpperCase() === 'PUBLISHED').length, resultsPending: marks.filter((row) => String(row.state).toUpperCase() !== 'PUBLISHED').length, classesWithResults: new Set(marks.filter((row) => String(row.state).toUpperCase() === 'PUBLISHED').map((row) => row.classId).filter(Boolean)).size, studentsWithPublishedResults: new Set(marks.filter((row) => String(row.state).toUpperCase() === 'PUBLISHED').map((row) => row.studentId).filter(Boolean)).size, currentAssessmentStatus: exams.filter((row) => String(row.examType ?? '').toUpperCase() !== 'MOCK').length ? 'Available' : 'No assessments recorded', currentMockExaminationStatus: exams.some((row) => String(row.examType ?? '').toUpperCase() === 'MOCK') ? 'Available' : 'No mock assessments recorded' } : null,
      finance: financeVisible ? { expectedFees: validInvoices.reduce((sum, row) => sum + number(row.total), 0), amountCollected: validPayments.reduce((sum, row) => sum + number(row.amount), 0), outstandingFees: validInvoices.reduce((sum, row) => sum + number(row.balance), 0), expenses: expenses.reduce((sum, row) => sum + number(row.amount), 0), netPosition: validPayments.reduce((sum, row) => sum + number(row.amount), 0) + incomes.reduce((sum, row) => sum + number(row.amount), 0) - expenses.reduce((sum, row) => sum + number(row.amount), 0), payments: validPayments.length, receipts: validPayments.length } : null,
      staff: staffVisible ? { total: dbStaff.filter(active).length, teaching: dbStaff.filter((row) => teachingRoles.has(String(row.roleKey ?? '').toUpperCase()) && active(row)).length, nonTeaching: dbStaff.filter(active).length - dbStaff.filter((row) => teachingRoles.has(String(row.roleKey ?? '').toUpperCase()) && active(row)).length, presentToday: staffPresent.length, absentToday: staffAttendanceRows.filter((row) => String(row.status ?? row.type).toUpperCase() === 'ABSENT').length, onLeave: leave.length } : null,
      collections: financeVisible ? { extraClasses: summarizeCollection(collectionRows, ['EXTRA_CLASS', 'EXTRA_CLASSES'], school, date), canteen: summarizeCollection(collectionRows, ['CANTEEN'], school, date) } : null,
      communication: can(actor, 'communication.read') ? { announcements: announcements.map(({ title, createdAt }) => ({ title, createdAt })), notifications: notifications.map(({ type, title, status, createdAt }) => ({ type, title, status, createdAt })) } : null,
      recentActivity: can(actor, 'reports.read') || can(actor, 'audit.read') || can(actor, 'users.read') ? auditRows.map((row) => ({ activity: row.action, module: row.entity, dateTime: row.occurredAt, userId: row.userId, role: row.roleId })) : [],
      quickActions: [
        ['Student Admission', '/admissions', 'admissions.read'], ['Class Database', '/class-database.html', 'students.read'], ['Attendance', '/attendance', 'attendance.read'], ['Score Entry', '/examinations/marks', 'marks.write'], ['Results', '/results', 'results.read'], ['Payments', '/fees/payments', 'fees.collect'], ['Receipts', '/fees/invoices', 'fees.read'], ['Fee Setup', '/fees/setup', 'fees.configure'], ['Staff Attendance', '/staff/attendance', 'staff.attendance.read'], ['Promotion', '/promotion', 'promotion.write'], ['School Settings', '/settings', 'settings.read'], ['Users & Roles', '/users', 'users.read'], ['Academic Calendar', '/communication/calendar', 'calendar.read']
      ].filter(([, , permission]) => can(actor, permission)).map(([label, route]) => ({ label, route }))
    };
    audit({ schoolId, userId: actor.id, roleId: actor.roleKey, action: 'ACCESS', entity: 'SingleSchoolPanel' });
    return clone(overview);
  }
  return { getOverview };
}
