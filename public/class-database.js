function classLabel(value) { const item = String(value ?? ''); return item === 'KG1' ? 'KG 1' : item === 'KG2' ? 'KG 2' : item; }
const form = document.querySelector('#filters');
const year = document.querySelector('#academicYear');
const classSelect = document.querySelector('#classId');
const search = document.querySelector('#search');
const rows = document.querySelector('#rows');
const status = document.querySelector('#status');
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const emptyMessage = 'No students are currently enrolled in this class for the selected academic year.';

async function api(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json().catch(() => ({ error: 'Request failed.' }));
  if (!response.ok) throw Error(body.error || 'Request failed.');
  return body;
}

function render(items) {
  rows.innerHTML = items.length ? items.map((item) => `<tr><td>${esc(item.permanentStudentId)}</td><td>${esc(item.studentName)}</td><td>${esc(item.gender || 'Not Recorded')}</td><td>${esc(item.parentGuardianName)}</td><td>${esc(item.registeredParentPhone)}</td><td>${esc(classLabel(item.classId))}</td><td>${esc(item.academicYear || year.value || 'Not Recorded')}</td></tr>`).join('') : `<tr><td colspan="7">${emptyMessage}</td></tr>`;
}

function showError(error) {
  rows.innerHTML = '<tr><td colspan="7">Unable to load Class Database records. Please try again.</td></tr>';
  status.textContent = error.message;
  status.className = 'error';
}

async function loadOptions() {
  status.className = 'muted';
  status.textContent = 'Loading Class Database options…';
  const data = await api('/api/class-database/options');
  year.innerHTML = data.academicYears.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join('');
  classSelect.innerHTML = '<option value="">Select Class</option>' + data.classes.map((item) => `<option value="${esc(item)}">${esc(classLabel(item))}</option>`).join('');
  status.textContent = 'Select a class to view currently enrolled students.';
}

async function loadRows() {
  if (!classSelect.value) {
    rows.innerHTML = '<tr><td colspan="7">Select a class to view students.</td></tr>';
    status.className = 'muted';
    status.textContent = 'Select a class to view currently enrolled students.';
    return;
  }
  status.className = 'muted';
  status.textContent = 'Loading…';
  const query = new URLSearchParams({ academicYear: year.value, classId: classSelect.value, search: search.value });
  const data = await api('/api/class-database?' + query);
  render(data.rows);
  status.textContent = `Showing ${data.rows.length} currently enrolled student(s).`;
}

classSelect.addEventListener('change', () => loadRows().catch(showError));
year.addEventListener('change', () => loadRows().catch(showError));
form.addEventListener('submit', (event) => { event.preventDefault(); loadRows().catch(showError); });
loadOptions().catch(showError);
