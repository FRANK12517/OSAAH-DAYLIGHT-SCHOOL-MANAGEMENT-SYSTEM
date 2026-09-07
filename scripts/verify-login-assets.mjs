import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from 'image-size';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const manifestPath = join(repositoryRoot, 'config', 'login-assets.integrity.json');
const loginPagePath = join(repositoryRoot, 'public', 'index.html');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const loginPage = await readFile(loginPagePath, 'utf8');
const failures = [];

if (manifest.version !== 1) failures.push(`Unsupported manifest version: ${manifest.version}`);
if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) failures.push('Manifest contains no protected assets.');

const seen = new Set();
for (const asset of manifest.assets ?? []) {
  if (!asset.path || seen.has(asset.path)) {
    failures.push(`Manifest has a missing or duplicate path: ${asset.path ?? '(empty)'}`);
    continue;
  }
  seen.add(asset.path);
  if (!asset.path.startsWith('public/assets/') || asset.path.includes('..')) failures.push(`Unsafe protected asset path: ${asset.path}`);
  const absolutePath = join(repositoryRoot, asset.path);
  let contents;
  try {
    contents = await readFile(absolutePath);
  } catch {
    failures.push(`Protected asset is missing: ${asset.path}`);
    continue;
  }
  const sha256 = createHash('sha256').update(contents).digest('hex');
  if (sha256 !== asset.sha256) failures.push(`Protected asset hash changed: ${asset.path}`);
  if (contents.length !== asset.bytes) failures.push(`Protected asset byte count changed: ${asset.path}`);
  const relativeAssetPath = asset.path.slice('public'.length).replaceAll('\\', '/');
  if (!loginPage.includes(`src="${relativeAssetPath}"`)) failures.push(`Login page no longer references protected asset: ${relativeAssetPath}`);
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(extname(asset.path).toLowerCase())) {
    try {
      const dimensions = imageSize(contents);
      if (asset.width !== dimensions.width || asset.height !== dimensions.height) failures.push(`Protected asset dimensions changed: ${asset.path}`);
    } catch {
      failures.push(`Protected asset is not a readable image: ${asset.path}`);
    }
  }
}

const requiredGallery = manifest.assets.filter((asset) => asset.path.includes('/login-gallery/'));
if (requiredGallery.length !== 11) failures.push(`Expected 11 protected login gallery assets, found ${requiredGallery.length}.`);
if (!manifest.assets.some((asset) => asset.path === 'public/assets/osaah-daylight-school-complex-logo.png')) failures.push('The protected login logo is not in the manifest.');

if (failures.length) {
  console.error('Login asset integrity check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Login asset integrity check passed for ${manifest.assets.length} protected assets.`);
}
