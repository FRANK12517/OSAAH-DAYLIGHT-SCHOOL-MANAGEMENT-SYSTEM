import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  impactReport,
  REQUIRED_ADMISSION_TESTS,
  runTestCommand,
  validateAdmissionManifest
} from '../scripts/admission-protection.mjs';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('config/admission-protection-manifest.json', root), 'utf8'));

test('admission protection manifest covers its required paths and commands', async () => {
  const validated = await validateAdmissionManifest(manifest);
  assert.deepEqual(validated.requiredTests, REQUIRED_ADMISSION_TESTS);
  assert.deepEqual(validated.browserTests, ['test/admission-protection-browser.test.js']);
});

test('admission protection manifest rejects a missing required test', async () => {
  const invalid = structuredClone(manifest);
  invalid.requiredTests = invalid.requiredTests.filter((path) => path !== REQUIRED_ADMISSION_TESTS[0]);
  await assert.rejects(validateAdmissionManifest(invalid), /required admission test is missing/);
});

test('admission test command preserves a failing runner exit status', () => {
  let observed;
  const status = runTestCommand(['test/example.test.js'], {
    repoRoot: 'repository-root',
    runner: (executable, args, options) => {
      observed = { executable, args, options };
      return { status: 1 };
    }
  });
  assert.equal(status, 1);
  assert.deepEqual(observed.args, ['--test', 'test/example.test.js']);
  assert.equal(observed.options.cwd, 'repository-root');
});

test('impact report identifies changed admission protection groups while keeping the full gate', () => {
  const report = impactReport(manifest, ['src/admission-enrollment.js', 'docs/ADMISSION_WORKFLOW_CHANGE_CONTROL.md']);
  assert.match(report, /admission-services-and-shared-rules/);
  assert.match(report, /protection-system/);
  assert.match(report, /runs on every pull request/);
});
