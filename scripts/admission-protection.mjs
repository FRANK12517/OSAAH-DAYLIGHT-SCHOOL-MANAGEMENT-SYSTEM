#!/usr/bin/env node
import { appendFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifest = 'config/admission-protection-manifest.json';
export const REQUIRED_ADMISSION_TESTS = Object.freeze([
  'test/admission-protection.test.js',
  'test/admission-protection-browser.test.js',
  'test/admission-continuation-access.test.js',
  'test/admissions-workflow-ui.test.js',
  'test/admission-form.test.js',
  'test/durable-admission-stages.test.js',
  'test/admission-enrollment.test.js',
  'test/existing-student-linking.test.js',
  'test/admissions-leadership-http.test.js',
  'test/admission-document-upload-http.test.js',
  'test/admission-document-storage.test.js',
  'test/admission-fee-assessment.test.js',
  'test/admission-prospectus.test.js',
  'test/admission-class-database-part1.test.js',
  'test/admission-workflow-migration-preflight.test.js',
  'test/admission-migration-078-preflight-source.test.js',
  'test/admissions-migration-gate.test.js',
  'test/production-admissions-migration-078.test.js',
  'test/production-enrollment-contract-migration.test.js',
  'test/production-enrollment-is-current-migration-080.test.js',
  'test/backward-compatible-enrollment.test.js',
  'test/permanent-student-id.test.js',
  'test/student-identity.test.js',
  'test/admissions-workforce-intelligence.test.js',
  'test/all-role-routing.test.js',
  'test/proprietor-sidebar.test.js',
  'test/proprietor-authentication.test.js',
  'test/durable-auth-sessions.test.js',
  'test/part29-sidebar-release-gate.test.js'
]);

function ensureRepoRelative(file) {
  if (typeof file !== 'string' || !file.trim() || isAbsolute(file) || file.split(/[\\/]/).includes('..')) {
    throw new Error(`Manifest path must be a repository-relative path: ${String(file)}`);
  }
  return file.replaceAll('\\', '/');
}

export async function validateAdmissionManifest(manifest, { repoRoot = root, packageJson } = {}) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion must be 1.');
  if (typeof manifest?.module !== 'string' || !manifest.module.trim()) errors.push('module must be a non-empty string.');
  if (!manifest?.groups || typeof manifest.groups !== 'object' || Array.isArray(manifest.groups)) errors.push('groups must be a path-group object.');
  const groups = Object.entries(manifest?.groups ?? {});
  const declared = new Set();
  for (const [groupName, paths] of groups) {
    if (!Array.isArray(paths) || !paths.length) { errors.push(`group ${groupName} must contain at least one path.`); continue; }
    for (const rawPath of paths) {
      let path;
      try { path = ensureRepoRelative(rawPath); } catch (error) { errors.push(error.message); continue; }
      if (declared.has(path)) errors.push(`path is declared more than once: ${path}`);
      declared.add(path);
      if (!existsSync(resolve(repoRoot, path))) errors.push(`protected path does not exist: ${path}`);
    }
  }
  if (!Array.isArray(manifest?.requiredTests)) errors.push('requiredTests must be an array.');
  else {
    const listed = new Set(manifest.requiredTests);
    if (listed.size !== manifest.requiredTests.length) errors.push('requiredTests must not contain duplicate paths.');
    for (const required of REQUIRED_ADMISSION_TESTS) {
      if (!listed.has(required)) errors.push(`required admission test is missing from the manifest: ${required}`);
      if (!existsSync(resolve(repoRoot, required))) errors.push(`required admission test file does not exist: ${required}`);
    }
    for (const candidate of manifest.requiredTests) {
      try { ensureRepoRelative(candidate); } catch (error) { errors.push(error.message); }
    }
  }
  if (!Array.isArray(manifest?.browserTests) || !manifest.browserTests.length) errors.push('browserTests must list at least one browser regression test.');
  for (const testFile of manifest?.browserTests ?? []) {
    try {
      const path = ensureRepoRelative(testFile);
      if (!manifest.requiredTests?.includes(path)) errors.push(`browser test is not part of requiredTests: ${path}`);
      if (!existsSync(resolve(repoRoot, path))) errors.push(`browser test file does not exist: ${path}`);
    } catch (error) { errors.push(error.message); }
  }
  const pkg = packageJson ?? JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8'));
  if (typeof pkg?.scripts?.['test:admission-protection'] !== 'string' || !pkg.scripts['test:admission-protection'].trim()) errors.push('package.json must register test:admission-protection.');
  if (manifest?.changeImpact?.alwaysRunForPullRequests !== true) errors.push('changeImpact.alwaysRunForPullRequests must be true.');
  if (errors.length) throw new Error(`Admission protection manifest is invalid:\n- ${errors.join('\n- ')}`);
  return { groups, requiredTests: manifest.requiredTests, browserTests: manifest.browserTests };
}

