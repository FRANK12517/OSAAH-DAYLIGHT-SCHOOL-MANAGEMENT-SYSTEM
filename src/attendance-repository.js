import { randomUUID } from 'node:crypto';
import { STUDENT_STATUSES, ATTENDANCE_METHODS, ATTENDANCE_SOURCES } from './attendance.js';
import { statusFromStaffAttendanceType, typeFromStaffAttendanceStatus, STAFF_ATTENDANCE_STATUSES } from './staff-leave-reconciliation.js';

function rows(value) { return Array.isArray(value) ? value : []; }
function actorId(actor) { const id = actor?.userId ?? actor?.id; if (!String(id ?? '').trim()) throw new Error('Authenticated user is required'); return id; }
function assertActor(actor, schoolId) { if (!actor?.schoolId || actor.schoolId !== schoolId) throw new Error('Forbidden.'); return actorId(actor); }
function date(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '')) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error('Invalid attendance date'); return value; }
function source(value) { const result = String(value ?? 'MANUAL').toUpperCase(); if (!ATTENDANCE_SOURCES.includes(result)) throw new Error('Invalid attendance source'); return result; }
function time(value, label) { if (value == null || value === '') return null; if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value))) throw new Error(`Invalid ${label}`); return String(value); }
function staffTime(value) { if (value == null || value === '') return null; const result = String(value); if (/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(result) || !Number.isNaN(Date.parse(result))) return result; throw new Error('Invalid attendance time'); }
function timestampMillis(value) { const result = value instanceof Date ? value.getTime() : Date.parse(String(value ?? '')); return Number.isFinite(result) ? result : null; }
function isMissingAttendanceDateColumn(error) {
  const code = String(error?.code ?? '').toUpperCase();
  const message = String(error?.message ?? error?.sqlMessage ?? '');
  return ['ER_BAD_FIELD_ERROR', 'ER_UNKNOWN_COLUMN', '42703', '42S22'].includes(code)
    && /unknown column|column .* does not exist/i.test(message)
    && /\battendance_date\b/i.test(message);
}
function validateReason(status, value) { if (['ABSENT', 'LATE', 'EARLY_DEPARTURE', 'EXCUSED_ABSENCE', 'UNEXCUSED_ABSENCE', 'SICK_ABSENCE'].includes(status) && !String(value ?? '').trim()) throw new Error(`Reason is required for ${status}`); }
function attendanceRow(row) { return { id: row.id, schoolId: row.schoolId ?? row.school_id, academicYear: row.academicYear ?? row.academic_year, term: row.term, date: row.date ?? row.attendance_date, classId: row.classId ?? row.class_id, studentId: row.studentId ?? row.student_id, subjectId: row.subjectId ?? row.subject_id ?? null, status: row.status, method: row.method, arrivalTime: row.arrivalTime ?? row.arrival_time ?? null, departureTime: row.departureTime ?? row.departure_time ?? null, reason: row.reason ?? null, version: Number(row.version ?? 1), recordedBy: row.recordedBy ?? row.recorded_by ?? row.enteredBy ?? row.entered_by, recordedAt: row.recordedAt ?? row.recorded_at ?? row.enteredAt ?? row.entered_at, updatedBy: row.updatedBy ?? row.updated_by ?? row.enteredBy ?? row.entered_by, updatedAt: row.updatedAt ?? row.updated_at, source: row.source ?? 'MANUAL', enteredBy: row.enteredBy ?? row.entered_by ?? row.recordedBy ?? row.recorded_by, enteredAt: row.enteredAt ?? row.entered_at ?? row.recordedAt ?? row.recorded_at }; }
function staffRow(row) { const type = row.type ?? row.attendance_type; const status = String(row.status ?? row.attendance_status ?? statusFromStaffAttendanceType(type) ?? '').toUpperCase(); return { id: row.id, schoolId: row.schoolId ?? row.school_id, academicYear: row.academicYear ?? row.academic_year, term: row.term, staffId: row.staffId ?? row.staff_id, date: row.date ?? row.attendance_date, type: type ?? typeFromStaffAttendanceStatus(status), status, source: row.source ?? row.attendance_source ?? 'MANUAL', leaveRequestId: row.leaveRequestId ?? row.leave_request_id ?? null, note: row.note ?? null, previousStatus: row.previousStatus ?? row.previous_status ?? null, time: row.time !== undefined ? row.time : row.attendance_time ?? null, recordedBy: row.recordedBy ?? row.recorded_by ?? row.enteredBy ?? row.entered_by, recordedAt: row.recordedAt ?? row.recorded_at ?? row.createdAt ?? row.created_at, updatedBy: row.updatedBy ?? row.updated_by ?? row.enteredBy ?? row.entered_by, updatedAt: row.updatedAt ?? row.updated_at ?? row.createdAt ?? row.created_at, enteredBy: row.enteredBy ?? row.entered_by ?? row.recordedBy ?? row.recorded_by, createdAt: row.createdAt ?? row.created_at ?? row.recordedAt ?? row.recorded_at }; }
const STUDENT_SELECT = 'id,school_id AS schoolId,academic_year AS academicYear,term,attendance_date AS date,class_id AS classId,student_id AS studentId,subject_id AS subjectId,status,method,arrival_time AS arrivalTime,departure_time AS departureTime,reason,version,entered_by AS enteredBy,entered_at AS enteredAt,recorded_by AS recordedBy,recorded_at AS recordedAt,updated_by AS updatedBy,updated_at AS updatedAt,source';
const STAFF_SELECT = 'id,school_id AS schoolId,academic_year AS academicYear,term,staff_id AS staffId,attendance_date AS date,attendance_type AS type,attendance_status AS status,attendance_source AS source,leave_request_id AS leaveRequestId,note,previous_status AS previousStatus,attendance_time AS time,entered_by AS enteredBy,created_at AS createdAt,recorded_by AS recordedBy,recorded_at AS recordedAt,updated_by AS updatedBy,updated_at AS updatedAt';
const CANONICAL_STUDENT_COLUMNS = ['id','school_id','academic_year','term','attendance_date','class_id','student_id','subject_id','subject_key','status','method','arrival_time','departure_time','reason','version','entered_by','entered_at','recorded_by','recorded_at','updated_by','updated_at','source'];

