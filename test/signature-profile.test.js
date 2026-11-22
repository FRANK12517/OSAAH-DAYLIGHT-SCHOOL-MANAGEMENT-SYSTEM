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
  const columns = new Set(['id', 'school_id', 'storage_key', 'mime_type', 'document_size', 'active', 'uploaded_by', 'uploaded_at', 'updated_at']);
  const addedColumns = [];
  const database = {
    async execute(sql, params) {
      if (sql.startsWith('ALTER TABLE result_signatures')) {
        const column = sql.match(/ADD COLUMN IF NOT EXISTS `?([a-z_]+)`?/i)?.[1];
        if (column) { columns.add(column); addedColumns.push(column); }
      }
      if (sql.startsWith('UPDATE result_signatures')) for (const row of stored) if (row.school_id === params[1] && (row.signatory_role ?? row.role) === params[2]) row.active = 0;
      if (sql.includes('INSERT INTO result_signatures')) {
        const names = sql.match(/INSERT INTO result_signatures \(([^)]+)\)/)[1].split(',');
        assert.ok(names.includes('`role`'));
        assert.ok(names.includes('`signatory_role`'));
        stored.push(Object.fromEntries(names.map((name, index) => [name.replaceAll('`', ''), params[index]])));
      }
      return { affectedRows: 1 };
    },
    async query(sql, params) {
      // Match the reported production schema: neither role field nor migration
      // 090's profile columns have been applied yet.
      if (sql.includes('information_schema.COLUMNS')) return [...columns].map((columnName) => ({ columnName }));
      const map = (row) => ({ id: row.id, schoolId: row.school_id, signatoryRole: row.signatory_role ?? row.role, storageKey: row.storage_key, mimeType: row.mime_type, size: row.document_size, teacherId: row.staff_id, fullName: row.full_name, phone: row.phone_number, classId: row.class_id, academicYear: row.academic_year, term: row.term, data: row.processed_image_data, active: row.active, uploadedAt: row.uploaded_at, updatedAt: row.updated_at });
      if (sql.includes('FROM result_signatures WHERE school_id=? ORDER BY')) return stored.map(map);
      const where = sql.slice(sql.indexOf(' WHERE '));
      const isClassTeacher = params.includes('CLASSTEACHER');
      const expectedRole = isClassTeacher ? 'CLASS_TEACHER' : 'HEADTEACHER';
      return stored.filter((row) => {
        if (row.school_id !== params[0] || row.active !== 1 || (row.signatory_role ?? row.role) !== expectedRole) return false;
        if (!isClassTeacher) return true; // Headteacher signatures are school-wide.
        if (!where.includes('`class_id` IN') || !where.includes('`academic_year` IN') || !where.includes('`term` IN')) return false;
        return params.includes(row.class_id) && params.includes(row.academic_year) && params.includes(row.term);
      }).map(map);
    },
    async transaction(work) { return work(this); }
  };
  const actor = { id: head.id, roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  const service = createSignatureService({ staff, database });
  await service.uploadDurable(uploadInput({ role: 'HEADTEACHER', full_name: 'Headteacher One', phone_number: '0241234569' }), actor);
  await service.uploadDurable(uploadInput({ signatoryRole: 'CLASS_TEACHER', classId: 'Primary 1', teacherId: teacher.id, academicYear: '2026/2027', term: 'First Term' }), actor);

  const restarted = createSignatureService({ staff, database });
  const resolved = await restarted.resolveForStudentDurable({ schoolId: actor.schoolId, classId: 'Primary 1' }, { academicYear: '2026/2027', term: 'First Term' });
  assert.equal(resolved.classTeacher.name, 'Assigned Teacher');
  assert.equal(resolved.classTeacher.signature.data, uploadInput({}).processedImageData);
  assert.equal(resolved.headteacher.name, 'Headteacher One');
  assert.equal(resolved.headteacher.signature.data, uploadInput({}).processedImageData);
  assert.equal((await restarted.listDurable(actor)).length, 2);
  assert.ok(addedColumns.includes('role'));
  assert.ok(addedColumns.includes('signatory_role'));
  assert.ok(addedColumns.includes('processed_image_data'));
});

