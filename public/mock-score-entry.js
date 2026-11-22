const JHS_CLASSES = new Set(['JHS 1', 'JHS 2', 'JHS 3']);
const MOCK_TYPES = Array.from({ length: 10 }, (_, index) => `${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'} Mock`);
const context = document.querySelector('#mock-context');
const status = document.querySelector('#status');
const studentsHost = document.querySelector('#students');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const valueOf = (item) => typeof item === 'string' ? item : item.id ?? item.name;
const labelOf = (item) => typeof item === 'string' ? item : item.name ?? item.id;
const saveStates = new WeakMap();
let activeContext = null;
let loadRequest = 0;

async function api(url, init) {
  const response = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await response.json().catch(() => ({ error: 'Request failed.' }));
  if (!response.ok) throw Error(body.error || 'Request failed.');
  return body;
}

function setOptions(select, values, emptyLabel = 'No options configured') {
  select.innerHTML = values.length ? values.map((item) => `<option value="${esc(valueOf(item))}">${esc(labelOf(item))}</option>`).join('') : `<option value="">${esc(emptyLabel)}</option>`;
  select.disabled = !values.length;
}

function selectedContext() {
  return new URLSearchParams(new FormData(context));
}

async function loadSubjects() {
  const classId = context.elements.classId.value;
  const academicYear = context.elements.academicYear.value;
  const term = context.elements.term.value;
  const query = new URLSearchParams({ mock: 'true', sampleMode: String(context.elements.sampleMode.checked) });
  if (classId && academicYear && term) { query.set('classId', classId); query.set('academicYearId', academicYear); query.set('termId', term); }
  const result = await api(`/api/subjects?${query}`);
  const subjects = (result.subjects || []).filter((subject) => subject.active !== false && (!classId || !subject.classId || subject.classId === classId));
  setOptions(context.elements.subjectId, subjects, 'No active subjects configured for this JHS class');
}

async function load() {
  const options = await api('/api/academic/options');
  setOptions(context.elements.academicYear, options.academicYears || [], 'No academic years configured');
  setOptions(context.elements.term, options.terms || [], 'No terms configured');
  setOptions(context.elements.mockLabel, options.mockTypes || MOCK_TYPES);
  const classes = (options.classes || []).filter((item) => JHS_CLASSES.has(labelOf(item)));
  setOptions(context.elements.classId, classes, 'No JHS classes configured');
  await loadSubjects();
}

const grade = (score) => {
  const value = Number(score);
  if (!Number.isFinite(value)) return '—';
  return value >= 80 ? '1' : value >= 70 ? '2' : value >= 60 ? '3' : value >= 50 ? '4' : value >= 45 ? '5' : value >= 40 ? '6' : value >= 35 ? '7' : value >= 25 ? '8' : '9';
};

function scoreStatus(row, label) {
  const output = row.querySelector('.save-status');
  if (output) output.textContent = label;
}

function rowInputValue(input) {
  const raw = input.value.trim();
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < 0 || value > 100) throw Error('Score must be between 0 and 100.');
  return value;
}

