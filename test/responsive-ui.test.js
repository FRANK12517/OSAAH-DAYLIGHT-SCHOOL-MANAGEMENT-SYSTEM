import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const publicRoot = new URL('../public/', import.meta.url);

test('every application page opts into the shared responsive viewport and styles', async () => {
  const pages = (await readdir(publicRoot)).filter((name) => name.endsWith('.html'));
  assert.ok(pages.length >= 40);
  for (const page of pages) {
    const html = await readFile(new URL(page, publicRoot), 'utf8');
    assert.match(html, /<meta[^>]+name="viewport"[^>]+width=device-width/i, `${page} viewport`);
    assert.match(html, /href="\/styles\.css"/i, `${page} responsive stylesheet`);
  }
});

test('shared CSS defines mobile-first controls, tables, dialogs and progressive breakpoints', async () => {
  const css = await readFile(new URL('styles.css', publicRoot), 'utf8');
  assert.match(css, /button,\[role="button"\],input:not\(\[type="hidden"\]\),select\{min-height:44px/);
  assert.match(css, /\.table-wrap,\.table-scroll,\.responsive-table\{[^}]*overflow-x:auto/);
  assert.match(css, /\.table-wrap th,\.table-scroll th,\.responsive-table th[^}]*position:sticky/);
  assert.match(css, /dialog,\[role="dialog"\],\.modal,\.modal-content\{[^}]*max-height:calc\(100dvh - 32px\)/);
  for (const width of [479, 600, 760, 900]) assert.match(css, new RegExp(`@media\\((?:max|min)-width:${width}px\\)`));
});

test('result slips fit narrow screens while print keeps official A4 dimensions', async () => {
  const [css, script] = await Promise.all([
    readFile(new URL('styles.css', publicRoot), 'utf8'),
    readFile(new URL('result-view.js', publicRoot), 'utf8')
  ]);
  assert.match(script, /class="result-header"/);
  assert.match(script, /class="table-scroll"/);
  assert.match(css, /\.result-slip\{width:min\(100%,820px\)/);
  assert.match(css, /\.result-slip table\{width:100%;min-width:0;table-layout:fixed\}/);
  assert.match(css, /@media print\{/);
  assert.match(css, /\.result-slip\{width:190mm!important;max-width:190mm!important/);
  assert.match(css, /@page\{size:A4 portrait;margin:10mm\}/);
});
