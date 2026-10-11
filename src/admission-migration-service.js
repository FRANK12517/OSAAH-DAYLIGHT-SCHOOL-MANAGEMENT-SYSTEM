import { createHash, randomUUID } from 'node:crypto';
import { isPermanentStudentId } from './permanent-student-id.js';
import { previewExistingStudentMigration } from './admission-migration-preview.js';

const rows = (value) => Array.isArray(value) ? value : [];
const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const sqlDateTime = (value) => { const date = new Date(value); if (Number.isNaN(date.getTime())) fail('TIMESTAMP_INVALID', 'A valid timestamp is required.', 400); return date.toISOString().slice(0, 19).replace('T', ' '); };
const validYear = (value) => {
  const date = String(value ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ? null : Number(date.slice(0, 4));
};

function previewRow(row, rowPreview = previewExistingStudentMigration([{
  id: row.id,
  firstName: row.first_name,
  surname: row.last_name,
  dateOfBirth: row.date_of_birth,
  admissionDate: row.admission_date,
  permanentStudentId: row.permanent_student_id
}]).records[0], duplicateIdentity = false) {
  const reasons = [...rowPreview.reasons];
  if (duplicateIdentity && !reasons.includes('POSSIBLE_DUPLICATE_IDENTITY')) reasons.push('POSSIBLE_DUPLICATE_IDENTITY');
  if (Number(row.profile_count) !== 1) reasons.push(Number(row.profile_count) > 1 ? 'DUPLICATE_STUDENT_PROFILES' : 'MISSING_STUDENT_PROFILE');
  if (row.profile_id && String(row.profile_master_id ?? '') !== String(row.id)) reasons.push('PROFILE_MASTER_LINK_MISMATCH');
  for (const profileId of [row.profile_student_id, row.profile_legacy_id].filter(Boolean)) {
    if (row.permanent_student_id && profileId !== row.permanent_student_id) reasons.push('PERMANENT_ID_COPY_CONFLICT');
    if (!row.permanent_student_id && profileId) reasons.push('PERMANENT_ID_COPY_CONFLICT');
  }
  if (Number(row.enrollment_count) < 1) reasons.push('MISSING_ENROLLMENT_RECORD');
  const uniqueReasons = [...new Set(reasons)];
  const needsReview = uniqueReasons.length > 0;
  const validId = Boolean(row.permanent_student_id && isPermanentStudentId(row.permanent_student_id));
  return {
    studentRef: String(row.id),
    action: needsReview ? 'MANUAL_REVIEW' : validId ? 'PRESERVE_EXISTING_ID' : 'ASSIGN_ID_FOR_VERIFIED_YEAR',
    admissionYear: validYear(row.admission_date),
    reasons: uniqueReasons
  };
}

export function createAdmissionMigrationService({ database, clock = () => new Date().toISOString(), idFactory = randomUUID } = {}) {
  if (!database?.query || !database?.transaction) fail('DATABASE_ADAPTER_REQUIRED', 'Admission migration persistence is unavailable.', 503);

  async function readRows(schoolId) {
    if (!schoolId) fail('SCHOOL_SCOPE_REQUIRED', 'School scope is required.');
    try {
      return rows(await database.query(`SELECT s.id, s.permanent_student_id, s.first_name, s.last_name,
        CAST(s.date_of_birth AS CHAR) AS date_of_birth,
        LEFT(CAST(s.admission_date AS CHAR),10) AS admission_date,
        COALESCE(p.profile_count,0) AS profile_count, p.profile_id,
        p.profile_master_id, p.profile_student_id, p.profile_legacy_id,
        COALESCE(e.enrollment_count,0) AS enrollment_count
        FROM students s
        LEFT JOIN (
          SELECT school_id, student_master_id, COUNT(*) AS profile_count,
            MIN(id) AS profile_id, MIN(student_master_id) AS profile_master_id,
            MIN(student_id) AS profile_student_id,
            MIN(permanent_student_id) AS profile_legacy_id
          FROM student_profiles WHERE school_id=? AND student_master_id IS NOT NULL
          GROUP BY school_id, student_master_id
        ) p ON p.school_id=s.school_id AND p.student_master_id=s.id
        LEFT JOIN (
          SELECT school_id, student_id, COUNT(*) AS enrollment_count
          FROM student_enrollments GROUP BY school_id, student_id
        ) e ON e.school_id=s.school_id AND e.student_id=s.id
        WHERE s.school_id=? ORDER BY s.id`, [schoolId, schoolId]));
    } catch {
      fail('ADMISSION_SCHEMA_UNAVAILABLE', 'The canonical admission migration schema is unavailable or incomplete.', 503);
    }
  }

  async function preview({ schoolId }) {
    const dbRows = await readRows(schoolId);
    const baseRows = previewExistingStudentMigration(dbRows.map((row) => ({ id: row.id, firstName: row.first_name, surname: row.last_name, dateOfBirth: row.date_of_birth, admissionDate: row.admission_date, permanentStudentId: row.permanent_student_id })));
    const baseByRef = new Map(baseRows.records.map((item) => [item.studentRef, item]));
    const records = dbRows.map((row) => previewRow(row, baseByRef.get(String(row.id))));
    const counts = {
      total: records.length,
      eligible: records.filter((item) => item.action === 'ASSIGN_ID_FOR_VERIFIED_YEAR').length,
      alreadyHasId: records.filter((item) => item.action === 'PRESERVE_EXISTING_ID').length,
      blocked: records.filter((item) => item.action === 'MANUAL_REVIEW').length,
      duplicate: records.filter((item) => item.reasons.includes('POSSIBLE_DUPLICATE_IDENTITY')).length,
      invalidId: records.filter((item) => item.reasons.some((reason) => ['MALFORMED_PERMANENT_STUDENT_ID', 'DUPLICATE_PERMANENT_STUDENT_ID', 'PERMANENT_ID_COPY_CONFLICT'].includes(reason))).length,
      unverifiedYear: records.filter((item) => item.reasons.includes('UNVERIFIED_ADMISSION_YEAR')).length,
      needsPermanentId: records.filter((item) => !dbRows.find((row) => String(row.id) === item.studentRef)?.permanent_student_id).length,
      manualReview: records.filter((item) => item.action === 'MANUAL_REVIEW').length,
      skipped: records.filter((item) => item.action === 'MANUAL_REVIEW').length
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(records)).digest('hex');
    return Object.freeze({ dryRun: true, writesPerformed: 0, schoolId, fingerprint, counts, records });
  }

  async function allocateId(tx, schoolId, year, timestamp) {
    const sequenceTimestamp = sqlDateTime(timestamp);
    await tx.execute('INSERT INTO student_id_sequences (admission_year,next_sequence,updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE next_sequence=next_sequence', [year, 1, sequenceTimestamp]);
    const sequenceRow = rows(await tx.query('SELECT next_sequence FROM student_id_sequences WHERE admission_year=? FOR UPDATE', [year]))[0];
    let next = Number(sequenceRow?.next_sequence);
    if (!Number.isInteger(next) || next < 1) fail('STUDENT_ID_SEQUENCE_INVALID', 'The annual Student ID sequence requires reconciliation.', 409);
    const masterIds = rows(await tx.query('SELECT permanent_student_id FROM students WHERE school_id=? AND permanent_student_id LIKE ? FOR UPDATE', [schoolId, `OSAAH/${year}/%`])).map((row) => row.permanent_student_id);
    const profileRows = rows(await tx.query('SELECT student_id,permanent_student_id FROM student_profiles WHERE school_id=? AND (student_id LIKE ? OR permanent_student_id LIKE ?) FOR UPDATE', [schoolId, `OSAAH/${year}/%`, `OSAAH/${year}/%`]));
    const seen = new Set();
    for (const existing of [...masterIds, ...profileRows.flatMap((row) => [row.student_id, row.permanent_student_id])].filter(Boolean)) {
      const match = new RegExp(`^OSAAH/${year}/(\\d{4})$`).exec(String(existing));
      if (!match) fail('STUDENT_ID_SEQUENCE_CONFLICT', 'Existing Student IDs for this year require manual reconciliation.', 409);
      if (seen.has(existing)) continue;
      seen.add(existing);
      next = Math.max(next, Number(match[1]) + 1);
    }
    if (next > 9999) fail('STUDENT_ID_CAPACITY_EXCEEDED', 'Annual permanent Student ID capacity exceeded.', 409);
    await tx.execute('UPDATE student_id_sequences SET next_sequence=?,updated_at=? WHERE admission_year=?', [next + 1, sequenceTimestamp, year]);
    return `OSAAH/${year}/${String(next).padStart(4, '0')}`;
  }

  async function ensureBatch(tx, { schoolId, requestKey, fingerprint, selectionFingerprint, actorId, count, timestamp }) {
    const id = idFactory();
    await tx.execute(`INSERT INTO admission_migration_batches
      (id,school_id,request_key,preview_fingerprint,selection_fingerprint,actor_user_id,status,requested_count,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'RUNNING',?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key`,
    [id, schoolId, requestKey, fingerprint, selectionFingerprint, actorId, count, timestamp, timestamp]);
    const batch = rows(await tx.query('SELECT * FROM admission_migration_batches WHERE school_id=? AND request_key=? FOR UPDATE', [schoolId, requestKey]))[0];
    if (!batch || batch.preview_fingerprint !== fingerprint || batch.selection_fingerprint !== selectionFingerprint || batch.actor_user_id !== actorId) fail('MIGRATION_BATCH_CONFLICT', 'This migration request key is already bound to another preview, selection, or operator.', 409);
    return batch;
  }

  async function migrateStudent({ schoolId, studentRef, batchId, actorId }) {
    return database.transaction(async (tx) => {
      const existingItem = rows(await tx.query('SELECT * FROM admission_migration_items WHERE batch_id=? AND source_student_id=? FOR UPDATE', [batchId, studentRef]))[0];
      if (existingItem && ['MIGRATED', 'PRESERVED'].includes(existingItem.outcome)) return existingItem;
      const row = rows(await tx.query(`SELECT s.id,s.school_id,s.permanent_student_id,s.first_name,s.last_name,
        CAST(s.date_of_birth AS CHAR) AS date_of_birth,LEFT(CAST(s.admission_date AS CHAR),10) AS admission_date,
        sp.id AS profile_id,sp.student_master_id AS profile_master_id,
        sp.student_id AS profile_student_id,sp.permanent_student_id AS profile_legacy_id,
        (SELECT COUNT(*) FROM student_profiles px WHERE px.school_id=s.school_id AND px.student_master_id=s.id) AS profile_count,
        (SELECT COUNT(*) FROM student_enrollments e WHERE e.school_id=s.school_id AND e.student_id=s.id) AS enrollment_count
        FROM students s LEFT JOIN student_profiles sp ON sp.school_id=s.school_id AND sp.student_master_id=s.id
        WHERE s.school_id=? AND s.id=? FOR UPDATE`, [schoolId, studentRef]))[0];
      if (!row) return recordOutcome(tx, { idFactory, batchId, schoolId, studentRef, actorId, outcome: 'NEEDS_REVIEW', reason: 'STUDENT_NOT_FOUND', timestamp: clock() });
      const duplicateIdentity = rows(await tx.query(`SELECT id FROM students WHERE school_id=?
        AND LOWER(TRIM(first_name))=LOWER(TRIM(?)) AND LOWER(TRIM(last_name))=LOWER(TRIM(?))
        AND date_of_birth=? FOR UPDATE`, [schoolId, row.first_name, row.last_name, row.date_of_birth])).length > 1;
      const candidate = previewRow(row, undefined, duplicateIdentity);
      if (candidate.action === 'MANUAL_REVIEW') return recordOutcome(tx, { idFactory, batchId, schoolId, studentRef, actorId, outcome: 'NEEDS_REVIEW', reason: candidate.reasons[0], timestamp: clock() });
      if (candidate.action === 'PRESERVE_EXISTING_ID') {
        const timestamp = clock();
        await tx.execute(`UPDATE student_profiles SET student_id=COALESCE(student_id,?),
          permanent_student_id=COALESCE(permanent_student_id,?),updated_at=?
          WHERE id=? AND school_id=? AND student_master_id=?`,
        [row.permanent_student_id, row.permanent_student_id, timestamp, row.profile_id, schoolId, row.id]);
        return recordOutcome(tx, { idFactory, batchId, schoolId, studentRef, actorId, outcome: 'PRESERVED', targetStudentId: row.id, permanentStudentId: row.permanent_student_id, timestamp });
      }
      const year = candidate.admissionYear;
      if (!year) return recordOutcome(tx, { idFactory, batchId, schoolId, studentRef, actorId, outcome: 'NEEDS_REVIEW', reason: 'UNVERIFIED_ADMISSION_YEAR', timestamp: clock() });
      const timestamp = clock();
      const permanentStudentId = await allocateId(tx, schoolId, year, timestamp);
      const master = await tx.execute('UPDATE students SET permanent_student_id=?,updated_at=? WHERE school_id=? AND id=? AND permanent_student_id IS NULL', [permanentStudentId, timestamp, schoolId, row.id]);
      if (Number(master?.affectedRows ?? 0) !== 1) fail('STUDENT_CHANGED_DURING_MIGRATION', 'Student changed during migration; refresh the preview.', 409);
      const profile = await tx.execute(`UPDATE student_profiles SET student_id=?,permanent_student_id=?,updated_at=?
        WHERE id=? AND school_id=? AND student_master_id=? AND (student_id IS NULL OR student_id=?)
        AND (permanent_student_id IS NULL OR permanent_student_id=?)`,
      [permanentStudentId, permanentStudentId, timestamp, row.profile_id, schoolId, row.id, permanentStudentId, permanentStudentId]);
      if (Number(profile?.affectedRows ?? 0) !== 1) fail('PROFILE_CHANGED_DURING_MIGRATION', 'Student profile changed during migration; refresh the preview.', 409);
      return recordOutcome(tx, { idFactory, batchId, schoolId, studentRef, actorId, outcome: 'MIGRATED', targetStudentId: row.id, permanentStudentId, timestamp });
    });
  }

  async function execute({ schoolId, actorId, requestKey, previewFingerprint, studentRefs }) {
    if (!schoolId || !actorId) fail('SCHOOL_SCOPE_REQUIRED', 'School and operator scope are required.');
    if (!/^[A-Za-z0-9:_-]{8,128}$/.test(String(requestKey ?? ''))) fail('REQUEST_KEY_REQUIRED', 'A stable migration request key is required.');
    if (!/^[a-f0-9]{64}$/i.test(String(previewFingerprint ?? ''))) fail('PREVIEW_FINGERPRINT_REQUIRED', 'A current dry-run fingerprint is required.');
    if (!Array.isArray(studentRefs) || !studentRefs.length || studentRefs.length > 500) fail('STUDENT_SELECTION_REQUIRED', 'Select between 1 and 500 students from the current dry-run.');
    const selected = [...new Set(studentRefs.map(String))];
    if (selected.length !== studentRefs.length) fail('MIGRATION_SELECTION_INVALID', 'Only unique eligible students from the current dry-run can be migrated.', 409);
    const selectionFingerprint = createHash('sha256').update(JSON.stringify(selected)).digest('hex');
    let existingBatch;
    try {
      existingBatch = rows(await database.query('SELECT * FROM admission_migration_batches WHERE school_id=? AND request_key=? LIMIT 1', [schoolId, requestKey]))[0];
    } catch {
      fail('ADMISSION_SCHEMA_UNAVAILABLE', 'The canonical admission migration schema is unavailable or incomplete.', 503);
    }
    if (existingBatch && (existingBatch.preview_fingerprint !== previewFingerprint || existingBatch.selection_fingerprint !== selectionFingerprint || existingBatch.actor_user_id !== actorId)) fail('MIGRATION_BATCH_CONFLICT', 'This migration request key is already bound to another preview, selection, or operator.', 409);
    const current = await preview({ schoolId });
    if (!existingBatch && current.fingerprint !== previewFingerprint) fail('PREVIEW_STALE', 'Student data changed after preview; run a new dry-run.', 409);
    const byRef = new Map(current.records.map((item) => [item.studentRef, item]));
    if (!existingBatch && selected.some((ref) => byRef.get(ref)?.action !== 'ASSIGN_ID_FOR_VERIFIED_YEAR')) fail('MIGRATION_SELECTION_INVALID', 'Only unique eligible students from the current dry-run can be migrated.', 409);
    const timestamp = clock();
    const batch = await database.transaction((tx) => ensureBatch(tx, { schoolId, requestKey, fingerprint: previewFingerprint, selectionFingerprint, actorId, count: selected.length, timestamp }));
    const items = [];
    for (const studentRef of selected) {
      try {
        const item = await migrateStudent({ schoolId, studentRef, batchId: batch.id, actorId });
        items.push({ studentRef, outcome: item.outcome, reason: item.reason_code ?? null, permanentStudentId: item.permanent_student_id ?? null });
      } catch (error) {
        const safeCode = /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'MIGRATION_ITEM_FAILED';
        const saved = await database.transaction((tx) => recordOutcome(tx, { idFactory, batchId: batch.id, schoolId, studentRef, actorId, outcome: 'FAILED', reason: safeCode, timestamp: clock() }));
        items.push({ studentRef, outcome: saved.outcome, reason: safeCode, permanentStudentId: null });
      }
    }
    const summary = {
      total: items.length,
      migrated: items.filter((item) => item.outcome === 'MIGRATED').length,
      preserved: items.filter((item) => item.outcome === 'PRESERVED').length,
      needsReview: items.filter((item) => item.outcome === 'NEEDS_REVIEW').length,
      failed: items.filter((item) => item.outcome === 'FAILED').length
    };
    await database.transaction(async (tx) => {
      await tx.execute(`UPDATE admission_migration_batches SET status=?,completed_count=?,review_count=?,updated_at=? WHERE id=? AND school_id=?`,
        [summary.needsReview || summary.failed ? 'REQUIRES_REVIEW' : 'COMPLETED', summary.migrated + summary.preserved, summary.needsReview + summary.failed, clock(), batch.id, schoolId]);
    });
    return Object.freeze({ dryRun: false, batchId: batch.id, summary, items });
  }

  return Object.freeze({ preview, execute });
}

async function recordOutcome(tx, { idFactory, batchId, schoolId, studentRef, actorId, outcome, reason = null, targetStudentId = null, permanentStudentId = null, timestamp = new Date().toISOString() }) {
  const id = idFactory();
  await tx.execute(`INSERT INTO admission_migration_items
    (id,batch_id,school_id,source_student_id,target_student_id,permanent_student_id,outcome,reason_code,actor_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE target_student_id=VALUES(target_student_id),
    permanent_student_id=VALUES(permanent_student_id),outcome=VALUES(outcome),reason_code=VALUES(reason_code),
    actor_user_id=VALUES(actor_user_id),updated_at=VALUES(updated_at)`,
  [id, batchId, schoolId, studentRef, targetStudentId, permanentStudentId, outcome, reason, actorId, timestamp, timestamp]);
  return { outcome, reason_code: reason, target_student_id: targetStudentId, permanent_student_id: permanentStudentId };
}