test('durable slip binding uses global headteacher metadata and the explicitly designated class-year-term teacher', async () => {
  const staff = createStaffService();
  const teacher = staff.createProfile({ fullName: 'KG Class Teacher', phone: '0241234568', roleKey: 'TEACHER' });
  const previousTeacher = staff.createProfile({ fullName: 'Previously Assigned Teacher', phone: '0241234567', roleKey: 'TEACHER' });
  staff.assign(previousTeacher.id, { classId: 'KG 1', academicYearId: 'year-2026', termId: 'term-1' });
  staff.assign(teacher.id, { classId: 'KG 1', academicYearId: 'year-2026', termId: 'term-1' });
  const columns = ['id','school_id','role','signatory_role','staff_id','full_name','phone_number','class_id','academic_year','term','processed_image_data','storage_key','mime_type','document_size','active','uploaded_at'];
  const records = [
    { id: 'head-global', school_id: 'school-osaah-daylight', role: 'PROPRIETOR_SIGNATURE', signatory_role: 'PROPRIETOR_SIGNATURE', staff_id: 'former-head-id', class_id: null, academic_year: '2024/2025', term: 'Old Term', full_name: 'School Head', phone_number: '0241234569', processed_image_data: uploadInput({}).processedImageData, active: 1 },
    { id: 'teacher-kg', school_id: 'school-osaah-daylight', role: 'CLASS_TEACHER_SIGNATURE', signatory_role: 'CLASS_TEACHER_SIGNATURE', staff_id: teacher.id, class_id: 'KG 1', academic_year: '2026/2027', term: '1st Term', full_name: 'KG Class Teacher', phone_number: '0241234568', processed_image_data: uploadInput({}).processedImageData, active: 1 },
    { id: 'teacher-kg-mock', school_id: 'school-osaah-daylight', role: 'CLASS_TEACHER', signatory_role: 'CLASS_TEACHER', staff_id: teacher.id, class_id: 'KG 1', academic_year: '2026/2027', term: '1st Mock', full_name: 'KG Mock Class Teacher', phone_number: '0241234566', processed_image_data: uploadInput({}).processedImageData, active: 1 },
    { id: 'teacher-nursery', school_id: 'school-osaah-daylight', role: 'CLASS_TEACHER', signatory_role: 'CLASS_TEACHER', staff_id: teacher.id, class_id: 'Nursery 1', academic_year: '2026/2027', term: '1st Term', full_name: 'Wrong Class Teacher', phone_number: '0241234567', active: 1 }
  ];
  const database = {
    async query(sql, params = []) {
      if (sql.includes('information_schema.COLUMNS')) return columns.map((columnName) => ({ columnName }));
      const where = sql.slice(sql.indexOf(' WHERE '));
      const quote = String.fromCharCode(96);
      const isTeacher = params.includes('CLASSTEACHER');
      if (!isTeacher) assert.doesNotMatch(where, /\b(?:class_id|staff_id|academic_year|term)\b/);
      const matchingRecords = records.filter((record) => {
        if (record.school_id !== params[0] || !record.active) return false;
        const normalizedRole = String(record.signatory_role || record.role).toUpperCase().replace(/[ _-]/g, '');
        if (isTeacher) {
          return normalizedRole.startsWith('CLASSTEACHER') && where.includes(quote+'class_id'+quote+' IN') && where.includes(quote+'academic_year'+quote+' IN') && where.includes(quote+'term'+quote+' IN') && params.includes(record.class_id) && params.includes(record.academic_year) && params.includes(record.term);
        }
        return ['HEADTEACHER','HEADTEACHERSIGNATURE','PROPRIETOR','PROPRIETORSIGNATURE','PRINCIPAL','SCHOOLHEAD','HEAD'].includes(normalizedRole);
      });
      if (isTeacher) matchingRecords.sort((left, right) => Number(right.term === params.at(-1)) - Number(left.term === params.at(-1)));
      return matchingRecords.slice(0, 1).map((record) => ({ id: record.id, signatoryRole: record.signatory_role || record.role, storageKey: record.storage_key || '', fullName: record.full_name, phone: record.phone_number, classId: record.class_id, academicYear: record.academic_year, term: record.term, data: record.processed_image_data || null, active: record.active, uploadedAt: record.uploaded_at }));
    }
  };
  const signatures = createSignatureService({ staff, database });
  const context = { academicYear: '2026/2027', academicYearValues: ['year-2026','2026/2027'], term: '1st Term', termValues: ['term-1','1st Term'], className: 'KG 1' };
  const resolved = await signatures.resolveForStudentDurable({ schoolId: 'school-osaah-daylight', classId: 'class_kg1_01' }, context);
  assert.equal(resolved.headteacher.name, 'School Head');
  assert.equal(resolved.headteacher.signature.phone, '0241234569');
  assert.equal(resolved.headteacher.signature.processedImageData, uploadInput({}).processedImageData);
  assert.equal(resolved.classTeacher.name, 'KG Class Teacher');
  assert.equal(resolved.classTeacher.signature.name, 'KG Class Teacher');
  assert.equal(resolved.classTeacher.signature.phone, '0241234568');
  assert.equal(resolved.classTeacher.signature.data, uploadInput({}).processedImageData);
  const mockResolved = await signatures.resolveForStudentDurable({ schoolId: 'school-osaah-daylight', classId: 'class_kg1_01' }, { ...context, mockLabel: '1st Mock', termValues: ['1st Mock','1st Term','term-1'] });
  assert.equal(mockResolved.classTeacher.name, 'KG Mock Class Teacher');
  assert.equal(mockResolved.classTeacher.signature.phone, '0241234566');
  assert.equal(mockResolved.headteacher.name, 'School Head');
  const otherClass = await signatures.resolveForStudentDurable({ schoolId: 'school-osaah-daylight', classId: 'class_nursery1_01' }, { ...context, className: 'Nursery 1' });
  assert.equal(otherClass.classTeacher.name, 'Wrong Class Teacher');
  assert.equal(otherClass.classTeacher.signature.classId, 'Nursery 1', 'each class resolves only its own designated profile');
  const otherTerm = await signatures.resolveForStudentDurable({ schoolId: 'school-osaah-daylight', classId: 'class_kg1_01' }, { ...context, term: '2nd Term', termValues: ['term-2','2nd Term'] });
  assert.equal(otherTerm.classTeacher.signature, null);
});

