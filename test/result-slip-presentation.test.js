import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { averageScore, subjectPositions } from '../src/result-slip.js';

const html = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
const renderer = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');

test('result slip has exactly one active border container and no outer nested border host', () => {
  assert.equal((html.match(/class="result-slip/g) || []).length, 0, 'the host must not carry the slip border');
  assert.match(renderer, /<section class="result-slip">/);
  assert.match(html, /\.result-slip\{[^}]*border:2px solid #102a43/);
  assert.match(html, /\.result-slip::after\{[^}]*border:2px solid #d4a72c/);
  assert.doesNotMatch(html, /border:4px double/);
});

test('border derives from content and remains present in print CSS', () => {
  assert.match(html, /height:auto/);
  assert.match(html, /min-height:0/);
  assert.match(html, /@media print\{[^}]*body/s);
  assert.match(html, /\.result-slip::after\{border-color:#d4a72c/);
  assert.doesNotMatch(html, /result-slip[^}]*height:\s*\d+px/);
});

test('result header uses the authoritative wide logo asset without overflow', () => {
  assert.match(renderer, /headerAsset/);
  assert.match(html, /\.slip-logo\{[^}]*width:min\(100%,420px\)[^}]*height:auto/);
  assert.match(html, /\.slip-logo\{[^}]*max-height:110px/);
});

test('result calculations remain unchanged by presentation enhancements', () => {
  assert.equal(averageScore([{ subjectId: 'Math', totalScore: 80 }, { subjectId: 'English', totalScore: 60 }]), 70);
  assert.equal(subjectPositions([{ subjectId: 'Math', totalScore: 90 }], [{ subjectId: 'Math', totalScore: 90 }, { subjectId: 'Math', totalScore: 80 }])[0].subjectPosition, '1st');
});
