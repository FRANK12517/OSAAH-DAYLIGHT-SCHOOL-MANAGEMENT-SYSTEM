import { loadConfiguredDatabaseAdapter } from '../src/ai/durable-stores.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const DATABASE = 'osaahdaylightschool';
const SCHOOL_ID = 'sch_default_01';
const PARENT_ID = '97324d93-d2cd-11f1-acd1-4ad4f02e631a';
const PARENT_PHONE = '0247293733';
const PROFILE_ID = 'stud_sample_01';
const INVALID_STUDENT_ID = 'DEFAULT_STUDENT';
const rows = (value) => Array.isArray(value) ? value : [];
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export async function repairParentPortalSample(database) {
  if (!database?.query || !database?.execute || !database?.transaction) fail('DATABASE_ADAPTER_REQUIRED', 'A transactional database adapter is required.');
  return database.transaction(async (tx) => {
    const meta = rows(await tx.query('SELECT DATABASE() AS databaseName, VERSION() AS serverVersion, @@version_comment AS versionComment'))[0];
    if (meta?.databaseName !== DATABASE) fail('DATABASE_TARGET_MISMATCH', `Expected database ${DATABASE}.`);
    if (!/tidb/i.test(`${meta.serverVersion ?? ''} ${meta.versionComment ?? ''}`)) fail('DATABASE_VERSION_UNVERIFIED', 'Server did not identify itself as TiDB; this procedure is intended only for the configured TiDB runtime.');

    const schools = rows(await tx.query('SELECT id FROM schools WHERE id=? FOR UPDATE', [SCHOOL_ID]));
    if (schools.length !== 1) fail('SCHOOL_PRECONDITION_FAILED', 'Expected exactly one canonical school.');
    const parents = rows(await tx.query('SELECT id,school_id AS schoolId,phone,status FROM users WHERE id=? FOR UPDATE', [PARENT_ID]));
    if (parents.length !== 1 || parents[0].phone !== PARENT_PHONE || !['DEFAULT_SCHOOL', SCHOOL_ID].includes(parents[0].schoolId) || String(parents[0].status ?? 'ACTIVE').toUpperCase() !== 'ACTIVE') fail('PARENT_PRECONDITION_FAILED', 'Parent identity, school, phone, or active status does not match the approved precondition.');
    const profiles = rows(await tx.query('SELECT id,school_id AS schoolId,student_id AS permanentStudentId,student_master_id AS studentMasterId,admission_number AS admissionNumber,first_name AS firstName,surname FROM student_profiles WHERE id=? FOR UPDATE', [PROFILE_ID]));
    if (profiles.length !== 1 || profiles[0].schoolId !== SCHOOL_ID || profiles[0].firstName !== 'Kofi' || profiles[0].surname !== 'Mensah' || profiles[0].permanentStudentId !== 'EDUT2026001' || profiles[0].admissionNumber !== 'ADM/2026/001') fail('PROFILE_PRECONDITION_FAILED', 'Approved Kofi Mensah profile does not match the expected identity and canonical school.');

    const links = rows(await tx.query('SELECT parent_user_id AS parentUserId,student_id AS studentId,link_status AS linkStatus FROM parent_student_links WHERE parent_user_id=? FOR UPDATE', [PARENT_ID]));
    const oldLinks = links.filter((link) => link.studentId === INVALID_STUDENT_ID);
    const targetLinks = links.filter((link) => link.studentId === PROFILE_ID);
    if (links.some((link) => ![INVALID_STUDENT_ID, PROFILE_ID].includes(link.studentId))) fail('LINK_CONFLICT', 'Parent has another linked profile; refusing to guess which link to change.');
    if (oldLinks.length > 1 || targetLinks.length > 1) fail('LINK_DUPLICATE', 'Duplicate source or target relationships exist.');
    if (oldLinks.length && targetLinks.length) fail('LINK_CONFLICT', 'Both invalid and target links exist; manual reconciliation is required.');
    if (!oldLinks.length && !targetLinks.length) fail('LINK_PRECONDITION_FAILED', 'Expected existing or already-repaired relationship is absent.');
    if ([...oldLinks, ...targetLinks].some((link) => String(link.linkStatus ?? '').toUpperCase() !== 'ACTIVE')) fail('LINK_INACTIVE', 'The approved parent relationship is not active; refusing to activate it implicitly.');

    const roles = rows(await tx.query('SELECT id FROM roles WHERE school_id=? AND role_key=? FOR UPDATE', [SCHOOL_ID, 'PARENT']));
    if (roles.length > 1) fail('ROLE_DUPLICATE', 'Duplicate school-scoped PARENT roles exist.');
    let roleId = roles[0]?.id ?? null;
    if (!roleId) {
      roleId = `role-${SCHOOL_ID}-parent`;
      const conflicts = rows(await tx.query('SELECT id FROM roles WHERE id=? FOR UPDATE', [roleId]));
      if (conflicts.length) fail('ROLE_ID_CONFLICT', 'Deterministic role ID is already occupied.');
    }

    const assignments = rows(await tx.query('SELECT ur.role_id AS roleId,r.school_id AS schoolId,r.role_key AS roleKey FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? FOR UPDATE', [PARENT_ID]));
    if (assignments.some((item) => item.roleKey === 'PARENT' && item.schoolId !== SCHOOL_ID)) fail('ROLE_ASSIGNMENT_CONFLICT', 'Parent has a conflicting PARENT role outside the canonical school.');
    const assigned = assignments.some((item) => item.roleId === roleId);
    const masterId = profiles[0].studentMasterId;
    const master = masterId ? rows(await tx.query('SELECT id,school_id AS schoolId,permanent_student_id AS permanentStudentId,admission_number AS admissionNumber,first_name AS firstName,last_name AS lastName FROM students WHERE id=? FOR UPDATE', [masterId])) : [];
    if (master.length !== 1 || master[0].schoolId !== SCHOOL_ID || master[0].permanentStudentId !== profiles[0].permanentStudentId || master[0].admissionNumber !== profiles[0].admissionNumber || master[0].firstName !== 'Kofi' || master[0].lastName !== 'Mensah') fail('STUDENT_MASTER_UNRESOLVED', 'Profile must point to the verified Kofi Mensah master with matching school, permanent ID, and admission number before repair.');

    // All reads, identity checks, and conflict checks complete above. Writes
    // start here and remain inside the adapter-owned transaction.
    if (roles.length === 0) {
      const timestamp = new Date().toISOString();
      const inserted = await tx.execute('INSERT INTO roles (id,school_id,role_key,role_name,oversight_rank,created_at,updated_at) VALUES (?,?,?,?,?,?,?)', [roleId, SCHOOL_ID, 'PARENT', 'Parent', 0, timestamp, timestamp]);
      if (Number(inserted?.affectedRows) !== 1) fail('ROLE_INSERT_FAILED', 'Expected to create exactly one PARENT role.');
    }

    if (parents[0].schoolId !== SCHOOL_ID) {
      const result = await tx.execute("UPDATE users SET school_id=? WHERE id=? AND school_id=? AND phone=? AND UPPER(COALESCE(status,'ACTIVE'))='ACTIVE'", [SCHOOL_ID, PARENT_ID, parents[0].schoolId, PARENT_PHONE]);
      if (Number(result?.affectedRows) !== 1) fail('PARENT_SCHOOL_UPDATE_FAILED', 'Expected exactly one account school update.');
    }
    if (!assigned) {
      const result = await tx.execute('INSERT INTO user_roles (user_id,role_id,created_at) VALUES (?,?,?)', [PARENT_ID, roleId, new Date().toISOString()]);
      if (Number(result?.affectedRows) !== 1) fail('ROLE_ASSIGNMENT_FAILED', 'Expected exactly one role assignment.');
    }
    if (oldLinks.length) {
      const result = await tx.execute('UPDATE parent_student_links SET student_id=? WHERE parent_user_id=? AND student_id=?', [PROFILE_ID, PARENT_ID, INVALID_STUDENT_ID]);
      if (Number(result?.affectedRows) !== 1) fail('LINK_UPDATE_FAILED', 'Expected exactly one existing link update.');
    }

    const verification = rows(await tx.query(`SELECT psl.parent_user_id AS parentUserId,psl.student_id AS studentId,psl.link_status AS linkStatus,u.school_id AS parentSchoolId,u.status AS parentStatus,u.phone AS parentPhone,sp.school_id AS profileSchoolId,r.id AS roleId,r.role_key AS roleKey,r.school_id AS roleSchoolId FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id JOIN parent_student_links psl ON psl.parent_user_id=u.id JOIN student_profiles sp ON sp.id=psl.student_id WHERE u.id=? AND psl.student_id=?`, [PARENT_ID, PROFILE_ID]));
    if (verification.length !== 1 || verification[0].parentSchoolId !== SCHOOL_ID || verification[0].profileSchoolId !== SCHOOL_ID || verification[0].roleSchoolId !== SCHOOL_ID || verification[0].roleKey !== 'PARENT' || verification[0].parentPhone !== PARENT_PHONE || String(verification[0].parentStatus ?? '').toUpperCase() !== 'ACTIVE' || String(verification[0].linkStatus ?? '').toUpperCase() !== 'ACTIVE') fail('POSTCHECK_FAILED', 'Post-write verification failed.');
    const masterCheck = rows(await tx.query(`SELECT sp.student_master_id AS studentMasterId,sp.school_id AS profileSchoolId,sp.student_id AS profilePermanentStudentId,sp.admission_number AS profileAdmissionNumber,s.id AS masterId,s.school_id AS masterSchoolId,s.permanent_student_id AS masterPermanentStudentId,s.admission_number AS masterAdmissionNumber,s.first_name AS masterFirstName,s.last_name AS masterLastName FROM student_profiles sp JOIN students s ON s.id=sp.student_master_id WHERE sp.id=?`, [PROFILE_ID]));
    if (masterCheck.length !== 1 || masterCheck[0].studentMasterId !== masterId || masterCheck[0].profileSchoolId !== SCHOOL_ID || masterCheck[0].masterSchoolId !== SCHOOL_ID || masterCheck[0].profilePermanentStudentId !== masterCheck[0].masterPermanentStudentId || masterCheck[0].profileAdmissionNumber !== masterCheck[0].masterAdmissionNumber || masterCheck[0].masterFirstName !== 'Kofi' || masterCheck[0].masterLastName !== 'Mensah') fail('MASTER_POSTCHECK_FAILED', 'Student profile/master identity verification failed.');
    return { ok: true, database: DATABASE, serverVersion: meta.serverVersion, changes: { parentSchoolChanged: parents[0].schoolId !== SCHOOL_ID, roleCreated: roles.length === 0, roleAssigned: !assigned, linkChanged: oldLinks.length === 1 }, studentMaster: masterCheck[0], postcheck: verification[0] };
  });
}

async function main() {
  if (process.env.OSAAH_DATABASE_ADAPTER !== 'tidb') fail('TIDB_SELECTION_REQUIRED', 'Set OSAAH_DATABASE_ADAPTER=tidb explicitly.');
  if (process.argv[2] !== '--apply' || process.env.PARENT_SAMPLE_REPAIR_APPROVAL !== 'APPROVED_FOR_MANUAL_EXECUTION' || !process.env.PARENT_SAMPLE_REPAIR_BACKUP_CONFIRMATION?.trim()) {
    fail('EXPLICIT_REPAIR_GATES_REQUIRED', 'This runner writes data. Review it, take a backup, and set the explicit approval and backup confirmations before passing --apply.');
  }
  const database = await loadConfiguredDatabaseAdapter();
  try { process.stdout.write(`${JSON.stringify(await repairParentPortalSample(database), null, 2)}\n`); }
  finally { await database.close?.(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch((error) => {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'PARENT_REPAIR_FAILED';
  process.stderr.write(`${code}: repair did not complete; review the approved preconditions and server diagnostics without sharing connection details.\n`);
  process.exitCode = 1;
});