test('durable signature options list active school teachers and durable save uses the selected registered identity', async () => {
  const columns = ['id','school_id','role','signatory_role','staff_id','full_name','phone_number','class_id','academic_year','term','processed_image_data','storage_key','mime_type','document_size','active','uploaded_by','uploaded_at','updated_at'];
  const teachers = [
    { id: 'staff-1', staffId: 'T-001', name: 'Ama Teacher', phone: '0241234567' },
    { id: 'staff-1', staffId: 'T-001', name: 'Ama Teacher', phone: '0241234567' },
    { id: 'staff-2', staffId: 'T-002', name: 'Ama Teacher', phone: '0241234568' }
  ];
  const executed = [];
  const database = {
    async query(sql, params = []) {
      if (sql.includes('information_schema.COLUMNS')) return columns.map((columnName) => ({ columnName }));
      if (sql.includes('FROM staff s')) {
        if (sql.includes('WHERE s.id=?')) return teachers.filter((item) => item.id === params[0]).slice(0, 1);
        assert.deepEqual(params, ['school-osaah-daylight']);
        return teachers;
      }
      if (sql.includes('FROM result_signatures')) return [];
      throw new Error(`Unexpected signature query: ${sql}`);
    },
    async execute(sql, params) { executed.push({ sql, params }); return { affectedRows: 1 }; },
    async transaction(work) { return work(this); }
  };
  const signatures = createSignatureService({ database });
  const manager = { id: 'manager', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  const options = await signatures.optionsDurable(manager);
  assert.equal(options.teachers.length, 2, 'duplicates from role joins are collapsed by staff ID');
  assert.deepEqual(options.teachers.map((item) => item.staffId), ['T-001', 'T-002']);
  assert.equal(options.teachers.every((item) => item.classIds.length === 0), true, 'the complete school teacher list is not hidden by class assignment filters');
  const saved = await signatures.uploadDurable(uploadInput({ signatoryRole: 'CLASS_TEACHER', classId: 'KG1', teacherId: 'staff-2', academicYear: '2026/2027', term: 'First Term', fullName: 'Forged Client Name', phone: '0241234567' }), manager);
  assert.equal(saved.teacherId, 'staff-2');
  assert.equal(saved.fullName, 'Ama Teacher');
  assert.equal(saved.phone, '0241234568');
  assert.match(executed.at(-1).sql, /INSERT INTO result_signatures/);
  assert.ok(executed.at(-1).params.includes('staff-2'));
});

test('signature schema bootstrap tolerates denied DDL and uses verified legacy role columns', async () => {
  const baseColumns = ['id', 'school_id', 'storage_key', 'mime_type', 'document_size', 'active', 'uploaded_by', 'uploaded_at', 'updated_at', 'staff_id', 'full_name', 'phone_number', 'class_id', 'academic_year', 'term', 'processed_image_data'];
  const legacyRoleDb = {
    async execute() { throw Object.assign(new Error('ALTER denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1142 }); },
    async query(sql) {
      if (sql.includes('information_schema.COLUMNS')) return [...baseColumns, 'signature_role'].map((columnName) => ({ columnName }));
      assert.match(sql, /`signature_role`/);
      return [];
    }
  };
  const actor = { id: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  assert.deepEqual(await createSignatureService({ database: legacyRoleDb }).listDurable(actor), []);

  let noRoleColumns = [...baseColumns];
  const noRoleDb = {
    async execute() { throw Object.assign(new Error('ALTER denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR', errno: 1142 }); },
    async query(sql) { return sql.includes('information_schema.COLUMNS') ? noRoleColumns.map((columnName) => ({ columnName })) : []; }
  };
  const noRoleService = createSignatureService({ database: noRoleDb });
  assert.deepEqual(await noRoleService.listDurable(actor), []);
  await assert.rejects(noRoleService.uploadDurable(uploadInput({ signatoryRole: 'HEADTEACHER', fullName: 'Headteacher One', phone: '0241234569' }), actor), (error) => error.status === 503 && error.code === 'RESULT_SIGNATURE_ROLE_COLUMN_UNAVAILABLE' && /Apply migration 090/.test(error.message));
  noRoleColumns = [...baseColumns, 'role', 'signatory_role'];
  assert.deepEqual(await noRoleService.listDurable(actor), []);

  let inspectionAvailable = false;
  const inspectionFailureService = createSignatureService({ database: { async query(sql) { if (!inspectionAvailable) throw Object.assign(new Error('metadata access denied'), { code: 'ER_TABLEACCESS_DENIED_ERROR' }); return sql.includes('information_schema.COLUMNS') ? [...baseColumns, 'role', 'signatory_role'].map((columnName) => ({ columnName })) : []; }, async execute() { throw new Error('DDL should not run after failed inspection'); } } });
  assert.deepEqual(await inspectionFailureService.listDurable(actor), []);
  await assert.rejects(inspectionFailureService.uploadDurable(uploadInput({ signatoryRole: 'HEADTEACHER', fullName: 'Headteacher One', phone: '0241234569' }), actor), (error) => error.status === 503 && error.code === 'RESULT_SIGNATURE_COLUMN_INSPECTION_UNAVAILABLE');
  inspectionAvailable = true;
  assert.deepEqual(await inspectionFailureService.listDurable(actor), []);
});

test('signature save includes legacy signature_type and signature_url in the live 20-column schema', async () => {
  const columns = ['id', 'school_id', 'staff_id', 'signature_type', 'class_id', 'academic_year', 'signature_url', 'role', 'signatory_role', 'storage_key', 'mime_type', 'document_size', 'active', 'uploaded_by', 'uploaded_at', 'updated_at', 'full_name', 'phone_number', 'term', 'processed_image_data'];
  const statements = [];
  const database = {
    async query(sql) { if (sql.includes('information_schema.COLUMNS')) return columns.map((columnName) => ({ columnName })); return []; },
    async execute() { return { affectedRows: 1 }; },
    async transaction(work) { return work({ async execute(sql, params) {
      statements.push({ sql, params });
      if (sql.startsWith('INSERT INTO result_signatures')) {
        const names = sql.match(/\(([^)]+)\)/)[1].split(',').map((column) => column.replaceAll('`', ''));
        const inserted = Object.fromEntries(names.map((column, index) => [column, params[index]]));
        if (!inserted.signature_type || !inserted.signature_url) throw new Error('NOT NULL legacy signature columns were not populated.');
      }
      return { affectedRows: 1 };
    } }); }
  };
  const actor = { id: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  const uploaded = await createSignatureService({ database }).uploadDurable(uploadInput({ signatoryRole: 'HEADTEACHER', fullName: 'Headteacher One', phone: '0241234569' }), actor);
  const insert = statements.find(({ sql }) => sql.startsWith('INSERT INTO result_signatures'));
  assert.ok(insert);
  const insertedColumns = insert.sql.match(/\(([^)]+)\)/)[1].split(',').map((column) => column.replaceAll('`', ''));
  const inserted = Object.fromEntries(insertedColumns.map((column, index) => [column, insert.params[index]]));
  assert.equal(inserted.signature_type, 'HEADTEACHER');
  assert.equal(inserted.signature_url, uploaded.storageKey);
  assert.equal(inserted.storage_key, uploaded.storageKey);
  assert.equal(inserted.processed_image_data, uploadInput({}).processedImageData);
});

test('signature schema rechecks when active is missing and saves using legacy active defaults', async () => {
  const columns = new Set(['id', 'school_id', 'staff_id', 'signature_type', 'class_id', 'academic_year', 'signature_url', 'role', 'signatory_role', 'storage_key', 'mime_type', 'document_size', 'uploaded_by', 'uploaded_at', 'updated_at', 'full_name', 'phone_number', 'term', 'processed_image_data']);
  const statements = [];
  const database = {
    async query(sql) {
      if (sql.includes('information_schema.COLUMNS')) return [...columns].map((columnName) => ({ columnName }));
      statements.push({ sql, params: [] });
      assert.match(sql, /1 AS active/);
      return [];
    },
    async execute() { return { affectedRows: 1 }; },
    async transaction(work) { return work({ async execute(sql, params) { statements.push({ sql, params }); return { affectedRows: 1 }; } }); }
  };
  const actor = { id: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
  const service = createSignatureService({ database });
  const input = uploadInput({ signatoryRole: 'HEADTEACHER', fullName: 'Headteacher One', phone: '0241234569' });
  await service.uploadDurable(input, actor);
  let inserts = statements.filter(({ sql }) => sql.startsWith('INSERT INTO result_signatures'));
  assert.equal(inserts.length, 1);
  assert.doesNotMatch(inserts[0].sql, /`active`/);
  assert.equal(statements.some(({ sql }) => sql.startsWith('UPDATE result_signatures')), false);

  await service.listDurable(actor);
  columns.add('active');
  await service.uploadDurable(input, actor);
  inserts = statements.filter(({ sql }) => sql.startsWith('INSERT INTO result_signatures'));
  assert.equal(inserts.length, 2);
  assert.match(inserts[1].sql, /`active`/);
  assert.equal(statements.filter(({ sql }) => sql.startsWith('UPDATE result_signatures')).length, 1);
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
  const backend = fs.readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const service = fs.readFileSync(new URL('../src/signatures.js', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../public/result-signatures.js', import.meta.url), 'utf8');
  assert.match(migration, /ADD COLUMN IF NOT EXISTS processed_image_data LONGTEXT/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS signatory_role VARCHAR\(64\) NULL/i);
  for (const column of ['staff_id', 'full_name', 'phone_number', 'class_id', 'academic_year', 'term']) assert.match(migration, new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`));
  assert.match(backend, /\[Result signatures\] list failed/);
  assert.match(backend, /\[Result signatures\] upload failed/);
  assert.match(service, /input\?\.signatoryRole \?\? input\?\.signatory_role \?\? input\?\.role/);
  assert.match(service, /input\?\.processedImageData \?\? input\?\.processed_image_data/);
  assert.match(client, /host\.innerHTML = `<tr><td colspan="6">\$\{esc\(error\.message\)\}<\/td><\/tr>`/);
  assert.match(client, /Select Class Teacher/);
  assert.match(client, /function populateTeachers/);
  assert.match(client, /selectedExistingProfile\(\)\?\.teacherId/);
  assert.match(backend, /signatures\.optionsDurable \? await signatures\.optionsDurable\(user\)/);
});
