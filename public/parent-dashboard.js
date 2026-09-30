const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const display = (value) => value === null || value === undefined || value === '' ? '—' : String(value);
const money = (value) => `GHS ${Number(value ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const byId = (root, id) => root.querySelector(`#${id}`);

export function isCurrentParentChildResolution(currentId, requestedId) {
  return String(currentId ?? '').trim() === String(requestedId ?? '').trim();
}

export function createParentDashboardViewState() {
  let revision = 0;
  let selectedChildId = '';
  let visible = { record: null, component: null };
  return Object.freeze({
    invalidate(childId = selectedChildId) {
      selectedChildId = String(childId ?? '').trim();
      visible = { record: null, component: null };
      revision += 1;
      return { revision, childId: selectedChildId };
    },
    capture() { return { revision, childId: selectedChildId }; },
    isCurrent(token) { return token?.revision === revision && token?.childId === selectedChildId; },
    commit(kind, token, value) {
      if (!['record', 'component'].includes(kind) || !this.isCurrent(token)) return false;
      visible = { ...visible, [kind]: value };
      return true;
    },
    snapshot() { return { revision, childId: selectedChildId, ...visible }; }
  });
}

function field(label, id, options, { required = true, disabled = false } = {}) {
  return `<label>${esc(label)}<select id="${esc(id)}" name="${esc(id)}"${required ? ' required' : ''}${disabled ? ' disabled' : ''}><option value="">Select ${esc(label)}</option>${options.map((option) => `<option value="${esc(option.id)}"${option.available === false ? ' disabled' : ''}>${esc(option.name)}${option.available === false ? ' — Not available yet' : ''}</option>`).join('')}</select></label>`;
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? String(value) : new Intl.DateTimeFormat('en-GH', { dateStyle: 'medium' }).format(date);
}

function empty(message) {
  return `<p class="parent-empty">${esc(message)}</p>`;
}

function summaryCards(items) {
  return `<div class="parent-summary-grid">${items.map(([label, value]) => `<div class="parent-summary-card"><span>${esc(label)}</span><strong>${esc(display(value))}</strong></div>`).join('')}</div>`;
}

