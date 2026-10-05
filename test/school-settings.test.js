import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { createApp } from '../src/server.mjs';
import { createAuthService } from '../src/auth.js';
import { createSchoolSettingsService } from '../src/school-settings.js';

const password = 'SettingsTest123!';

function request(server, path, token, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port: server.address().port, path, method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (res) => { let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null })); });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

test('School Settings uses the authenticated canonical school, persists edits, and protects RBAC', async (t) => {
  const auth = createAuthService();
  const admin = auth.login({ username: 'proprietor@osaah.edu.gh', password: 'Proprietor123!', portal: 'school', role: 'PROPRIETOR' });
  const teacher = auth.login({ username: 'teacher@osaah.edu.gh', password: 'Teacher123!', portal: 'school', role: 'TEACHER' });
  assert.equal(admin.ok, true); assert.equal(teacher.ok, true);
  const server = createServer(createApp({ auth })); await new Promise((resolve) => server.listen(0, resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  const page = await new Promise((resolve, reject) => { const req = httpRequest({ port: server.address().port, path: '/settings?embedded=1', headers: { Authorization: `Bearer ${admin.token}` } }, (res) => { let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode, text })); }); req.on('error', reject); req.end(); }); assert.equal(page.status, 200); assert.match(page.text, /School Settings/); assert.match(page.text, /school-settings/);
  const loaded = await request(server, '/api/school-settings', admin.token); assert.equal(loaded.status, 200); assert.equal(loaded.body.schoolId, 'school-osaah-daylight'); assert.equal(loaded.body.profile.name, 'OSAAH DAYLIGHT SCH. COM.');
  const saved = await request(server, '/api/school-settings', admin.token, 'PATCH', { address: 'Bogoso Settings Test' }); assert.equal(saved.status, 200); assert.equal(saved.body.profile.address, 'Bogoso Settings Test');
  const reloaded = await request(server, '/api/school-settings', admin.token); assert.equal(reloaded.body.profile.address, 'Bogoso Settings Test');
  assert.equal((await request(server, '/api/school-settings', teacher.token)).status, 403);
  assert.equal((await request(server, '/api/school-settings', teacher.token, 'PATCH', { address: 'Nope' })).status, 403);
  assert.equal(reloaded.body.schoolId, admin.user.schoolId);
});

