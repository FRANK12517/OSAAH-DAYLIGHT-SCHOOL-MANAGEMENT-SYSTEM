import { randomUUID } from 'node:crypto';

const clone = (value) => JSON.parse(JSON.stringify(value));
const rows = (value) => Array.isArray(value) ? value : [];
const value = (...items) => items.find((item) => item !== undefined && item !== null && item !== '') ?? null;
const error = (message, status = 400) => Object.assign(new Error(message), { status });

const STUDENT_FIELDS = Object.freeze({
  firstName: ['first_name', 'firstName'], middleName: ['middle_name', 'middleName'], surname: ['last_name', 'surname', 'lastName'],
  gender: ['gender'], dateOfBirth: ['date_of_birth', 'dateOfBirth'], placeOfBirth: ['place_of_birth', 'placeOfBirth'], nationality: ['nationality'],
  preferredName: ['preferred_name', 'preferredName'], photograph: ['photograph_path', 'photograph', 'photographPath'], admissionDate: ['admission_date', 'admissionDate'],
  previousSchool: ['previous_school', 'previousSchool'], admissionType: ['admission_type', 'admissionType'], classId: ['current_class_id', 'class_id', 'classId'],
  streamId: ['stream_id', 'streamId'], houseId: ['house_id', 'houseId'], indexNumber: ['index_number', 'indexNumber']
});

function columnMap(row) { return new Map(Object.keys(row ?? {}).map((key) => [key.toLowerCase(), key])); }
function findColumn(map, candidates) { return candidates.find((candidate) => map.has(candidate.toLowerCase())) ? map.get(candidates.find((candidate) => map.has(candidate.toLowerCase())).toLowerCase()) : null; }
function fieldFromRow(row, field) { const map = columnMap(row); const column = findColumn(map, STUDENT_FIELDS[field]); return column ? row[column] : null; }
function normalized(row, profile = null, family = []) {
  const student = {
    id: value(row.id, row.studentId), schoolId: value(row.school_id, row.schoolId), permanentStudentId: value(row.permanent_student_id, row.permanentStudentId, profile?.student_id, profile?.studentId),
    admissionNumber: value(row.admission_number, row.admissionNumber, profile?.admission_number, profile?.admissionNumber),
    firstName: value(fieldFromRow(row, 'firstName'), profile?.first_name, profile?.firstName), middleName: value(fieldFromRow(row, 'middleName'), profile?.middle_name, profile?.middleName),
    surname: value(fieldFromRow(row, 'surname'), profile?.last_name, profile?.surname, profile?.lastName), gender: value(fieldFromRow(row, 'gender'), profile?.gender),
    dateOfBirth: value(fieldFromRow(row, 'dateOfBirth'), profile?.date_of_birth, profile?.dateOfBirth), placeOfBirth: value(fieldFromRow(row, 'placeOfBirth'), profile?.place_of_birth, profile?.placeOfBirth),
    nationality: value(fieldFromRow(row, 'nationality'), profile?.nationality), preferredName: value(fieldFromRow(row, 'preferredName'), profile?.preferred_name, profile?.preferredName),
    photograph: value(fieldFromRow(row, 'photograph'), profile?.photograph_path, profile?.photographPath), admissionDate: value(fieldFromRow(row, 'admissionDate'), profile?.admission_date, profile?.admissionDate),
    previousSchool: value(fieldFromRow(row, 'previousSchool'), profile?.previous_school, profile?.previousSchool), admissionType: value(fieldFromRow(row, 'admissionType'), profile?.admission_type, profile?.admissionType),
    classId: value(fieldFromRow(row, 'classId'), profile?.class_id, profile?.classId), streamId: value(fieldFromRow(row, 'streamId'), profile?.stream_id, profile?.streamId), houseId: value(fieldFromRow(row, 'houseId'), profile?.house_id, profile?.houseId),
    indexNumber: value(fieldFromRow(row, 'indexNumber'), profile?.index_number, profile?.indexNumber), family: family.map((item) => ({ ...item })),
    status: value(row.student_status, row.studentStatus, profile?.enrollment_status, profile?.enrollmentStatus), updatedAt: value(row.updated_at, row.updatedAt, profile?.updated_at, profile?.updatedAt)
  };
  return clone(student);
}