function buildAttendanceRepository({ adapter, now, insideTransaction }) {
  if (!adapter?.query || !adapter?.execute) throw new Error('A durable database adapter is required.');
  let cachedStudentColumns;
  async function studentAttendanceColumns() {
    if (cachedStudentColumns !== undefined) return cachedStudentColumns;
    const found = rows(await adapter.query("SELECT COLUMN_NAME AS columnName FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='student_attendance'"));
    cachedStudentColumns = found.length ? new Set(found.map((row) => String(row.columnName ?? row.COLUMN_NAME ?? '').toLowerCase())) : null;
    return cachedStudentColumns;
  }
  function has(columns, name) { return columns?.has(name) === true; }
  function attendanceProjection(columns) {
    const dateColumn = has(columns, 'attendance_date') ? 'attendance_date' : has(columns, 'date') ? 'date' : null;
    const required = ['id','school_id','academic_year','term','class_id','student_id','status'];
    if (!dateColumn || required.some((column) => !has(columns, column))) throw Object.assign(new Error('The student attendance table is missing required identity or period columns.'), { status: 503, code: 'ATTENDANCE_SCHEMA_INCOMPLETE' });
    const expression = (column, alias, fallback = 'NULL') => has(columns, column) ? `\`${column}\`${alias ? ` AS ${alias}` : ''}` : `${fallback}${alias ? ` AS ${alias}` : ''}`;
    return {
      dateColumn,
      select: [expression('id'),expression('school_id','schoolId'),expression('academic_year','academicYear'),expression('term'),expression(dateColumn,'date'),expression('class_id','classId'),expression('student_id','studentId'),expression('subject_id','subjectId'),expression('status'),expression('method','method',"'MANUAL'"),expression('arrival_time','arrivalTime'),expression('departure_time','departureTime'),expression('reason'),expression('version','version','1'),expression('entered_by','enteredBy'),expression('entered_at','enteredAt'),expression('recorded_by','recordedBy'),expression('recorded_at','recordedAt'),expression('updated_by','updatedBy'),expression('updated_at','updatedAt'),expression('source','source',"'MANUAL'")].join(',')
    };
  }
  async function listStudentRecordsForSchema(filters = {}, columns) {
    const projection = attendanceProjection(columns);
    const conditions = ['school_id=?']; const params = [filters.schoolId];
    for (const [column, value] of [['academic_year',filters.academicYear],['term',filters.term],[projection.dateColumn,filters.date],['class_id',filters.classId],['student_id',filters.studentId]]) if (value && has(columns,column)) { conditions.push(`\`${column}\`=?`); params.push(value); }
    const result = await adapter.query(`SELECT ${projection.select} FROM student_attendance WHERE ${conditions.join(' AND ')} ORDER BY \`${projection.dateColumn}\`,student_id`, params);
    return rows(result).map(attendanceRow);
  }
  async function findStudentAttendanceForSchema(entry, actor, columns) {
    const projection = attendanceProjection(columns);
    const conditions = ['school_id=?','academic_year=?','term=?','`' + projection.dateColumn + '`=?','class_id=?','student_id=?'];
    const params = [actor.schoolId,entry.academicYear,entry.term,date(entry.date),entry.classId,entry.studentId];
    if (has(columns,'subject_key')) { conditions.push('subject_key=?'); params.push(entry.subjectId ?? 'daily'); }
    return rows(await adapter.query(`SELECT ${projection.select} FROM student_attendance WHERE ${conditions.join(' AND ')} LIMIT 1`,params))[0] ?? null;
  }

  async function saveStudentAttendanceForSchema(entry, actor, options, columns) {
    const schoolId = actor.schoolId; assertActor(actor, schoolId);
    const status = String(entry.status ?? '').toUpperCase();
    const method = String(entry.method ?? 'MANUAL').toUpperCase();
    if (!STUDENT_STATUSES.includes(status)) throw new Error('Invalid attendance status');
    if (!ATTENDANCE_METHODS.includes(method)) throw new Error('Invalid attendance method');
    const attendanceDate = date(entry.date);
    const reason = entry.reason == null || String(entry.reason).trim() === '' ? null : String(entry.reason).trim();
    validateReason(status, reason);
    if (!has(columns,'reason') && reason) throw Object.assign(new Error('This attendance schema cannot store a reason yet. Apply the attendance compatibility migration before recording reason-required marks.'), { status: 503, code: 'ATTENDANCE_REASON_SCHEMA_UNAVAILABLE' });
    const existing = await findStudentAttendanceForSchema(entry, actor, columns);
    const correction = Boolean(options.correction);
    const expectedVersion = options.expectedVersion == null ? null : Number(options.expectedVersion);
    if (existing && !correction) throw Object.assign(new Error('Attendance already recorded'), { status: 409, code: 'ATTENDANCE_DUPLICATE' });
    if (existing && expectedVersion == null) throw Object.assign(new Error('Attendance version is required for a correction.'), { status: 409, code: 'ATTENDANCE_VERSION_REQUIRED' });
    if (existing && expectedVersion !== Number(existing.version ?? 1)) throw Object.assign(new Error('Attendance conflict: server record is newer'), { status: 409, code: 'ATTENDANCE_VERSION_CONFLICT' });
    if (!existing && expectedVersion != null) throw Object.assign(new Error('Attendance conflict: the server record no longer exists.'), { status: 409, code: 'ATTENDANCE_VERSION_CONFLICT' });
    const timestamp = now();
    const id = existing?.id ?? randomUUID();
    if (existing) {
      const values = new Map([
        ['status',status],['method',method],['arrival_time',time(entry.arrivalTime,'arrival time')],['departure_time',time(entry.departureTime,'departure time')],['reason',reason],['updated_by',actorId(actor)],['updated_at',timestamp],['source',source(entry.source)]
      ]);
      const sets = [];
      const params = [];
      for (const [column,value] of values) if (has(columns,column)) { sets.push(`\`${column}\`=?`); params.push(value); }
      if (has(columns,'version')) sets.push('version=version+1');
      const where = ['id=?','school_id=?']; params.push(id,schoolId);
      if (has(columns,'version')) { where.push('version=?'); params.push(existing.version); }
      const result = await adapter.execute(`UPDATE student_attendance SET ${sets.join(',')} WHERE ${where.join(' AND ')}`,params);
      if (Number(result?.affectedRows ?? result?.changes ?? result?.rowCount ?? 0) !== 1) throw Object.assign(new Error('Attendance conflict: server record is newer'), { status: 409, code: 'ATTENDANCE_VERSION_CONFLICT' });
    } else {
      const values = new Map([
        ['id',id],['school_id',schoolId],['academic_year',entry.academicYear],['term',entry.term],['attendance_date',attendanceDate],['date',attendanceDate],['class_id',entry.classId],['student_id',entry.studentId],['subject_id',entry.subjectId ?? null],['subject_key',entry.subjectId ?? 'daily'],['status',status],['method',method],['arrival_time',time(entry.arrivalTime,'arrival time')],['departure_time',time(entry.departureTime,'departure time')],['reason',reason],['version',1],['entered_by',actorId(actor)],['entered_at',timestamp],['created_at',timestamp],['recorded_by',actorId(actor)],['recorded_at',timestamp],['updated_by',actorId(actor)],['updated_at',timestamp],['source',source(entry.source)]
      ]);
      const fields = [...values].filter(([column]) => has(columns,column));
      await adapter.execute(`INSERT INTO student_attendance (${fields.map(([column]) => `\`${column}\``).join(',')}) VALUES (${fields.map(() => '?').join(',')})`,fields.map(([,value]) => value));
    }
    const persisted = rows(await adapter.query(`SELECT ${attendanceProjection(columns).select} FROM student_attendance WHERE id=? AND school_id=?`, [id, schoolId]))[0];
    if (!persisted) throw new Error('Attendance record could not be read after saving.');
    const record = attendanceRow(persisted);
    await writeAudit(record, existing ? attendanceRow(existing) : null, actor, 'STUDENT');
    return record;
  }

  async function writeAudit(record, previous, actor, personType) {
    if (previous) {
      const unchanged = personType === 'STAFF'
        ? previous.status === record.status && previous.note === record.note && previous.time === record.time && previous.source === record.source && previous.leaveRequestId === record.leaveRequestId && previous.previousStatus === record.previousStatus
        : previous.status === record.status && previous.reason === record.reason && previous.arrivalTime === record.arrivalTime && previous.departureTime === record.departureTime;
      if (unchanged) return;
    }
    const previousReason = personType === 'STAFF' ? previous?.note ?? null : previous?.reason ?? null;
    const newReason = personType === 'STAFF' ? record.note ?? null : record.reason ?? null;
    try {
      await adapter.execute('INSERT INTO attendance_audit_history (id,school_id,attendance_record_id,person_id,person_type,previous_status,new_status,previous_reason,new_reason,changed_by,changed_at,source,action) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)', [randomUUID(), record.schoolId, record.id, record.studentId ?? record.staffId, personType, previous?.status ?? null, record.status, previousReason, newReason, actorId(actor), record.updatedAt, record.source, previous ? 'UPDATE' : 'CREATE']);
    } catch (error) {
      const message = String(error?.message ?? error?.sqlMessage ?? '');
      if (!/attendance_audit_history|unknown column|doesn't exist|does not exist|no such table/i.test(message)) throw error;
    }
  }

  async function saveStudentAttendance(entry, actor, { correction = false, expectedVersion = null } = {}) {
    const schoolId = actor.schoolId; assertActor(actor, schoolId);
    const columns = await studentAttendanceColumns();
    if (columns && CANONICAL_STUDENT_COLUMNS.some((column) => !has(columns, column))) {
      return saveStudentAttendanceForSchema(entry, actor, { correction, expectedVersion }, columns);
    }
    if (!STUDENT_STATUSES.includes(String(entry.status ?? '').toUpperCase())) throw new Error('Invalid attendance status');
    if (!ATTENDANCE_METHODS.includes(String(entry.method ?? 'MANUAL').toUpperCase())) throw new Error('Invalid attendance method');
    const timestamp = now();
    const params = [schoolId, entry.academicYear, entry.term, date(entry.date), entry.classId, entry.studentId, entry.subjectId ?? 'daily'];
    const existing = rows(await adapter.query(`SELECT ${STUDENT_SELECT} FROM student_attendance WHERE school_id=? AND academic_year=? AND term=? AND attendance_date=? AND class_id=? AND student_id=? AND subject_key=? LIMIT 1`, params))[0];
    if (existing && !correction) throw new Error('Attendance already recorded');
    if (existing && expectedVersion == null) throw Object.assign(new Error('Attendance version is required for a correction.'), { status: 409, code: 'ATTENDANCE_VERSION_REQUIRED' });
    if (existing && Number(existing.version) !== Number(expectedVersion)) throw Object.assign(new Error('Attendance conflict: server record is newer'), { status: 409, code: 'ATTENDANCE_VERSION_CONFLICT' });
    if (!existing && expectedVersion != null) throw Object.assign(new Error('Attendance conflict: the server record no longer exists.'), { status: 409, code: 'ATTENDANCE_VERSION_CONFLICT' });
    const id = existing?.id ?? randomUUID(); const status = String(entry.status).toUpperCase(); const method = String(entry.method ?? 'MANUAL').toUpperCase();
    const arrival = time(entry.arrivalTime, 'arrival time'); const departure = time(entry.departureTime, 'departure time');
    const reason = entry.reason == null || String(entry.reason).trim() === '' ? null : String(entry.reason).trim(); validateReason(status, reason);
    try {
      if (existing) {
        const update = await adapter.execute('UPDATE student_attendance SET status=?,method=?,arrival_time=?,departure_time=?,reason=?,version=version+1,updated_by=?,updated_at=?,source=? WHERE id=? AND school_id=? AND version=?', [status, method, arrival, departure, reason, actorId(actor), timestamp, source(entry.source), id, schoolId, existing.version]);
        if (Number(update?.affectedRows ?? update?.changes ?? update?.rowCount ?? 0) !== 1) throw Object.assign(new Error('Attendance conflict: server record is newer'), { status: 409, code: 'ATTENDANCE_VERSION_CONFLICT' });
      } else {
        await adapter.execute('INSERT INTO student_attendance (id,school_id,academic_year,term,attendance_date,class_id,student_id,subject_id,subject_key,status,method,arrival_time,departure_time,reason,version,entered_by,entered_at,recorded_by,recorded_at,updated_by,updated_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, schoolId, entry.academicYear, entry.term, entry.date, entry.classId, entry.studentId, entry.subjectId ?? null, entry.subjectId ?? 'daily', status, method, arrival, departure, reason, 1, actorId(actor), timestamp, actorId(actor), timestamp, actorId(actor), timestamp, source(entry.source)]);
      }
    } catch (error) {
      if (/duplicate|unique|1062/i.test(error.message)) throw Object.assign(new Error(existing ? 'Attendance conflict: server record is newer' : 'Attendance already recorded'), { status: 409, code: existing ? 'ATTENDANCE_VERSION_CONFLICT' : 'ATTENDANCE_DUPLICATE' });
      throw error;
    }
    const record = attendanceRow(rows(await adapter.query(`SELECT ${STUDENT_SELECT} FROM student_attendance WHERE id=? AND school_id=?`, [id, schoolId]))[0]);
    if (!record?.id) throw new Error('Attendance record could not be read after saving.');
    await writeAudit(record, existing ? attendanceRow(existing) : null, actor, 'STUDENT');
    return record;
  }

  async function saveStudentAttendanceBatch(entries, actor, options = {}) {
    if (!Array.isArray(entries) || !entries.length) throw Object.assign(new Error('At least one attendance entry is required.'), { status: 400 });
    const optionsFor = (entry) => typeof options === 'function' ? options(entry) : options;
    if (adapter.transaction) return adapter.transaction(async (tx) => {
      const transactional = buildAttendanceRepository({ adapter: tx, now, insideTransaction: true });
      const saved = [];
      for (const entry of entries) saved.push(await transactional.saveStudentAttendance(entry, actor, optionsFor(entry)));
      return saved;
    });
    if (entries.length > 1) throw Object.assign(new Error('Attendance batch transactions are unavailable.'), { status: 503, code: 'ATTENDANCE_TRANSACTION_UNAVAILABLE' });
    return [await saveStudentAttendance(entries[0], actor, optionsFor(entries[0]))];
  }

  async function persistStaffAttendance(entry, actor) {
    const schoolId = actor.schoolId; assertActor(actor, schoolId);
    const existing = entry.id ? rows(await adapter.query(`SELECT ${STAFF_SELECT} FROM staff_attendance WHERE id=? AND school_id=? LIMIT 1 FOR UPDATE`, [entry.id, schoolId]))[0] : null;
    if (existing && entry.expectedUpdatedAt != null) {
      const expectedAt = timestampMillis(entry.expectedUpdatedAt);
      const currentAt = timestampMillis(existing.updatedAt);
      if (expectedAt == null || currentAt == null || expectedAt !== currentAt) throw Object.assign(new Error('Staff attendance record has changed.'), { status: 409, code: 'STAFF_ATTENDANCE_VERSION_CONFLICT' });
    }
    const id = existing?.id ?? entry.id ?? randomUUID(); const timestamp = now();
    const type = String(entry.type ?? typeFromStaffAttendanceStatus(entry.status) ?? '').toUpperCase();
    const status = String(entry.status ?? statusFromStaffAttendanceType(type) ?? '').toUpperCase();
    if (!STAFF_ATTENDANCE_STATUSES.includes(status)) throw new Error('Invalid staff attendance status');
    date(entry.date); const normalizedSource = source(entry.source);
    const leaveRequestId = Object.hasOwn(entry, 'leaveRequestId') ? entry.leaveRequestId ?? null : existing?.leaveRequestId ?? null;
    const note = Object.hasOwn(entry, 'note') ? entry.note == null ? null : String(entry.note) : existing?.note ?? null;
    const previousStatus = Object.hasOwn(entry, 'previousStatus') ? entry.previousStatus ?? null : existing?.previousStatus ?? null;
    const rawTime = Object.hasOwn(entry, 'time') ? entry.time : existing?.time;
    const normalizedTime = rawTime == null || rawTime === '' ? existing ? Object.hasOwn(entry, 'time') ? null : existing.time ?? null : timestamp : staffTime(rawTime);
    try {
      if (existing) {
        const update = await adapter.execute('UPDATE staff_attendance SET academic_year=?,term=?,attendance_date=?,attendance_type=?,attendance_status=?,attendance_source=?,leave_request_id=?,note=?,previous_status=?,attendance_time=?,updated_by=?,updated_at=?,source=? WHERE id=? AND school_id=? AND updated_at=?', [entry.academicYear, entry.term, entry.date, type, status, normalizedSource, leaveRequestId, note, previousStatus, normalizedTime, actorId(actor), timestamp, normalizedSource, id, schoolId, existing.updatedAt]);
        if (Number(update?.affectedRows ?? update?.changes ?? update?.rowCount ?? 0) !== 1) throw Object.assign(new Error('Staff attendance record has changed.'), { status: 409, code: 'STAFF_ATTENDANCE_VERSION_CONFLICT' });
      } else {
        await adapter.execute('INSERT INTO staff_attendance (id,school_id,academic_year,term,staff_id,attendance_date,attendance_type,attendance_status,attendance_source,leave_request_id,note,previous_status,attendance_time,entered_by,created_at,recorded_by,recorded_at,updated_by,updated_at,source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', [id, schoolId, entry.academicYear, entry.term, entry.staffId, entry.date, type, status, normalizedSource, leaveRequestId, note, previousStatus, normalizedTime, actorId(actor), timestamp, actorId(actor), timestamp, actorId(actor), timestamp, normalizedSource]);
      }
    } catch (error) {
      if (error.code === 'STAFF_ATTENDANCE_VERSION_CONFLICT') throw error;
      if (/duplicate|unique|1062/i.test(error.message)) throw Object.assign(new Error('Staff attendance already recorded'), { status: 409, code: 'STAFF_ATTENDANCE_DUPLICATE' });
      throw error;
    }
    const record = staffRow(rows(await adapter.query(`SELECT ${STAFF_SELECT} FROM staff_attendance WHERE id=? AND school_id=?`, [id, schoolId]))[0]);
    if (!record?.id) throw new Error('Staff attendance record could not be read after saving.');
    await writeAudit(record, existing ? staffRow(existing) : null, actor, 'STAFF');
    return record;
  }

  async function saveStaffAttendance(entry, actor) {
    if (insideTransaction) return persistStaffAttendance(entry, actor);
    if (typeof adapter.transaction !== 'function') throw Object.assign(new Error('Staff Attendance writes require a transactional database adapter.'), { status: 503, code: 'STAFF_ATTENDANCE_TRANSACTION_UNAVAILABLE' });
    return adapter.transaction(async (tx) => {
      if (!tx?.query || !tx?.execute) throw Object.assign(new Error('The database transaction adapter is incomplete.'), { status: 503, code: 'STAFF_ATTENDANCE_TRANSACTION_UNAVAILABLE' });
      const transactional = buildAttendanceRepository({ adapter: tx, now, insideTransaction: true });
      return transactional.saveStaffAttendance(entry, actor);
    });
  }

  async function listStudentRecords(filters = {}) {
    const columns = await studentAttendanceColumns();
    if (columns && CANONICAL_STUDENT_COLUMNS.some((column) => !has(columns, column))) return listStudentRecordsForSchema(filters, columns);
    const conditions = ['school_id=?']; const params = [filters.schoolId];
    for (const [column, value] of [['academic_year', filters.academicYear], ['term', filters.term], ['attendance_date', filters.date], ['class_id', filters.classId], ['student_id', filters.studentId]]) if (value) { conditions.push(`${column}=?`); params.push(value); }
    const result = await adapter.query(`SELECT ${STUDENT_SELECT} FROM student_attendance WHERE ${conditions.join(' AND ')} ORDER BY attendance_date,student_id`, params);
    return rows(result).map(attendanceRow);
  }

  // Production may still be on the documented legacy student_attendance schema
  // (date/remarks/created_at) while the additive compatibility migration is
  // pending. Alerts need only these stable identity/context fields; keep that
  // read path available without changing schema or touching attendance rows.
  async function listStudentAlertRecords({ schoolId } = {}) {
    if (!schoolId) throw new Error('School context is required.');
    try {
      const result = await adapter.query(
        `SELECT ${STUDENT_SELECT} FROM student_attendance WHERE school_id=? ORDER BY attendance_date,student_id`,
        [schoolId]
      );
      return rows(result).map(attendanceRow);
    } catch (error) {
      if (!isMissingAttendanceDateColumn(error)) throw error;
      const result = await adapter.query(
        'SELECT id,school_id AS schoolId,academic_year AS academicYear,term,`date` AS date,class_id AS classId,student_id AS studentId,status FROM student_attendance WHERE school_id=? ORDER BY `date`,student_id',
        [schoolId]
      );
      return rows(result).map(attendanceRow);
    }
  }

  async function listStaffRecords(filters = {}) {
    const conditions = ['school_id=?']; const params = [filters.schoolId];
    for (const [column, value] of [['academic_year', filters.academicYear], ['term', filters.term], ['attendance_date', filters.date], ['staff_id', filters.staffId]]) if (value) { conditions.push(`${column}=?`); params.push(value); }
    const result = await adapter.query(`SELECT ${STAFF_SELECT} FROM staff_attendance WHERE ${conditions.join(' AND ')} ORDER BY attendance_date,staff_id`, params);
    return rows(result).map(staffRow);
  }

  async function findStaffAttendance(entry, actor) {
    const records = await listStaffRecords({ schoolId: actor.schoolId, academicYear: entry.academicYear, term: entry.term, date: entry.date, staffId: entry.staffId });
    const priority = ['PRESENT', 'CHECKED_IN', 'LATE', 'ABSENT', 'ON_LEAVE', 'EXCUSED', 'CHECKED_OUT'];
    return records.sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status))[0] ?? null;
  }

  async function upsertStaffAttendance(entry, actor, options = {}) {
    const existing = await findStaffAttendance(entry, actor);
    if (existing && (options.forceStatus || existing.type === entry.type || existing.status === entry.status)) return saveStaffAttendance({ ...entry, id: existing.id }, actor);
    return saveStaffAttendance(entry, actor);
  }

  async function listAuditHistory({ schoolId, attendanceRecordId, personId } = {}, actor) {
    assertActor(actor, schoolId); const conditions = ['school_id=?']; const params = [schoolId];
    if (attendanceRecordId) { conditions.push('attendance_record_id=?'); params.push(attendanceRecordId); }
    if (personId) { conditions.push('person_id=?'); params.push(personId); }
    return rows(await adapter.query(`SELECT id,school_id AS schoolId,attendance_record_id AS attendanceRecordId,person_id AS personId,person_type AS personType,previous_status AS previousStatus,new_status AS newStatus,previous_reason AS previousReason,new_reason AS newReason,changed_by AS changedBy,changed_at AS changedAt,source,action FROM attendance_audit_history WHERE ${conditions.join(' AND ')} ORDER BY changed_at,id`, params));
  }

  return { saveStudentAttendance, saveStudentAttendanceBatch, saveStaffAttendance, upsertStaffAttendance, findStaffAttendance, listStudentRecords, listStudentAlertRecords, listStaffRecords, listAuditHistory };
}

export function createAttendanceRepository({ adapter, now = () => new Date().toISOString() } = {}) {
  return buildAttendanceRepository({ adapter, now, insideTransaction: false });
}

export default createAttendanceRepository;
