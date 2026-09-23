import { randomUUID } from 'node:crypto';
import { LEAVE_STATES } from './staff-leave-reconciliation.js';

export { LEAVE_STATES } from './staff-leave-reconciliation.js';

function required(value, label) {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} is required`);
  return result;
}

function validateDateRange(startsOn, endsOn) {
  const start = required(startsOn, 'Leave start date');
  const end = required(endsOn, 'Leave end date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error('Leave dates are invalid');
  return { startsOn: start, endsOn: end };
}

export function createStaffService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight', reconcileLeave = null } = {}) {
  const staff = new Map(); const leave = new Map(); const assignments = [];
  function createProfile(input) { if (!input?.fullName) throw new Error('Full name is required'); const employeeId = input.employeeId ?? `EMP-${String(staff.size + 1).padStart(5, '0')}`; if ([...staff.values()].some((item) => item.employeeId === employeeId)) throw new Error('Employee ID already exists'); const record = { provenance: 'PRODUCTION', employmentStatus: input.employmentStatus ?? 'ACTIVE', id: `STAFF-${String(staff.size + 1).padStart(5, '0')}`, schoolId, staffId: `STAFF-${String(staff.size + 1).padStart(5, '0')}`, employeeId, fullName: input.fullName, photograph: input.photograph ?? null, gender: input.gender ?? null, dateOfBirth: input.dateOfBirth ?? null, phone: input.phone ?? null, address: input.address ?? null, emergencyContact: input.emergencyContact ?? null, departmentId: input.departmentId ?? null, roleKey: input.roleKey ?? null, employmentType: input.employmentType ?? null, appointmentDate: input.appointmentDate ?? null, contract: input.contract ?? null, qualification: input.qualification ?? null, institution: input.institution ?? null, certificates: input.certificates ?? [], ntc: input.ntc ?? null, professionalDevelopment: input.professionalDevelopment ?? [], appraisal: input.appraisal ?? [], promotion: input.promotion ?? [], documents: input.documents ?? [], confidential: input.confidential ?? null, createdAt: now(), updatedAt: now() }; staff.set(record.id, record); return profile(record); }
  function profile(record, { confidential = false } = {}) { const result = JSON.parse(JSON.stringify(record)); if (!confidential) delete result.confidential; return result; }
  function getProfile(id, options = {}) { const record = staff.get(id); return record && record.schoolId === (options.requestedSchoolId ?? schoolId) ? profile(record, options) : null; }
  function assign(staffId, input) { if (!staff.has(staffId)) throw new Error('Staff member not found'); const assignment = { id: randomUUID(), provenance: 'PRODUCTION', schoolId, staffId, subjectId: input.subjectId ?? null, classId: input.classId ?? null, streamId: input.streamId ?? null, departmentId: input.departmentId ?? null, timetableId: input.timetableId ?? null, academicYearId: input.academicYearId ?? null, termId: input.termId ?? null, createdAt: now() }; assignments.push(assignment); return { ...assignment }; }
  function applyLeave(input) { const dates = validateDateRange(input.startsOn, input.endsOn); const record = { id: randomUUID(), schoolId, provenance: 'PRODUCTION', staffId: required(input.staffId, 'Staff member'), academicYear: input.academicYear ?? input.academicYearId ?? null, term: input.term ?? input.termId ?? null, leaveType: required(input.leaveType, 'Leave type'), startsOn: dates.startsOn, endsOn: dates.endsOn, reason: input.reason ?? null, state: 'PENDING', appliedAt: now(), decidedAt: null, decidedBy: null, cancellationReason: null, updatedAt: now() }; leave.set(record.id, record); return { ...record }; }
  function decideLeave(id, state, actor, options = {}) { const record = leave.get(id); if (!record || !LEAVE_STATES.includes(state) || state === 'PENDING') throw new Error('Invalid leave decision'); const previousState = record.state; record.state = state; record.decidedAt = now(); record.decidedBy = actor.userId; record.cancellationReason = state === 'CANCELLED' ? (options.cancellationReason ?? 'Cancelled by an authorized user.') : null; record.updatedAt = now(); const result = { ...record, previousState }; if (typeof reconcileLeave === 'function') result.reconciliation = reconcileLeave({ ...record }, { previousState, actor }); return result; }
  function updateLeave(id, input, actor = null) { const record = leave.get(id); if (!record) throw new Error('Leave request not found'); const dates = validateDateRange(input.startsOn ?? record.startsOn, input.endsOn ?? record.endsOn); const previous = { ...record }; record.startsOn = dates.startsOn; record.endsOn = dates.endsOn; if (input.academicYear !== undefined || input.academicYearId !== undefined) record.academicYear = input.academicYear ?? input.academicYearId ?? null; if (input.term !== undefined || input.termId !== undefined) record.term = input.term ?? input.termId ?? null; if (input.reason !== undefined) record.reason = input.reason; record.updatedAt = now(); return { ...record, previous, changedBy: actor?.userId ?? null }; }
  function listLeave(staffId, filters = {}) { return [...leave.values()].filter((item) => item.schoolId === schoolId && (!staffId || item.staffId === staffId) && (!filters.state || item.state === filters.state) && (!filters.academicYear || item.academicYear === filters.academicYear) && (!filters.term || item.term === filters.term)).map((item) => ({ ...item })); }
  return { createProfile, getProfile, listProfiles: () => [...staff.values()].map((record) => profile(record)), assign, applyLeave, decideLeave, updateLeave, listLeave, assignments: () => assignments.map((item) => ({ ...item })), counts: () => ({ staff: staff.size, leave: leave.size }) };
}