async function saveRow(row) {
  const state = saveStates.get(row);
  const input = row.querySelector('.total-score');
  if (!state || !activeContext || !row.isConnected) return;
  if (state.inFlight) { state.queued = true; return; }

  let totalScore;
  try { totalScore = rowInputValue(input); }
  catch (error) { scoreStatus(row, 'Error saving'); status.textContent = error.message; return; }
  if (String(totalScore) === String(state.lastSavedValue)) { scoreStatus(row, 'Saved'); return; }

  state.inFlight = true;
  state.queued = false;
  scoreStatus(row, 'Saving…');
  const body = { ...activeContext, studentId: row.dataset.student, totalScore: String(totalScore) };
  try {
    await api('/api/academic/mock-scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    state.lastSavedValue = totalScore;
    status.textContent = 'Mock score saved.';
    const currentValue = input.value.trim() === '' ? NaN : Number(input.value);
    scoreStatus(row, currentValue === totalScore ? 'Saved' : 'Saving…');
  } catch (error) {
    status.textContent = error.message;
    scoreStatus(row, 'Error saving');
  } finally {
    state.inFlight = false;
    if (state.queued && row.isConnected) {
      state.queued = false;
      await saveRow(row);
    }
  }
}

function scheduleSave(row, delay = 500) {
  const state = saveStates.get(row);
  if (!state) return;
  clearTimeout(state.timer);
  scoreStatus(row, state.inFlight ? 'Saving…' : 'Not saved');
  state.timer = setTimeout(() => { state.timer = null; saveRow(row); }, delay);
}

function render(list, loadedContext) {
  activeContext = loadedContext;
  studentsHost.innerHTML = list.map((student) => {
    const score = student.totalScore ?? '';
    return `<tr data-student="${esc(student.studentId)}"><td data-label="Student ID">${esc(student.permanentStudentId)}</td><td data-label="Student Name">${esc(student.studentName)}</td><td data-label="Gender">${esc(student.gender || 'Not recorded')}</td><td data-label="Total Score / 100"><input class="total-score" type="number" min="0" max="100" step="0.01" value="${esc(score)}" aria-label="Total score out of 100 for ${esc(student.studentName)}"></td><td data-label="Grade" class="grade">${esc(student.grade ?? (score === '' ? '—' : grade(score)))}</td><td data-label="Save Status" class="save-status">${student.saved ? 'Saved' : 'Not saved'}</td></tr>`;
  }).join('') || '<tr><td colspan="6">No students are enrolled in this academic context.</td></tr>';

  studentsHost.querySelectorAll('tr[data-student]').forEach((row) => {
    const input = row.querySelector('.total-score');
    const initialValue = input.value.trim() === '' ? null : Number(input.value);
    saveStates.set(row, { timer: null, inFlight: false, queued: false, lastSavedValue: studentSavedValue(list, row.dataset.student, initialValue) });
    input.addEventListener('input', () => {
      row.querySelector('.grade').textContent = input.value.trim() === '' ? '—' : grade(input.value);
      scheduleSave(row);
    });
    input.addEventListener('blur', () => {
      const state = saveStates.get(row);
      if (state?.timer) { clearTimeout(state.timer); state.timer = null; saveRow(row); }
    });
  });
}

function studentSavedValue(list, studentId, fallback) {
  const student = list.find((item) => String(item.studentId) === String(studentId));
  if (!student?.saved || student.totalScore == null) return null;
  return Number(student.totalScore);
}

function clearRoster(message = 'Choose a JHS mock context and load students.') {
  loadRequest += 1;
  activeContext = null;
  studentsHost.querySelectorAll('tr[data-student]').forEach((row) => clearTimeout(saveStates.get(row)?.timer));
  studentsHost.innerHTML = `<tr><td colspan="6">${esc(message)}</td></tr>`;
}

async function refreshSubjectsAndRoster() {
  clearRoster('Selection changed. Load the selected mock context to continue.');
  try { await loadSubjects(); } catch (error) { status.textContent = error.message; }
}

for (const name of ['classId', 'academicYear', 'term', 'mockLabel', 'subjectId', 'sampleMode']) {
  context.elements[name].addEventListener('change', () => {
    if (['classId', 'academicYear', 'term', 'sampleMode'].includes(name)) refreshSubjectsAndRoster();
    else clearRoster('Selection changed. Load the selected mock context to continue.');
  });
}

context.onsubmit = async (event) => {
  event.preventDefault();
  const requestId = ++loadRequest;
  status.textContent = 'Loading Students…';
  const snapshot = Object.fromEntries(selectedContext());
  snapshot.sampleMode = context.elements.sampleMode.checked;
  try {
    const data = await api(`/api/academic/mock-scores/roster?${selectedContext()}`);
    if (requestId !== loadRequest) return;
    render(data.students || [], snapshot);
    status.textContent = `${(data.students || []).length} student(s) loaded.`;
  } catch (error) {
    if (requestId !== loadRequest) return;
    status.textContent = error.message;
  }
};

load().catch((error) => { status.textContent = error.message; });
