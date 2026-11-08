import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function setup({ confirms = [], responses = [] } = {}) {
  const buttons = new Map();
  const button = (id) => {
    if (!buttons.has(id)) buttons.set(id, { disabled: false, textContent: '', onclick: null });
    return buttons.get(id);
  };
  const host = { hidden: true, _innerHTML: '', querySelector: (selector) => selector.startsWith('#') ? button(selector.slice(1)) : null, querySelectorAll: () => [] };
  Object.defineProperty(host, 'innerHTML', { get() { return this._innerHTML; }, set(value) { this._innerHTML = value; const publish = button('publish-sample'); if (String(value).includes('id="publish-sample"')) { publish.disabled = /id="publish-sample"[^>]*\sdisabled/.test(value); publish.textContent = publish.disabled ? 'Sample Result Published' : 'Publish Sample Result'; } const reset = button('reset-sample'); reset.disabled = false; } });
  const status = { textContent: '', dataset: {}, focus() {} };
  const field = () => ({ value: '', checked: false, innerHTML: '', selectedOptions: [], addEventListener() {} });
  const form = { elements: { academicYear: field(), term: field(), classId: field(), studentId: field(), sampleMode: field() }, addEventListener() {} };
  const requests = [];
  let confirmIndex = 0;
  const context = {
    window: { confirm: () => confirms[confirmIndex++] ?? true, print() {} },
    document: { querySelector: (selector) => ({ '#result-context': form, '#status': status, '#result': host })[selector] },
    localStorage: { getItem: () => null, setItem() {} },
    fetch: async (url, init = {}) => {
      if (!String(url).startsWith('/api/academic/sample/')) return { ok: false, status: 404, json: async () => ({ error: 'Not configured in test.' }) };
      requests.push({ url: String(url), init });
      const next = responses.shift();
      if (!next) return new Promise(() => {});
      return { ok: next.ok ?? true, status: next.status ?? 200, json: async () => next.body ?? {} };
    },
    URLSearchParams,
    AbortController,
    FormData: class FormData {},
    Event: class Event {}
  };
  vm.runInNewContext(fs.readFileSync(new URL('../public/ges-assessment-libraries.js', import.meta.url), 'utf8'), context);
  vm.runInNewContext(fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8'), context);
  const result = { isSample: true, studentId: 'sample-row-001', studentIndexNumber: 'OSAAH/DEMO/001', classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', resultType: 'TERMINAL', subjects: [], attendance: {}, assessments: {} };
  context.render(result);
  return { context, buttons, host, requests, result, status };
}

test('cancelling sample publish or reset sends no request and leaves the rendered sample result intact', async () => {
  const { buttons, host, requests, result, status } = setup({ confirms: [false, false] });
  await new Promise((resolve) => setImmediate(resolve));
  const initialStatus = status.textContent;
  await buttons.get('publish-sample').onclick({ currentTarget: buttons.get('publish-sample') });
  await buttons.get('reset-sample').onclick({ currentTarget: buttons.get('reset-sample') });
  assert.equal(requests.length, 0);
  assert.equal(host.hidden, false);
  assert.equal(status.textContent, initialStatus);
  assert.equal(result.studentIndexNumber, 'OSAAH/DEMO/001');
});

test('confirmed publish refreshes state, exposes published status, and blocks duplicate publish requests', async () => {
  const publication = { id: 'sample-pub-1', isSample: true, status: 'PUBLISHED' };
  const { buttons, requests, status } = setup({ confirms: [true], responses: [
    { body: publication },
    { body: { sample: { isSample: true, publication, publicationStatus: 'PUBLISHED' } } }
  ] });
  await buttons.get('publish-sample').onclick({ currentTarget: buttons.get('publish-sample') });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /^\/api\/academic\/sample\/publish$/);
  assert.equal(requests[0].init.method, 'POST');
  assert.match(requests[1].url, /^\/api\/academic\/sample\/state\?/);
  assert.match(requests[1].url, /classId=Primary\+1/);
  assert.equal(buttons.get('publish-sample').disabled, true);
  assert.equal(buttons.get('publish-sample').textContent, 'Sample Result Published');
  assert.equal(status.textContent, 'Sample result published.');
  await buttons.get('publish-sample').onclick({ currentTarget: buttons.get('publish-sample') });
  assert.equal(requests.length, 2, 'published result cannot be submitted again from the disabled action');
});

test('confirmed reset refreshes empty state and leaves publish available', async () => {
  const { buttons, requests, status } = setup({ confirms: [true], responses: [
    { body: { ok: true, isSample: true, publicationRemoved: true } },
    { body: { sample: null } }
  ] });
  await buttons.get('reset-sample').onclick({ currentTarget: buttons.get('reset-sample') });
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /^\/api\/academic\/sample\/reset$/);
  assert.match(requests[1].url, /^\/api\/academic\/sample\/state\?/);
  assert.equal(buttons.get('publish-sample').disabled, false);
  assert.equal(buttons.get('publish-sample').textContent, 'Publish Sample Result');
  assert.equal(status.textContent, 'Sample result reset.');
});

test('sample lifecycle API errors are visible and the action can be retried', async () => {
  const { buttons, requests, status } = setup({ confirms: [true], responses: [
    { ok: false, status: 403, body: { error: 'Forbidden.' } }
  ] });
  await buttons.get('publish-sample').onclick({ currentTarget: buttons.get('publish-sample') });
  assert.equal(requests.length, 1);
  assert.equal(status.textContent, 'Forbidden.');
  assert.equal(buttons.get('publish-sample').disabled, false);
});

test('Mock sample publish and reset require confirmation and verify refreshed isolated state', () => {
  const client = fs.readFileSync(new URL('../public/mock-result-view.js', import.meta.url), 'utf8');
  assert.match(client, /Publish this SAMPLE DATA Mock result\?/);
  assert.match(client, /Reset this SAMPLE DATA Mock result and its sample scores\?/);
  assert.match(client, /\/api\/academic\/sample\/mock-reset/);
  assert.match(client, /sampleLifecycleState\(x\)/);
  assert.match(client, /if\(sampleLifecycle\)throw Error\('The sample Mock state is still present after reset\.'\)/);
  assert.match(client, /id="reset-sample-mock"[^`]*x\.isSample\?''/);
});
