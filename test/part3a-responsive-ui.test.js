import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (name) => readFile(new URL(`../public/${name}`, import.meta.url), 'utf8');

test('Part 3A uses targeted overflow containment instead of page-wide hiding', async () => {
  const css = await read('styles.css');
  assert.doesNotMatch(css, /body\{overflow-x:hidden\}/);
  assert.doesNotMatch(css, /html\{[^}]*overflow-x:hidden/);
  assert.match(css, /\.table-wrap,\.table-scroll,\.responsive-table\{[^}]*overflow-x:auto/);
  assert.match(css, /\.finance-table-wrap\{[^}]*overflow-x:auto/);
});

test('Part 3A Result Slip controls and document auto-fit stay separate from print dimensions', async () => {
  const [css, page] = await Promise.all([read('styles.css'), read('results.html')]);
  assert.match(page, /result-context-card/);
  assert.match(css, /#result-context label:has\(input\[type=checkbox\]\)/);
  assert.match(css, /\.result-slip\{container-type:inline-size/);
  assert.match(css, /@container \(max-width:600px\)/);
  assert.match(css, /\.result-slip\{width:190mm!important;max-width:190mm!important/);
  assert.match(css, /@media print\{/);
});

test('Part 3A keeps mobile score cards, finance tables, dialogs and sidebar touch targets', async () => {
  const css = await read('styles.css');
  assert.match(css, /\.score-grid tr>td::before/);
  assert.match(css, /\.finance-table-wrap\{[^}]*overscroll-behavior-inline:contain/);
  assert.match(css, /dialog\{width:min\(92vw,760px\)/);
  assert.match(css, /\.sidebar-menu-button\{display:block;position:fixed/);
  assert.match(css, /button,\[role=\"button\"\],input:not\(\[type=\"hidden\"\]\),select\{min-height:44px/);
});
