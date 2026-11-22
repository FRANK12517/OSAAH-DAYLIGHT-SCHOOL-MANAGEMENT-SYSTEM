import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadResultView() {
  const noop = () => {};
  const field = () => ({ value: '', checked: false, innerHTML: '', selectedOptions: [], addEventListener: noop });
  const form = { elements: { academicYear: field(), term: field(), classId: field(), studentId: field(), sampleMode: field() }, addEventListener: noop };
  const status = { textContent: '', dataset: {}, focus: noop };
  const host = { hidden: true, querySelectorAll: () => [], querySelector: () => null };
  const window = {};
  const storage = new Map();
  const context = {
    window, host, status,
    document: { querySelector: (selector) => ({ '#result-context': form, '#status': status, '#result': host })[selector] },
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    fetch: () => new Promise(() => {}), URLSearchParams, AbortController,
    FormData: class FormData {}, Event: class Event {}
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/ges-assessment-libraries.js', import.meta.url), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8'), context);
  context.storage = storage;
  return context;
}

const fields = [
  ['Conduct', 'conduct', 'conduct'],
  ['Interest', 'interest', 'interest'],
  ['Attitude', 'attitude', 'attitude'],
  ["Class Teacher's Remarks", 'classTeacherRemarks', 'ctRemarks'],
  ["Headteacher's Remarks", 'headteacherRemarks', 'htRemarks']
];
const escapeHtml = (value) => String(value).replace(/[&<>\'\"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);

test('Examination Result Slip exposes independent two-tier selectors for all five canonical 30/30 GES comment banks', () => {
  const context = loadResultView();
  const libraries = context.window.OSAAH_GES_ASSESSMENT_LIBRARIES;
  const html = context.assessmentEditor({});
  assert.match(html, /assessment-control-panel no-print print-hidden/);
  for (const [label, field, bankKey] of fields) {
    const library = libraries[bankKey];
    assert.equal(library.positive.length, 30, `${field} positive bank`);
    assert.equal(library.negative.length, 30, `${field} negative bank`);
    assert.ok(html.includes(`>${escapeHtml(label)}</label>`), `${field} category is present`);
    assert.ok(html.includes(`data-assessment-sentiment-for="${field}"`), `${field} sentiment selector is present`);
    const comment = html.match(new RegExp(`data-assessment="${field}"[^>]*>([\\s\\S]*?)<\\/select>`));
    assert.ok(comment, `${field} comment selector is present`);
    assert.equal((comment[1].match(/<option\b/g) || []).length, library.positive.length + 1, `${field} defaults to its complete positive bank`);
    for (const value of library.positive) assert.ok(comment[1].includes(`>${escapeHtml(value)}</option>`));
    const negativeOptions = context.assessmentCommentOptions(field, 'negative');
    assert.equal((negativeOptions.match(/<option\b/g) || []).length, library.negative.length + 1);
    for (const value of library.negative) assert.ok(negativeOptions.includes(`>${escapeHtml(value)}</option>`));
  }
  assert.doesNotMatch(html, /<select\b[^>]*\bmultiple\b/i);
});

test('saved positive or negative comments are selected and printable markup contains only the chosen text', () => {
  const context = loadResultView();
  const libraries = context.window.OSAAH_GES_ASSESSMENT_LIBRARIES;
  for (const [, field, bankKey] of fields) {
    const positive = libraries[bankKey].positive[0];
    const negative = libraries[bankKey].negative[0];
    for (const [comment, sentiment] of [[positive, 'positive'], [negative, 'negative']]) {
      const controls = context.assessmentEditor({ [field]: comment });
      assert.match(controls, new RegExp(`data-assessment-sentiment-for="${field}"><option value="positive"${sentiment === 'positive' ? ' selected' : ''}>Positive</option><option value="negative"${sentiment === 'negative' ? ' selected' : ''}>Negative</option>`));
      assert.ok(controls.includes(`value="${escapeHtml(comment)}" selected`), `${field} selected option remains selected`);
      const printable = context.assessmentFinal({ [field]: comment });
      assert.ok(printable.includes(`data-assessment-value="${field}">${escapeHtml(comment)}</span>`));
      assert.doesNotMatch(printable, /<select|Positive|Negative/);
    }
  }
  assert.match(context.assessmentFinal({}), /Not recorded/);
});

test('standard result preview updates one category, persists assessment state, exports current values, and hides external controls in print', () => {
  const context = loadResultView();
  const client = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  const page = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  assert.match(client, /host\.innerHTML = `\$\{assessmentEditor\(assess\)\}/);
  assert.match(client, /<section class="result-slip">[\s\S]*?assessmentFinal\(assess\)/);
  assert.match(client, /comment\.addEventListener\('change'/);
  assert.match(client, /sentiment\.addEventListener\('change'/);
  assert.match(client, /updateAssessmentPreview\(key, selected\)/);
  assert.match(client, /localStorage\.setItem\(storageKey\(x\), JSON\.stringify\(next\)\)/);
  assert.match(client, /downloadResultPdf\(\{ \.\.\.x, attendance: attendanceValues\(\), assessment: \{ \.\.\.assess, \.\.\.assessmentValues\(\) \} \}/);
  assert.match(page, /\.assessment-control-grid\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(page, /\.no-print\{display:none!important\}/);
  assert.match(page, /\.assessment-control-panel\{/);
  assert.equal(typeof context.assessmentFinal, 'function');
});
test('changing sentiment filters one category, changing comment updates its print preview and persists the selected state', () => {
  const context = loadResultView();
  const keys = fields.map(([, key]) => key);
  const comments = new Map();
  const sentiments = new Map();
  const previews = new Map();
  const makeControl = (dataset, value = '') => {
    const listeners = {};
    return { dataset, value, innerHTML: '', textContent: value, addEventListener: (name, callback) => { listeners[name] = callback; }, trigger: (name) => listeners[name]?.() };
  };
  for (const key of keys) {
    comments.set(key, makeControl({ assessment: key, assessmentSentiment: 'positive' }));
    sentiments.set(key, makeControl({ assessmentSentimentFor: key }, 'positive'));
    previews.set(key, makeControl({ assessmentValue: key }, 'Not recorded'));
  }
  context.host.querySelectorAll = (selector) => selector === '[data-assessment]' ? [...comments.values()] : [...sentiments.values()];
  context.host.querySelector = (selector) => {
    const commentMatch = selector.match(/data-assessment="([^"]+)"/);
    if (commentMatch) return comments.get(commentMatch[1]);
    const previewMatch = selector.match(/data-assessment-value="([^"]+)"/);
    if (previewMatch) return previews.get(previewMatch[1]);
    return null;
  };
  const result = { schoolId: 'school-1', studentId: 'student-1', classId: 'class-1', academicYear: 'year-1', term: 'term-1', resultType: 'TERMINAL' };
  context.bindAssessmentControls(result);
  sentiments.get('conduct').value = 'negative';
  sentiments.get('conduct').trigger('change');
  const negative = context.window.OSAAH_GES_ASSESSMENT_LIBRARIES.conduct.negative[0];
  assert.ok(comments.get('conduct').innerHTML.includes(`>${escapeHtml(negative)}</option>`));
  assert.equal(comments.get('conduct').value, '');
  assert.equal(previews.get('conduct').textContent, 'Not recorded');
  comments.get('conduct').value = negative;
  comments.get('conduct').trigger('change');
  assert.equal(previews.get('conduct').textContent, negative);
  assert.equal(previews.get('interest').textContent, 'Not recorded');
  const saved = JSON.parse([...context.storage.values()][0]);
  assert.equal(saved.conduct, negative);
  assert.equal(saved.interest, '');
});

test('printable assessment comments use a full-width horizontal label/comment layout', () => {
  const page = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  const threeColumnAssessmentRule = page.indexOf('.slip-summary,.slip-assessment,.slip-attendance{display:grid;grid-template-columns:repeat(3,1fr)');
  const oneColumnAssessmentOverride = page.indexOf('.result-slip .slip-assessment{grid-template-columns:minmax(0,1fr)}', threeColumnAssessmentRule);
  assert.ok(threeColumnAssessmentRule >= 0, 'shared summary/assessment grid rule exists');
  assert.ok(oneColumnAssessmentOverride > threeColumnAssessmentRule, 'the printable assessment section overrides the shared three-column grid');
  assert.match(page, /\.result-slip \.slip-assessment \.assessment-card\{display:grid;grid-template-columns:minmax\(9rem,25%\) minmax\(0,1fr\)/);
  assert.match(page, /@media\(max-width:600px\)[\s\S]*?\.result-slip \.slip-assessment \.assessment-card\{grid-template-columns:minmax\(7rem,25%\) minmax\(0,1fr\)\}/);
  assert.match(page, /\.result-slip \.slip-assessment \.static-value\{min-width:0;overflow-wrap:break-word;word-break:normal\}/);
});
