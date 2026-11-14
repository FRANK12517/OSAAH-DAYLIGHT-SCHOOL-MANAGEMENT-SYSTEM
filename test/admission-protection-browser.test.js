import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import test from 'node:test';
import { chromium } from 'playwright';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

function createBrowserTestAuth() {
  const username = 'admission-continuation-browser-test@osaah.invalid';
  const password = randomBytes(24).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const user = {
    id: randomUUID(),
    username,
    fullName: 'Isolated Admission Browser Test',
    portal: 'school',
    roleKey: 'HEADTEACHER',
    schoolId: 'school-osaah-daylight',
    passwordHash: `${salt}:${scryptSync(password, salt, 32).toString('hex')}`,
    permissions: new Set(['students.read', 'admissions.read', 'admissions.write'])
  };
  return {
    credentials: { username, password },
    auth: createAuthService({ users: [user] })
  };
}

async function startServer(t, auth = createAuthService()) {
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

async function startBrowser(t) {
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe` : null,
    process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe` : null,
    '/usr/bin/chromium'
  ].find((candidate) => candidate && existsSync(candidate));
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  return browser;
}

test('authorized staff can continue through the normal workflow to the application page', { timeout: 120_000 }, async (t) => {
  const fixture = createBrowserTestAuth();
  const base = await startServer(t, fixture.auth);
  const browser = await startBrowser(t);
  const context = await browser.newContext();
  const page = await context.newPage();
  const applicationWrites = [];
  const continuationResponses = [];
  const authResponses = [];
  let loginCookieSet = false;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/admission-applications' && request.method() === 'POST') {
      applicationWrites.push({ method: request.method(), payload: request.postDataJSON() });
    }
  });
  page.on('response', (response) => {
    if (new URL(response.url()).pathname === '/admission-application.html') continuationResponses.push({ status: response.status(), url: response.url() });
    if (['/api/auth/login', '/api/auth/session', '/api/sidebar'].includes(new URL(response.url()).pathname)) {
      authResponses.push({ path: new URL(response.url()).pathname, status: response.status() });
      if (new URL(response.url()).pathname === '/api/auth/login') loginCookieSet = Boolean(response.headers()['set-cookie']?.includes('osaah_session='));
    }
  });

  await page.goto(base);
  const schoolPortal = page.locator('[data-portal="school"]');
  try {
    await schoolPortal.click({ force: true, timeout: 10000 });
  } catch (error) {
    const uiState = await page.evaluate(() => {
      const element = document.querySelector('[data-portal="school"]');
      const bounds = element?.getBoundingClientRect();
      const style = element ? getComputedStyle(element) : null;
      const coveringElement = bounds ? document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2) : null;
      return {
        url: location.href,
        title: document.title,
        bodyText: document.body.innerText.slice(0, 300),
        portalBounds: bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
        portalStyle: style ? { display: style.display, visibility: style.visibility, opacity: style.opacity } : null,
        coveringElement: coveringElement?.outerHTML?.slice(0, 200) ?? null
      };
    }).catch(() => null);
    throw new Error(`School portal picker did not become clickable: ${JSON.stringify(uiState)}`, { cause: error });
  }
  await page.locator('[name="role"]').selectOption('HEADTEACHER');
  await page.locator('[name="username"]').fill(fixture.credentials.username);
  await page.locator('[name="password"]').fill(fixture.credentials.password);
  await page.locator('#login-form button[type="submit"]').click({ force: true });
  try {
    await page.getByText('HEADTEACHER · SCHOOL PORTAL').waitFor({ timeout: 5000 });
  } catch {
    const loginError = await page.locator('#login-error').innerText().catch(() => 'unavailable');
    const pageText = await page.locator('body').innerText().catch(() => 'unavailable');
    const cookieNames = (await page.context().cookies()).map((cookie) => cookie.name);
    throw new Error(`Local browser login did not reach the headteacher dashboard. Login message: ${loginError}. HTTP: ${JSON.stringify(authResponses)}. Login session cookie set: ${loginCookieSet}. Browser cookie names: ${JSON.stringify(cookieNames)}. Visible page: ${pageText.slice(0, 500)}`);
  }
  await page.getByRole('button', { name: /STUDENTS? MANAGEMENT/i }).click({ force: true });
  await page.getByRole('link', { name: 'Student Registration' }).click({ force: true });
  await page.goto(`${base}/admissions/register?embedded=1`);

  const registration = page;
  await registration.getByRole('heading', { name: 'Student Admission and Registration' }).waitFor();
  assert.ok(await registration.locator('select[name="admissionType"] option[value="FIRST_TIME"]').count());
  assert.ok(await registration.locator('select[name="admissionType"] option[value="TRANSFER"]').count());
  assert.ok(await registration.locator('select[name="admissionType"] option[value="ALREADY_ENROLLED"]').count());
  assert.ok(await registration.locator('input[name="registrationToken"]').count());
  const submitAndGenerate = registration.getByRole('button', { name: 'Submit, Save and Generate Permanent Student ID' });
  assert.equal(await submitAndGenerate.count(), 1, 'Section 20 exposes one authoritative save and ID action');
  assert.equal(await submitAndGenerate.isDisabled(), false, 'registration can be submitted before an ID exists');
  assert.equal(await registration.getByRole('button', { name: 'Generate Permanent Student ID' }).count(), 0);
  assert.equal(applicationWrites.length, 0, 'the unified registration page never creates a legacy application');
  assert.equal(continuationResponses.some((entry) => entry.status < 400), false, 'the obsolete application page is never served');
});
test('public legacy application URL redirects to staff registration without guest session creation', async () => {
  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/admission-application.html`, { redirect: 'manual' });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), '/admissions/register');
    assert.equal(response.headers.get('set-cookie'), null);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});
