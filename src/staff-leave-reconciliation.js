export const LEAVE_STATES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'];
export const STAFF_ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'CHECKED_IN', 'CHECKED_OUT', 'ON_LEAVE', 'EXCUSED'];
export const STAFF_ATTENDANCE_SOURCES = ['MANUAL', 'LEAVE_RECONCILIATION'];

const POSITIVE_STATUSES = new Set(['PRESENT', 'CHECKED_IN', 'LATE']);

export function datesBetweenInclusive(startsOn, endsOn) {
  const start = new Date(`${startsOn}T00:00:00.000Z`);
  const end = new Date(`${endsOn}T00:00:00.000Z`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || start > end) throw new Error('Leave dates are invalid');
  const dates = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
  return dates;
}

export function statusFromStaffAttendanceType(type) {
  return ({ CHECK_IN: 'CHECKED_IN', CHECK_OUT: 'CHECKED_OUT', PRESENT: 'PRESENT', ABSENT: 'ABSENT', LATE: 'LATE', ON_LEAVE: 'ON_LEAVE', EXCUSED: 'EXCUSED' })[String(type ?? '').toUpperCase()] ?? null;
}

export function typeFromStaffAttendanceStatus(status) {
  return ({ CHECKED_IN: 'CHECK_IN', CHECKED_OUT: 'CHECK_OUT', PRESENT: 'PRESENT', ABSENT: 'ABSENT', LATE: 'LATE', ON_LEAVE: 'ON_LEAVE', EXCUSED: 'EXCUSED' })[String(status ?? '').toUpperCase()] ?? null;
}

export function decideStaffLeaveAttendance({ leaveState, existing, leaveRequestId, dateInApprovedRange = true }) {
  const effectiveState = leaveState === 'APPROVED' && dateInApprovedRange ? 'APPROVED' : 'NOT_APPROVED';
  if (effectiveState === 'APPROVED') {
    if (!existing) return { action: 'CREATE', status: 'ON_LEAVE', type: 'ON_LEAVE', source: 'LEAVE_RECONCILIATION', linkLeave: true, reason: 'Approved leave generated an On Leave attendance classification.' };
    if (POSITIVE_STATUSES.has(existing.status)) return { action: 'PRESERVE_CONFLICT', status: existing.status, type: existing.type, source: existing.source, linkLeave: true, reason: `Existing ${existing.status} attendance is preserved; approved leave is recorded as a traceable conflict.` };
    if (existing.status === 'ABSENT') return { action: 'RECLASSIFY', status: 'ON_LEAVE', type: 'ON_LEAVE', source: 'LEAVE_RECONCILIATION', linkLeave: true, reason: 'Approved leave reclassified an unexplained absence as On Leave.' };
    if ((existing.status === 'ON_LEAVE' || existing.status === 'EXCUSED') && existing.leaveRequestId === leaveRequestId) return { action: 'NOOP', status: existing.status, type: existing.type, source: existing.source, linkLeave: true, reason: 'Attendance is already reconciled to this approved leave.' };
    return { action: 'PRESERVE_CONFLICT', status: existing.status, type: existing.type, source: existing.source, linkLeave: false, reason: 'An existing leave or exception classification is preserved to avoid overwriting another explanation.' };
  }

  if (!existing || existing.leaveRequestId !== leaveRequestId) return { action: 'NOOP', status: existing?.status ?? null, type: existing?.type ?? null, source: existing?.source ?? null, linkLeave: false, reason: 'Leave is not approved for this date; no approved-leave attendance is generated.' };
  if (existing.source === 'LEAVE_RECONCILIATION' && existing.status === 'ON_LEAVE') return { action: 'RESTORE', status: 'ABSENT', type: 'ABSENT', source: 'MANUAL', linkLeave: false, reason: 'Generated On Leave attendance was restored to unexplained absence after leave approval ceased.' };
  return { action: 'UNLINK', status: existing.status, type: existing.type, source: existing.source, linkLeave: false, reason: 'Existing attendance is preserved and its leave relationship is removed.' };
}

export function reconciliationDates(leave, linkedDates = []) {
  const desired = leave.state === 'APPROVED' ? datesBetweenInclusive(leave.startsOn, leave.endsOn) : [];
  return [...new Set([...desired, ...linkedDates])].sort();
}
