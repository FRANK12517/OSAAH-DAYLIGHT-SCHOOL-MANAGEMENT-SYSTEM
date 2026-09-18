import { CORE_LEVELS } from './students.js';
import { GES_ASSESSMENT_LIBRARIES } from './ges-assessment-libraries.js';

const SAMPLE_CLASSES = Object.freeze([...CORE_LEVELS]);
const ASSESSMENT_KEYS = Object.freeze(['conduct', 'attitude', 'interest', 'classTeacherRemarks', 'headteacherRemarks']);
const SCORE_MAX = 50;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hash(input) { let h = 2166136261; for (const char of String(input)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function pick(input, size) { return size ? hash(input) % size : 0; }
function score(input, min, max) { return min + (hash(input) % (max - min + 1)); }
function assessmentCategory(key) { return key === 'classTeacherRemarks' ? 'ctRemarks' : key === 'headteacherRemarks' ? 'htRemarks' : key; }
function assertActor(actor) { if (!actor?.schoolId || (!actor.permissions?.has?.('marks.write') && !actor.permissions?.has?.('results.generate') && actor.roleKey !== 'PROPRIETOR' && actor.roleKey !== 'HEADTEACHER' && actor.roleKey !== 'SCHOOL_ADMIN')) throw new Error('Sample result generation permission required.'); }

export function createSampleResultWorkflow({ students, subjects, academicResults, schoolId = 'school-osaah-daylight', now = () => new Date().toISOString() } = {}) {
  if (!students || !subjects || !academicResults) throw new Error('Sample workflow dependencies are required.');
  const sampleState = new Map();
  function sampleStudents(classId) { return students.listStudents({ requestedSchoolId: schoolId, includeTestRecords: true }).filter((student) => student.isTestRecord && (!classId || student.classId === classId)); }
  function generate(input, actor) {
    assertActor(actor); if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const academicYear = String(input?.academicYear ?? '').trim(); const term = String(input?.term ?? '').trim(); const examinationType = String(input?.examinationType ?? 'TERMINAL').trim(); const classId = String(input?.classId ?? '').trim();
    if (!academicYear || !term || !classId || !SAMPLE_CLASSES.includes(classId)) throw new Error('Academic year, term, and configured sample class are required.');
    const roster = sampleStudents(classId); if (!roster.length) throw new Error('No existing sample student is available for this class.');
    const target = input.studentId ? roster.find((student) => student.id === input.studentId || student.permanentStudentId === input.studentId) : roster[0]; if (!target) throw new Error('Existing sample student not found.');
    const availableSubjects = subjects.list({ classId }, actor).filter((subject) => subject.active); if (!availableSubjects.length) throw new Error('No active subjects are configured for this class.');
    const key = `${schoolId}:${target.permanentStudentId}:${academicYear}:${term}:${examinationType}`;
    for (const subject of availableSubjects) {
      academicResults.saveScore({ studentId: target.id, classId, subjectId: subject.id, academicYear, term, caScore: score(`${key}:${subject.id}:ca`, 24, 45), examScore: score(`${key}:${subject.id}:exam`, 24, 50), caMax: SCORE_MAX, examMax: SCORE_MAX }, actor);
    }
    const assessments = Object.fromEntries(ASSESSMENT_KEYS.map((assessmentKey) => { const category = assessmentCategory(assessmentKey); const side = hash(`${key}:${assessmentKey}:side`) % 2 ? 'positive' : 'negative'; const bank = GES_ASSESSMENT_LIBRARIES[category][side]; return [assessmentKey, bank[pick(`${key}:${assessmentKey}:statement`, bank.length)]]; }));
    const attendance = { timesPresent: fiftyFive(key, 'present'), timesAbsent: 60 - fiftyFive(key, 'present'), totalSchoolDays: 60, term, isSample: true };
    const state = { isSample: true, studentId: target.id, permanentStudentId: target.permanentStudentId, classId, academicYear, term, examinationType, assessments, attendance, generatedAt: now() };
    sampleState.set(key, state);
    const result = academicResults.result({ studentId: target.id, classId, academicYear, term, examinationType, sample: true }, actor);
    return { ...clone(result), ...clone(state), sampleLabel: 'SAMPLE DATA' };
  }
  function state(input, actor) { assertActor(actor); const target = students.findByPermanentStudentId(input.permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: schoolId }); if (!target?.isTestRecord) return null; return clone(sampleState.get(`${schoolId}:${target.permanentStudentId}:${input.academicYear}:${input.term}:${input.examinationType ?? 'TERMINAL'}`) ?? null); }
  function reset(input, actor) { assertActor(actor); const target = students.findByPermanentStudentId(input.permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: schoolId }); if (!target?.isTestRecord) throw new Error('Only existing sample records can be reset.'); const prefix = `${schoolId}:${target.permanentStudentId}:${input.academicYear}:${input.term}:`; for (const key of sampleState.keys()) if (key.startsWith(prefix)) sampleState.delete(key); return { ok: true, isSample: true, permanentStudentId: target.permanentStudentId }; }
  function publish(input, actor) { assertActor(actor); const target = students.findByPermanentStudentId(input.permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: schoolId }); if (!target?.isTestRecord) throw new Error('Only existing sample records can be published through the sample workflow.'); return academicResults.publishResults({ ...input, studentId: target.id, isSample: true }, actor); }
  return { classes: () => [...SAMPLE_CLASSES], students: sampleStudents, generate, state, publish, reset };
}
function fiftyFive(key, field) { return 55 + (hash(`${key}:${field}`) % 6); }
export { ASSESSMENT_KEYS };
