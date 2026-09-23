import { randomUUID } from 'node:crypto';

function rows(value) { return Array.isArray(value) ? value : []; }
function attendanceRow(row) {
  return { id: row.id, schoolId: row.schoolId ?? row.school_id, academicYear: row.academicYear ?? row.academic_year, term: row.term, date: row.date ?? row.attendance_date, classId: row.classId ?? row.class_id, studentId: row.studentId ?? row.student_id, subjectId: row.subjectId ?? row.subject_id ?? null, status: row.status, method: row.method, arrivalTime: row.arrivalTime ?? row.arrival_time ?? null, departureTime: row.departureTime ?? row.departure_time ?? null, reason: row.reason ?? null, version: Number(row.version ?? 1), enteredBy: row.enteredBy ?? row.entered_by, enteredAt: row.enteredAt ?? row.entered_at, updatedAt: row.updatedAt ?? row.updated_at };
}
function staffRow(row) { return { id: row.id, schoolId: row.schoolId ?? row.school_id, academicYear: row.academicYear ?? row.academic_year, term: row.term, staffId: row.staffId ?? row.staff_id, date: row.date ?? row.attendance_date, type: row.type ?? row.attendance_type, time: row.time ?? row.attendance_time, enteredBy: row.enteredBy ?? row.entered_by, createdAt: row.createdAt ?? row.created_at }; }

export function createAttendanceRepository({ adapter, now = () => new Date().toISOString() } = {}) {
  if (!adapter?.query || !adapter?.execute) throw new Error('A durable database adapter is required.');
  async function saveStudentAttendance(entry, actor, { correction = false, expectedVersion = null } = {}) {
    const id = randomUUID(); const timestamp = now();
    if (correction) {
      const existing = rows(await adapter.query('SELECT id,version FROM student_attendance WHERE school_id=? AND academic_year=? AND term=? AND attendance_date=? AND class_id=? AND student_id=? AND subject_key=? LIMIT 1', [actor.schoolId, entry.academicYear, entry.term, entry.date, entry.classId, entry.studentId, entry.subjectId ?? 'daily']))[0];
      if (!existing) throw new Error('Attendance record not found');
      if (expectedVersion !== null && Number(existing.version) !== Number(expectedVersion)) throw new Error('Attendance conflict: server record is newer');
      await adapter.execute('UPDATE student_attendance SET status=?,method=?,arrival_time=?,departure_time=?,reason=?,version=version+1,updated_at=? WHERE id=? AND school_id=?', [entry.status, entry.method ?? 'MANUAL', entry.arrivalTime ?? null, entry.departureTime ?? null, entry.reason ?? null, timestamp, existing.id, actor.schoolId]);
      return attendanceRow((await adapter.query('SELECT id,school_id AS schoolId,academic_year AS academicYear,term,attendance_date AS date,class_id AS classId,student_id AS studentId,subject_id AS subjectId,status,method,arrival_time AS arrivalTime,departure_time AS departureTime,reason,version,entered_by AS enteredBy,entered_at AS enteredAt,updated_at AS updatedAt FROM student_attendance WHERE id=?', [existing.id]))[0]);
    }
    try {
      await adapter.execute('INSERT INTO student_attendance (id,school_id,academic_year,term,attendance_date,class_id,student_id,subject_id,subject_key,status,method,arrival_time,departure_time,reason,version,entered_by,entered_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, actor.schoolId, entry.academicYear, entry.term, entry.date, entry.classId, entry.studentId, entry.subjectId ?? null, entry.subjectId ?? 'daily', entry.status, entry.method ?? 'MANUAL', entry.arrivalTime ?? null, entry.departureTime ?? null, entry.reason ?? null, 1, actor.userId, timestamp, timestamp]);
    } catch (error) { if (/duplicate|unique|1062/i.test(error.message)) throw new Error('Attendance already recorded'); throw error; }
    return attendanceRow((await adapter.query('SELECT id,school_id AS schoolId,academic_year AS academicYear,term,attendance_date AS date,class_id AS classId,student_id AS studentId,subject_id AS subjectId,status,method,arrival_time AS arrivalTime,departure_time AS departureTime,reason,version,entered_by AS enteredBy,entered_at AS enteredAt,updated_at AS updatedAt FROM student_attendance WHERE id=?', [id]))[0]);
  }
  async function saveStaffAttendance(entry, actor) {
    const id = randomUUID(); const timestamp = now();
    try { await adapter.execute('INSERT INTO staff_attendance (id,school_id,academic_year,term,staff_id,attendance_date,attendance_type,attendance_time,entered_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)', [id, actor.schoolId, entry.academicYear, entry.term, entry.staffId, entry.date, entry.type, entry.time ?? timestamp, actor.userId, timestamp]); } catch (error) { if (/duplicate|unique|1062/i.test(error.message)) throw new Error('Staff attendance already recorded'); throw error; }
    return staffRow((await adapter.query('SELECT id,school_id AS schoolId,academic_year AS academicYear,term,staff_id AS staffId,attendance_date AS date,attendance_type AS type,attendance_time AS time,entered_by AS enteredBy,created_at AS createdAt FROM staff_attendance WHERE id=?', [id]))[0]);
  }
  async function listStudentRecords(filters = {}) { const conditions = ['school_id=?']; const params = [filters.schoolId]; for (const [column, value] of [['academic_year', filters.academicYear], ['term', filters.term], ['attendance_date', filters.date], ['class_id', filters.classId], ['student_id', filters.studentId]]) if (value) { conditions.push(`${column}=?`); params.push(value); } const result = await adapter.query(`SELECT id,school_id AS schoolId,academic_year AS academicYear,term,attendance_date AS date,class_id AS classId,student_id AS studentId,subject_id AS subjectId,status,method,arrival_time AS arrivalTime,departure_time AS departureTime,reason,version,entered_by AS enteredBy,entered_at AS enteredAt,updated_at AS updatedAt FROM student_attendance WHERE ${conditions.join(' AND ')} ORDER BY attendance_date,student_id`, params); return rows(result).map(attendanceRow); }
  async function listStaffRecords(filters = {}) { const conditions = ['school_id=?']; const params = [filters.schoolId]; for (const [column, value] of [['academic_year', filters.academicYear], ['term', filters.term], ['attendance_date', filters.date], ['staff_id', filters.staffId]]) if (value) { conditions.push(`${column}=?`); params.push(value); } const result = await adapter.query(`SELECT id,school_id AS schoolId,academic_year AS academicYear,term,staff_id AS staffId,attendance_date AS date,attendance_type AS type,attendance_time AS time,entered_by AS enteredBy,created_at AS createdAt FROM staff_attendance WHERE ${conditions.join(' AND ')} ORDER BY attendance_date,staff_id`, params); return rows(result).map(staffRow); }
  return { saveStudentAttendance, saveStaffAttendance, listStudentRecords, listStaffRecords };
}

export default createAttendanceRepository;
