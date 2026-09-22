import { decideStaffLeaveAttendance, reconciliationDates } from './staff-leave-reconciliation.js';

const PRIORITY = ['PRESENT', 'CHECKED_IN', 'LATE', 'ABSENT', 'ON_LEAVE', 'EXCUSED', 'CHECKED_OUT'];

function chooseRow(rows, date) {
  return rows.filter((row) => row.date === date).sort((a, b) => PRIORITY.indexOf(a.status) - PRIORITY.indexOf(b.status))[0] ?? null;
}

export function createStaffLeaveReconciler({ attendance, now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight', audit = () => {} } = {}) {
  if (!attendance?.listStaffRecords || !attendance?.upsertStaffAttendance) throw new Error('A staff attendance service is required.');
  const memoryAudit = [];

  async function reconcileLeave(leave, actor = {}) {
    if (!leave?.id) throw new Error('Leave request is required');
    const effectiveSchoolId = leave.schoolId ?? actor.schoolId ?? schoolId;
    const allRows = await Promise.resolve(attendance.listStaffRecords({ schoolId: effectiveSchoolId, staffId: leave.staffId }));
    const linkedRows = allRows.filter((row) => row.leaveRequestId === leave.id);
    const scopedRows = allRows.filter((row) => row.academicYear === leave.academicYear && row.term === leave.term);
    const dates = reconciliationDates(leave, linkedRows.map((row) => row.date));
    const processed = [];

    for (const date of dates) {
      const existing = chooseRow([...scopedRows, ...linkedRows], date);
      const inApprovedRange = leave.state === 'APPROVED' && date >= leave.startsOn && date <= leave.endsOn && (leave.academicYear === (existing?.academicYear ?? leave.academicYear)) && (leave.term === (existing?.term ?? leave.term));
      const decision = decideStaffLeaveAttendance({ leaveState: leave.state, existing, leaveRequestId: leave.id, dateInApprovedRange: inApprovedRange });
      if (decision.action === 'NOOP') continue;
      const targetScope = existing ?? { academicYear: leave.academicYear, term: leave.term };
      const next = await Promise.resolve(attendance.upsertStaffAttendance({
        academicYear: targetScope.academicYear ?? 'UNSPECIFIED',
        term: targetScope.term ?? 'UNSPECIFIED',
        staffId: leave.staffId,
        date,
        type: decision.type,
        status: decision.status,
        source: decision.source,
        leaveRequestId: decision.linkLeave ? leave.id : null,
        previousStatus: existing?.status ?? null,
        note: decision.reason,
      }, { userId: actor.userId ?? 'leave-reconciliation', schoolId: effectiveSchoolId }, { forceStatus: true }));
      const auditRecord = { schoolId: effectiveSchoolId, leaveRequestId: leave.id, staffAttendanceId: next?.id ?? existing?.id ?? null, date, action: decision.action, previousStatus: existing?.status ?? null, nextStatus: decision.status, details: `${decision.reason} Date: ${date}.`, actorId: actor.userId ?? null, createdAt: now() };
      if (typeof attendance.writeReconciliationAudit === 'function') await attendance.writeReconciliationAudit(auditRecord);
      else memoryAudit.push({ id: `${leave.id}:${date}:${memoryAudit.length + 1}`, ...auditRecord });
      audit(auditRecord);
      processed.push({ date, action: decision.action, status: decision.status, attendance: next });
    }
    return { leaveRequestId: leave.id, state: leave.state, processedDates: dates.length, changes: processed };
  }

  async function auditFor(leaveRequestId, requestedSchoolId = schoolId) {
    if (typeof attendance.listReconciliationAudit === 'function') return attendance.listReconciliationAudit({ schoolId: requestedSchoolId, leaveRequestId });
    return memoryAudit.filter((entry) => entry.leaveRequestId === leaveRequestId).map((entry) => ({ ...entry }));
  }

  return { reconcileLeave, auditFor };
}

export default createStaffLeaveReconciler;