export function createDurableStudentProfileService({ database, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.query || !database?.execute) return null;
  async function profileForStudent(studentId, schoolId) {
    return rows(await database.query('SELECT * FROM student_profiles WHERE school_id=? AND (student_master_id=? OR student_id=?) ORDER BY updated_at DESC,id DESC LIMIT 1', [schoolId, studentId, studentId]))[0] ?? null;
  }
  async function familyForProfile(profileId, schoolId) {
    try { return rows(await database.query('SELECT * FROM student_family_contacts WHERE student_id=? AND student_id IN (SELECT id FROM student_profiles WHERE school_id=?) ORDER BY created_at,id', [profileId, schoolId])); } catch { try { return rows(await database.query('SELECT * FROM student_family_contacts WHERE student_id=? ORDER BY created_at,id', [profileId])); } catch { return []; } }
  }
  async function getStudent(identifier, actor) {
    const schoolId = actor?.schoolId;
    if (!schoolId || !identifier) throw error('Authenticated school context is required.', 403);
    const result = rows(await database.query('SELECT * FROM students WHERE school_id=? AND (id=? OR permanent_student_id=?) LIMIT 1', [schoolId, identifier, identifier]))[0];
    if (!result) return null;
    const profile = await profileForStudent(result.id, schoolId);
    return normalized(result, profile, profile ? await familyForProfile(profile.id, schoolId) : []);
  }
  async function search(query, actor) {
    const schoolId = actor?.schoolId;
    if (!schoolId) throw error('Authenticated school context is required.', 403);
    const term = `%${String(query ?? '').trim().toLowerCase()}%`;
    const found = rows(await database.query(`SELECT s.*,sp.id AS profile_id,sp.first_name AS profile_first_name,sp.last_name AS profile_last_name,sp.class_id AS profile_class_id
      FROM students s LEFT JOIN student_profiles sp ON sp.school_id=s.school_id AND (sp.student_master_id=s.id OR sp.student_id=s.permanent_student_id)
      WHERE s.school_id=? AND COALESCE(s.is_test_record,0)=0 AND (?='' OR LOWER(CONCAT_WS(' ',s.first_name,s.middle_name,s.last_name,s.permanent_student_id,s.admission_number)) LIKE ?)
      ORDER BY s.last_name,s.first_name,s.id`, [schoolId, String(query ?? '').trim(), term]));
    return found.map((row) => normalized(row, { id: row.profile_id, first_name: row.profile_first_name, last_name: row.profile_last_name, class_id: row.profile_class_id }));
  }
  async function update(identifier, input, actor) {
    const current = await getStudent(identifier, actor);
    if (!current) throw error('Student not found.', 404);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw error('Profile payload must be an object.');
    const allowed = new Set([...Object.keys(STUDENT_FIELDS), 'family']);
    if (Object.keys(input).some((key) => !allowed.has(key))) throw error('Unsupported student profile field.');
    if (input.firstName !== undefined && !String(input.firstName).trim()) throw error('First name is required.');
    if (input.surname !== undefined && !String(input.surname).trim()) throw error('Surname is required.');
    const timestamp = clock();
    const studentRow = rows(await database.query('SELECT * FROM students WHERE school_id=? AND (id=? OR permanent_student_id=?) LIMIT 1', [actor.schoolId, identifier, identifier]))[0];
    const profileRow = await profileForStudent(studentRow.id, actor.schoolId);
    const updateTable = async (table, row, fields) => {
      if (!row || !Object.keys(fields).length) return;
      const map = columnMap(row); const assignments = []; const params = [];
      for (const [field, raw] of Object.entries(fields)) { const column = findColumn(map, STUDENT_FIELDS[field]); if (column) { assignments.push(`${column}=?`); params.push(raw === null ? null : String(raw).trim()); } }
      const updatedAt = map.get('updated_at') ?? map.get('updatedat'); if (updatedAt) { assignments.push(`${updatedAt}=?`); params.push(timestamp); }
      if (assignments.length) await database.execute(`UPDATE ${table} SET ${assignments.join(',')} WHERE id=? AND school_id=?`, [...params, row.id, actor.schoolId]);
    };
    const fields = Object.fromEntries(Object.keys(STUDENT_FIELDS).filter((key) => Object.prototype.hasOwnProperty.call(input, key)).map((key) => [key, input[key]]));
    if (Object.keys(fields).length) {
      await updateTable('students', studentRow, fields);
      await updateTable('student_profiles', profileRow, fields);
    }
    if (Array.isArray(input.family) && profileRow) {
      for (const contact of input.family) {
        if (!contact?.fullName && !contact?.telephone) continue;
        let existing;
        try { existing = rows(await database.query('SELECT * FROM student_family_contacts WHERE student_id=? AND student_id IN (SELECT id FROM student_profiles WHERE school_id=?) ORDER BY created_at,id LIMIT 1', [profileRow.id, actor.schoolId]))[0]; } catch { existing = rows(await database.query('SELECT * FROM student_family_contacts WHERE student_id=? ORDER BY created_at,id LIMIT 1', [profileRow.id]))[0]; }
        const contactId = existing?.id ?? idFactory();
        if (existing) await database.execute('UPDATE student_family_contacts SET full_name=?,relationship=?,telephone=?,alternative_phone=?,updated_at=? WHERE id=? AND student_id=?', [contact.fullName ?? null, contact.relationship ?? null, contact.telephone ?? null, contact.alternativePhone ?? null, timestamp, contactId, profileRow.id]);
        else await database.execute('INSERT INTO student_family_contacts (id,student_id,contact_type,full_name,relationship,telephone,alternative_phone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)', [contactId, profileRow.id, contact.contactType ?? 'GUARDIAN', contact.fullName ?? 'Guardian', contact.relationship ?? 'Guardian', contact.telephone ?? null, contact.alternativePhone ?? null, timestamp, timestamp]);
        break;
      }
    }
    return getStudent(current.id, actor);
  }
  return Object.freeze({ getStudent, search, update });
}
