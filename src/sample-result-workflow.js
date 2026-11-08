import { CORE_LEVELS } from './students.js';
import { GES_ASSESSMENT_LIBRARIES } from './ges-assessment-libraries.js';
import { SAMPLE_STUDENT_IDS } from './sample-student-identities.js';

const SAMPLE_CLASSES = Object.freeze([...CORE_LEVELS]);
const SAMPLE_MOCK_CLASSES = Object.freeze(['JHS 1', 'JHS 2', 'JHS 3']);
const ASSESSMENT_KEYS = Object.freeze(['conduct', 'attitude', 'interest', 'classTeacherRemarks', 'headteacherRemarks']);
const SCORE_MAX = 50;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function hash(input) { let h = 2166136261; for (const char of String(input)) { h ^= char.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function pick(input, size) { return size ? hash(input) % size : 0; }
function score(input, min, max) { return min + (hash(input) % (max - min + 1)); }
function assessmentCategory(key) { return key === 'classTeacherRemarks' ? 'ctRemarks' : key === 'headteacherRemarks' ? 'htRemarks' : key; }
function assertActor(actor, permission = 'marks.write') { if (!actor?.schoolId || (!actor.permissions?.has?.(permission) && !actor.permissions?.has?.('marks.write') && !actor.permissions?.has?.('results.generate') && actor.roleKey !== 'PROPRIETOR' && actor.roleKey !== 'HEADTEACHER' && actor.roleKey !== 'SCHOOL_ADMIN')) throw new Error('Sample result generation permission required.'); }
function assertPublisher(actor, schoolId) { const manager = ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'EXAMINATION_OFFICER'].includes(actor?.roleKey); if (actor?.schoolId !== schoolId || (!actor?.permissions?.has?.('results.publish') && !actor?.permissions?.has?.('*') && !manager)) throw new Error('Forbidden.'); }

export function createSampleResultWorkflow({ students, subjects, academicResults, sampleFixtureRepository = null, schoolId = 'school-osaah-daylight', now = () => new Date().toISOString() } = {}) {
  if (!students || !subjects || !academicResults) throw new Error('Sample workflow dependencies are required.');
  const sampleState = new Map();
  const sampleStateKey = ({ student, classId, academicYear, term, examinationType = 'TERMINAL', mockLabel = '' }) => `${schoolId}:${student.permanentStudentId}:${academicYear}:${term}:${classId}:${examinationType}${examinationType === 'MOCK' ? `:${mockLabel || '1st Mock'}` : ''}`;
  const lifecycleContextKey = (examinationType = 'TERMINAL', mockLabel = '1st Mock') => examinationType === 'MOCK' ? `MOCK:${mockLabel || '1st Mock'}` : 'TERMINAL';
  const lifecycleFixtureIdentity = ({ student, classId, academicYear, term }) => ({ schoolId, sampleStudentId: student.permanentStudentId, academicYearId: String(academicYear ?? '').trim(), termId: String(term ?? '').trim(), classId: String(classId ?? '').trim(), fixtureType: 'result-lifecycle', fixtureVersion: 1 });
  const withLifecycleContext = (payload = {}, key, context) => ({ ...payload, version: 1, contexts: { ...(payload.contexts ?? {}), [key]: context } });
  function sampleStudents(classId) { return students.listStudents({ requestedSchoolId: schoolId, includeTestRecords: true }).filter((student) => student.isTestRecord && SAMPLE_STUDENT_IDS.includes(student.permanentStudentId) && (!classId || !student.classId || student.classId === classId)); }
  function sampleStudentByPermanentId(permanentStudentId) { return sampleStudents().find((student) => student.permanentStudentId === permanentStudentId) ?? null; }
  function generate(input, actor) {
    assertActor(actor); if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const academicYear = String(input?.academicYear ?? '').trim(); const term = String(input?.term ?? '').trim(); const examinationType = String(input?.examinationType ?? 'TERMINAL').trim(); const classId = String(input?.classId ?? '').trim();
    if (!academicYear || !term || !classId || !SAMPLE_CLASSES.includes(classId)) throw new Error('Academic year, term, and configured sample class are required.');
    const roster = sampleStudents(classId); if (!roster.length) throw new Error('No existing sample student is available for this class.');
    const target = input.studentId ? roster.find((student) => student.id === input.studentId || student.permanentStudentId === input.studentId) : roster[0]; if (!target) throw new Error('Existing sample student not found.');
    const availableSubjects = subjects.list({ classId }, actor).filter((subject) => subject.active); if (!availableSubjects.length) throw new Error('No active subjects are configured for this class.');
    const key = sampleStateKey({ student: target, classId, academicYear, term, examinationType });
    for (const sampleStudent of roster) {
      const studentKey = `${schoolId}:${sampleStudent.permanentStudentId}:${academicYear}:${term}:${examinationType}`;
      for (const subject of availableSubjects) academicResults.saveScore({ studentId: sampleStudent.id, classId, subjectId: subject.id, academicYear, term, caScore: score(`${studentKey}:${subject.id}:ca`, 24, 45), examScore: score(`${studentKey}:${subject.id}:exam`, 24, 50), caMax: SCORE_MAX, examMax: SCORE_MAX }, actor);
    }
    const assessments = Object.fromEntries(ASSESSMENT_KEYS.map((assessmentKey) => { const category = assessmentCategory(assessmentKey); const side = hash(`${key}:${assessmentKey}:side`) % 2 ? 'positive' : 'negative'; const bank = GES_ASSESSMENT_LIBRARIES[category][side]; return [assessmentKey, bank[pick(`${key}:${assessmentKey}:statement`, bank.length)]]; }));
    const attendance = { timesPresent: fiftyFive(key, 'present'), timesAbsent: 60 - fiftyFive(key, 'present'), totalSchoolDays: 60, term, isSample: true };
    const state = { isSample: true, studentId: target.id, permanentStudentId: target.permanentStudentId, classId, academicYear, term, examinationType, assessments, attendance, generatedAt: now() };
    sampleState.set(key, state);
    const result = academicResults.result({ studentId: target.id, classId, academicYear, term, examinationType, sample: true }, actor);
    return { ...clone(result), ...clone(state), sampleLabel: 'SAMPLE DATA' };
  }
  function generateMock(input, actor) {
    assertActor(actor, 'mock.scores.write'); if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const academicYear = String(input?.academicYear ?? '').trim(); const term = String(input?.term ?? '').trim(); const mockLabel = String(input?.mockLabel ?? input?.mockType ?? '1st Mock').trim(); const classId = String(input?.classId ?? '').trim();
    if (!academicYear || !term || !classId || !SAMPLE_MOCK_CLASSES.includes(classId)) throw new Error('Sample Mock data is available for JHS 1, JHS 2, and JHS 3 only.');
    const roster = sampleStudents(classId); if (!roster.length) throw new Error('No existing sample student is available for this JHS class.');
    const target = input.studentId ? roster.find((student) => student.id === input.studentId || student.permanentStudentId === input.studentId) : roster[0]; if (!target) throw new Error('Existing sample student not found.');
    const availableSubjects = subjects.list({ classId }, actor).filter((subject) => subject.active); if (!availableSubjects.length) throw new Error('No active subjects are configured for this class.');
    for (const sampleStudent of roster) { const studentKey = schoolId + ':' + sampleStudent.permanentStudentId + ':' + academicYear + ':' + term + ':MOCK:' + mockLabel; for (const subject of availableSubjects) academicResults.saveMockScore({ studentId: sampleStudent.id, classId, subjectId: subject.id, academicYear, term, mockLabel, totalScore: score(studentKey + ':' + subject.id + ':total', 55, 98) }, actor); }
    const stateKey = sampleStateKey({ student: target, classId, academicYear, term, examinationType: 'MOCK', mockLabel });
    const assessments = Object.fromEntries(ASSESSMENT_KEYS.map((assessmentKey) => { const category = assessmentCategory(assessmentKey); const side = hash(stateKey + ':' + assessmentKey + ':side') % 2 ? 'positive' : 'negative'; const bank = GES_ASSESSMENT_LIBRARIES[category][side]; return [assessmentKey, bank[pick(stateKey + ':' + assessmentKey + ':statement', bank.length)]]; }));
    const attendance = { timesPresent: fiftyFive(stateKey, 'present'), timesAbsent: 60 - fiftyFive(stateKey, 'present'), totalSchoolDays: 60 };
    academicResults.saveResult({ studentId: target.id, permanentStudentId: target.permanentStudentId, classId, academicYear, term, examination: 'MOCK', attendance, assessment: assessments }, actor);
    const stateValue = { isSample: true, studentId: target.id, permanentStudentId: target.permanentStudentId, classId, academicYear, term, examinationType: 'MOCK', mockLabel, assessments, attendance, generatedAt: now() }; sampleState.set(stateKey, stateValue);
    const result = academicResults.result({ studentId: target.id, classId, academicYear, term, mockLabel }, actor, { mock: true });
    return { ...clone(result), ...clone(stateValue), assessment: { ...clone(assessments) }, attendance: clone(attendance), isSample: true, sampleLabel: 'SAMPLE DATA / DEMONSTRATION' };
  }
  async function persistGeneratedState(generated, actor) {
    const examinationType = generated.examinationType ?? generated.resultType ?? 'TERMINAL';
    assertActor(actor, examinationType === 'MOCK' ? 'mock.scores.write' : 'results.generate');
    if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const permanentStudentId = generated.permanentStudentId ?? generated.studentIndexNumber;
    const target = sampleStudentByPermanentId(permanentStudentId);
    if (!target?.isTestRecord || !SAMPLE_STUDENT_IDS.includes(target.permanentStudentId) || target.id !== generated.studentId || !generated.classId || target.classId && target.classId !== generated.classId) throw new Error('Only a matching existing sample result can be persisted.');
    const state = { isSample: true, studentId: target.id, permanentStudentId: target.permanentStudentId, classId: generated.classId, academicYear: generated.academicYear, term: generated.term, examinationType, ...(examinationType === 'MOCK' ? { mockLabel: generated.mockLabel ?? '1st Mock' } : {}), generatedAt: generated.generatedAt ?? now() };
    const key = sampleStateKey({ student: target, classId: state.classId, academicYear: state.academicYear, term: state.term, examinationType, mockLabel: state.mockLabel });
    const contextKey = lifecycleContextKey(examinationType, state.mockLabel);
    const identity = lifecycleFixtureIdentity({ student: target, classId: state.classId, academicYear: state.academicYear, term: state.term });
    const existing = await sampleFixtureRepository?.getFixture(identity, actor);
    const payload = existing?.fixturePayload ?? {};
    const previous = payload.contexts?.[contextKey] ?? {};
    const publication = previous.reset ? null : previous.publication ?? null;
    sampleState.set(key, state);
    if (sampleFixtureRepository) await sampleFixtureRepository.ensureFixture({ ...identity, fixturePayload: withLifecycleContext(payload, contextKey, { state, publication, publicationStatus: publication?.status ?? 'UNPUBLISHED', reset: false }) }, actor);
    return { ...clone(state), publication: clone(publication), publicationStatus: publication?.status ?? 'UNPUBLISHED' };
  }
  async function state(input, actor) {
    const examinationType = String(input.examinationType ?? 'TERMINAL').trim();
    const readPermission = actor?.permissions?.has?.('*') || (examinationType === 'MOCK'
      ? ['results.read', 'results.generate', 'results.publish', 'mock.scores.read', 'mock.scores.write', 'mock.results.read'].some((permission) => actor?.permissions?.has?.(permission))
      : ['results.read', 'results.generate', 'results.publish'].some((permission) => actor?.permissions?.has?.(permission)));
    if (!actor?.id || actor.portal !== 'school' || !readPermission) throw new Error('Forbidden.');
    if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const target = sampleStudentByPermanentId(input.permanentStudentId);
    if (!target?.isTestRecord || !SAMPLE_STUDENT_IDS.includes(target.permanentStudentId)) return null;
    const classId = String(input.classId ?? '').trim();
    const academicYear = String(input.academicYear ?? '').trim();
    const term = String(input.term ?? '').trim();
    const mockLabel = String(input.mockLabel ?? '1st Mock').trim();
    if (!classId || !academicYear || !term) throw new Error('Academic year, term, and class are required.');
    const key = sampleStateKey({ student: target, classId, academicYear, term, examinationType, mockLabel });
    const contextKey = lifecycleContextKey(examinationType, mockLabel);
    const identity = lifecycleFixtureIdentity({ student: target, classId, academicYear, term });
    const fixture = await sampleFixtureRepository?.getFixture(identity, actor);
    const context = fixture?.fixturePayload?.contexts?.[contextKey];
    if (context?.reset) return null;
    const current = context?.state ?? sampleState.get(key);
    if (!current) return null;
    const publication = context?.publication ?? academicResults.publicationFor({ studentId: target.id, classId, academicYear, term, examination: examinationType, mockLabel, isSample: true });
    return clone({ ...current, publication, publicationStatus: publication?.status ?? 'UNPUBLISHED' });
  }
  async function publish(input, actor) {
    assertPublisher(actor, schoolId);
    const requestedStudent = input.studentId ? students.getStudent(input.studentId, { requestedSchoolId: schoolId }) : null;
    const target = requestedStudent?.isTestRecord ? requestedStudent : students.findByPermanentStudentId(input.permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: schoolId });
    if (!target?.isTestRecord || !SAMPLE_STUDENT_IDS.includes(target.permanentStudentId)) throw new Error('Only existing sample records can be published through the sample workflow.');
    const examination = String(input.examination ?? input.examinationType ?? 'TERMINAL').trim();
    const classId = String(input.classId ?? '').trim();
    const academicYear = String(input.academicYear ?? '').trim();
    const term = String(input.term ?? '').trim();
    const mockLabel = String(input.mockLabel ?? '1st Mock').trim();
    if (examination === 'MOCK' ? !SAMPLE_MOCK_CLASSES.includes(classId) : !SAMPLE_CLASSES.includes(classId)) throw new Error('Selected class is not configured for this sample result type.');
    const context = { ...input, classId, academicYear, term, examinationType: examination, mockLabel };
    const generated = await state({ ...context, permanentStudentId: target.permanentStudentId }, actor);
    if (!generated) throw new Error('Generate this sample result before publishing it.');
    if (generated.publicationStatus === 'PUBLISHED' && generated.publication) return clone(generated.publication);
    const publication = academicResults.publishResults({ ...input, studentId: target.id, permanentStudentId: target.permanentStudentId, classId, academicYear, term, examination, mockLabel, isSample: true }, actor);
    const contextKey = lifecycleContextKey(examination, mockLabel);
    const identity = lifecycleFixtureIdentity({ student: target, classId, academicYear, term });
    if (sampleFixtureRepository) {
      try {
        const existing = await sampleFixtureRepository.getFixture(identity, actor);
        const payload = existing?.fixturePayload ?? {};
        await sampleFixtureRepository.ensureFixture({ ...identity, fixturePayload: withLifecycleContext(payload, contextKey, { state: generated, publication, publicationStatus: 'PUBLISHED', reset: false }) }, actor);
      } catch (error) {
        academicResults.resetSamplePublication({ studentId: target.id, classId, academicYear, term, examination, mockLabel }, actor);
        throw error;
      }
    }
    const key = sampleStateKey({ student: target, classId, academicYear, term, examinationType: examination, mockLabel });
    sampleState.set(key, { ...generated, publication, publicationStatus: 'PUBLISHED' });
    return clone(publication);
  }
  async function reset(input, actor) {
    assertPublisher(actor, schoolId);
    const target = students.findByPermanentStudentId(input.permanentStudentId, { roleKey: actor.roleKey, requestedSchoolId: schoolId });
    if (!target?.isTestRecord || !SAMPLE_STUDENT_IDS.includes(target.permanentStudentId)) throw new Error('Only existing sample records can be reset.');
    const classId = String(input.classId ?? '').trim();
    const academicYear = String(input.academicYear ?? '').trim();
    const term = String(input.term ?? '').trim();
    const examinationType = String(input.examinationType ?? input.examination ?? 'TERMINAL').trim();
    if (examinationType === 'MOCK') throw new Error('Use the Sample Mock reset for Mock results.');
    if (!classId || !SAMPLE_CLASSES.includes(classId) || !academicYear || !term) throw new Error('Academic year, term, and class are required.');
    const identity = lifecycleFixtureIdentity({ student: target, classId, academicYear, term });
    const existing = await sampleFixtureRepository?.getFixture(identity, actor);
    const payload = existing?.fixturePayload ?? {};
    await sampleFixtureRepository?.ensureFixture({ ...identity, fixturePayload: withLifecycleContext(payload, lifecycleContextKey(examinationType), { state: null, publication: null, publicationStatus: 'UNPUBLISHED', reset: true, resetAt: now() }) }, actor);
    const publication = academicResults.resetSamplePublication({ studentId: target.id, classId, academicYear, term, examination: examinationType }, actor);
    sampleState.delete(sampleStateKey({ student: target, classId, academicYear, term, examinationType }));
    return { ok: true, isSample: true, publicationRemoved: publication.publicationRemoved, permanentStudentId: target.permanentStudentId, classId, academicYear, term, examinationType };
  }
  async function resetMock(input, actor) {
    assertActor(actor, 'mock.scores.write');
    if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const target = sampleStudents(input.classId).find((student) => student.permanentStudentId === input.permanentStudentId);
    if (!target?.isTestRecord || !SAMPLE_STUDENT_IDS.includes(target.permanentStudentId)) throw new Error('Only existing sample records can be reset.');
    const classId = String(input.classId ?? '').trim();
    const academicYear = String(input.academicYear ?? '').trim();
    const term = String(input.term ?? '').trim();
    const mockLabel = String(input.mockLabel ?? '1st Mock').trim();
    if (!SAMPLE_MOCK_CLASSES.includes(classId) || !academicYear || !term) throw new Error('A configured JHS sample Mock context is required.');
    const identity = lifecycleFixtureIdentity({ student: target, classId, academicYear, term });
    const existing = await sampleFixtureRepository?.getFixture(identity, actor);
    const payload = existing?.fixturePayload ?? {};
    await sampleFixtureRepository?.ensureFixture({ ...identity, fixturePayload: withLifecycleContext(payload, lifecycleContextKey('MOCK', mockLabel), { state: null, publication: null, publicationStatus: 'UNPUBLISHED', reset: true, resetAt: now() }) }, actor);
    const removed = academicResults.resetMockScores({ studentId: target.id, classId, academicYear, term, mockLabel }, actor);
    sampleState.delete(sampleStateKey({ student: target, classId, academicYear, term, examinationType: 'MOCK', mockLabel }));
    return { ok: true, isSample: true, removed: removed.removed ?? 0, publicationRemoved: Boolean(removed.publicationRemoved), permanentStudentId: target.permanentStudentId };
  }
  function saveMock(input, actor) {
    assertActor(actor, 'mock.scores.write');
    if (actor.schoolId !== schoolId) throw new Error('Forbidden.');
    const target = sampleStudents(input.classId).find((student) => student.id === input.studentId || student.permanentStudentId === input.permanentStudentId);
    if (!target) throw new Error('Existing sample student not found.');
    if (String(input.examination ?? '').toUpperCase() !== 'MOCK') throw new Error('Sample Mock result is required.');
    return academicResults.saveResult({ ...input, studentId: target.id, permanentStudentId: target.permanentStudentId, isSample: true }, actor);
  }
  function broadsheet(input, actor, { mock = false } = {}) {
    if (actor?.schoolId !== schoolId || !(actor?.permissions?.has?.('results.read') || actor?.permissions?.has?.('mock.results.read') || actor?.permissions?.has?.('*') || ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER'].includes(actor?.roleKey))) throw new Error('Forbidden.');
    const classId = String(input?.classId ?? '').trim();
    if (!(mock ? SAMPLE_MOCK_CLASSES : SAMPLE_CLASSES).includes(classId)) throw new Error('A configured sample class is required.');
    students.seedSampleStudents?.();
    const reader = { ...actor, permissions: new Set([...(actor.permissions ?? []), 'results.generate', 'mock.results.generate', 'marks.write', 'mock.scores.write']) };
    return sampleStudents(classId).map((student) => {
      const report = mock
        ? generateMock({ ...input, classId, studentId: student.id }, reader)
        : generate({ ...input, classId, studentId: student.id }, reader);
      const subjectCas = Object.fromEntries((report.subjects ?? []).map((row) => [row.subjectName || row.subjectId, row.caScore]));
      const subjectExams = Object.fromEntries((report.subjects ?? []).map((row) => [row.subjectName || row.subjectId, row.examScore]));
      const subjectTotals = Object.fromEntries((report.subjects ?? []).map((row) => [row.subjectName || row.subjectId, row.totalScore]));
      const subjectGrades = Object.fromEntries((report.subjects ?? []).map((row) => [row.subjectName || row.subjectId, row.grade]));
      return { studentId: student.id, permanentStudentId: student.permanentStudentId, studentName: report.studentName, classId, subjectCas, subjectExams, subjectTotals, subjectGrades, totalScore: report.totalScore, averageScore: report.average, aggregate: report.aggregate ?? null, classPosition: report.classPosition ?? report.position ?? null, subjectsSat: report.subjectsSat ?? report.subjects?.length ?? 0, isSample: true };
    });
  }
  return { classes: () => [...SAMPLE_CLASSES], mockClasses: () => [...SAMPLE_MOCK_CLASSES], students: sampleStudents, generate, generateMock, saveMock, persistGeneratedState, state, publish, reset, resetMock, broadsheet };
}
function fiftyFive(key, field) { return 55 + (hash(`${key}:${field}`) % 6); }
export { ASSESSMENT_KEYS };
