import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStaffService } from '../src/staff.js';
import { createSignatureService } from '../src/signatures.js';

const uploadInput = (input) => ({ mimeType: 'image/png', processedImageData: 'data:image/png;base64,iVBORw0KGgo=', size: 8, ...input });

test('signature profiles require name, valid Ghana phone, and secure signature reference', () => {
  const staff = createStaffService(); const signatures = createSignatureService({ staff });
  const manager = { id: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  assert.throws(() => signatures.upload(uploadInput({ signatoryRole: 'HEADTEACHER' }), manager), /Full name is required/);
  assert.throws(() => signatures.upload(uploadInput({ signatoryRole: 'HEADTEACHER', fullName: 'Head', phone: '123' }), manager), /Invalid Ghana phone number/);
  assert.throws(() => signatures.upload(uploadInput({ signatoryRole: 'HEADTEACHER', fullName: 'Head', phone: '0241234567', processedImageData: 'invalid' }), manager), /valid processed PNG/);
  assert.throws(() => signatures.upload(uploadInput({ signatoryRole: 'HEADTEACHER', fullName: 'Head', phone: '0241234567', size: 0 }), manager), /image is invalid/);
});

test('signature profiles prefill canonical staff name and phone and preserve valid profile on failed replacement', () => {
  const staff = createStaffService(); const head = staff.createProfile({ fullName: 'Headteacher One', phone: '0241234567', roleKey: 'HEADTEACHER' });
  const signatures = createSignatureService({ staff }); const manager = { id: head.id, roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  const saved = signatures.upload(uploadInput({ signatoryRole: 'HEADTEACHER' }), manager);
  assert.equal(saved.fullName, 'Headteacher One'); assert.equal(saved.phone, '0241234567');
  assert.throws(() => signatures.upload(uploadInput({ signatoryRole: 'HEADTEACHER', fullName: 'Changed', phone: 'bad' }), manager), /Invalid Ghana phone number/);
  assert.match(signatures.list(manager).find((item) => item.active).storageKey, /^signatures\/[0-9a-f-]+\.png$/);
});

test('cross-school resolution is rejected and assigned teacher identity is canonical', () => {
  const staff = createStaffService(); const teacher = staff.createProfile({ fullName: 'Assigned Teacher', phone: '0241234568', roleKey: 'TEACHER' });
  staff.assign(teacher.id, { classId: 'Primary 1', academicYearId: '2026/2027', termId: 'First Term' });
  const signatures = createSignatureService({ staff }); const manager = { id: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  signatures.upload(uploadInput({ signatoryRole: 'CLASS_TEACHER', classId: 'Primary 1', teacherId: teacher.id, academicYear: '2026/2027', term: 'First Term' }), manager);
  assert.throws(() => signatures.resolveForStudent({ schoolId: 'another-school', classId: 'Primary 1' }, { academicYear: '2026/2027', term: 'First Term' }), /Forbidden/);
  const resolved = signatures.resolveForStudent({ schoolId: 'school-osaah-daylight', classId: 'Primary 1' }, { academicYear: '2026/2027', term: 'First Term' });
  assert.equal(resolved.classTeacher.name, 'Assigned Teacher'); assert.equal(resolved.classTeacher.phone, '0241234568');
});

test('signature uploads persist processed PNG and resolve school-wide head plus class-scoped teacher across service instances', async () => {
  const staff = createStaffService();
  const teacher = staff.createProfile({ fullName: 'Assigned Teacher', phone: '0241234568', roleKey: 'TEACHER' });
  const head = staff.createProfile({ fullName: 'Headteacher One', phone: '0241234569', roleKey: 'HEADTEACHER' });
  staff.assign(teacher.id, { classId: 'Primary 1', academicYearId: '2026/2027', termId: 'First Term' });
  const stored = [];
  const database = {
    async execute(sql, params) {
      if (sql.startsWith('UPDATE result_signatures')) for (const row of stored) if (row.id === params[1]) row.active = 0;
      if (sql.includes('INSERT INTO result_signatures')) stored.push({ id: params[0], school_id: params[1], signatory_role: params[2], storage_key: params[3], mime_type: params[4], document_size: params[5], active: 1, uploaded_by: params[6], uploaded_at: params[7], updated_at: params[8], staff_id: params[9], full_name: params[10], phone_number: params[11], class_id: params[12], academic_year: params[13], term: params[14], processed_image_data: params[15] });
      return { affectedRows: 1 };
    },
    async query(sql, params) {
      if (sql.includes('FROM result_signatures WHERE school_id=? ORDER BY')) return stored.map((row) => ({ id: row.id, schoolId: row.school_id, signatoryRole: row.signatory_role, storageKey: row.storage_key, mimeType: row.mime_type, size: row.document_size, teacherId: row.staff_id, fullName: row.full_name, phone: row.phone_number, classId: row.class_id, academicYear: row.academic_year, term: row.term, data: row.processed_image_data, active: row.active, uploadedAt: row.uploaded_at, updatedAt: row.updated_at }));
      return stored.filter((row) => row.school_id === params[0] && row.signatory_role === params[1] && row.active && (!row.class_id || row.class_id === params[2]) && (!row.staff_id || row.staff_id === params[3]) && (!row.academic_year || row.academic_year === params[4]) && (!row.term || row.term === params[5])).map((row) => ({ id: row.id, schoolId: row.school_id, signatoryRole: row.signatory_role, storageKey: row.storage_key, mimeType: row.mime_type, size: row.document_size, teacherId: row.staff_id, fullName: row.full_name, phone: row.phone_number, classId: row.class_id, academicYear: row.academic_year, term: row.term, data: row.processed_image_data, active: row.active, uploadedAt: row.uploaded_at, updatedAt: row.updated_at }));
    },
    async transaction(work) { return work(this); }
  };
  const actor = { id: head.id, roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  const service = createSignatureService({ staff, database });
  await service.uploadDurable(uploadInput({ signatoryRole: 'HEADTEACHER' }), actor);
  await service.uploadDurable(uploadInput({ signatoryRole: 'CLASS_TEACHER', classId: 'Primary 1', teacherId: teacher.id, academicYear: '2026/2027', term: 'First Term' }), actor);

  const restarted = createSignatureService({ staff, database });
  const resolved = await restarted.resolveForStudentDurable({ schoolId: actor.schoolId, classId: 'Primary 1' }, { academicYear: '2026/2027', term: 'First Term' });
  assert.equal(resolved.classTeacher.name, 'Assigned Teacher');
  assert.equal(resolved.classTeacher.signature.data, uploadInput({}).processedImageData);
  assert.equal(resolved.headteacher.name, 'Headteacher One');
  assert.equal(resolved.headteacher.signature.data, uploadInput({}).processedImageData);
  assert.equal((await restarted.listDurable(actor)).length, 2);
});

test('management and result-slip contracts preserve phone, print, and PDF-safe signature output', () => {
  const page = fs.readFileSync(new URL('../public/result-signatures.html', import.meta.url), 'utf8');
  const renderer = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  for (const label of ['Full Name', 'Phone Number', 'Upload Signature', 'SAVE SIGNATURE PROFILE']) assert.match(page, new RegExp(label));
  assert.doesNotMatch(page, /MIME type|Signature file size in bytes|Secure signature reference/);
  const processor = fs.readFileSync(new URL('../public/signature-image-processor.js', import.meta.url), 'utf8');
  assert.match(processor, /createObjectURL/); assert.match(processor, /getImageData/); assert.match(processor, /pixels\[i \+ 3\]/); assert.match(processor, /toDataURL\('image\/png'\)/);
  assert.match(page, /Before|Original image/); assert.match(page, /Processed transparent signature/);
  assert.match(renderer, /signature\?\.phone/); assert.match(renderer, /window\.print/); assert.match(renderer, /Signature not uploaded/);
  assert.match(styles, /signature-grid[^}]*break-inside:avoid/); assert.match(styles, /@media print/); assert.match(styles, /\.signature-box img/);
  const migration = fs.readFileSync(new URL('../schema/090_processed_result_signature_profiles.sql', import.meta.url), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS processed_image_data LONGTEXT/);
  for (const column of ['staff_id', 'full_name', 'phone_number', 'class_id', 'academic_year', 'term']) assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
});
