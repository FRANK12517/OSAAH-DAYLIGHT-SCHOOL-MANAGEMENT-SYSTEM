import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { chromium } from 'playwright';
import { createAuthService } from '../src/auth.js';
import { createApp } from '../src/server.mjs';

async function startServer(t) {
  const auth = createAuthService();
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
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
    || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox'] });
  t.after(() => browser.close());
  return browser;
}

test('authenticated Student Management navigation opens Admission and validates an incomplete enquiry without writing', { timeout: 120_000 }, async (t) => {
  const base = await startServer(t);
  const browser = await startBrowser(t);
  const context = await browser.newContext();
  const page = await context.newPage();
  const applicationWrites = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/admission-applications' && request.method() !== 'GET') applicationWrites.push(request.method());
  });

  await page.goto(base);
  await page.locator('[data-portal="school"]').click();
  await page.locator('[name="username"]').fill('proprietor@osaah.edu.gh');
  await page.locator('[name="password"]').fill('Proprietor123!');
  await page.locator('#login-form button[type="submit"]').click();
  await page.getByText('PROPRIETOR · SCHOOL PORTAL').waitFor();
  await page.getByRole('button', { name: /STUDENT MANAGEMENT/i }).click();
  await page.getByRole('link', { name: 'Admission / Admissions Workflow' }).click();

  const admission = page.frameLocator('#module-frame');
  await admission.getByRole('heading', { name: 'Admissions and Registration' }).waitFor();
  assert.ok(await admission.getByRole('option', { name: 'Basic 2' }).count());
  assert.ok(await admission.getByRole('option', { name: 'Transfer from another school' }).count());
  assert.ok(await admission.getByRole('option', { name: 'First-time applicant' }).count());
  assert.ok(await admission.getByRole('option', { name: 'Already enrolled at OsaaH' }).count());

  const category = admission.locator('select[name="admissionType"]');
  await category.selectOption('ALREADY_ENROLLED');
  assert.equal(await admission.locator('[data-category-field="ALREADY_ENROLLED"]').first().isVisible(), true);
  await category.selectOption('TRANSFER');
  assert.equal(await admission.locator('[data-category-field="TRANSFER"]').isVisible(), true);
  await category.selectOption('FIRST_TIME');
  assert.equal(await admission.locator('[data-category-field="TRANSFER"]').isVisible(), false);
  await admission.getByRole('button', { name: 'Continue to application' }).click();
  assert.equal(applicationWrites.length, 0, 'incomplete input must be stopped before the application API is called');
});

test('public application renders with its scoped admission session and has no application writes on load', { timeout: 120_000 }, async (t) => {
  const base = await startServer(t);
  const browser = await startBrowser(t);
  const context = await browser.newContext();
  const page = await context.newPage();
  const writes = { POST: 0, PATCH: 0 };
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/admission-applications' && request.method() === 'POST') writes.POST += 1;
    if (url.pathname.endsWith('/update') && request.method() === 'PATCH') writes.PATCH += 1;
  });

  await page.goto(`${base}/admission-application.html`);
  await page.locator('#admission-form').waitFor();
  const admissionCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'osaah_admission_session');
  assert.ok(admissionCookie, 'public form receives its scoped admission session');
  assert.ok(await page.getByRole('heading', { name: 'OFFICIAL ADMISSION FORM' }).count());
  assert.deepEqual(writes, { POST: 0, PATCH: 0 }, 'incomplete applications do not reach the API');
});
