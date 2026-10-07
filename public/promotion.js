const form = document.querySelector('#promotion-form');
const year = document.querySelector('#promotion-year');
const classField = document.querySelector('#promotion-class');
const term = document.querySelector('#promotion-term');
const picker = document.querySelector('#promotion-student-picker');
const summary = document.querySelector('#promotion-student-summary');
const optionsHost = document.querySelector('#promotion-student-options');
const selectAll = document.querySelector('#promotion-select-all');
const clearButton = document.querySelector('#promotion-clear');
const decision = document.querySelector('#promotion-decision');
const comment = document.querySelector('#promotion-comment');
const saveButton = document.querySelector('#promotion-save');
const status = document.querySelector('#promotion-status');
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
let lists = { academicYears: [], terms: [], classes: [] };
let eligibleStudents = [];
let selected = new Set();
let rosterRequest = 0;

async function api(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({ error: `Server returned an unreadable response (${response.status}).` }));
  if (!response.ok) throw Error(body.error || `Request failed (${response.status}).`);
  return body;
}
function announce(message, kind = 'muted') { status.className = kind; status.textContent = message; }
function contextReady() { return Boolean(year.value && classField.value && term.value); }
function updateSummary() {
  const chosen = eligibleStudents.filter((item) => selected.has(item.id));
  summary.textContent = chosen.length ? `${chosen.length} student${chosen.length === 1 ? '' : 's'} selected` : eligibleStudents.length ? 'Choose students' : contextReady() ? 'No students found for the selected class, term and academic year.' : 'Choose academic year, class, and term first';
  selectAll.checked = eligibleStudents.length > 0 && selected.size === eligibleStudents.length;
  selectAll.indeterminate = selected.size > 0 && selected.size < eligibleStudents.length;
  selectAll.disabled = eligibleStudents.length === 0;
  clearButton.disabled = selected.size === 0;
  saveButton.disabled = selected.size === 0;
}
function clearSelection() { selected.clear(); optionsHost.querySelectorAll('input[type="checkbox"][data-student-id]').forEach((input) => { input.checked = false; }); updateSummary(); }
function renderStudents() {
  eligibleStudents = eligibleStudents.filter((student) => !student.isTestRecord);
  selected = new Set([...selected].filter((id) => eligibleStudents.some((student) => student.id === id)));
  if (!eligibleStudents.length) {
    optionsHost.innerHTML = '<p class="muted">No students found for the selected class, term and academic year.</p>';
  } else {
    optionsHost.innerHTML = eligibleStudents.map((student) => `<label><input type="checkbox" data-student-id="${esc(student.id)}" ${selected.has(student.id) ? 'checked' : ''}> ${esc(student.name)} — ${esc(student.permanentStudentId)}</label>`).join('');
  }
  optionsHost.querySelectorAll('input[data-student-id]').forEach((input) => input.addEventListener('change', () => {
    if (input.checked) selected.add(input.dataset.studentId); else selected.delete(input.dataset.studentId);
    updateSummary();
  }));
  renderTerms();
  updateSummary();
}
function renderTerms() {
  const yearTerms = lists.terms.filter((item) => !item.academicYearId || item.academicYearId === year.value);
  const previous = term.value;
  term.innerHTML = '<option value="">Choose term</option>' + yearTerms.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  term.value = yearTerms.some((item) => item.id === previous) ? previous : yearTerms.find((item) => item.isCurrent)?.id ?? yearTerms[0]?.id ?? '';
}
async function loadStudents() {
  const requestId = ++rosterRequest;
  clearSelection();
  eligibleStudents = [];
  if (!contextReady()) {
    optionsHost.innerHTML = '';
    updateSummary();
    return;
  }
  summary.textContent = 'Loading eligible students…';
  optionsHost.innerHTML = '<p class="muted">Loading eligible students…</p>';
  announce('Loading eligible students…');
  try {
    const params = new URLSearchParams({ academicYearId: year.value, classId: classField.value, termId: term.value });
    const result = await api(`/api/examinations/promotion/options?${params}`);
    if (requestId !== rosterRequest) return;
    eligibleStudents = result.students ?? [];
    renderStudents();
    announce(eligibleStudents.length ? `${eligibleStudents.length} eligible student${eligibleStudents.length === 1 ? '' : 's'} loaded.` : 'No students found for the selected class, term and academic year.', eligibleStudents.length ? 'success' : 'muted');
  } catch (error) {
    if (requestId !== rosterRequest) return;
    eligibleStudents = [];
    selected.clear();
    optionsHost.innerHTML = '<p class="error">Eligible students could not be loaded.</p>';
    updateSummary();
    announce(error.message || 'Unable to load eligible students. Please try again.', 'error');
  }
}
function renderClasses() {
  const previous = classField.value;
  classField.innerHTML = '<option value="">Choose class</option>' + lists.classes.map((item) => `<option value="${esc(item.id ?? item)}">${esc(item.name ?? item)}</option>`).join('');
  classField.value = lists.classes.some((item) => String(item.id ?? item) === previous) ? previous : '';
}
function renderYears() {
  const previous = year.value;
  year.innerHTML = '<option value="">Choose academic year</option>' + lists.academicYears.map((item) => `<option value="${esc(item.id ?? item)}">${esc(item.name ?? item)}</option>`).join('');
  year.value = lists.academicYears.some((item) => String(item.id ?? item) === previous) ? previous : lists.academicYears.find((item) => item.isCurrent)?.id ?? '';
}
async function loadOptions() {
  announce('Loading promotion options…');
  try {
    lists = await api('/api/examinations/promotion/options');
    renderYears();
    renderClasses();
    renderTerms();
    year.disabled = false;
    classField.disabled = false;
    term.disabled = false;
    await loadStudents();
    if (!contextReady()) announce('Choose an academic year, class, and term to load eligible students.');
  } catch (error) {
    year.innerHTML = '<option value="">Academic years unavailable</option>';
    classField.innerHTML = '<option value="">Classes unavailable</option>';
    term.innerHTML = '<option value="">Terms unavailable</option>';
    year.disabled = classField.disabled = term.disabled = true;
    announce(error.message || 'Promotion options could not be loaded.', 'error');
  }
}
year.addEventListener('change', () => { renderTerms(); loadStudents(); });
classField.addEventListener('change', loadStudents);
term.addEventListener('change', loadStudents);
selectAll.addEventListener('change', () => {
  selected = selectAll.checked ? new Set(eligibleStudents.map((item) => item.id)) : new Set();
  optionsHost.querySelectorAll('input[data-student-id]').forEach((input) => { input.checked = selected.has(input.dataset.studentId); });
  updateSummary();
});
clearButton.addEventListener('click', clearSelection);
picker.addEventListener('toggle', () => {
  // Opening the picker only exposes local pending selection; it never submits a write.
});
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!contextReady() || !selected.size) { announce('Select at least one eligible student before saving.', 'error'); return; }
  const submittedIds = eligibleStudents.filter((item) => selected.has(item.id)).map((item) => item.id);
  saveButton.disabled = true;
  announce(`Saving promotion decision for ${submittedIds.length} student${submittedIds.length === 1 ? '' : 's'}…`);
  try {
    const result = await api('/api/examinations/promotion/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ academicYearId: year.value, classId: classField.value, termId: term.value, studentIds: submittedIds, decision: decision.value, comment: comment.value }) });
    const count = result.decisions?.length ?? submittedIds.length;
    picker.open = false;
    selected.clear();
    announce(`Promotion decision saved for ${count} student${count === 1 ? '' : 's'}.`, 'success');
    await loadStudents();
  } catch (error) {
    updateSummary();
    announce(error.message || 'Promotion decisions could not be saved.', 'error');
  }
});
loadOptions();
