import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStaffService } from '../src/staff.js';
import { createSignatureService } from '../src/signatures.js';

test('signature profiles require name, valid Ghana phone, and secure signature reference', () => {
  const staff = createStaffService(); const signatures = createSignatureService({ staff });
  const manager = { id: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  assert.throws(() => signatures.upload({ signatoryRole: 'HEADTEACHER', mimeType: 'image/png', size: 10, storageKey: 'signatures/head.png' }, manager), /Full name is required/);
  assert.throws(() => signatures.upload({ signatoryRole: 'HEADTEACHER', fullName: 'Head', phone: '123', mimeType: 'image/png', size: 10, storageKey: 'signatures/head.png' }, manager), /Invalid Ghana phone number/);
  assert.throws(() => signatures.upload({ signatoryRole: 'HEADTEACHER', fullName: 'Head', phone: '0241234567', mimeType: 'image/png', size: 10, storageKey: 'https://evil.test/head.png' }, manager), /secure signature reference/);
  assert.throws(() => signatures.upload({ signatoryRole: 'HEADTEACHER', fullName: 'Head', phone: '0241234567', mimeType: 'image/png', size: 0, storageKey: 'signatures/head.png' }, manager), /too large or invalid/);
});

test('signature profiles prefill canonical staff name and phone and preserve valid profile on failed replacement', () => {
  const staff = createStaffService(); const head = staff.createProfile({ fullName: 'Headteacher One', phone: '0241234567', roleKey: 'HEADTEACHER' });
  const signatures = createSignatureService({ staff }); const manager = { id: head.id, roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  const saved = signatures.upload({ signatoryRole: 'HEADTEACHER', mimeType: 'image/png', size: 10, storageKey: 'signatures/head.png' }, manager);
  assert.equal(saved.fullName, 'Headteacher One'); assert.equal(saved.phone, '0241234567');
  assert.throws(() => signatures.upload({ signatoryRole: 'HEADTEACHER', fullName: 'Changed', phone: 'bad', mimeType: 'image/png', size: 10, storageKey: 'signatures/new.png' }, manager), /Invalid Ghana phone number/);
  assert.equal(signatures.list(manager).find((item) => item.active).storageKey, 'signatures/head.png');
});

test('cross-school resolution is rejected and assigned teacher identity is canonical', () => {
  const staff = createStaffService(); const teacher = staff.createProfile({ fullName: 'Assigned Teacher', phone: '0241234568', roleKey: 'TEACHER' });
  staff.assign(teacher.id, { classId: 'Primary 1', academicYearId: '2026/2027', termId: 'First Term' });
  const signatures = createSignatureService({ staff }); const manager = { id: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  signatures.upload({ signatoryRole: 'CLASS_TEACHER', classId: 'Primary 1', teacherId: teacher.id, academicYear: '2026/2027', term: 'First Term', mimeType: 'image/png', size: 10, storageKey: 'signatures/teacher.png' }, manager);
  assert.throws(() => signatures.resolveForStudent({ schoolId: 'another-school', classId: 'Primary 1' }, { academicYear: '2026/2027', term: 'First Term' }), /Forbidden/);
  const resolved = signatures.resolveForStudent({ schoolId: 'school-osaah-daylight', classId: 'Primary 1' }, { academicYear: '2026/2027', term: 'First Term' });
  assert.equal(resolved.classTeacher.name, 'Assigned Teacher'); assert.equal(resolved.classTeacher.phone, '0241234568');
});

test('management and result-slip contracts preserve phone, print, and PDF-safe signature output', () => {
  const page = fs.readFileSync(new URL('../public/result-signatures.html', import.meta.url), 'utf8');
  const renderer = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  for (const label of ['Full Name', 'Phone Number', 'SAVE SIGNATURE PROFILE']) assert.match(page, new RegExp(label));
  assert.match(renderer, /signature\?\.phone/); assert.match(renderer, /window\.print/); assert.match(renderer, /Signature not uploaded/);
  assert.match(styles, /signature-grid[^}]*break-inside:avoid/); assert.match(styles, /@media print/); assert.match(styles, /\.signature-box img/);
});