function table(headers, rows) {
  if (!rows.length) return empty('No records are available for this child and selected context.');
  return `<div class="parent-table-wrap"><table class="parent-table"><thead><tr>${headers.map((header) => `<th>${esc(header.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${headers.map((header) => `<td>${header.render ? header.render(row[header.key], row) : esc(display(row[header.key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function renderFees(body, { payments = false } = {}) {
  if (!body.summary?.hasRecords) return `<h4>${payments ? 'Payments and receipts' : 'Fees'}</h4>${empty('No fee obligations or payments are recorded for this child in the selected academic context.')}`;
  const metrics = summaryCards([
    ['Fees payable', money(body.summary.feesPayable)],
    ['Amount paid', money(body.summary.amountPaid)],
    ['Outstanding balance', money(body.summary.outstandingBalance)]
  ]);
  if (payments) {
    const rows = (body.receipts?.length ? body.receipts : body.payments ?? []).map((receipt) => ({
      date: receipt.paidAt ?? receipt.createdAt ?? receipt.receiptDate,
      reference: receipt.receiptNumber ?? receipt.reference ?? receipt.id,
      type: receipt.paymentMethod ?? receipt.method ?? receipt.paymentType,
      amount: receipt.amount ?? receipt.amountPaid ?? (receipt.amountMinor !== undefined ? Number(receipt.amountMinor) / 100 : undefined),
      status: receipt.status ?? 'VALID',
      receiptNumber: receipt.receiptNumber,
      amountMinor: receipt.amountMinor
    }));
    const records = table([
      { key: 'date', label: 'Date', render: (value) => esc(formatDate(value)) },
      { key: 'reference', label: 'Reference' },
      { key: 'type', label: 'Method' },
      { key: 'amount', label: 'Amount', render: (value) => esc(money(value)) },
      { key: 'status', label: 'Status' },
      { key: 'receiptNumber', label: 'Receipt', render: (value) => value ? `<a href="/api/fees/receipts/${encodeURIComponent(value)}/preview" target="_blank" rel="noopener">View</a> · <a href="/api/fees/receipts/${encodeURIComponent(value)}/pdf" target="_blank" rel="noopener">Download PDF</a>` : '—' }
    ], rows);
    return `${metrics}<h4>Payments and receipts</h4>${records}`;
  }
  const rows = (body.obligations ?? []).map((item) => ({
    fee: item.customFeeTypeName ?? item.feeName ?? item.feeStructureName ?? item.feeStructureId ?? 'School fee',
    dueDate: item.dueDate,
    amount: item.amountMinor !== undefined ? money(Number(item.amountMinor) / 100) : money(item.total ?? item.amount),
    status: item.status ?? item.allocation_status ?? 'Published'
  }));
  return `${metrics}<h4>Published fee obligations</h4>${table([
    { key: 'fee', label: 'Fee' },
    { key: 'dueDate', label: 'Due date', render: (value) => esc(formatDate(value)) },
    { key: 'amount', label: 'Amount' },
    { key: 'status', label: 'Status' }
  ], rows)}`;
}

function renderResult(body) {
  const result = body.result ?? {};
  const pdfQuery = new URLSearchParams({ permanentStudentId: body.student?.permanentStudentId ?? '', academicYear: body.context?.yearId ?? '', classId: body.context?.classId ?? '', term: body.context?.termId ?? '' });
  const pdfUrl = `/api/parent/results/pdf?${pdfQuery}`;
  const subjects = (result.subjects ?? []).map((item) => ({
    subject: item.subjectName ?? item.subjectId,
    ca: item.caScore,
    exam: item.examScore,
    total: item.totalScore,
    grade: item.grade,
    remark: item.remark
  }));
  return `<div class="parent-result-slip"><p class="parent-status-pill">PUBLISHED RESULT</p><h4>${esc(result.resultType === 'MOCK' ? result.mockLabel ?? 'Mock examination' : 'End-of-term result')}</h4>${summaryCards([
    ['Student', body.student?.name],
    ['Permanent Student ID', body.student?.permanentStudentId],
    ['Class', body.context?.className],
    ['Academic year', body.context?.yearName],
    ['Term', body.context?.termName],
    ['Average', result.average === undefined ? '—' : `${Number(result.average).toFixed(2)}%`],
    ['Grade', result.grade],
    ['Class position', result.classPosition ?? result.position]
  ])}<h5>Subject results</h5>${table([
    { key: 'subject', label: 'Subject' },
    { key: 'ca', label: 'Class assessment' },
    { key: 'exam', label: 'Examination' },
    { key: 'total', label: 'Total' },
    { key: 'grade', label: 'Grade' },
    { key: 'remark', label: 'Remark' }
  ], subjects)}<div class="parent-result-actions no-print"><button class="secondary-button" type="button" data-parent-print>View / Print Result Slip</button><a class="primary-button" href="${esc(pdfUrl)}" target="_blank" rel="noopener">Download Result PDF</a></div></div>`;
}

function renderRecord(body) {
  if (body.recordType === 'student-summary') {
    const student = body.student ?? {};
    return `<h4>Student summary</h4>${summaryCards([
      ['Student name', student.name],
      ['Permanent Student ID', student.permanentStudentId],
      ['Current class', student.className ?? student.classId],
      ['Academic year', body.context?.yearName ?? 'Select an academic context for year-specific records'],
      ['Sample status', student.sampleLabel ?? 'Official student record']
    ])}`;
  }
  if (body.recordType === 'attendance') return `<h4>Attendance</h4>${summaryCards([
    ['Student', body.student?.name], ['Academic year', body.context?.yearName], ['Class', body.context?.className], ['Term', body.context?.termName]
  ])}${table([
    { key: 'date', label: 'Date', render: (value, row) => esc(formatDate(value ?? row.attendanceDate)) },
    { key: 'status', label: 'Status' },
    { key: 'arrivalTime', label: 'Arrival' },
    { key: 'departureTime', label: 'Departure' },
    { key: 'remarks', label: 'Notes' }
  ], body.records ?? [])}`;
  if (body.recordType === 'published-results') return renderResult(body);
  if (body.recordType === 'fees') return renderFees(body);
  if (body.recordType === 'payments' || body.recordType === 'payment-receipts') return renderFees(body, { payments: true });
  if (body.recordType === 'timetable') return `<h4>Timetable</h4>${summaryCards([
    ['Student', body.student?.name], ['Academic year', body.context?.yearName], ['Class', body.context?.className], ['Term', body.context?.termName]
  ])}${table([
    { key: 'day', label: 'Day' },
    { key: 'startTime', label: 'Start' },
    { key: 'endTime', label: 'End' },
    { key: 'subjectName', label: 'Subject' },
    { key: 'teacherName', label: 'Teacher' },
    { key: 'venue', label: 'Venue' }
  ], body.records ?? [])}`;
  if (body.recordType === 'transport') {
    const entries = body.records?.assignments ?? [];
    return `<h4>Transport</h4>${table([
      { key: 'routeName', label: 'Route' },
      { key: 'vehicleName', label: 'Vehicle' },
      { key: 'registrationNumber', label: 'Registration' },
      { key: 'pickupPoint', label: 'Pickup point' },
      { key: 'status', label: 'Status' }
    ], entries)}`;
  }
  return empty('Not available yet.');
}

function renderService(body, moduleKey) {
  const records = Array.isArray(body.records) ? body.records : Object.values(body.records ?? {}).flatMap((value) => Array.isArray(value) ? value : []);
  if (!records.length) return `<h4>${esc(body.moduleName ?? moduleKey)}</h4>${empty('No records are available for this child in this service.')}`;
  const rows = records.map((item) => ({
    title: item.title ?? item.subject ?? item.name ?? item.category ?? item.type,
    date: item.date ?? item.startsAt ?? item.createdAt ?? item.sentAt,
    detail: item.body ?? item.description ?? item.message ?? item.venue,
    status: item.status ?? item.audience ?? item.className
  }));
  return `<h4>${esc(body.moduleName ?? moduleKey)}</h4>${table([
    { key: 'title', label: 'Title' },
    { key: 'date', label: 'Date', render: (value) => esc(formatDate(value)) },
    { key: 'detail', label: 'Details' },
    { key: 'status', label: 'Status / audience' }
  ], rows)}`;
}

function installStyles() {
  if (document.querySelector('link[data-parent-dashboard-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/parent-dashboard.css';
  link.dataset.parentDashboardStyles = 'true';
  document.head.append(link);
}

export async function mountParentDashboard({ dashboard, user, sidebar } = {}) {
  if (!dashboard || user?.portal !== 'parent') return;
  installStyles();
  const overview = dashboard.querySelector('#dashboard-overview');
  if (!overview) return;
  const cards = sidebar?.parentCards ?? [];
  const childResponse = await fetch('/api/parent/children', { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Unable to load linked children.'); return body; }).catch((error) => ({ children: [], error: error.message }));
  const childList = Array.isArray(childResponse.children) ? childResponse.children : [];
  const childLoadError = String(childResponse.error ?? '');
  overview.innerHTML = `<section class="hero parent-dashboard-hero"><p class="eyebrow">AUTHORIZED PARENT ACCESS</p><h3>My Children</h3><p class="muted">Choose an authorized child. Every record request is checked against your signed-in Parent account.</p>
    <div class="parent-child-context"><label for="parent-child-select">Selected child<select id="parent-child-select" aria-label="Select an authorized child"><option value="">Select a child</option>${childList.map((child) => `<option value="${esc(child.permanentStudentId)}">${esc(child.name)} · ${esc(child.permanentStudentId)}${child.className ? ` · ${esc(child.className)}` : ''}</option>`).join('')}</select></label><div id="parent-child-summary" class="parent-child-summary" aria-live="polite">${childLoadError ? esc(childLoadError) : childList.length ? 'Select a child to begin.' : 'No children are currently linked to this Parent account.'}</div></div>
    <section class="parent-lookup card"><p class="eyebrow">STUDENT RECORD LOOKUP</p><h3>Load your child’s records</h3><p class="muted">Choose one record type and the academic context to load. The Permanent Student ID is selected from your authorized children.</p>
      <form id="parent-record-form" class="form-grid parent-record-form">
        <label>Permanent Student ID<input id="parent-permanent-id" name="permanentStudentId" required placeholder="Select or enter an authorized Permanent Student ID" autocomplete="off"></label>
        ${field('Academic Year', 'parent-academic-year', [], { required: false })}
        ${field('Class', 'parent-class', [], { required: false })}
        ${field('Term', 'parent-term', [], { required: false })}
        ${field('Record to View', 'parent-record-type', [{ id: 'student-summary', name: 'Student Summary' }])}
        <button class="primary-button" type="submit">Load Student Records</button>
      </form><p id="parent-options-status" class="module-status" role="status">Loading configured academic options…</p><p id="parent-record-status" class="module-status" role="status"></p><div id="parent-record-output" class="parent-output" aria-live="polite"></div>
    </section>
    <section class="parent-components-section"><div class="section-heading"><div><p class="eyebrow">PARENT SERVICES</p><h3>Child information and school services</h3></div></div><div class="parent-card-grid parent-component-grid">${cards.map((card) => `<button class="parent-card" type="button" data-parent-component="${esc(card.moduleKey)}"><strong>${esc(card.moduleName)}</strong><span data-parent-card-status="${esc(card.moduleKey)}">Open authorized information</span></button>`).join('')}</div></section>
    <section id="parent-component-panel" class="parent-component-panel card" aria-live="polite" hidden><div class="parent-panel-heading"><div><p class="eyebrow">PARENT SERVICES</p><h3 id="parent-panel-title"></h3></div><button id="parent-panel-close" type="button" class="secondary-button">Close</button></div><p id="parent-component-status" class="module-status" role="status"></p><div id="parent-component-output" class="parent-output"></div></section>
  </section>`;

  const childSelect = byId(overview, 'parent-child-select');
  const yearSelect = byId(overview, 'parent-academic-year');
  const classSelect = byId(overview, 'parent-class');
  const termSelect = byId(overview, 'parent-term');
  const recordTypeSelect = byId(overview, 'parent-record-type');
  const permanentId = byId(overview, 'parent-permanent-id');
  const optionsStatus = byId(overview, 'parent-options-status');
  const recordStatus = byId(overview, 'parent-record-status');
  const recordOutput = byId(overview, 'parent-record-output');
  const panel = byId(overview, 'parent-component-panel');
  const panelTitle = byId(overview, 'parent-panel-title');
  const panelStatus = byId(overview, 'parent-component-status');
  const panelOutput = byId(overview, 'parent-component-output');
  const cardSupport = new Map();
  let options = null;
  const viewState = createParentDashboardViewState();
  let selectedStudent = null;

  function clearData() {
    viewState.invalidate(permanentId.value.trim());
    recordOutput.replaceChildren();
    panelOutput.replaceChildren();
    panelStatus.textContent = '';
    recordStatus.textContent = '';
    panel.hidden = true;
  }

  function currentChild() {
    return childList.find((child) => child.permanentStudentId === childSelect.value) ?? null;
  }

  function selectedContext() {
    return { academicYear: yearSelect.value, classId: classSelect.value, term: termSelect.value };
  }

  function contextComplete() {
    return Boolean(yearSelect.value && classSelect.value && termSelect.value);
  }

  function fillTerms() {
    if (!options) return;
    const previous = termSelect.value;
    const terms = options.terms.filter((term) => !term.academicYearId || term.academicYearId === yearSelect.value);
    termSelect.innerHTML = `<option value="">Select Term</option>${terms.map((term) => `<option value="${esc(term.id)}">${esc(term.name)}</option>`).join('')}`;
      const preferred = terms.find((term) => term.id === previous) ?? terms.find((term) => term.isCurrent);
    if (preferred) termSelect.value = preferred.id;
  }

  function applyChildContext(child) {
    selectedStudent = child;
    permanentId.value = child?.permanentStudentId ?? '';
    const classMatch = options?.classes.find((item) => item.id === child?.classId || item.name === child?.className || item.id === child?.className);
    if (classMatch) classSelect.value = classMatch.id;
    else classSelect.value = '';
    const summary = byId(overview, 'parent-child-summary');
    summary.innerHTML = child ? `<strong>${esc(child.name)}</strong><span>Permanent Student ID: ${esc(child.permanentStudentId)}</span><span>Current class: ${esc(child.className ?? 'Not recorded')}</span>${child.isTestRecord ? '<span class="parent-sample-badge">SAMPLE DATA</span>' : ''}` : childLoadError ? esc(childLoadError) : childList.length ? 'Select a child to begin.' : 'No children are currently linked to this Parent account.';
  }

  async function loadOptions() {
    try {
      const response = await fetch('/api/parent/options', { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Unable to load configured academic options.');
      options = body;
      yearSelect.innerHTML = `<option value="">Select Academic Year</option>${body.academicYears.map((year) => `<option value="${esc(year.id)}">${esc(year.name)}</option>`).join('')}`;
      classSelect.innerHTML = `<option value="">Select Class</option>${body.classes.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('')}`;
      const years = body.academicYears;
      const preferredYear = years.find((year) => year.isCurrent);
      if (preferredYear) yearSelect.value = preferredYear.id;
      fillTerms();
      recordTypeSelect.innerHTML = `<option value="">Select Record to Load</option>${body.recordTypes.map((item) => `<option value="${esc(item.id)}"${item.available ? '' : ' disabled'}>${esc(item.name)}${item.available ? '' : ' — Not available yet'}</option>`).join('')}`;
      recordTypeSelect.value = 'student-summary';
      for (const component of body.components ?? []) {
        cardSupport.set(component.moduleKey, component);
        const status = overview.querySelector(`[data-parent-card-status="${CSS.escape(component.moduleKey)}"]`);
        if (status) status.textContent = component.available ? (component.scope === 'student' ? 'Open child-scoped information' : 'Open Parent or school information') : component.status === 'NOT_AVAILABLE_YET' ? 'Not available yet' : 'Service not configured';
        const card = overview.querySelector(`[data-parent-component="${CSS.escape(component.moduleKey)}"]`);
        card?.classList.toggle('parent-card-unavailable', !component.available);
      }
      optionsStatus.textContent = '';
      if (selectedStudent) applyChildContext(selectedStudent);
    } catch (error) {
      optionsStatus.textContent = error.message;
      optionsStatus.classList.add('error');
      for (const control of [yearSelect, classSelect, termSelect]) control.disabled = true;
    }
  }

  async function ensureSelectedChild() {
    const permanentStudentId = permanentId.value.trim() || currentChild()?.permanentStudentId;
    if (!permanentStudentId) throw new Error('Select or enter an authorized child first.');
    let response;
    let body;
    try {
      response = await fetch(`/api/parent/children/resolve?permanentStudentId=${encodeURIComponent(permanentStudentId)}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      body = await response.json();
    } catch (error) {
      if (!isCurrentParentChildResolution(permanentId.value, permanentStudentId)) return null;
      throw error;
    }
    if (!isCurrentParentChildResolution(permanentId.value, permanentStudentId)) return null;
    if (!response.ok) throw new Error(body.error || 'This child is not linked to your Parent account.');
    if (!body.child?.permanentStudentId) throw new Error('The server did not return an authorized child.');
    let displayedChild = childList.find((child) => child.permanentStudentId === body.child.permanentStudentId);
    if (!displayedChild) {
      displayedChild = body.child;
      childList.push(displayedChild);
      const option = document.createElement('option');
      option.value = displayedChild.permanentStudentId;
      option.textContent = `${displayedChild.name} — ${displayedChild.permanentStudentId}`;
      childSelect.append(option);
    }
    childSelect.value = displayedChild.permanentStudentId;
    applyChildContext(displayedChild);
    return body.child;
  }

  function showError(container, error) {
    container.replaceChildren();
    const p = document.createElement('p');
    p.className = 'parent-empty parent-error';
    p.textContent = error?.message ?? 'Unable to load this Parent service.';
    container.append(p);
  }

  async function loadRecord(event) {
    event?.preventDefault();
    clearData();
    const token = viewState.capture();
    try {
      const child = await ensureSelectedChild();
      if (!viewState.isCurrent(token)) return;
      const recordType = recordTypeSelect.value;
      if (!recordType) throw new Error('Select a record type.');
      const type = options?.recordTypes.find((item) => item.id === recordType);
      if (type?.requiresAcademicContext && !contextComplete()) throw new Error('Select an academic year, class, and term.');
      recordStatus.textContent = 'Loading authorized records…';
      const params = new URLSearchParams({ permanentStudentId: child.permanentStudentId, recordType, ...selectedContext() });
      const response = await fetch(`/api/parent/records?${params}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const body = await response.json();
      if (!viewState.isCurrent(token)) return;
      if (!response.ok) throw new Error(body.error || 'Unable to load this record.');
      if (!viewState.commit('record', token, body)) return;
      recordOutput.innerHTML = renderRecord(body);
      recordOutput.querySelector('[data-parent-print]')?.addEventListener('click', () => window.print());
      recordStatus.textContent = '';
    } catch (error) {
      if (!viewState.isCurrent(token)) return;
      recordStatus.textContent = '';
      showError(recordOutput, error);
    }
  }

  async function openComponent(moduleKey) {
    clearData();
    const token = viewState.capture();
    const card = cards.find((item) => item.moduleKey === moduleKey);
    const support = cardSupport.get(moduleKey);
    panel.hidden = false;
    panelTitle.textContent = card?.moduleName ?? 'Parent service';
    panelStatus.textContent = '';
    panelOutput.replaceChildren();
    if (support && !support.available) {
      panelStatus.textContent = support.status === 'NOT_AVAILABLE_YET' ? 'Not available yet.' : 'This Parent service is not configured.';
      return;
    }
    try {
      const childRequired = support?.scope === 'student';
      const child = childRequired || permanentId.value.trim() ? await ensureSelectedChild() : null;
      if (!viewState.isCurrent(token)) return;
      if (support?.requiresAcademicContext && !contextComplete()) throw new Error('Select an academic year, class, and term in Student Record Lookup before opening this component.');
      panelStatus.textContent = 'Loading authorized information…';
      const params = new URLSearchParams({ moduleKey, ...selectedContext(), ...(child ? { permanentStudentId: child.permanentStudentId } : {}) });
      const response = await fetch(`/api/parent/components?${params}`, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const body = await response.json();
      if (!viewState.isCurrent(token)) return;
      if (!response.ok) throw new Error(body.error || 'Unable to load this Parent service.');
      if (!viewState.commit('component', token, body)) return;
      panelOutput.innerHTML = support?.recordType ? renderRecord(body) : renderService(body, moduleKey);
      panelStatus.textContent = '';
      panelOutput.querySelector('[data-parent-print]')?.addEventListener('click', () => window.print());
    } catch (error) {
      if (!viewState.isCurrent(token)) return;
      panelStatus.textContent = '';
      showError(panelOutput, error);
    }
  }

  childSelect.addEventListener('change', () => {
    applyChildContext(currentChild());
    clearData();
    if (selectedStudent) ensureSelectedChild().then(() => {}).catch((error) => {
      selectedStudent = null;
      childSelect.value = '';
      permanentId.value = '';
      showError(panelOutput, error);
      panel.hidden = false;
      panelTitle.textContent = 'Child access';
    });
  });
  permanentId.addEventListener('input', () => {
    clearData();
    const entered = permanentId.value.trim();
    const match = childList.find((child) => child.permanentStudentId === entered) ?? null;
    childSelect.value = match?.permanentStudentId ?? '';
    if (match) applyChildContext(match);
    else {
      selectedStudent = null;
      byId(overview, 'parent-child-summary').textContent = entered
        ? 'Permanent Student ID entered. The server will verify that this student is linked to your Parent account.'
        : childList.length ? 'Select a child or enter an authorized Permanent Student ID.' : childLoadError || 'No children are currently linked to this Parent account.';
      classSelect.value = '';
    }
  });
  yearSelect.addEventListener('change', () => { fillTerms(); clearData(); });
  for (const control of [classSelect, termSelect, recordTypeSelect]) control.addEventListener('change', clearData);
  byId(overview, 'parent-record-form').addEventListener('submit', loadRecord);
  overview.querySelectorAll('[data-parent-component]').forEach((button) => button.addEventListener('click', () => openComponent(button.dataset.parentComponent)));
  byId(overview, 'parent-panel-close').addEventListener('click', () => { clearData(); panel.hidden = true; });
  await loadOptions();
  if (childList.length) {
    childSelect.value = childList[0].permanentStudentId;
    applyChildContext(childList[0]);
    ensureSelectedChild().catch((error) => { byId(overview, 'parent-child-summary').textContent = error.message; });
  }
  const requestedCard = new URLSearchParams(window.location.search).get('parentCard');
  if (cards.some((card) => card.moduleKey === requestedCard)) await openComponent(requestedCard);
}
