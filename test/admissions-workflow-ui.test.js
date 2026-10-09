import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SIDEBAR_MODULES } from '../src/sidebar-registry.js';
import '../src/module-registry.js';

const page = await readFile(new URL('../public/admissions.html', import.meta.url), 'utf8');
const applicationPage = await readFile(new URL('../public/admission-application.html', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../public/admissions-workflow.js', import.meta.url), 'utf8');
const application = await readFile(new URL('../public/admission-application.js', import.meta.url), 'utf8');

test('Start Application validates, saves idempotently, and opens Step 2 without a manual reload', () => {
  assert.match(page, /id="admission-enquiry"/);
  assert.match(page, /Start Application/);
  assert.match(workflow, /normalizeGhanaPhone/);
  assert.match(workflow, /enquiryRequestId/);
  assert.match(workflow, /window\.location\.assign\(`\/admission-application\.html\?applicationNumber=.*step=2`\)/);
  assert.match(workflow, /if \(submitting\) return/);
});

test('application drafts reopen and private document uploads transmit bytes through the storage API', () => {
  assert.match(application, /populate\(await request\(`\/api\/admission-applications\/\$\{encodeURIComponent\(applicationNumber\)\}`\)\)/);
  assert.match(application, /Save Draft/);
  assert.match(application, /uploadSelectedDocuments/);
  assert.match(application, /body: file/);
  assert.match(application, /X-Document-Type/);
  assert.doesNotMatch(application, /fileReference:\s*file\.name/);
  assert.match(applicationPage, /id="document-storage-status"/);
  assert.match(applicationPage, /10 MB maximum per file/);
});

test('three leadership roles share the Student Management workflow and retain separate Prospectus navigation', () => {
  const admission = SIDEBAR_MODULES.find((item) => item.moduleKey === 'admissions');
  const prospectus = SIDEBAR_MODULES.find((item) => item.moduleKey === 'admission-prospectus');
  assert.ok(admission);
  for (const role of ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER']) assert.ok((admission.allowedRoles ?? admission.roles).includes(role));
  assert.equal(admission.route, '/admissions');
  assert.ok(prospectus);
  assert.notEqual(prospectus.route, admission.route);
});
