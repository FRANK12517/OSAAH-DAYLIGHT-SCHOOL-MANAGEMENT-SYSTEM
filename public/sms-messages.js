(() => {
  const $ = (selector) => document.querySelector(selector);
  const form = $('#sms-form');
  const status = $('#sms-status');
  const mode = $('#recipient-mode');
  const text = $('#message');
  const state = { parents: [], contexts: [], providerReady: false, draftId: null, busy: false, preview: null, idempotencyKey: null };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers ?? {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }
  function setStatus(message, kind = '') { status.textContent = message; status.className = `sms-status${kind ? ` ${kind}` : ''}`; }
  function selectedValues(select) { return [...select.selectedOptions].map((option) => option.value).filter(Boolean); }
  function parentLabel(parent) { return `${parent.name || 'Parent'} · ${String(parent.id).slice(0, 8)}`; }
  function renderParents() {
    const options = state.parents.map((parent) => `<option value="${esc(parent.id)}">${esc(parentLabel(parent))}</option>`).join('');
    $('#single-parent').innerHTML = '<option value="">Choose a parent</option>' + options;
    $('#multi-parent').innerHTML = options;
  }
  function renderContexts() {
    const classes = ['Nursery 1','Nursery 2','KG 1','KG 2','Primary 1','Primary 2','Primary 3','Primary 4','Primary 5','Primary 6','JHS 1','JHS 2','JHS 3'];
    $('#class-name').innerHTML = classes.map((name) => `<option>${esc(name)}</option>`).join('');
    const years = [...new Map(state.contexts.map((item) => [item.academicYearId, item])).values()];
    $('#academic-year').innerHTML = years.map((item) => `<option value="${esc(item.academicYearId)}">${esc(item.academicYearName)}</option>`).join('');
    renderTerms();
  }
  function renderTerms() {
    const year = $('#academic-year').value;
    const terms = state.contexts.filter((item) => item.academicYearId === year);
    $('#term').innerHTML = terms.map((item) => `<option value="${esc(item.termId)}">${esc(item.termName)}</option>`).join('');
  }
  function setModeVisibility() {
    const current = mode.value;
    $('#single-parent-wrap').classList.toggle('sms-hidden', current !== 'INDIVIDUAL_PARENT');
    $('#multi-parent-wrap').classList.toggle('sms-hidden', current !== 'SELECTED_PARENTS');
    $('#class-context').classList.toggle('sms-hidden', current !== 'PARENTS_BY_CLASS');
    state.preview = null;
    state.idempotencyKey = null;
    $('#recipient-count').textContent = 'Recipients not previewed';
    $('#preview-box').classList.add('sms-hidden');
    updateButtons();
  }
  function payload() {
    const value = { recipientMode: mode.value, message: text.value.trim() };
    if (mode.value === 'INDIVIDUAL_PARENT') value.parentIds = $('#single-parent').value ? [$('#single-parent').value] : [];
    if (mode.value === 'SELECTED_PARENTS') value.parentIds = selectedValues($('#multi-parent'));
    if (mode.value === 'PARENTS_BY_CLASS') Object.assign(value, { className: $('#class-name').value, academicYearId: $('#academic-year').value, termId: $('#term').value });
    return value;
  }
  function updateEstimate() {
    const message = text.value;
    const gsm = /^[\u0000-\u007f£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&'()*+,-.\/:;<=>?¡@£$¥¿ÄÖÑÜ§¿äöñüà^{}\\\[~\]|€]*$/u.test(message);
    const units = gsm ? [...message].reduce((sum, char) => sum + ('^{}\\[]~|€'.includes(char) ? 2 : 1), 0) : [...message].length;
    const limit = units > (gsm ? 160 : 70) ? (gsm ? 153 : 67) : gsm ? 160 : 70;
    const segments = message ? units <= (gsm ? 160 : 70) ? 1 : Math.ceil(units / limit) : 0;
    $('#char-count').textContent = `${[...message].length} characters`;
    $('#segment-count').textContent = `${segments} estimated segment${segments === 1 ? '' : 's'} per recipient`;
    updateButtons();
  }
  function updateButtons() {
    $('#send').disabled = state.busy || !state.providerReady || !state.preview || state.preview.recipientCount === 0 || !text.value.trim();
    $('#save-draft').disabled = state.busy || !text.value.trim();
    $('#preview').disabled = state.busy || !text.value.trim();
  }
  async function preview() {
    if (!text.value.trim()) return setStatus('Enter a message before previewing.', 'error');
    try {
      const result = await api('/api/sms/preview', { method: 'POST', body: JSON.stringify(payload()) });
      state.preview = result;
      state.idempotencyKey = crypto.randomUUID();
      $('#recipient-count').textContent = `${result.recipientCount} unique recipient${result.recipientCount === 1 ? '' : 's'}`;
      $('#segment-count').textContent = `${result.segments} segment${result.segments === 1 ? '' : 's'} each · ${result.totalEstimatedSegments} total estimated`;
      $('#cost-count').textContent = result.estimatedCost === null ? 'Cost estimate unavailable' : `Estimated GHS ${Number(result.estimatedCost).toFixed(2)}`;
      $('#preview-box').innerHTML = `<h3>Preview</h3><p><strong>${esc(result.message)}</strong></p><p>${esc(result.characters)} characters · ${esc(result.encoding)} · ${esc(result.segments)} segment${result.segments === 1 ? '' : 's'} per recipient</p><div>${result.recipients.slice(0, 100).map((person) => `<span class="sms-chip">${esc(person.parentName)}${person.className ? ` — ${esc(person.className)}` : ''}</span>`).join('')}${result.recipientCount > 100 ? `<p class="sms-small">And ${result.recipientCount - 100} more eligible recipients.</p>` : ''}</div>`;
      $('#preview-box').classList.remove('sms-hidden');
      setStatus(result.recipientCount ? 'Preview ready. Review the audience and message before sending.' : 'No eligible parents have registered Ghana mobile numbers for this selection.', result.recipientCount ? 'good' : 'error');
      updateButtons();
    } catch (error) { state.preview = null; updateButtons(); setStatus(error.message, 'error'); }
  }
  async function refreshHistory() {
    const result = await api('/api/sms/history');
    const container = $('#history');
    if (!result.messages.length) { container.textContent = 'No saved drafts or SMS history yet.'; return; }
    container.innerHTML = result.messages.map((item) => `<article class="sms-item"><header><strong>${esc(item.status)}</strong><span class="sms-small">${esc(new Date(item.updatedAt).toLocaleString())}</span></header><p>${esc(item.message)}</p><div class="sms-small">${esc(item.recipientMode)} · ${esc(item.recipients)} recipient${item.recipients === 1 ? '' : 's'}${item.provider ? ` · ${esc(item.provider)}` : ''}</div>${item.status === 'DRAFT' ? `<button type="button" class="text-button" data-load-draft="${esc(item.id)}">Edit draft</button>` : ''}</article>`).join('');
    container.querySelectorAll('[data-load-draft]').forEach((button) => button.addEventListener('click', async () => {
      try {
        const item = await api(`/api/sms/history/${encodeURIComponent(button.dataset.loadDraft)}`);
        state.draftId = item.id; text.value = item.message; mode.value = item.recipientMode;
        const selection = item.selector || {};
        if (mode.value === 'INDIVIDUAL_PARENT') $('#single-parent').value = selection.parentIds?.[0] || '';
        if (mode.value === 'SELECTED_PARENTS') [...$('#multi-parent').options].forEach((option) => { option.selected = selection.parentIds?.includes(option.value) || false; });
        if (mode.value === 'PARENTS_BY_CLASS') { $('#class-name').value = selection.className || ''; $('#academic-year').value = selection.academicYearId || ''; renderTerms(); $('#term').value = selection.termId || ''; }
        setModeVisibility(); updateEstimate(); setStatus('Draft loaded. Preview it again before sending.', 'good');
      } catch (error) { setStatus(error.message, 'error'); }
    }));
  }
  async function saveDraft() {
    try {
      state.busy = true; updateButtons();
      const result = await api('/api/sms/drafts', { method: 'POST', body: JSON.stringify({ ...payload(), id: state.draftId }) });
      state.draftId = result.id; setStatus('Draft saved to durable SMS history.', 'good'); await refreshHistory();
    } catch (error) { setStatus(error.message, 'error'); }
    finally { state.busy = false; updateButtons(); }
  }
  async function sendSms() {
    if (!state.preview || state.preview.recipientCount < 1) return setStatus('Preview a valid recipient list before sending.', 'error');
    const cost = state.preview.estimatedCost === null ? 'Cost estimate unavailable' : `Estimated cost: GHS ${Number(state.preview.estimatedCost).toFixed(2)}`;
    const summary = `Send this SMS to ${state.preview.recipientCount} unique parents?\n\n${state.preview.message}\n\nEstimated ${state.preview.totalEstimatedSegments} total segment(s) (${state.preview.segments} per recipient). ${cost}. Sending is irreversible.`;
    if (!window.confirm(summary)) return;
    try {
      state.busy = true; updateButtons();
      const result = await api('/api/sms/send', { method: 'POST', body: JSON.stringify({ ...payload(), confirm: true, idempotencyKey: state.idempotencyKey || (state.idempotencyKey = crypto.randomUUID()) }) });
      state.draftId = null; state.preview = null; state.idempotencyKey = null;
      setStatus(result.status === 'SENT' ? 'Provider accepted the SMS submission. Delivery remains pending until provider confirmation.' : result.error || result.status, result.status === 'SENT' ? 'good' : 'error');
      $('#preview-box').classList.add('sms-hidden'); $('#recipient-count').textContent = 'Recipients not previewed'; await refreshHistory();
    } catch (error) { setStatus(error.message, 'error'); }
    finally { state.busy = false; updateButtons(); }
  }
  mode.addEventListener('change', setModeVisibility);
  for (const control of [$('#single-parent'), $('#multi-parent'), $('#class-name'), $('#academic-year'), $('#term')]) control.addEventListener('change', () => { state.preview = null; state.idempotencyKey = null; $('#recipient-count').textContent = 'Recipients not previewed'; $('#preview-box').classList.add('sms-hidden'); updateButtons(); });
  text.addEventListener('input', () => { state.preview = null; state.idempotencyKey = null; $('#recipient-count').textContent = 'Recipients not previewed'; updateEstimate(); });
  $('#academic-year').addEventListener('change', renderTerms);
  $('#preview').addEventListener('click', preview);
  $('#save-draft').addEventListener('click', saveDraft);
  $('#send').addEventListener('click', sendSms);
  (async () => {
    try {
      const result = await api('/api/sms/options');
      state.parents = result.parents || []; state.contexts = result.academicContexts || []; state.providerReady = Boolean(result.provider?.configured);
      renderParents(); renderContexts(); setModeVisibility(); updateEstimate(); await refreshHistory();
      if (!state.providerReady) setStatus(`SMS provider ${result.provider?.name || 'Arkesel'} is not configured. Drafts and previews are available; sending is disabled until protected provider credentials and callback settings are configured.`, 'error');
      else setStatus('SMS service ready. Delivery status will reflect provider confirmation.', 'good');
      if (!state.parents.length) setStatus('No eligible registered parent roster is available yet.', 'error');
    } catch (error) { setStatus(error.message, 'error'); }
  })();
})();
