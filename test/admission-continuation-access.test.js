import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/server.mjs';

const SCHOOL_ID = 'school-osaah-daylight';
const CONTINUATION = '/admission-application.html?applicationNumber=APP-READONLY&step=2';

function actor(roleKey, permissions, schoolId = SCHOOL_ID, portal = 'school') {
  return { id: `test-${roleKey}`, roleKey, portal, schoolId, permissions: new Set(permissions) };
}

async function withServer(t, actors = {}) {
  const auth = { authenticateAsync: async (token) => actors[token] ?? null };
  const server = createServer(createApp({ auth }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections?.();
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

function session(token) {
  return { headers: { Cookie: `osaah_session=${token}` } };
}

test('admission write roles can fetch the staff continuation page with the existing session', async (t) => {
  const actors = {
    proprietor: actor('PROPRIETOR', ['*']),
    headteacher: actor('HEADTEACHER', ['admissions.read', 'admissions.write']),
    assistant: actor('ASSISTANT_HEADTEACHER', ['admissions.read', 'admissions.write'])
  };
  const base = await withServer(t, actors);

  for (const token of Object.keys(actors)) {
    const response = await fetch(base + CONTINUATION, session(token));
    assert.equal(response.status, 200, `${token} should retain its authorized admission continuation`);
    assert.match(await response.text(), /OFFICIAL ADMISSION FORM/);
    assert.equal(response.headers.get('set-cookie'), null, 'authenticated staff must not be downgraded to a guest admission session');
  }
});

test('authenticated school users without admissions.write remain denied', async (t) => {
  const actors = {
    accountant: actor('ACCOUNTANT_BURSAR', ['fees.read']),
    teacher: actor('TEACHER', ['students.read', 'academics.read']),
    administrator: actor('SCHOOL_ADMIN', ['students.read', 'settings.read']),
    readOnlyAdmission: actor('SCHOOL_ADMIN', ['admissions.read'])
  };
  const base = await withServer(t, actors);

  for (const token of Object.keys(actors)) {
    const response = await fetch(base + CONTINUATION, session(token));
    assert.equal(response.status, 403, `${token} must not gain write access by loading the application form`);
    assert.equal(await response.text(), 'Forbidden');
  }
});

test('a continuation without an authenticated staff or existing parent session is denied while a new parent application remains public', async (t) => {
  const base = await withServer(t);
  const continuation = await fetch(base + CONTINUATION);
  assert.equal(continuation.status, 401);
  assert.equal(await continuation.text(), 'Authentication required');

  const newParentForm = await fetch(base + '/admission-application.html');
  assert.equal(newParentForm.status, 200, 'the existing public parent application entry remains available');
  assert.match(newParentForm.headers.get('set-cookie') ?? '', /^osaah_admission_session=/);
});

test('invalid or missing session identity cannot open an existing application continuation', async (t) => {
  const base = await withServer(t);
  for (const cookie of ['osaah_session=invalid-session', 'osaah_session=']) {
    const response = await fetch(base + CONTINUATION, { headers: { Cookie: cookie } });
    assert.equal(response.status, 401);
    assert.equal(await response.text(), 'Authentication required');
  }
});

test('admissions.write from a mismatched school tenant does not authorize the route', async (t) => {
  const base = await withServer(t, {
    otherSchool: actor('HEADTEACHER', ['admissions.read', 'admissions.write'], 'another-school')
  });
  const response = await fetch(base + CONTINUATION, session('otherSchool'));
  assert.equal(response.status, 403);
  assert.equal(await response.text(), 'Forbidden');
});

test('incomplete or malformed authenticated identity context fails closed', async (t) => {
  const actors = {
    missingSchool: actor('HEADTEACHER', ['admissions.write'], null),
    missingPermissions: { id: 'test-missing-permissions', roleKey: 'HEADTEACHER', portal: 'school', schoolId: SCHOOL_ID },
    malformedPermissions: { ...actor('HEADTEACHER', []), permissions: {} }
  };
  const base = await withServer(t, actors);
  for (const token of Object.keys(actors)) {
    const response = await fetch(base + CONTINUATION, session(token));
    assert.equal(response.status, 403, `${token} must not produce an authorization error or a successful page`);
    assert.equal(await response.text(), 'Forbidden');
  }
});

test('an authorized continuation does not turn a missing application into a successful record read', async (t) => {
  const base = await withServer(t, {
    staff: actor('HEADTEACHER', ['admissions.read', 'admissions.write'])
  });
  const page = await fetch(base + CONTINUATION, session('staff'));
  assert.equal(page.status, 200);
  const application = await fetch(base + '/api/admission-applications/APP-DOES-NOT-EXIST', session('staff'));
  assert.equal(application.status, 404);
  assert.deepEqual(await application.json(), { error: 'Not found.' });
});
