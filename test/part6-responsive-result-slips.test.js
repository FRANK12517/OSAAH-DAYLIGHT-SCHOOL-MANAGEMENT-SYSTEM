import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(new URL(`../public/${name}`, import.meta.url), 'utf8');
const css = read('styles.css');
const terminal = read('results.html');
const mock = read('mock-results.html');
const terminalClient = read('result-view.js');
const mockClient = read('mock-result-view.js');

const widths = [320, 360, 375, 390, 414, 768, 1024];

test('shared result-slip CSS covers every required viewport width without nested horizontal scrolling', () => {
  for (const width of widths) assert.ok(width >= 320, `supported viewport ${width}px`);
  assert.match(css, /\.result-slip\{width:min\(100%,820px\)/);
  assert.match(css, /\.result-slip table\{[^}]*min-width:0[^}]*table-layout:fixed/);
  assert.match(css, /\.result-slip th,.result-slip td\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /@media\(max-width:479px\)/);
  assert.match(css, /@media\(min-width:600px\)/);
  assert.match(css, /@media\(min-width:900px\)/);
  assert.doesNotMatch(terminalClient, /table-scroll[^>]*style="[^"]*overflow-x:auto/);
  assert.match(mock, /\.mock-page \.table-scroll\{overflow:visible/);
  assert.match(mock, /\.mock-page table\{[^}]*min-width:0[^}]*table-layout:fixed/);
});

test('End-of-Term and Mock slips retain responsive controls, content, borders, and A4 print rules', () => {
  for (const page of [terminal, mock]) {
    assert.match(page, /name="viewport"[^>]+content="width=device-width/);
    assert.match(page, /@media print/);
    assert.match(page, /border:(?:2px|4px) solid #102a43/);
    assert.match(page, /#d4a72c|#d4af37/);
  }
  for (const client of [terminalClient, mockClient]) {
    for (const marker of ['Permanent Student ID', 'TOTAL BOYS IN CLASS', 'TOTAL GIRLS IN CLASS', 'SUBJECT POSITION', 'GES', 'Attendance', 'window.print', 'downloadResultPdf']) assert.match(client, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.match(css, /\.result-slip\{width:190mm!important;max-width:190mm!important/);
  assert.match(css, /@page\{size:A4 portrait;margin:10mm\}/);
});
