import { randomUUID } from 'node:crypto';

const clone = (value) => structuredClone(value);

export class FoundationRepositoryError extends Error {
  constructor(code, message, options = {}) { super(message); this.name = 'FoundationRepositoryError'; this.code = code; this.status = options.status ?? (code === 'SCHOOL_SCOPE_VIOLATION' ? 403 : code === 'NOT_FOUND' ? 404 : code === 'CONFLICT' ? 409 : 503); }
}

function requireSchool(schoolId) { if (!schoolId || typeof schoolId !== 'string') throw new FoundationRepositoryError('SCHOOL_SCOPE_VIOLATION', 'School scope is required.', { status: 400 }); return schoolId; }
function safe(value) { return value == null ? null : clone(value); }

export function createFoundationTransactionContext({ stores = new Map() } = {}) {
  const snapshots = new Map();
  return Object.freeze({
    async withTransaction(work) {
      for (const [name, store] of stores) snapshots.set(name, new Map([...store.entries()].map(([key, value]) => [key, clone(value)])));
      try { return await work({ stores }); } catch (error) { for (const [name, snapshot] of snapshots) { const store = stores.get(name); store.clear(); for (const [key, value] of snapshot) store.set(key, clone(value)); } throw error; }
    }
  });
}

export function createMemoryFoundationRepositories({ schoolId = 'school-osaah-daylight' } = {}) {
  const scope = requireSchool(schoolId);
  const stores = new Map(['schools', 'years', 'terms', 'classes', 'students', 'history', 'contacts', 'links', 'subjects', 'subjectClasses', 'assignments'].map((name) => [name, new Map()]));
  const tx = createFoundationTransactionContext({ stores });
  const schoolStructure = Object.freeze({
    async getSchool() { return safe(stores.get('schools').get(scope)); },
    async getAcademicYear(id) { return safe(stores.get('years').get(`${scope}:${id}`)); },
    async listAcademicYears() { return [...stores.get('years').values()].filter((x) => x.schoolId === scope).map(safe); },
    async getTerm(id) { return safe(stores.get('terms').get(`${scope}:${id}`)); },
    async listTerms(yearId = null) { return [...stores.get('terms').values()].filter((x) => x.schoolId === scope && (!yearId || x.academicYearId === yearId)).map(safe); },
    async getClass(id) { const row = stores.get('classes').get(`${scope}:${id}`); return row?.schoolId === scope ? safe(row) : null; },
    async listClasses() { return [...stores.get('classes').values()].filter((x) => x.schoolId === scope).map(safe); }
  });
  const students = Object.freeze({
    async getStudentById(id) { const row = stores.get('students').get(`${scope}:${id}`); return row?.schoolId === scope ? safe(row) : null; },
    async getStudentByPermanentId(permanentStudentId) { const row = [...stores.get('students').values()].find((x) => x.schoolId === scope && x.permanentStudentId === permanentStudentId); return safe(row); },
    async listStudentsBySchool() { return [...stores.get('students').values()].filter((x) => x.schoolId === scope).map(safe); },
    async getStudentClassHistory(studentId) { return [...stores.get('history').values()].filter((x) => x.schoolId === scope && x.studentId === studentId).map(safe); },
    async createStudentAggregate(input) { const id = input.id ?? `STD-${String(stores.get('students').size + 1).padStart(6, '0')}`; const key = `${scope}:${id}`; if (stores.get('students').has(key)) throw new FoundationRepositoryError('CONFLICT', 'Student already exists.'); const row = { ...clone(input), id, schoolId: scope }; stores.get('students').set(key, row); return safe(row); },
    async transitionStudentClass(studentId, assignment) { const student = stores.get('students').get(`${scope}:${studentId}`); if (!student) throw new FoundationRepositoryError('NOT_FOUND', 'Student not found.'); return tx.withTransaction(async () => { student.classId = assignment.classId; student.updatedAt = assignment.updatedAt ?? new Date().toISOString(); const history = { id: randomUUID(), schoolId: scope, studentId, ...clone(assignment) }; stores.get('history').set(`${scope}:${history.id}`, history); return safe(student); }); }
  });
  const parents = Object.freeze({
    async linkParentStudent(input) { const key = `${scope}:${input.parentId}:${input.studentId}`; if (stores.get('links').has(key)) return safe(stores.get('links').get(key)); const student = stores.get('students').get(`${scope}:${input.studentId}`); if (!student) throw new FoundationRepositoryError('NOT_FOUND', 'Student not found.'); const row = { ...clone(input), schoolId: scope }; stores.get('links').set(key, row); return safe(row); },
    async listParentStudents(parentId) { return [...stores.get('links').values()].filter((x) => x.schoolId === scope && x.parentId === parentId).map((x) => safe(stores.get('students').get(`${scope}:${x.studentId}`))).filter(Boolean); }
  });
  const subjects = Object.freeze({
    async listSubjects() { return [...stores.get('subjects').values()].filter((x) => x.schoolId === scope).map(safe); },
    async getSubject(id) { return safe(stores.get('subjects').get(`${scope}:${id}`)); },
    async createSubject(input) { const id = input.id ?? randomUUID(); const row = { ...clone(input), id, schoolId: scope, active: input.active ?? true }; stores.get('subjects').set(`${scope}:${id}`, row); return safe(row); },
    async setSubjectActive(id, active) { const row = stores.get('subjects').get(`${scope}:${id}`); if (!row) throw new FoundationRepositoryError('NOT_FOUND', 'Subject not found.'); row.active = Boolean(active); return safe(row); },
    async assignSubjectToClass(input) { const key = `${scope}:${input.subjectId}:${input.classId}`; const row = { ...clone(input), schoolId: scope }; stores.get('subjectClasses').set(key, row); return safe(row); }
  });
  const assignments = Object.freeze({
    async assignStaff(input) { const id = input.id ?? randomUUID(); const row = { ...clone(input), id, schoolId: scope }; stores.get('assignments').set(`${scope}:${id}`, row); return safe(row); },
    async listStaffAssignments(staffId = null) { return [...stores.get('assignments').values()].filter((x) => x.schoolId === scope && (!staffId || x.staffId === staffId)).map(safe); }
  });
  return Object.freeze({ durable: false, scope, transaction: tx, schoolStructure, students, parents, subjects, assignments });
}
