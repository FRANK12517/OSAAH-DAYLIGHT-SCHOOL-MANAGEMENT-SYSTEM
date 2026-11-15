import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';
import { TRANSFER_PREVIOUS_CLASS_OPTIONS } from '../src/student-classes.js';

const registrationPage = pathToFileURL(fileURLToPath(new URL('../public/internal-registration.html', import.meta.url))).href;

async function launchBrowser(t) {
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    chromium.executablePath(),
    process.env.ProgramFiles ? `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe` : null,
    process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe` : null,
    '/usr/bin/chromium'
  ].find((candidate) => candidate && existsSync(candidate));
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--allow-file-access-from-files'] });
  t.after(() => browser.close());
  return browser;
}

async function installApiFixture(page) {
  const setup = (transferPreviousClasses) => {
    window.__registrationCalls = 0;
    window.__idCalls = 0;
    window.__lookupCalls = 0;
    window.__registrationPayloads = [];
    window.fetch = async (input, options = {}) => {
      const url = new URL(input, location.href);
      const pathname = url.pathname.replace(/^\/[A-Za-z]:/, '');
      const key = '__registration_test_record';
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (pathname === '/api/admission-workflow/options') return json({ classes: [{ id: 'class-1', name: 'Primary 1' }], academicYears: [{ id: 'year-1', name: '2026/2027' }], terms: [{ id: 'term-1', academicYearId: 'year-1', name: '1st Term' }], transferPreviousClasses });
      if (pathname === '/api/sidebar') return json({ user: { id: 'browser-test-user' } });
      if (pathname === '/api/internal-student-registration/existing-student') {
        window.__lookupCalls += 1;
        const existing = ['existing', 'existing-id'].includes(localStorage.getItem('__registration_test_mode'));
        return json(existing ? { found: true, student: { id: 'existing-1', studentId: 'existing-1', firstName: 'Ama', lastName: 'Mensah', permanentStudentId: 'OSAA/2025/004' } } : { found: false, student: null });
      }
      if (pathname === '/api/internal-student-registration' && options.method === 'POST') {
        window.__registrationCalls += 1;
        window.__registrationPayloads.push(JSON.parse(options.body));
        if (localStorage.getItem('__registration_test_mode') === 'offline') throw new TypeError('Failed to fetch');
        if (localStorage.getItem('__registration_test_mode') === 'server-error') return json({ error: 'Duplicate admission number exists.' }, 409);
        if (localStorage.getItem('__registration_test_mode') === 'missing-id') return json({ success: true }, 200);
        if (localStorage.getItem('__registration_test_mode') === 'unknown-id') return json({ error: 'EXISTING_ID_NOT_FOUND: No student record has that permanent ID. Check the ID and try again.', code: 'EXISTING_ID_NOT_FOUND' }, 404);
        await new Promise((resolve) => setTimeout(resolve, 300));
        const payload = JSON.parse(options.body);
        const mode = localStorage.getItem('__registration_test_mode');
        const existing = ['existing', 'existing-id', 'existing-no-id', 'existing-id-by-name'].includes(mode);
        const permanentStudentId = ['existing', 'existing-id', 'existing-id-by-name'].includes(mode) ? 'OSAA/2025/004' : null;
        const record = { id: existing ? 'existing-1' : 'saved-1', studentId: existing ? 'existing-1' : 'saved-1', firstName: 'Ama', lastName: 'Mensah', permanentStudentId };
        localStorage.setItem(key, JSON.stringify(record));
        return json({ success: true, found: existing, studentId: record.studentId, student: record, permanentStudentId: record.permanentStudentId, idStatus: permanentStudentId ? 'EXISTING' : 'PENDING_GENERATION', className: 'Primary 1' }, 201);
      }
      if (pathname === '/api/internal-student-registration/student-id' && (!options.method || options.method === 'GET')) return json(JSON.parse(localStorage.getItem(key) || 'null') || { error: 'Saved registration not found.' }, localStorage.getItem(key) ? 200 : 404);
      if (pathname === '/api/internal-student-registration/student-id' && options.method === 'POST') {
        window.__idCalls += 1;
        const record = JSON.parse(localStorage.getItem(key) || 'null');
        if (!record) return json({ error: 'Saved registration not found.' }, 404);
        record.permanentStudentId ||= 'OSAA/2026/001';
        localStorage.setItem(key, JSON.stringify(record));
        return json({ studentId: record.studentId, permanentStudentId: record.permanentStudentId, created: true }, 201);
      }
      return json({ error: `Unexpected request: ${pathname}` }, 404);
    };
  };
  await page.evaluate(setup, TRANSFER_PREVIOUS_CLASS_OPTIONS);
}

async function loadRegistrationPage(page, html, css, script, savedDraft = null) {
  if (page.url() === 'about:blank') await page.goto(registrationPage);
  else await page.reload();
  const pageHtml = html
    .replace('<link rel="stylesheet" href="/styles.css">', '')
    .replace('<link rel="stylesheet" href="/internal-registration.css">', `<style>${css}</style>`)
    .replace('<script src="/internal-registration.js"></script>', '');
  await page.setContent(pageHtml);
  await installApiFixture(page);
  if (savedDraft) await page.evaluate((draft) => localStorage.setItem('osaah.internal-registration.draft.v1.browser-test-user', JSON.stringify(draft)), savedDraft);
  await page.addScriptTag({ content: script });
}

async function fillValidRegistration(page, { firstName = 'Ama', lastName = 'Mensah', gender = 'Female' } = {}) {
  await page.locator('select[name="classId"]').selectOption('class-1');
  await page.locator('select[name="academicYearId"]').selectOption('year-1');
  await page.locator('select[name="termId"]').selectOption('term-1');
  await page.locator('input[name="fullName"]').fill(`${firstName} ${lastName}`);
  await page.locator('input[name="dateOfBirth"]').fill('2018-01-02');
  await page.locator('select[name="gender"]').selectOption(gender);
  await page.locator('textarea[name="homeAddress"]').fill('1 Fixture Road');
  await page.locator('input[name="parentName"]').fill(`${firstName} Guardian`);
  await page.locator('input[name="parentPhone"]').fill('0540652824');
  await page.locator('textarea[name="parentAddress"]').fill('1 Fixture Road');
}

test('Section 20 submits, recovers, preserves existing IDs and reports failures at 360px', { timeout: 120_000 }, async (t) => {
  const browser = await launchBrowser(t);
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  const [html, css, script] = await Promise.all([
    readFile(new URL('../public/internal-registration.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/internal-registration.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/internal-registration.js', import.meta.url), 'utf8')
  ]);
  await loadRegistrationPage(page, html, css, script);
  const browserErrors = [];
  const onConsole = (message) => { if (message.type() === 'error') browserErrors.push(message.text()); };
  const onPageError = (error) => browserErrors.push(error.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try { await page.waitForFunction(() => document.querySelector('select[name="classId"] option[value="class-1"]'), null, { timeout: 5000 }); }
  catch (error) { throw new Error(`Fixture options were not loaded. Browser errors: ${JSON.stringify(browserErrors)}. Status: ${await page.locator('#registration-status').innerText()}`, { cause: error }); }

  const submit = page.locator('#submit-registration');
  const generate = page.locator('#generate-student-id');
  assert.equal(await page.evaluate(() => innerWidth), 360);
  assert.equal(await page.locator('input[name="existingIdChoice"][value="NO_ID"]').isChecked(), true);
  assert.equal(await page.getByRole('button', { name: 'Submit', exact: true }).count(), 1);
  assert.equal(await generate.isDisabled(), true);
  await submit.evaluate((button) => button.scrollIntoView({ block: 'center', behavior: 'instant' }));
  assert.equal(await submit.evaluate((button) => {
    const rect = button.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === button;
  }), true, 'the Submit button receives the hit test at its center');

  await submit.click();
  const invalidStatus = page.locator('#registration-status');
  assert.match(await invalidStatus.innerText(), /Category .*Please select/i);
  assert.equal(await invalidStatus.evaluate((node) => getComputedStyle(node).color), 'rgb(166, 27, 27)');
  assert.equal(await generate.isDisabled(), true);
  assert.equal(await page.evaluate(() => window.__registrationCalls), 0);

  await page.locator('select[name="admissionType"]').selectOption('FIRST_TIME');
  await fillValidRegistration(page);
  await submit.click();
  await page.waitForFunction(() => document.querySelector('#submit-registration')?.textContent === 'Submitting…');
  assert.equal(await submit.isDisabled(), true);
  assert.equal(await generate.isDisabled(), true);
  await submit.evaluate((button) => button.form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  assert.equal(await page.evaluate(() => window.__registrationCalls), 1, 'a second submit event does not duplicate the in-flight save');
  await page.waitForFunction(() => document.querySelector('#registration-status')?.textContent === '✅ Submitted successfully');
  assert.equal(await generate.isDisabled(), false);
  assert.equal(await page.locator('#student-id-help').isVisible(), false, 'the pre-save hint is removed after server confirmation');

  await generate.click();
  await page.waitForFunction(() => !document.querySelector('#permanent-student-id')?.hidden);
  assert.equal((await page.locator('#permanent-student-id').innerText()).trim(), 'Permanent Student ID: OSAA/2026/001');
  assert.match(await page.evaluate(() => localStorage.getItem('osaah.internal-registration.draft.v1.browser-test-user') || ''), /saved-1/);
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  await loadRegistrationPage(page, html, css, script);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try { await page.waitForFunction(() => document.querySelector('#generate-student-id')?.textContent === 'Permanent Student ID Assigned', null, { timeout: 5000 }); }
  catch (error) { throw new Error(`Reload did not restore the assigned ID. Draft status: ${await page.locator('#registration-draft-status').innerText()}; button: ${await generate.innerText()}; draft: ${await page.evaluate(() => localStorage.getItem('osaah.internal-registration.draft.v1.browser-test-user'))}`, { cause: error }); }
  assert.equal(await generate.isDisabled(), true);
  assert.equal((await page.locator('#permanent-student-id').innerText()).trim(), 'Permanent Student ID: OSAA/2026/001');
  await page.locator('#reset-registration-form').click();
  assert.equal(await page.locator('input[name="existingIdChoice"][value="NO_ID"]').isChecked(), true, 'reset restores the no-ID default');
  assert.equal(await generate.isDisabled(), true);

  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('__registration_test_mode', 'existing'); });
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  await loadRegistrationPage(page, html, css, script);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  await page.waitForFunction(() => document.querySelector('select[name="classId"] option[value="class-1"]'), null, { timeout: 5000 });
  await page.locator('select[name="admissionType"]').selectOption('ALREADY_ENROLLED');
  await page.locator('input[name="existingIdChoice"][value="HAVE_ID"]').check();
  await page.locator('input[name="existingPermanentStudentId"]').fill('OSAA/2025/004');
  await fillValidRegistration(page);
  await page.locator('#submit-registration').click();
  await page.waitForFunction(() => document.querySelector('#registration-status')?.textContent === '✅ Submitted successfully');
  assert.equal(await page.locator('#permanent-student-id').innerText(), 'Permanent Student ID: OSAA/2025/004');
  assert.equal(await page.locator('#generate-student-id').isDisabled(), true);
  assert.equal(await page.locator('#student-id-help').innerText(), 'This student already has a permanent ID.');
  assert.equal(await page.evaluate(() => window.__idCalls), 0, 'an existing ID is retained without requesting a new ID');

  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('__registration_test_mode', 'offline'); });
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  await loadRegistrationPage(page, html, css, script);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  await page.waitForFunction(() => document.querySelector('select[name="classId"] option[value="class-1"]'), null, { timeout: 5000 });
  await page.locator('select[name="admissionType"]').selectOption('FIRST_TIME');
  await fillValidRegistration(page, { firstName: 'Kofi', gender: 'Male' });
  await page.locator('#submit-registration').click();
  await page.waitForFunction(() => document.querySelector('#registration-status')?.classList.contains('status-error'));
  assert.match(await page.locator('#registration-status').innerText(), /Failed to fetch/i);
  assert.equal(await page.locator('#generate-student-id').isDisabled(), true);
  assert.equal(await page.locator('#submit-registration').isDisabled(), false);

  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('__registration_test_mode', 'server-error'); });
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  await loadRegistrationPage(page, html, css, script);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  await page.waitForFunction(() => document.querySelector('select[name="classId"] option[value="class-1"]'), null, { timeout: 5000 });
  await page.locator('select[name="admissionType"]').selectOption('FIRST_TIME');
  await fillValidRegistration(page, { firstName: 'Esi', gender: 'Female' });
  await page.locator('#submit-registration').click();
  await page.waitForFunction(() => document.querySelector('#registration-status')?.textContent.includes('Duplicate admission number exists.'));
  assert.equal(await page.locator('#registration-status').evaluate((node) => getComputedStyle(node).color), 'rgb(166, 27, 27)');
  assert.equal(await page.locator('#generate-student-id').isDisabled(), true);

  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('__registration_test_mode', 'missing-id'); });
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  await loadRegistrationPage(page, html, css, script);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  await page.waitForFunction(() => document.querySelector('select[name="classId"] option[value="class-1"]'), null, { timeout: 5000 });
  await page.locator('select[name="admissionType"]').selectOption('FIRST_TIME');
  await fillValidRegistration(page, { firstName: 'Yaw', gender: 'Male' });
  await page.locator('#submit-registration').click();
  await page.waitForFunction(() => document.querySelector('#registration-status')?.textContent.includes('success without a saved student record or ID'));
  assert.equal(await page.locator('#generate-student-id').isDisabled(), true, 'a 2xx response without a student ID does not unlock ID generation');
  assert.deepEqual(browserErrors, [], `Browser console/page errors: ${JSON.stringify(browserErrors)}`);
  await context.close();
});

test('no-ID registration uses one transactional submit; existing matches and entered-ID errors are explicit', { timeout: 120_000 }, async (t) => {
  const browser = await launchBrowser(t);
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  const [html, css, script] = await Promise.all([
    readFile(new URL('../public/internal-registration.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/internal-registration.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/internal-registration.js', import.meta.url), 'utf8')
  ]);
  await loadRegistrationPage(page, html, css, script);
  const submit = page.locator('#submit-registration');
  const idField = page.locator('input[name="existingPermanentStudentId"]');
  const noId = page.locator('input[name="existingIdChoice"][value="NO_ID"]');
  const haveId = page.locator('input[name="existingIdChoice"][value="HAVE_ID"]');
  const status = page.locator('#registration-status');
  await page.waitForFunction(() => document.querySelector('select[name="classId"] option[value="class-1"]'), null, { timeout: 5000 });
  assert.equal(await noId.isChecked(), true, 'fresh form defaults to no ID');
  assert.equal(await idField.isHidden(), true, 'the ID field is hidden until I HAVE AN ID is selected');

  await page.locator('select[name="admissionType"]').selectOption('ALREADY_ENROLLED');
  await noId.check();
  assert.equal(await idField.isHidden(), true);
  assert.equal(await idField.evaluate((input) => input.required), false);
  await fillValidRegistration(page);
  await page.evaluate(() => localStorage.setItem('__registration_test_mode', 'existing-no-id'));
  await submit.click();
  await page.waitForFunction(() => document.querySelector('#registration-status')?.textContent === '✅ Submitted successfully');
  assert.equal(await page.evaluate(() => window.__lookupCalls), 0, 'the no-ID path skips the separate student lookup');
  assert.equal(await page.evaluate(() => window.__registrationCalls), 1);
  assert.equal(await page.evaluate(() => window.__registrationPayloads[0].existingStudentId), null);
  assert.equal(await page.evaluate(() => window.__registrationPayloads[0].existingPermanentStudentId), null);
  assert.equal(await page.locator('#generate-student-id').isDisabled(), false, 'a matched student without an ID can receive one');

  await page.locator('#reset-registration-form').click();
  await page.locator('select[name="admissionType"]').selectOption('ALREADY_ENROLLED');
  await noId.check();
  await fillValidRegistration(page);
  await page.evaluate(() => localStorage.setItem('__registration_test_mode', 'existing-id-by-name'));
  await submit.click();
  await page.waitForFunction(() => document.querySelector('#registration-status')?.textContent === '✅ Submitted successfully');
  assert.equal((await page.locator('#permanent-student-id').innerText()).trim(), 'Permanent Student ID: OSAA/2025/004');
  assert.equal(await page.locator('#generate-student-id').isDisabled(), true, 'an existing ID is returned without generation');
  assert.equal(await page.evaluate(() => window.__lookupCalls), 0);

  await page.locator('#reset-registration-form').click();
  await page.evaluate(() => { window.__lookupCalls = 0; window.__registrationCalls = 0; });
  await page.locator('select[name="admissionType"]').selectOption('ALREADY_ENROLLED');
  await haveId.check();
  assert.equal(await idField.isVisible(), true);
  assert.equal(await idField.evaluate((input) => input.required), true);
  await fillValidRegistration(page);
  await submit.click();
  assert.match(await page.locator('#existing-id-error').innerText(), /Enter the existing Student ID/);
  assert.equal(await idField.getAttribute('aria-invalid'), 'true');
  assert.equal(await page.evaluate(() => window.__lookupCalls), 0, 'blank ID blocks all requests');
  assert.equal(await page.evaluate(() => window.__registrationCalls), 0);

  await idField.fill('OSAA/2026/999');
  assert.equal(await page.locator('#existing-id-error').isHidden(), true, 'editing the ID clears the inline validation error');
  await page.evaluate(() => localStorage.setItem('__registration_test_mode', 'unknown-id'));
  await submit.click();
  await page.waitForFunction(() => document.querySelector('#registration-status')?.textContent.includes('EXISTING_ID_NOT_FOUND'));
  assert.equal(await page.evaluate(() => window.__lookupCalls), 1, 'only I HAVE AN ID calls the lookup endpoint');
  assert.equal(await page.evaluate(() => window.__registrationCalls), 1, 'the transactional submit returns the authoritative 404');
  assert.equal(await status.evaluate((node) => getComputedStyle(node).color), 'rgb(166, 27, 27)');
  assert.equal(await status.evaluate((node) => document.activeElement === node), true, 'outcome status receives focus');
  assert.equal(await page.locator('#generate-student-id').isDisabled(), true);

  await page.locator('input[name="existingIdChoice"][value="NO_ID"]').check();
  assert.equal(await idField.isHidden(), true);
  assert.equal(await idField.evaluate((input) => input.required), false);
  assert.equal(await page.locator('#existing-id-error').isHidden(), true, 'switching choices clears the inline error');
  await page.locator('#reset-registration-form').click();
  assert.equal(await noId.isChecked(), true, 'Reset Form restores no-ID default');
  assert.equal(await idField.isHidden(), true);
  await context.close();
});

test('a saved ID choice is restored, while Reset Form returns to NO_ID', { timeout: 120_000 }, async (t) => {
  const browser = await launchBrowser(t);
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  const [html, css, script] = await Promise.all([
    readFile(new URL('../public/internal-registration.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/internal-registration.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/internal-registration.js', import.meta.url), 'utf8')
  ]);
  await loadRegistrationPage(page, html, css, script, { version: 2, data: { admissionType: 'ALREADY_ENROLLED' } });
  await page.waitForFunction(() => document.querySelector('input[name="existingIdChoice"][value="NO_ID"]')?.checked);
  assert.equal(await page.locator('input[name="existingIdChoice"][value="NO_ID"]').isChecked(), true, 'draft without a choice uses the NO_ID default');
  await loadRegistrationPage(page, html, css, script, { version: 2, data: { admissionType: 'ALREADY_ENROLLED', existingIdChoice: 'HAVE_ID' } });
  await page.waitForFunction(() => document.querySelector('input[name="existingIdChoice"][value="HAVE_ID"]')?.checked);
  const idField = page.locator('input[name="existingPermanentStudentId"]');
  assert.equal(await idField.isVisible(), true);
  assert.equal(await idField.evaluate((input) => input.required), true);
  await page.locator('#reset-registration-form').click();
  assert.equal(await page.locator('input[name="existingIdChoice"][value="NO_ID"]').isChecked(), true);
  assert.equal(await idField.isHidden(), true);
  assert.equal(await idField.evaluate((input) => input.required), false);
  await context.close();
});

test('transfer fields validate, save, restore and clear at 360px', { timeout: 120_000 }, async (t) => {
  const browser = await launchBrowser(t);
  const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
  const page = await context.newPage();
  const [html, css, script] = await Promise.all([
    readFile(new URL('../public/internal-registration.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/internal-registration.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/internal-registration.js', import.meta.url), 'utf8')
  ]);
  await loadRegistrationPage(page, html, css, script);
  await page.waitForFunction(() => document.querySelector('select[name="classId"] option[value="class-1"]'));
  const category = page.locator('select[name="admissionType"]');
  const school = page.locator('#previous-school');
  const previousClass = page.locator('#previous-class');
  const submit = page.locator('#submit-registration');
  const generate = page.locator('#generate-student-id');
  const status = page.locator('#registration-status');

  assert.equal(await page.evaluate(() => innerWidth), 360);
  assert.equal(await page.locator('input[name="existingIdChoice"][value="NO_ID"]').isChecked(), true);
  assert.equal(await school.isHidden(), true);
  assert.equal(await previousClass.isHidden(), true);

  await category.selectOption('TRANSFER');
  assert.equal(await school.isVisible(), true);
  assert.equal(await previousClass.isVisible(), true);
  assert.equal(await school.evaluate((node) => node.required), true);
  assert.equal(await previousClass.evaluate((node) => node.required), true);
  assert.equal(await page.locator('[data-existing-field]').isHidden(), true, 'ID choice stays hidden for transfer admission');
  assert.deepEqual(await previousClass.locator('option').allTextContents(), ['Select previous class', 'KG 1', 'KG 2', 'Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5', 'Basic 6', 'JHS 1', 'JHS 2', 'JHS 3']);

  await fillValidRegistration(page);
  await submit.click();
  assert.match(await page.locator('#previous-school-error').innerText(), /at least 2 characters/);
  assert.match(await page.locator('#previous-class-error').innerText(), /Select the student’s previous class/);
  assert.equal(await page.evaluate(() => window.__registrationCalls), 0, 'invalid transfer does not send a request');
  assert.equal(await generate.isDisabled(), true);

  await school.fill('  Bogoso Basic School  ');
  await previousClass.selectOption('Primary 1');
  await submit.click();
  await page.waitForFunction(() => document.querySelector('#registration-status')?.textContent === '✅ Submitted successfully');
  assert.equal(await page.evaluate(() => window.__registrationCalls), 1);
  assert.equal(await page.evaluate(() => window.__registrationPayloads[0].previousSchool), 'Bogoso Basic School');
  assert.equal(await page.evaluate(() => window.__registrationPayloads[0].previousClass), 'Primary 1');
  assert.equal(await generate.isDisabled(), false, 'Generate unlocks after successful save');
  await generate.click();
  await page.waitForFunction(() => document.querySelector('#permanent-student-id')?.textContent.includes('OSAA/2026/001'));
  assert.match(await page.locator('#permanent-student-id').innerText(), /OSAA\/2026\/001/);

  await page.locator('#reset-registration-form').click();
  assert.equal(await school.isHidden(), true);
  assert.equal(await previousClass.isHidden(), true);
  assert.equal(await school.inputValue(), '');
  assert.equal(await previousClass.inputValue(), '');
  assert.equal(await page.locator('input[name="existingIdChoice"][value="NO_ID"]').isChecked(), true);

  await category.selectOption('TRANSFER');
  await fillValidRegistration(page);
  await submit.click();
  assert.equal(await page.locator('#previous-school-error').isVisible(), true);
  assert.equal(await page.locator('#previous-class-error').isVisible(), true);
  await page.locator('select[name="admissionType"]').selectOption('FIRST_TIME');
  assert.equal(await school.isHidden(), true);
  assert.equal(await previousClass.isHidden(), true);
  assert.equal(await page.locator('#previous-school-error').isHidden(), true);
  assert.equal(await page.locator('#previous-class-error').isHidden(), true);
  assert.equal(await school.inputValue(), '');
  assert.equal(await previousClass.inputValue(), '');
  assert.equal(await school.evaluate((node) => node.required), false);
  assert.equal(await previousClass.evaluate((node) => node.required), false);

  await loadRegistrationPage(page, html, css, script, { version: 2, data: { admissionType: 'TRANSFER', previousSchool: 'Draft Academy', previousClass: 'JHS 2', existingIdChoice: 'HAVE_ID' } });
  await page.waitForFunction(() => document.querySelector('#previous-class')?.value === 'JHS 2');
  assert.equal(await school.inputValue(), 'Draft Academy');
  assert.equal(await previousClass.inputValue(), 'JHS 2');
  assert.equal(await page.locator('input[name="existingIdChoice"][value="NO_ID"]').isChecked(), true, 'transfer drafts cannot restore HAVE_ID');
  await page.setViewportSize({ width: 1280, height: 900 });
  assert.equal(await page.evaluate(() => innerWidth), 1280);
  assert.equal(await school.isVisible(), true, 'transfer fields remain visible at desktop width');
  assert.equal(await previousClass.isVisible(), true);
  await context.close();
  await browser.close();
});
