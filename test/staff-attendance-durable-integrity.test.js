import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceRepository } from '../src/attendance-repository.js';

const actor = { id: 'hr-user-1', schoolId: 'school-1' };
const entry = (overrides = {}) => ({ schoolId: 'school-1', academicYear: '2026/2027', term: 'First Term', date: '2026-10-10', staffId: 'staff-1', type: 'CHECKED_IN', status: 'PRESENT', source: 'MANUAL', time: '08:00', note: 'On time', ...overrides });

function database({ transactions = true, failAudit = false } = {}) {
  const records = new Map();
  const audits = [];
  const executeLog = [];
  let queue = Promise.resolve();

  function makeAdapter(withTransaction) {
    const adapter = {
      async query(sql, params = []) {
        if (sql.includes('FROM staff_attendance') && sql.includes('WHERE id=? AND school_id=?')) {
          const record = records.get(params[0]);
          return record?.schoolId === params[1] ? [{ ...record }] : [];
        }
        if (sql.includes('FROM staff_attendance') && sql.includes('WHERE school_id=?')) {
          return [...records.values()].filter((record) => record.schoolId === params[0]).map((record) => ({ ...record }));
        }
        return [];
      },
      async execute(sql, params = []) {
        executeLog.push({ sql, params });
        if (sql.startsWith('INSERT INTO staff_attendance')) {
          const [id, schoolId, academicYear, term, staffId, date, type, status, attendanceSource, leaveRequestId, note, previousStatus, time, enteredBy, createdAt, recordedBy, recordedAt, updatedBy, updatedAt, source] = params;
          if (records.has(id)) throw Object.assign(new Error('Duplicate entry for primary key'), { code: 'ER_DUP_ENTRY' });
          const duplicate = [...records.values()].some((record) => record.schoolId === schoolId && record.academicYear === academicYear && record.term === term && record.date === date && record.staffId === staffId && record.type === type);
          if (duplicate) throw Object.assign(new Error('Duplicate entry for uq_staff_attendance_scope_identity'), { code: 'ER_DUP_ENTRY' });
          records.set(id, { id, schoolId, academicYear, term, staffId, date, type, status, attendanceSource, source, leaveRequestId, note, previousStatus, time, enteredBy, createdAt, recordedBy, recordedAt, updatedBy, updatedAt });
          return { affectedRows: 1 };
        }
        if (sql.startsWith('UPDATE staff_attendance')) {
          const [academicYear, term, date, type, status, attendanceSource, leaveRequestId, note, previousStatus, time, updatedBy, updatedAt, source, id, schoolId, expectedUpdatedAt] = params;
          const current = records.get(id);
          if (!current || current.schoolId !== schoolId || current.updatedAt !== expectedUpdatedAt) return { affectedRows: 0 };
          records.set(id, { ...current, academicYear, term, date, type, status, attendanceSource, leaveRequestId, note, previousStatus, time, updatedBy, updatedAt, source });
          return { affectedRows: 1 };
        }
        if (sql.startsWith('INSERT INTO attendance_audit_history')) {
          if (failAudit) throw new Error('simulated audit storage outage');
          const [id, schoolId, attendanceRecordId, personId, personType, previousStatus, newStatus, previousReason, newReason, changedBy, changedAt, source, action] = params;
          audits.push({ id, schoolId, attendanceRecordId, personId, personType, previousStatus, newStatus, previousReason, newReason, changedBy, changedAt, source, action });
          return { affectedRows: 1 };
        }
        return { affectedRows: 1 };
      }
    };

    if (withTransaction) adapter.transaction = async (work) => {
      const prior = queue;
      let release;
      queue = new Promise((resolve) => { release = resolve; });
      await prior;
      const recordsBefore = new Map([...records].map(([key, value]) => [key, structuredClone(value)]));
      const auditsBefore = structuredClone(audits);
      try { return await work(makeAdapter(false)); }
      catch (error) {
        records.clear();
        for (const [key, value] of recordsBefore) records.set(key, value);
        audits.splice(0, audits.length, ...auditsBefore);
        throw error;
      } finally { release(); }
    };
    return adapter;
  }

  return { adapter: makeAdapter(transactions), records, audits, executeLog };
}

test('durable Staff Attendance saves and their audit events commit atomically', async () => {
  const db = database();
  const repository = createAttendanceRepository({ adapter: db.adapter, now: () => '2026-10-10T10:00:00.000Z' });
  const saved = await repository.saveStaffAttendance(entry(), actor);
  assert.equal(saved.schoolId, actor.schoolId);
  assert.equal(saved.staffId, 'staff-1');
  assert.equal(saved.status, 'PRESENT');
  assert.equal(saved.type, 'CHECKED_IN');
  assert.equal(db.records.size, 1);
  assert.equal(db.audits.length, 1);
  assert.equal(db.audits[0].personType, 'STAFF');
  assert.equal(db.audits[0].action, 'CREATE');
  assert.equal(db.audits[0].newReason, 'On time');
  assert.ok(db.executeLog.some(({ sql }) => sql.startsWith('INSERT INTO attendance_audit_history')));
});

