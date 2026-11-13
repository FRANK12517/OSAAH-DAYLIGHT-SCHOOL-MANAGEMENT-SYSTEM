import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('terminal and Mock result pages use one-class selection controls for class operations', async () => {
  const [terminalPage, mockPage, controls, terminalScript, mockScript] = await Promise.all([
    readFile(new URL('../public/results.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/mock-results.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/result-blocking-controls.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/result-view.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/mock-result-view.js', import.meta.url), 'utf8')
  ]);
  for (const page of [terminalPage, mockPage]) assert.match(page, /result-blocking-controls\.js/);
  assert.match(controls, /<select id="result-blocking-class" required/);
  assert.match(controls, /window\.confirm/);
  assert.match(controls, /chooseClass/);
  assert.match(terminalScript, /chooseClass\(options\.classes/);
  assert.match(mockScript, /chooseClass\(options\.classes/);
});

test('result pages refresh persisted block status and report class operation outcomes', async () => {
  const [terminalScript, mockScript, server] = await Promise.all([
    readFile(new URL('../public/result-view.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/mock-result-view.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/server.mjs', import.meta.url), 'utf8')
  ]);
  for (const script of [terminalScript, mockScript]) {
    assert.match(script, /\/api\/academic\/results\/block-status/);
    assert.match(script, /affectedStudents/);
  }
  assert.match(server, /pathname === '\/api\/academic\/results\/block-status'/);
  assert.match(server, /resultStudents\(\{ \.\.\.body, resultType/);
});
