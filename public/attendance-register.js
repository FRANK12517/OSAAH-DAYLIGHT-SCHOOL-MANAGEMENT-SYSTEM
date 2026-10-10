import { buildTermOptions } from '/attendance-terms.js';
import { requestAttendanceJson, AttendanceApiError } from '/attendance-api.js';

const form = document.querySelector('#attendance-form');
const classField = document.querySelector('#attendance-class');
const yearField = document.querySelector('#attendance-academic-year');
const termField = document.querySelector('#attendance-term');
const dateField = document.querySelector('#attendance-date');
const sampleModeField = document.querySelector('#attendance-sample-mode');
const sampleIndicator = document.querySelector('#sample-mode-indicator');
const tbody = document.querySelector('#attendance-register');
const mobileCards = document.querySelector('#attendance-mobile-cards');
const status = document.querySelector('#attendance-status');
const loadButton = document.querySelector('#load-register');
const saveButton = document.querySelector('#save-attendance');
const statuses = ['PRESENT', 'ABSENT', 'LATE', 'EARLY_DEPARTURE', 'EXCUSED_ABSENCE', 'UNEXCUSED_ABSENCE', 'SICK_ABSENCE'];
const reasonStatuses = new Set(['ABSENT', 'LATE', 'EARLY_DEPARTURE', 'EXCUSED_ABSENCE', 'UNEXCUSED_ABSENCE', 'SICK_ABSENCE']);
let register = [];
let loading = false;
let saving = false;
let dirty = false;
let canCorrect = false;
let loadedContext = null;

function escape(value) {
  const node = document.createElement('span');
  node.textContent = value ?? '';
  return node.innerHTML;
}
function sampleMode() { return sampleModeField.checked; }
function selectedContext() {
  return { classId: classField.value, academicYear: yearField.value, term: termField.value, date: dateField.value, sampleMode: sampleMode() };
}
function sameContext(left, right) { return left && right && Object.keys(left).every((key) => String(left[key]) === String(right[key])); }
function attendanceData(payload) { return payload?.data && typeof payload.data === 'object' ? { ...payload.data, ...payload } : payload; }
function syncSampleIndicator() { sampleIndicator.hidden = !sampleMode(); }
function isReadOnly(row) { return row.version !== undefined && row.version !== null && row.version !== '' && !canCorrect && !loadedContext?.sampleMode; }
function setError(message, error) {
  status.textContent = message;
  if (error instanceof AttendanceApiError) console.error('[Attendance register request failed]', { endpoint: error.endpoint, status: error.status, code: error.code });
}
function controlMarkup(row) {
  const selected = row.status || '';
  const options = `<option value="">Not marked</option>${statuses.map((item) => `<option value="${item}"${item === selected ? ' selected' : ''}>${item.replaceAll('_', ' ')}</option>`).join('')}`;
  const disabled = isReadOnly(row) ? ' disabled' : '';
  return `<select class="attendance-status" aria-label="Attendance status for ${escape(row.studentName)}"${disabled}>${options}</select>`;
}
function tableRow(row) {
  const disabled = isReadOnly(row) ? ' disabled' : '';
  return `<tr data-student-id="${escape(row.studentId)}" data-version="${escape(row.version ?? '')}" data-dirty="false"><td>${row.number}</td><td>${escape(row.permanentStudentId)}${row.isTestRecord ? ' <small>(SAMPLE / TEST)</small>' : ''}</td><td>${escape(row.studentName)}</td><td>${escape(row.gender || 'Not recorded')}</td><td>${controlMarkup(row)}</td><td><input class="attendance-reason" type="text" maxlength="500" placeholder="Reason" aria-label="Reason for ${escape(row.studentName)}" value="${escape(row.reason || '')}"${disabled}></td><td><input class="attendance-arrival" type="time" aria-label="Arrival time for ${escape(row.studentName)}" value="${escape(row.arrivalTime || '')}"${disabled}></td><td><input class="attendance-departure" type="time" aria-label="Departure time for ${escape(row.studentName)}" value="${escape(row.departureTime || '')}"${disabled}></td></tr>`;
}
function mobileCard(row) {
  const disabled = isReadOnly(row) ? ' disabled' : '';
  return `<article class="attendance-card" data-student-id="${escape(row.studentId)}" data-version="${escape(row.version ?? '')}" data-dirty="false"><header><strong>Student ${row.number}</strong><span>${row.isTestRecord ? 'SAMPLE / TEST' : ''}</span></header><dl><div><dt>Permanent Student ID</dt><dd>${escape(row.permanentStudentId)}</dd></div><div><dt>Full Student Name</dt><dd>${escape(row.studentName)}</dd></div><div><dt>Gender</dt><dd>${escape(row.gender || 'Not recorded')}</dd></div><div><dt>Attendance Date</dt><dd>${escape(row.attendanceDate || dateField.value)}</dd></div></dl><label>Attendance Status${controlMarkup(row)}</label><label class="reason-label">Reason<input class="attendance-reason" type="text" maxlength="500" placeholder="Reason when applicable" aria-label="Reason for ${escape(row.studentName)}" value="${escape(row.reason || '')}"${disabled}></label><label class="arrival-label">Arrival / check-in<input class="attendance-arrival" type="time" aria-label="Arrival time for ${escape(row.studentName)}" value="${escape(row.arrivalTime || '')}"${disabled}></label><label class="departure-label">Departure / check-out<input class="attendance-departure" type="time" aria-label="Departure time for ${escape(row.studentName)}" value="${escape(row.departureTime || '')}"${disabled}></label></article>`;
}
function updateFields(row) {
  const selected = row.querySelector('.attendance-status')?.value || '';
  row.querySelectorAll('.attendance-reason').forEach((field) => { field.hidden = !reasonStatuses.has(selected); field.required = reasonStatuses.has(selected); });
  row.querySelectorAll('.attendance-arrival').forEach((field) => { field.hidden = !['PRESENT', 'LATE', 'EARLY_DEPARTURE'].includes(selected); });
  row.querySelectorAll('.attendance-departure').forEach((field) => { field.hidden = !['PRESENT', 'EARLY_DEPARTURE'].includes(selected); });
}
function syncDuplicateControls(source, sourceRow) {
  const studentId = sourceRow.dataset.studentId;
  const controlClass = ['attendance-status', 'attendance-reason', 'attendance-arrival', 'attendance-departure'].find((name) => source.classList.contains(name));
  if (!controlClass) return;
  for (const peer of document.querySelectorAll('[data-student-id]')) {
    if (peer === sourceRow || peer.dataset.studentId !== studentId) continue;
    const target = peer.querySelector(`.${controlClass}`);
    if (target) { target.value = source.value; peer.dataset.dirty = 'true'; updateFields(peer); }
  }
}
function wireRows() {
  document.querySelectorAll('[data-student-id]').forEach((row) => {
    row.querySelectorAll('select, input').forEach((field) => {
      const mark = () => { if (field.disabled) return; dirty = true; row.dataset.dirty = 'true'; syncDuplicateControls(field, row); updateFields(row); };
      field.addEventListener('input', mark);
      field.addEventListener('change', mark);
    });
    updateFields(row);
  });
}
function renderRegister() {
  if (!register.length) {
    tbody.innerHTML = '<tr><td colspan="8">No enrolled students in this class for the selected period.</td></tr>';
    mobileCards.innerHTML = '<p class="muted attendance-empty">No enrolled students in this class for the selected period.</p>';
    return;
  }
  tbody.innerHTML = register.map(tableRow).join('');
  mobileCards.innerHTML = register.map(mobileCard).join('');
  wireRows();
}
function activeRows() {
  const mobile = window.matchMedia?.('(max-width: 1023px)').matches;
  return [...(mobile ? mobileCards : tbody).querySelectorAll('[data-student-id]')];
}
function clearRegister(message = 'Load a class register to begin.') {
  register = [];
  loadedContext = null;
  dirty = false;
  saveButton.disabled = true;
  tbody.innerHTML = `<tr><td colspan="8">${escape(message)}</td></tr>`;
  mobileCards.innerHTML = '';
}
function validateDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return false;
  return new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
