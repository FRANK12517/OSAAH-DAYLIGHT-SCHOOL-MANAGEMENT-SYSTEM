import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../public/subjects.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../public/subjects.js', import.meta.url), 'utf8');

test('Subject Configuration has academic-year and single-selection class dropdowns', () => {
  assert.match(html, /<select id="academic-year"/);
  assert.match(html, /<select id="class-select"/);
  assert.doesNotMatch(html.match(/<select id="class-select"[\s\S]*?<\/select>/)?.[0] ?? '', /\smultiple(?:\s|>)/i);
  assert.match(js, /\/api\/academic\/options/);
  assert.match(js, /\/api\/subjects\/configuration\?/);
});

test('Subject Configuration renders classifications and scoring metadata with useful request states', () => {
  for (const phrase of ['Loading class subjects', 'No subjects are configured', 'Unable to load this configuration', 'Saving the class assignment', 'subjectType', 'Scoring', 'Non-scoring']) assert.ok(js.includes(phrase), `missing ${phrase}`);
  assert.match(html, /<th>Mandatory<\/th>/);
});

test('Success messages are shown only after the server response and reload confirm the persisted state', () => {
  assert.match(js, /const result = await api\('\/api\/subjects\/configure-defaults'/);
  assert.match(js, /Saved and confirmed by the school server/);
  assert.match(js, /await loadConfiguration\(\{ savedMessage:/);
  assert.match(js, /Save failed; no success was reported/);
  assert.match(js, /No local or memory-only data was substituted/);
});
