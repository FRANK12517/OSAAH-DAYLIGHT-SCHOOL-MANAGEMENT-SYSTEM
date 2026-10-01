import { createHash } from 'node:crypto';
import { isConfiguredTestParentActor, isConfiguredTestStudentId, TEST_PARENT_SCHOOL_ID } from './test-parent-fixture.js';

const FIXTURE_TYPES = Object.freeze(new Set([
  'student-summary', 'attendance', 'published-results', 'result-slip', 'fees',
  'payments', 'receipts', 'announcements', 'timetable', 'assignments', 'historical-records'
]));
const SAMPLE_IDS = Object.freeze(new Set(['OSAAH-DEMO-001', 'OSAAH-DEMO-002']));
const text = (value, label) => {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(`${label} is required.`);
  return result;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const fixtureKey = ({ schoolId, sampleStudentId, academicYearId, termId, classId, fixtureType, fixtureVersion }) =>
  [schoolId, sampleStudentId, academicYearId, termId, classId, fixtureType, fixtureVersion].join('|');
const fixtureId = (identity) => `SAMPLE-FIXTURE-${createHash('sha256').update(fixtureKey(identity)).digest('hex').slice(0, 48)}`;

function assertIdentity(input) {
  const identity = {
    schoolId: text(input.schoolId, 'School scope'),
    sampleStudentId: text(input.sampleStudentId, 'Sample student ID'),
    academicYearId: text(input.academicYearId, 'Academic year ID'),
    termId: text(input.termId, 'Term ID'),
    classId: text(input.classId, 'Class ID'),
    fixtureType: text(input.fixtureType, 'Fixture type'),
    fixtureVersion: Number(input.fixtureVersion ?? 1)
  };
  if (!SAMPLE_IDS.has(identity.sampleStudentId) || !isConfiguredTestStudentId(identity.sampleStudentId)) throw new Error('Only configured sample student identities are allowed.');
  if (!FIXTURE_TYPES.has(identity.fixtureType)) throw new Error('Unsupported sample fixture type.');
  if (!Number.isSafeInteger(identity.fixtureVersion) || identity.fixtureVersion < 1) throw new Error('Fixture version must be a positive integer.');
  return identity;
}
function assertActor(actor, schoolId, action) {
  if (!actor?.id || actor.schoolId !== schoolId || actor.portal !== 'parent' && actor.portal !== 'school') throw Object.assign(new Error('Sample fixture access is forbidden.'), { status: 403, code: 'SAMPLE_FIXTURE_FORBIDDEN' });
  if (actor.portal === 'parent') {
    if (!isConfiguredTestParentActor(actor, schoolId)) throw Object.assign(new Error('Sample fixture access is forbidden.'), { status: 403, code: 'SAMPLE_FIXTURE_FORBIDDEN' });
    if (action !== 'read') throw Object.assign(new Error('Sample fixture writes are restricted.'), { status: 403, code: 'SAMPLE_FIXTURE_WRITE_FORBIDDEN' });
    return;
  }
  const permissions = actor.permissions;
  if (!(permissions?.has?.('*') || permissions?.has?.(`sample.fixtures.${action}`) || permissions?.has?.('results.read') && action === 'read')) throw Object.assign(new Error('Sample fixture access is forbidden.'), { status: 403, code: 'SAMPLE_FIXTURE_FORBIDDEN' });
}
function fromRow(row) {
  if (!row) return null;
  let payload = row.fixturePayload ?? row.fixture_payload;
  if (typeof payload === 'string') payload = JSON.parse(payload);
  return {
    fixtureId: row.fixtureId ?? row.fixture_id,
    schoolId: row.schoolId ?? row.school_id,
    sampleStudentId: row.sampleStudentId ?? row.sample_student_id,
    academicYearId: row.academicYearId ?? row.academic_year_id,
    termId: row.termId ?? row.term_id,
    classId: row.classId ?? row.class_id,
    fixtureType: row.fixtureType ?? row.fixture_type,
    fixturePayload: clone(payload),
    fixtureVersion: Number(row.fixtureVersion ?? row.fixture_version),
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at
  };
}

export function createSampleFixtureRepository({ adapter, now = () => new Date().toISOString(), schoolId = TEST_PARENT_SCHOOL_ID } = {}) {
  if (!adapter?.query || !adapter?.execute) throw new Error('A durable database adapter is required.');
  async function ensureFixture(input, actor) {
    const identity = assertIdentity({ ...input, schoolId: input.schoolId ?? schoolId });
    assertActor(actor, identity.schoolId, 'write');
    const timestamp = now();
    const id = fixtureId(identity);
    const payload = clone(input.fixturePayload ?? {});
    await adapter.execute(`INSERT INTO sample_data_fixtures (fixture_id,school_id,sample_student_id,academic_year_id,term_id,class_id,fixture_type,fixture_payload,fixture_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE fixture_payload=VALUES(fixture_payload),updated_at=VALUES(updated_at)`, [id, identity.schoolId, identity.sampleStudentId, identity.academicYearId, identity.termId, identity.classId, identity.fixtureType, JSON.stringify(payload), identity.fixtureVersion, timestamp, timestamp]);
    return getFixture(identity, actor);
  }
  async function getFixture(input, actor) {
    const identity = assertIdentity({ ...input, schoolId: input.schoolId ?? schoolId });
    assertActor(actor, identity.schoolId, 'read');
    const rows = await adapter.query(`SELECT fixture_id AS fixtureId,school_id AS schoolId,sample_student_id AS sampleStudentId,academic_year_id AS academicYearId,term_id AS termId,class_id AS classId,fixture_type AS fixtureType,fixture_payload AS fixturePayload,fixture_version AS fixtureVersion,created_at AS createdAt,updated_at AS updatedAt FROM sample_data_fixtures WHERE school_id=? AND sample_student_id=? AND academic_year_id=? AND term_id=? AND class_id=? AND fixture_type=? AND fixture_version=? LIMIT 1`, [identity.schoolId, identity.sampleStudentId, identity.academicYearId, identity.termId, identity.classId, identity.fixtureType, identity.fixtureVersion]);
    return fromRow(rows[0]);
  }
  async function listFixtures(filters = {}, actor) {
    const requestedSchool = filters.schoolId ?? schoolId;
    assertActor(actor, requestedSchool, 'read');
    const conditions = ['school_id=?']; const params = [requestedSchool];
    for (const [key, column] of [['sampleStudentId', 'sample_student_id'], ['academicYearId', 'academic_year_id'], ['termId', 'term_id'], ['classId', 'class_id'], ['fixtureType', 'fixture_type']]) if (filters[key]) { if (key === 'sampleStudentId' && !isConfiguredTestStudentId(filters[key])) throw new Error('Only configured sample student identities are allowed.'); conditions.push(`${column}=?`); params.push(filters[key]); }
    const rows = await adapter.query(`SELECT fixture_id AS fixtureId,school_id AS schoolId,sample_student_id AS sampleStudentId,academic_year_id AS academicYearId,term_id AS termId,class_id AS classId,fixture_type AS fixtureType,fixture_payload AS fixturePayload,fixture_version AS fixtureVersion,created_at AS createdAt,updated_at AS updatedAt FROM sample_data_fixtures WHERE ${conditions.join(' AND ')} ORDER BY sample_student_id,academic_year_id,term_id,class_id,fixture_type,fixture_version`, params);
    return rows.map(fromRow);
  }
  return Object.freeze({ ensureFixture, getFixture, listFixtures, fixtureId, fixtureTypes: () => [...FIXTURE_TYPES] });
}
export { FIXTURE_TYPES };