async function loadOptions() {
  loadButton.disabled = true;
  try {
    const result = attendanceData(await requestAttendanceJson('/api/attendance/options', { credentials: 'same-origin', cache: 'no-store' }));
    classField.innerHTML = '<option value="">Choose a class</option>' + (result.classes || []).map((item) => `<option value="${escape(item.id)}">${escape(item.name ?? item.id)}</option>`).join('');
    yearField.innerHTML = '<option value="">Choose an academic year</option>' + (result.academicYears || []).map((item) => `<option value="${escape(item.name ?? item.id)}">${escape(item.name ?? item.id)}</option>`).join('');
    termField.innerHTML = '<option value="">Choose a term</option>' + buildTermOptions(result.terms).map(({ label, value }) => `<option value="${escape(value)}">${escape(label)}</option>`).join('');
    if (result.today && validateDate(result.today)) dateField.value = result.today;
    if (!Array.isArray(result.classes) || !Array.isArray(result.academicYears) || !Array.isArray(result.terms)) throw new Error('Attendance options are incomplete. Check school academic setup, then retry.');
    status.textContent = result.classes.length && result.academicYears.length && result.terms.length
      ? '' : 'No classes or academic periods are configured yet. Ask a school administrator to finish setup.';
  } catch (error) {
    setError(error.message || 'Attendance options could not be loaded. Please retry.', error);
    classField.innerHTML = '<option value="">Classes unavailable</option>';
    yearField.innerHTML = '<option value="">Academic years unavailable</option>';
    termField.innerHTML = '<option value="">Terms unavailable</option>';
  } finally {
    loadButton.disabled = false;
  }
}

