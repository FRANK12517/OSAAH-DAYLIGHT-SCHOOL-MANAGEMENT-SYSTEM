import { readdir } from 'node:fs/promises';

export async function discoverAICapabilityManifests({ directory = new URL('./capabilities/', import.meta.url) } = {}) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.capability.js')).sort((a, b) => a.name.localeCompare(b.name));
  const manifests = [];
  for (const file of files) {
    const module = await import(new URL(file.name, directory));
    if (!Array.isArray(module.capabilities)) throw new Error(`AI capability manifest must export a capabilities array: ${file.name}`);
    manifests.push(...module.capabilities);
  }
  return manifests;
}
