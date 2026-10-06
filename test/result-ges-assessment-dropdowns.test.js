import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadResultView() {
  const noop = () => {};
  const field = () => ({ value: '', checked: false, innerHTML: '', selectedOptions: [], addEventListener: noop });
  const form = {
    elements: { academicYear: field(), term: field(), classId: field(), studentId: field(), sampleMode: field() },
    addEventListener: noop
  };
  const status = { textContent: '', dataset: {}, focus: noop };
  const host = { hidden: true, querySelectorAll: () => [], querySelector: () => null };
  const window = {};
  const context = {
    window,
    document: { querySelector: (selector) => ({ '#result-context': form, '#status': status, '#result': host })[selector] },
    localStorage: { getItem: () => null, setItem: noop },
    fetch: () => new Promise(() => {}),
    URLSearchParams,
    AbortController,
    FormData: class FormData {},
    Event: class Event {}
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/ges-assessment-libraries.js', import.meta.url), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8'), context);
  return context;
}

const fields = [
  ['classTeacherRemarks', 'ctRemarks'],
  ['headteacherRemarks', 'htRemarks'],
  ['conduct', 'conduct'],
  ['attitude', 'attitude'],
  ['interest', 'interest']
];
const escapeHtml = (value) => String(value).replace(/[&<>\'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

test('Result Slip maps teacher remark field names to the canonical comment banks without duplicating them', () => {
  const context = loadResultView();
  const libraries = context.window.OSAAH_GES_ASSESSMENT_LIBRARIES;
  assert.equal(context.window.OSAAH_GES_ASSESSMENT_LIBRARY_KEY('classTeacherRemarks'), 'ctRemarks');
  assert.equal(context.window.OSAAH_GES_ASSESSMENT_LIBRARY_KEY('headteacherRemarks'), 'htRemarks');
  for (const [field, bankKey] of fields) {
    const library = libraries[bankKey];
    assert.ok(library?.positive?.length, `${field} positive bank exists`);
    assert.ok(library?.negative?.length, `${field} negative bank exists`);
    const html = context.assessmentField(field, field, {});
    for (const [sentiment, comments] of Object.entries(library)) {
      const source = html.match(new RegExp(`data-assessment-source="${sentiment}">([\\s\\S]*?)<\\/select>`));
      assert.ok(source, `${field} ${sentiment} source select exists`);
      assert.equal((source[1].match(/<option\b/g) || []).length, comments.length + 1, `${field} ${sentiment} exposes the complete canonical bank`);
      for (const comment of comments) assert.ok(source[1].includes(`>${escapeHtml(comment)}</option>`), `${field} ${sentiment} includes: ${comment}`);
    }
    assert.doesNotMatch(html, /<select\b[^>]*\bmultiple\b/i, `${field} controls remain single-selection`);
  }
});

test('selected class-teacher and headteacher remarks remain selected and display the full saved values beneath the dropdown', () => {
  const context = loadResultView();
  const libraries = context.window.OSAAH_GES_ASSESSMENT_LIBRARIES;
  for (const [field, bankKey] of fields.slice(0, 2)) {
    const value = libraries[bankKey].positive[0];
    const html = context.assessmentField(field, field, { [field]: value });
    assert.ok(html.includes(`value="${value}" selected`), `${field} selected comment is represented in its options`);
    assert.ok(html.includes(`<div class="static-value" data-static="${field}">${value}</div>`), `${field} selected comment is shown below its dropdown`);
  }
});