test('same-status staff corrections that change note/time create a complete audit event', async () => {
  const db = database();
  const repository = createAttendanceRepository({ adapter: db.adapter, now: () => '2026-10-10T10:00:00.000Z' });
  const original = await repository.saveStaffAttendance(entry(), actor);
  const updated = await repository.saveStaffAttendance(entry({ id: original.id, time: '08:30', note: 'Clock corrected' }), actor);
  assert.equal(updated.id, original.id);
  assert.equal(db.records.size, 1);
  assert.equal(db.audits.length, 2);
  assert.equal(db.audits[1].action, 'UPDATE');
  assert.equal(db.audits[1].previousStatus, 'PRESENT');
  assert.equal(db.audits[1].newStatus, 'PRESENT');
  assert.equal(db.audits[1].previousReason, 'On time');
  assert.equal(db.audits[1].newReason, 'Clock corrected');
});

test('concurrent duplicate staff submissions cannot create two records', async () => {
  const db = database();
  const repository = createAttendanceRepository({ adapter: db.adapter, now: () => '2026-10-10T10:00:00.000Z' });
  const outcomes = await Promise.allSettled([repository.saveStaffAttendance(entry(), actor), repository.saveStaffAttendance(entry(), actor)]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.match(rejected.reason.message, /already recorded/i);
  assert.equal(db.records.size, 1);
  assert.equal(db.audits.length, 1);
});

test('concurrent stale staff updates serialize and only the first matching version can commit', async () => {
  const db = database();
  let minute = 0;
  const repository = createAttendanceRepository({ adapter: db.adapter, now: () => `2026-10-10T10:${String(minute++).padStart(2, '0')}:00.000Z` });
  const original = await repository.saveStaffAttendance(entry(), actor);
  const outcomes = await Promise.allSettled([
    repository.upsertStaffAttendance(entry({ id: original.id, expectedUpdatedAt: original.updatedAt, note: 'First correction' }), actor, { forceStatus: true }),
    repository.upsertStaffAttendance(entry({ id: original.id, expectedUpdatedAt: original.updatedAt, note: 'Stale correction' }), actor, { forceStatus: true })
  ]);
  assert.equal(outcomes.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'STAFF_ATTENDANCE_VERSION_CONFLICT');
  assert.equal(rejected.reason.status, 409);
  assert.equal(db.records.size, 1);
  assert.equal(db.audits.length, 2);
  assert.ok(['First correction', 'Stale correction'].includes(db.records.get(original.id).note));
});

test('partial staff updates preserve omitted fields and explicit null clears them', async () => {
  const db = database();
  let minute = 0;
  const repository = createAttendanceRepository({ adapter: db.adapter, now: () => `2026-10-10T11:${String(minute++).padStart(2, '0')}:00.000Z` });
  const original = await repository.saveStaffAttendance(entry(), actor);
  const partial = entry({ id: original.id, expectedUpdatedAt: original.updatedAt });
  delete partial.time;
  delete partial.note;
  const preserved = await repository.saveStaffAttendance(partial, actor);
  assert.equal(preserved.time, '08:00');
  assert.equal(preserved.note, 'On time');
  const cleared = await repository.saveStaffAttendance(entry({ id: preserved.id, expectedUpdatedAt: preserved.updatedAt, time: null, note: null }), actor);
  assert.equal(cleared.time, null);
  assert.equal(cleared.note, null);
});

test('audit-storage failure rolls back the staff record instead of committing partial attendance', async () => {
  const db = database({ failAudit: true });
  const repository = createAttendanceRepository({ adapter: db.adapter, now: () => '2026-10-10T10:00:00.000Z' });
  await assert.rejects(repository.saveStaffAttendance(entry(), actor), /simulated audit storage outage/);
  assert.equal(db.records.size, 0);
  assert.equal(db.audits.length, 0);
});

test('durable staff writes fail closed when the database adapter cannot provide transactions', async () => {
  const db = database({ transactions: false });
  const repository = createAttendanceRepository({ adapter: db.adapter });
  await assert.rejects(repository.saveStaffAttendance(entry(), actor), (error) => error.code === 'STAFF_ATTENDANCE_TRANSACTION_UNAVAILABLE' && error.status === 503);
  assert.equal(db.records.size, 0);
});

test('body-supplied school IDs are ignored and a different school cannot update another school row', async () => {
  const db = database();
  const repository = createAttendanceRepository({ adapter: db.adapter });
  const created = await repository.saveStaffAttendance(entry(), actor);
  const spoofed = await repository.saveStaffAttendance(entry({ staffId: 'staff-2', schoolId: 'school-2' }), actor);
  assert.equal(spoofed.schoolId, actor.schoolId);
  await assert.rejects(repository.saveStaffAttendance(entry({ id: created.id, schoolId: 'school-2', note: 'foreign update' }), { ...actor, schoolId: 'school-2' }), /already recorded/i);
  assert.equal(db.records.size, 2);
  assert.equal(db.records.get(created.id).schoolId, actor.schoolId);
  assert.equal(db.records.get(created.id).note, 'On time');
  assert.equal(db.audits.length, 2);
});
