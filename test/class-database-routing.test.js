import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { scryptSync } from 'node:crypto';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';
import { SIDEBAR_MODULES, visibleSidebar } from '../src/sidebar-registry.js';

const schoolId = 'school-osaah-daylight';
const password = 'Part2Routing123!';
const hash = (id) => `${id}-salt:${scryptSync(password, `${id}-salt`, 32).toString('hex')}`;
const roles = ['PROPRIETOR', 'ACCOUNTANT_BURSAR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'];
const allClasses = ['Nursery 1', 'Nursery 2', 'KG1', 'KG2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3'];
const users = roles.map((roleKey) => ({ id: `part2-${roleKey.toLowerCase()}`, username: `${roleKey.toLowerCase()}@part2.test`, passwordHash: hash(`part2-${roleKey.toLowerCase()}`), portal: 'school', roleKey, schoolId, permissions: new Set(['students.read', ...(roleKey === 'PROPRIETOR' ? ['*'] : [])]), assignedClassIds: roleKey === 'TEACHER' ? allClasses : [] }));

function request(server, path, token) { return new Promise((resolve, reject) => { const req = httpRequest({ host: '127.0.0.1', port: server.address().port, path, headers: { Authorization: `Bearer ${token}` } }, (res) => { let body = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body })); }); req.on('error', reject); req.end(); }); }

test('every authorized role maps to one exact Class Database sidebar route and component', async (t) => {
  const module = SIDEBAR_MODULES.find((item) => item.moduleKey === 'class-database');
  assert.ok(module); assert.equal(module.route, '/class-database.html'); assert.equal(module.category, 'STUDENTS MANAGEMENT'); assert.equal(module.requiredPermission, 'students.read');
  const auth = createAuthService({ users, sessionSecret: 'part2-routing-session-secret-0123456789' });
  const server = createServer(createApp({ auth })); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise((resolve) => server.close(resolve)));
  for (const roleKey of roles) {
    const user = users.find((item) => item.roleKey === roleKey); const login = auth.login({ username: user.username, password, portal: 'school', role: roleKey }); assert.equal(login.ok, true, roleKey);
    const groups = visibleSidebar({ permissions: new Set([...user.permissions]), roleKey, portal: 'school' }); const studentGroup = groups.find((group) => group.category === 'STUDENTS MANAGEMENT' || group.category === 'STUDENT MANAGEMENT'); const item = studentGroup?.modules.find((entry) => entry.moduleKey === 'class-database'); assert.ok(item, `${roleKey} sidebar visibility`); assert.equal(item.route, '/class-database.html', roleKey);
    const page = await request(server, '/class-database.html?embedded=1&route=%2Fclass-database.html', login.token); assert.equal(page.status, 200, roleKey); assert.match(page.body, /CLASS DATABASE/); assert.match(page.body, /Permanent Student ID/); assert.match(page.body, /class-database\.js/); assert.doesNotMatch(page.body, /Coming Soon|Student Profiles|Student Search|Student Directory/); const archivePage = await request(server, '/completed-class-database.html?embedded=1&route=%2Fcompleted-class-database.html', login.token); assert.equal(archivePage.status, 200, `${roleKey} archive page`); assert.match(archivePage.body, /COMPLETED CLASS DATABASE \/ ARCHIVES/); assert.match(archivePage.body, /Year of Completion/); const archiveOptions = await request(server, '/api/class-database/completed/options', login.token); assert.equal(archiveOptions.status, 200, `${roleKey} archive API`);
    const options = await request(server, '/api/class-database/options', login.token); assert.equal(options.status, 200, `${roleKey} API`); assert.match(options.body, /Nursery 1/); assert.match(options.body, /JHS 3/);
  }
  const unauthenticated = await request(server, '/class-database.html?embedded=1', 'invalid-token'); assert.equal(unauthenticated.status, 401);
});

test('Class Database academic-year filtering uses the academic_year_id join on legacy enrollment schemas', async (t) => {
  const queries = [];
  const database = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS') && sql.includes("TABLE_NAME='student_profiles'")) {
        return [{ columnName: 'previous_school' }, { columnName: 'previous_class' }];
      }
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS') && sql.includes("TABLE_NAME='student_enrollments'") && sql.includes("COLUMN_NAME='academic_year'")) return [{ columnName: 'academic_year' }];
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS') && sql.includes("TABLE_NAME='student_enrollments'") && !sql.includes("COLUMN_NAME='academic_year'")) return [];
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS') && sql.includes("TABLE_NAME='students'")) return [];
      if (sql.includes('INFORMATION_SCHEMA.COLUMNS') && sql.includes("TABLE_NAME='student_family_contacts'")) return ['student_id','contact_type','full_name','telephone','created_at','id'].map((columnName) => ({ columnName }));
      if (sql.includes('FROM student_enrollments e JOIN students s')) {
        assert.match(sql, /e\.academic_year=\?/);
        assert.doesNotMatch(sql, /sp\.updated_at\b/);
        assert.doesNotMatch(sql, /s\.parent_guardian_name|s\.parent_phone/);
        assert.match(sql, /FROM student_family_contacts fc JOIN student_profiles spg/);
        assert.match(sql, /ORDER BY sp\.id DESC LIMIT 1/);
        assert.match(sql, /y\.id=e\.academic_year_id/);
        assert.match(sql, /y\.id IS NULL AND e\.academic_year=\?/);
        assert.match(sql, /LOWER\(TRIM\(c\.name\)\)=LOWER\(TRIM\(\?\)\)/);
        assert.deepEqual(params.slice(1, 5), Array(4).fill('2026/2027 Academic Year'));
        assert.deepEqual(params.slice(5, 9), Array(4).fill('class-kg1'));
        return [{ permanentStudentId: 'OSAAH-2026-0001', studentId: 'student-1', studentName: 'Ama Mensah', gender: 'Female', parentGuardianName: 'Efua Mensah', registeredParentPhone: '0240000000', previousSchool: null, previousClass: null, classId: 'class-kg1', academicYear: '2026/2027 Academic Year' }];
      }
      return [];
    }
  };
  const actor = { id: 'proprietor-1', schoolId, portal: 'school', roleKey: 'PROPRIETOR', permissions: new Set(['*']) };
  const auth = { authenticateAsync: async () => actor };
  const server = createServer(createApp({ auth, database }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const response = await request(server, '/api/class-database?classId=class-kg1&academicYear=2026%2F2027%20Academic%20Year', 'test-token');
  assert.equal(response.status, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.rows.length, 1);
  assert.equal(body.rows[0].studentName, 'Ama Mensah');
  assert.equal(body.rows[0].parentGuardianName, 'Efua Mensah');
  assert.equal(body.rows[0].registeredParentPhone, '0240000000');
  assert.equal(body.rows[0].classId, 'class-kg1');
  assert.ok(queries.some(({ sql }) => sql.includes('academic_years y')));
});

test('Class Database is a single route/component and is not aliased to generic student pages', async () => {
  const source = await (await import('node:fs/promises')).readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /navigateToRoute\(dashboard, route, title/); assert.match(source, /frame\.contentWindow\.location\.replace\(frameUrl\)/); assert.doesNotMatch(source, /class-database[^\n]*(students\.html|student-search|coming-soon)/i);
});
