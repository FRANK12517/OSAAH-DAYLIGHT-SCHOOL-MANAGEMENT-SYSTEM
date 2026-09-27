import { SCHOOL_CLASS_CATALOGUE } from '/class-catalogue.js';

const CURRENT_ACADEMIC_YEAR = '2026/2027';
const PREVIOUS_ACADEMIC_YEAR = '2025/2026';
const year = document.querySelector('#academic-year');
const term = document.querySelector('#term');
const klass = document.querySelector('#class');
const rows = document.querySelector('#rows');
const status = document.querySelector('#status');
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

async function api(url) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' });
  const body = await response.json().catch(() => ({ error: 'Request failed.' }));
  if (!response.ok) throw Error(body.error || 'Request failed.');
  return body;
}

function render(items) {
  rows.innerHTML = items.length
    ? items.map((item) => `<tr><td>${esc(item.permanentStudentId)}</td><td>${esc(item.studentName || 'Not found')}</td><td>${esc(item.gender || 'Not Recorded')}</td><td>${esc(item.previousClass)}</td><td>${esc(item.promotedTo)}</td><td>${esc(item.academicYearId)}</td><td>${esc(item.termId)}</td><td>${esc(item.status)}</td><td>${esc(item.promotionDate)}</td></tr>`).join('')
    : '<tr><td colspan="9">No students were promoted to the selected class for this academic context.</td></tr>';
}

function normalizeYear(item) {
  if (typeof item === 'string') return { id: item, name: item };
  return { id: item?.id ?? item?.name, name: item?.name ?? item?.id };
}

function loadAcademicYears(items) {
  const available = new Map(items.map(normalizeYear).filter((item) => item.id && item.name).map((item) => [String(item.name), item]));
  const years = [PREVIOUS_ACADEMIC_YEAR, CURRENT_ACADEMIC_YEAR].map((name) => available.get(name) ?? { id: name, name });
  year.innerHTML = years.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  year.value = years.at(-1).id;
}

function loadClasses() {
  klass.innerHTML = '<option value="">Select destination class</option>' + SCHOOL_CLASS_CATALOGUE
    .map(({ id, label }) => `<option value="${esc(id)}">${esc(label)}</option>`)
    .join('');
}

async function loadOptions() {
  const data = await api('/api/academic/options');
  loadAcademicYears(data.academicYears || []);
  loadClasses();
  status.textContent = 'Select a destination class and fetch promotion results.';
}

document.querySelector('#promotion-results-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!year.value || !klass.value) {
    status.className = 'error';
    status.textContent = 'Select an academic year and destination class.';
    return;
  }
  status.className = 'muted';
  status.textContent = 'Loading…';
  try {
    const query = new URLSearchParams({ academicYearId: year.value, termId: term.value, classId: klass.value });
    const data = await api('/api/examinations/promotion/results?' + query);
    render(data.rows || []);
    status.textContent = `${(data.rows || []).length} promoted student(s) found for ${year.options[year.selectedIndex]?.text || year.value}.`;
  } catch (error) {
    rows.innerHTML = '<tr><td colspan="9">Unable to load Promotion Results.</td></tr>';
    status.className = 'error';
    status.textContent = error.message;
  }
});

loadOptions().catch((error) => {
  status.className = 'error';
  status.textContent = error.message;
});