sampleModeField.addEventListener('change', () => {
  if (dirty && !window.confirm('Changing register mode will discard unsaved attendance marks. Continue?')) {
    sampleModeField.checked = !sampleModeField.checked;
    return;
  }
  syncSampleIndicator();
  clearRegister();
  status.textContent = 'Mode changed. Load the register again.';
});
loadButton.addEventListener('click', async () => {
  if (loading || saving) return;
  const context = selectedContext();
  if (!context.classId || !context.academicYear || !context.term || !context.date || !validateDate(context.date)) {
    status.textContent = 'Select a valid class, academic year, term, and date.';
    return;
  }
  if (dirty && !sameContext(context, loadedContext) && !window.confirm('Loading another register will discard unsaved attendance marks. Continue?')) return;
  loading = true;
  loadButton.disabled = true;
  saveButton.disabled = true;
  loadButton.textContent = 'Loading…';
  status.textContent = 'Loading register…';
  const query = new URLSearchParams({ classId: context.classId, academicYear: context.academicYear, term: context.term, date: context.date, sampleMode: String(context.sampleMode) });
  try {
    const result = attendanceData(await requestAttendanceJson(`/api/attendance/register?${query}`, { credentials: 'same-origin', cache: 'no-store' }));
    if (!Array.isArray(result.register)) throw new AttendanceApiError('The attendance service returned an incomplete register. Your existing marks were preserved.', { code: 'ATTENDANCE_REGISTER_CONTRACT_INVALID', endpoint: '/api/attendance/register' });
    register = result.register;
    canCorrect = result.canCorrect === true;
    loadedContext = context;
    dirty = false;
    renderRegister();
    status.textContent = register.length
      ? `${register.length} student${register.length === 1 ? '' : 's'} loaded${context.sampleMode ? ' in SAMPLE / TEST MODE' : ''}.`
      : `No enrolled students in this class for ${context.academicYear}, ${context.term}, ${context.date}${context.sampleMode ? ' (SAMPLE / TEST MODE)' : ''}.`;
  } catch (error) {
    setError(error.message || 'Register could not be loaded. Your selections and any displayed marks are unchanged.', error);
  } finally {
    loading = false;
    loadButton.disabled = false;
    saveButton.disabled = saving || !register.length;
    loadButton.textContent = 'Load Register';
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving || loading || !register.length) return;
  if (!sameContext(selectedContext(), loadedContext)) {
    status.textContent = 'The selected class, period, date, or mode has changed. Load the register again before saving.';
    return;
  }
  saving = true;
  saveButton.disabled = true;
  loadButton.disabled = true;
  saveButton.textContent = 'Saving…';
  try {
    const changedEntries = [];
    for (const row of activeRows()) {
      const statusValue = row.querySelector('.attendance-status').value;
      const reasonValue = row.querySelector('.attendance-reason').value.trim();
      if (!statusValue) throw new Error(`Select an attendance status for ${row.querySelector('.attendance-status').ariaLabel.replace('Attendance status for ', '')}.`);
      if (reasonStatuses.has(statusValue) && !reasonValue) throw new Error(`A reason is required for ${statusValue.replaceAll('_', ' ')}.`);
      if (row.dataset.dirty !== 'true') continue;
      changedEntries.push({
        studentId: row.dataset.studentId,
        version: row.dataset.version ? Number(row.dataset.version) : null,
        classId: loadedContext.classId,
        academicYear: loadedContext.academicYear,
        term: loadedContext.term,
        date: loadedContext.date,
        status: statusValue,
        reason: reasonValue || null,
        arrivalTime: row.querySelector('.attendance-arrival').value || null,
        departureTime: row.querySelector('.attendance-departure').value || null,
        method: 'MANUAL',
        source: loadedContext.sampleMode ? 'TEST' : 'MANUAL'
      });
    }
    if (!changedEntries.length) { status.textContent = 'There are no attendance changes to save.'; return; }
    const result = attendanceData(await requestAttendanceJson('/api/attendance/students/sync', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sampleMode: loadedContext.sampleMode, entries: changedEntries })
    }));
    if (!Array.isArray(result.synced) || result.synced.length !== changedEntries.length) throw new AttendanceApiError('The attendance service did not confirm every record. Reload before retrying.', { code: 'ATTENDANCE_SAVE_CONFIRMATION_INVALID', endpoint: '/api/attendance/students/sync' });
    register = register.map((item) => ({ ...item, ...(result.synced.find((saved) => saved.studentId === item.studentId) || {}) }));
    dirty = false;
    renderRegister();
    status.textContent = `${result.synced.length} attendance change${result.synced.length === 1 ? '' : 's'} saved${loadedContext.sampleMode ? ' in isolated SAMPLE / TEST MODE' : ''} for ${loadedContext.academicYear}, ${loadedContext.term}, ${loadedContext.date}.`;
    if (!loadedContext.sampleMode) window.dispatchEvent(new CustomEvent('attendance:save-confirmed', { detail: { kind: 'student', count: result.synced.length } }));
  } catch (error) {
    dirty = true;
    setError(error.message || 'Attendance could not be saved. Your marks remain on screen; reload before retrying if another educator may have updated them.', error);
  } finally {
    saving = false;
    saveButton.disabled = !register.length;
    loadButton.disabled = false;
    saveButton.textContent = 'Save Attendance';
  }
});

syncSampleIndicator();
clearRegister();
loadOptions();