export function runTestCommand(testFiles, { repoRoot = root, runner = spawnSync } = {}) {
  const result = runner(process.execPath, ['--test', ...testFiles], { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  return Number.isInteger(result.status) ? result.status : 1;
}

function runCommand(command, args, repoRoot = root) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  return Number.isInteger(result.status) ? result.status : 1;
}

function parseArgs(argv) {
  const options = { manifest: defaultManifest, base: null, runTests: false, validateMigrations: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--manifest') options.manifest = argv[++index];
    else if (value === '--base') options.base = argv[++index];
    else if (value === '--run-tests') options.runTests = true;
    else if (value === '--validate-migrations') options.validateMigrations = true;
    else throw new Error(`Unknown admission protection option: ${value}`);
  }
  return options;
}

function changedFiles(base, repoRoot) {
  if (!base) return [];
  const result = spawnSync('git', ['diff', '--name-only', '--diff-filter=ACDMRTUXB', `${base}...HEAD`], { cwd: repoRoot, encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Could not compare admission changes with base ${base}: ${String(result.stderr ?? '').trim()}`);
  return String(result.stdout ?? '').split(/\r?\n/).filter(Boolean).map((file) => file.replaceAll('\\', '/'));
}

export function impactReport(manifest, files) {
  const changed = new Set(files);
  const impacted = [];
  for (const [group, paths] of Object.entries(manifest.groups)) {
    const hits = paths.filter((path) => changed.has(path) || [...changed].some((file) => file.startsWith(`${path.replace(/\/$/, '')}/`)));
    if (hits.length) impacted.push({ group, paths: hits });
  }
  const lines = ['## Admission protection change impact', ''];
  if (!files.length) lines.push('No base comparison was supplied; the complete admission suite still runs.');
  else if (!impacted.length) lines.push('No manifest path changed. The complete admission suite still runs for this pull request.');
  else for (const group of impacted) {
    lines.push(`### ${group.group}`, ...group.paths.map((path) => `- \`${path}\``), '');
  }
  lines.push('', 'Required suite: `npm run test:admission-protection` (runs on every pull request).');
  return lines.join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(root, ensureRepoRelative(options.manifest));
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const validated = await validateAdmissionManifest(manifest);
  process.stdout.write(`Admission protection manifest valid: ${validated.requiredTests.length} required test files, ${validated.browserTests.length} browser suite(s).\n`);
  const report = impactReport(manifest, changedFiles(options.base, root));
  process.stdout.write(`${report}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `${report}\n`, 'utf8');
  if (options.runTests) {
    process.stdout.write(`Running ${validated.requiredTests.length} required admission tests.\n`);
    const status = runTestCommand(validated.requiredTests);
    if (status !== 0) process.exitCode = status;
  }
  if (options.validateMigrations && !process.exitCode) {
    process.stdout.write('Validating repository migration inventory.\n');
    process.exitCode = runCommand(process.execPath, ['scripts/migrate.mjs', 'validate']);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