test('School Settings maps legacy phone_number columns and persists the complete School Profile payload', async () => {
  const school = { id: 'school-osaah-daylight', name: 'OSAAH DAYLIGHT SCH. COM.', motto: 'AIM HIGH', address: 'Bogoso', phone_number: '0200000000', email: null, website: null, updated_at: '2026-01-01' };
  const storedSettings = new Map();
  const schoolUpdates = [];
  const database = {
    async query(sql) {
      if (sql.startsWith('SELECT id,name,motto')) throw new Error("Unknown column 'telephone'");
      if (sql.startsWith('SELECT * FROM schools')) return [{ ...school }];
      if (sql.startsWith('SELECT setting_key AS')) return [...storedSettings.entries()].map(([settingKey, value]) => ({ settingKey, settingValue: value.settingValue, valueType: value.valueType, updatedAt: value.updatedAt }));
      return [];
    },
    async execute(sql, params) {
      if (sql.startsWith('UPDATE schools SET ')) {
        schoolUpdates.push(sql);
        const columns = sql.slice('UPDATE schools SET '.length, sql.lastIndexOf(' WHERE id=?')).split(',').map((assignment) => assignment.split('=')[0]);
        columns.forEach((column, index) => { school[column] = params[index]; });
      } else if (sql.startsWith('INSERT INTO system_settings')) {
        storedSettings.set(params[2], { settingValue: params[3], valueType: params[4], updatedAt: params[6] });
      } else throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const settings = createSchoolSettingsService({ database });
  const result = await settings.update({
    name: 'OSAAH DAYLIGHT SCHOOL',
    telephone: '0241234567',
    schoolInformation: { name: 'OSAAH DAYLIGHT SCHOOL', telephone: '0241234567', secondaryPhone: '0201234567' }
  }, { schoolId: 'school-osaah-daylight' });

  assert.equal(school.phone_number, '0241234567');
  assert.match(schoolUpdates[0], /phone_number=\?/);
  assert.doesNotMatch(schoolUpdates[0], /telephone=/);
  assert.equal(result.profile.telephone, '0241234567');
  assert.deepEqual(result.settings.find((item) => item.key === 'schoolInformation').value, { name: 'OSAAH DAYLIGHT SCHOOL', telephone: '0241234567', secondaryPhone: '0201234567' });
});

test('School Settings reads older school schemas without optional branding columns', async () => {
  const database = {
    async query(sql) {
      if (sql.startsWith('SELECT id,name,motto')) throw new Error("Unknown column 'primary_colour'");
      if (sql.startsWith('SELECT * FROM schools')) return [{ id: 'school-osaah-daylight', name: 'OSAAH DAYLIGHT SCH. COM.', motto: 'AIM HIGH', address: 'Bogoso', created_at: '2026-01-01', updated_at: '2026-01-01' }];
      return [];
    }
  };
  const settings = createSchoolSettingsService({ database });
  const result = await settings.read({ schoolId: 'school-osaah-daylight' });
  assert.equal(result.schoolId, 'school-osaah-daylight');
  assert.equal(result.profile.name, 'OSAAH DAYLIGHT SCH. COM.');
  assert.equal(result.profile.primaryColour, null);
});

test('School Settings rehydrates legacy branding fields from the persisted schoolInformation setting after restart', async () => {
  const school = { id: 'school-osaah-daylight', name: 'OSAAH DAYLIGHT SCH. COM.', motto: 'AIM HIGH', address: 'Bogoso', phone_number: '0200000000', email: null, website: null, updated_at: '2026-01-01' };
  const storedSettings = new Map();
  const database = {
    async query(sql) {
      if (sql.startsWith('SELECT id,name,motto')) throw new Error("Unknown column 'telephone'");
      if (sql.startsWith('SELECT * FROM schools')) return [{ ...school }];
      if (sql.startsWith('SELECT setting_key AS')) return [...storedSettings.entries()].map(([settingKey, value]) => ({ settingKey, settingValue: value.settingValue, valueType: value.valueType, updatedAt: value.updatedAt }));
      return [];
    },
    async execute(sql, params) {
      if (sql.startsWith('UPDATE schools SET ')) {
        const assignments = sql.slice('UPDATE schools SET '.length, sql.lastIndexOf(' WHERE id=?')).split(',');
        assignments.forEach((assignment, index) => { school[assignment.split('=')[0]] = params[index]; });
      } else if (sql.startsWith('INSERT INTO system_settings')) {
        storedSettings.set(params[2], { settingValue: params[3], valueType: params[4], updatedAt: params[6] });
      } else throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const actor = { schoolId: 'school-osaah-daylight' };
  const firstInstance = createSchoolSettingsService({ database });
  const saved = await firstInstance.update({ name: 'OSAAH DAYLIGHT SCHOOL', telephone: '0241234567', primaryColour: '#102a43', secondaryColour: '#1769aa', accentColour: '#d4a72c' }, actor);
  assert.equal(school.phone_number, '0241234567');
  assert.equal(saved.profile.telephone, '0241234567');
  assert.equal(saved.profile.primaryColour, '#102a43');
  const secondInstance = createSchoolSettingsService({ database });
  const reopened = await secondInstance.read(actor);
  assert.equal(reopened.profile.name, 'OSAAH DAYLIGHT SCHOOL');
  assert.equal(reopened.profile.telephone, '0241234567');
  assert.equal(reopened.profile.primaryColour, '#102a43');
  assert.equal(reopened.profile.secondaryColour, '#1769aa');
  assert.equal(reopened.profile.accentColour, '#d4a72c');
});
