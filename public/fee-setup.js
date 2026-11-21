import { FEE_TYPE_CATALOGUE } from '/fee-type-catalogue.js';
import { parsePositiveGhsAmountToMinorUnits } from '/fee-amount.js';
import { renderPublishedFeeSummary } from '/fee-publication-summary.js';
(() => {
  const form = document.querySelector('#publish'), status = document.querySelector('#status'), classField = document.querySelector('#class-field'), classSelect = form.elements.classId, customField = document.querySelector('#custom-fee-field'), customInput = form.elements.customFeeTypeName, submitButton = form.querySelector('[type="submit"]'), publishedFeeSummary = document.querySelector('#published-fee-summary');
  let ready = false, submitting = false, canPublish = false;
  const setStatus = (message, error = false) => { status.textContent = message; status.dataset.state = error ? 'error' : 'ready'; };
  const amountHelp = document.querySelector('#amount-help');
  function refreshSubmitState() {
    let validAmount = false;
    try { validAmount = Boolean(form.elements.amount.value) && parsePositiveGhsAmountToMinorUnits(form.elements.amount.value) > 0; }
    catch (error) { amountHelp.textContent = form.elements.amount.value ? error.message : 'Enter a positive amount with up to two decimal places.'; }
    if (validAmount) amountHelp.textContent = 'Enter a positive amount with up to two decimal places.';
    submitButton.disabled = !ready || !canPublish || submitting || !form.elements.academicYearId.value || !form.elements.termId.value || !form.elements.feeStructureId.value || !validAmount || (form.elements.scope.value === 'SPECIFIC_CLASS' && !classSelect.value) || (customInput.required && !customInput.value.trim());
  }
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const fill = (select, items, placeholder, label = (item) => item.name) => { select.replaceChildren(new Option(placeholder, '')); items.forEach((item) => select.add(new Option(label(item), item.id))); };
  const syncTarget = () => { const specific = form.elements.scope.value === 'SPECIFIC_CLASS'; classField.hidden = !specific; classSelect.required = specific; if (!specific) classSelect.value = ''; };
  const syncCustom = () => { const other = form.elements.feeStructureId.value === 'OTHER' || /(^|\b)other(\b|$)/i.test(form.elements.feeStructureId.selectedOptions[0]?.textContent ?? ''); customField.hidden = !other; customInput.required = other; if (!other) customInput.value = ''; };
  async function jsonRequest(url, options = {}) {
    let response;
    try {
      response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', ...(options.headers || {}) }, ...options });
    } catch (cause) {
      const error = new Error(`Could not reach ${url}. Check the connection and try again.`);
      error.code = 'FEE_NETWORK_ERROR';
      console.error('Fee Setup request failed', { path: url, code: error.code });
      throw error;
    }
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
      const error = new Error(data.error || `Fee Setup request failed (${response.status}).`);
      error.status = response.status;
      error.code = data.code || `HTTP_${response.status}`;
      error.requestId = response.headers.get('x-vercel-id') || response.headers.get('x-request-id') || undefined;
      console.error('Fee Setup request failed', { path: url, status: error.status, code: error.code, requestId: error.requestId });
      throw error;
    }
    return data;
  }
  async function loadOptions() { const data = await jsonRequest('/api/fee-setup/options'); canPublish = data.canPublish === true; const feeTypes = data.feeTypes?.length ? data.feeTypes : FEE_TYPE_CATALOGUE.map(([id, name]) => ({ id, name })); fill(form.elements.academicYearId, data.academicYears || [], 'Select academic year', (item) => item.name); const terms = data.terms || []; const syncTerms = () => { const yearId = form.elements.academicYearId.value; const available = terms.filter((item) => !item.academicYearId || item.academicYearId === yearId); fill(form.elements.termId, available, yearId ? 'Select term' : 'Select academic year first', (item) => item.name); refreshSubmitState(); }; syncTerms(); form.elements.academicYearId.addEventListener('change', syncTerms); fill(form.elements.feeStructureId, feeTypes, 'Select fee type', (item) => item.name || item.feeType); fill(classSelect, data.classes || [], 'Select class', (item) => item.name); if (!data.classes?.length) classSelect.add(new Option('No classes available', '')); syncTarget(); syncCustom(); if (!canPublish) setStatus('You have read-only access to Fee Setup; publishing requires fee publication permission.', true); }
  async function loadPublishedFees() {
    const data = await jsonRequest('/api/fees/obligations');
    const rows = Array.isArray(data) ? data : (data.rows || data.obligations || []);
    renderPublishedFeeSummary(publishedFeeSummary, rows);
    document.querySelector('#fees').innerHTML = rows.map((item) => {
      const feeType = item.fee_type_name || item.feeTypeName || item.custom_fee_type_name || item.fee_structure_id || item.feeStructureId || 'Published fee';
      const amountMinor = Number(item.amount_minor ?? item.amountMinor);
      const amount = Number.isSafeInteger(amountMinor) ? `GH₵${(amountMinor / 100).toFixed(2)}` : 'Amount unavailable';
      const target = (item.applicability_type || item.scope) === 'WHOLE_SCHOOL' ? 'Whole school' : `Class ${item.class_id || item.classId || '—'}`;
      const period = [item.academic_year_name || item.academicYearName || item.academic_year_id || item.academicYearId, item.term_name || item.termName || item.term_id || item.termId, target].filter(Boolean).join(' · ');
      return `<article class="card"><strong>${esc(feeType)}</strong><span>${esc(amount)}</span><small>${esc(period)}</small></article>`;
    }).join('') || '<p>No published fees.</p>';
  }
  form.elements.scope.addEventListener('change', () => { syncTarget(); refreshSubmitState(); }); form.elements.feeStructureId.addEventListener('change', () => { syncCustom(); refreshSubmitState(); });
  form.addEventListener('input', refreshSubmitState); form.addEventListener('change', refreshSubmitState);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!ready || !canPublish || submitting) return;
    try {
      const data = new FormData(form), scope = data.get('scope'), customFeeTypeName = String(data.get('customFeeTypeName') || '').trim();
      const body = { scope, feeStructureId: data.get('feeStructureId'), academicYearId: data.get('academicYearId'), termId: data.get('termId'), amountMinor: parsePositiveGhsAmountToMinorUnits(data.get('amount')), ...(customFeeTypeName ? { customFeeTypeName } : {}), ...(scope === 'SPECIFIC_CLASS' ? { classId: data.get('classId') } : {}) };
      if (!body.feeStructureId || !body.academicYearId || !body.termId || (scope === 'SPECIFIC_CLASS' && !body.classId)) throw new Error('Complete all required Fee Setup fields.');
      if ((body.feeStructureId === 'OTHER' || /(^|\b)other(\b|$)/i.test(form.elements.feeStructureId.selectedOptions[0]?.textContent ?? '')) && !customFeeTypeName) throw new Error('Specify Fee Type is required when Other is selected.');
      submitting = true; submitButton.disabled = true; submitButton.textContent = 'Publishing…'; setStatus('Publishing fee securely…');
      const result = await jsonRequest('/api/fees/obligations/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!Number.isSafeInteger(Number(result.created_count)) || Number(result.created_count) < 0 || !Number.isSafeInteger(Number(result.skipped_count)) || Number(result.skipped_count) < 0) throw new Error('The server response was incomplete; verify the published fee before retrying.');
      const successMessage = `Published successfully! ${result.created_count} student obligations created${result.skipped_count ? ` · ${result.skipped_count} existing obligations safely retained` : ''}`;
      form.elements.amount.value = '';
      setStatus(successMessage);
      try { await loadPublishedFees(); }
      catch { setStatus(`${successMessage}. The published-fee list could not refresh; reload Fee Setup to view it.`, true); }
    } catch (error) { setStatus(error.message || 'Unable to publish this fee. Please try again.', true); }
    finally { submitting = false; submitButton.textContent = 'Publish fee'; refreshSubmitState(); }
  });
  loadOptions().then(() => { ready = true; refreshSubmitState(); if (canPublish) setStatus('Ready'); }).catch((error) => { ready = false; refreshSubmitState(); setStatus(`${error.message || 'Unable to load Fee Setup data. Please try again.'}${error.status ? ` (HTTP ${error.status}${error.code ? ` · ${error.code}` : ''})` : error.code ? ` (${error.code})` : ''}`, true); });
  loadPublishedFees().catch(() => { document.querySelector('#fees').innerHTML = '<p>Published fees could not be loaded. You can still publish a fee; reload the list after the service recovers.</p>'; });
})();
