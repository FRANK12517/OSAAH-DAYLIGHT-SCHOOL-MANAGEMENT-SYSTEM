import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = new URL('../config/protected-components.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

 test('protected component registry explicitly preserves the Users & Roles feature', () => {
  assert.equal(manifest.version, 1);
  assert.ok(Array.isArray(manifest.components) && manifest.components.length > 0);
  const ids = manifest.components.map((component) => component.id);
  assert.equal(new Set(ids).size, ids.length, 'protected component IDs must be unique');
  assert.ok(ids.includes('administrator-users-roles-directory'), 'Users & Roles must remain a protected component');
});

test('protected component files exist and retain required semantic markers', async () => {
  for (const component of manifest.components) {
    assert.ok(component.id && component.route && component.description, 'each protected component must have an ID, route, and description');
    assert.ok(Array.isArray(component.files) && component.files.length > 0, `${component.id} must protect at least one file`);
    for (const file of component.files) {
      assert.ok(typeof file.path === 'string' && file.path.length > 0, `${component.id} contains a missing file path`);
      assert.equal(isAbsolute(file.path), false, `${component.id} paths must be repository-relative`);
      const absolutePath = resolve(repositoryRoot, file.path);
      const relativePath = relative(repositoryRoot, absolutePath);
      assert.ok(relativePath && relativePath !== '..' && !relativePath.startsWith(`..${sep}`), `${component.id} file path escapes the repository`);
      const contents = await readFile(absolutePath, 'utf8');
      assert.ok(Array.isArray(file.requiredMarkers) && file.requiredMarkers.length > 0, `${file.path} must declare semantic protection markers`);
      for (const marker of file.requiredMarkers) assert.ok(contents.includes(marker), `${component.id}: ${file.path} is missing protected marker ${JSON.stringify(marker)}`);
    }
  }
});
