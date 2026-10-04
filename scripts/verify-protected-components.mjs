import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifest = JSON.parse(await readFile(resolve(root, 'config/protected-components.json'), 'utf8'));
const failures = [];
for (const component of manifest.components ?? []) {
  for (const file of component.files ?? []) {
    const path = resolve(root, file.path);
    let contents;
    try { contents = await readFile(path, 'utf8'); } catch { failures.push(`${component.id}: missing ${file.path}`); continue; }
    for (const marker of file.requiredMarkers ?? []) if (!contents.includes(marker)) failures.push(`${component.id}: ${file.path} is missing ${JSON.stringify(marker)}`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log(`Protected component verification passed: ${manifest.components.length} component(s).`);
