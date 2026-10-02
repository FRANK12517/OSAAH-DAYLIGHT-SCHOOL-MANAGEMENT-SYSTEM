const JHS_CLASSES = new Set(['JHS 1', 'JHS 2', 'JHS 3']);
const MOCK_TYPES = Array.from({ length: 10 }, (_, index) => `${index + 1}${index === 0 ? 'st' : index === 1 ? 'nd' : index === 2 ? 'rd' : 'th'} Mock`);
const context = document.querySelector('#mock-context');
const status = document.querySelector('#status');
const studentsHost = document.querySelector('#students');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const valueOf = (item) => typeof item === 'string' ? item : item.id ?? item.name;
const labelOf = (item) => typeof item === 'string' ? item : item.name ?? item.id;
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
  if (!JHS_CLASSES.has(classId)) { setOptions(context.elements.subjectId, [], 'Select a JHS class first'); return; }
  const query = new URLSearchParams({ classId, academicYearId: academicYear, termId: term });
  const result = await api(`/api/subjects?${query}`);
  const subjects = (result.subjects || []).filter((subject) => subject.active !== false && subject.classId === classId);
  setOptions(context.elements.subjectId, subjects, 'No active subjects configured for this JHS class');
}
async function load() {
  const options = await api('/api/academic/options');
  setOptions(context.elements.academicYear, options.academicYears || [], 'No academic years configured');
  setOptions(context.elements.term, options.terms || [], 'No terms configured');
  setOptions(context.elements.mockLabel, options.mockTypes || MOCK_TYPES);
  const classes = (options.classes || []).filter((item) => JHS_CLASSES.has(valueOf(item)));
  setOptions(context.elements.classId, classes, 'No JHS classes configured');
  await loadSubjects();
}
const grade = (score) => { const value = Number(score); if (!Number.isFinite(value)) return '—'; return value >= 80 ? '1' : value >= 70 ? '2' : value >= 60 ? '3' : value >= 55 ? '4' : value >= 50 ? '5' : value >= 45 ? '6' : value >= 40 ? '7' : value >= 35 ? '8' : '9'; };
function render(list) {
  studentsHost.innerHTML = list.map((student) => `<tr data-student="${esc(student.studentId)}"><td data-label="Student ID">${esc(student.permanentStudentId)}</td><td data-label="Student Name">${esc(student.studentName)}</td><td data-label="Total Score / 100"><input class="total-score" type="number" min="0" max="100" step="0.01" value="${esc(student.totalScore ?? 0)}"></td><td data-label="Grade" class="grade">${esc(student.grade ?? grade(student.totalScore))}</td><td data-label="Save Status" class="save-status">${student.saved ? 'Saved' : 'Not saved'} <button class="text-button save" type="button">Save</button></td></tr>`).join('') || '<tr><td colspan="5">No students are enrolled in this academic context.</td></tr>';
  studentsHost.querySelectorAll('tr[data-student]').forEach((row) => {
    const input = row.querySelector('.total-score');
    input.oninput = () => { row.querySelector('.grade').textContent = grade(input.value); };
    row.querySelector('.save').onclick = async () => {
      const totalScore = Number(input.value);
      if (!Number.isFinite(totalScore) || totalScore < 0 || totalScore > 100) { status.textContent = 'Score must be between 0 and 100.'; return; }
      const body = Object.fromEntries(selectedContext());
      body.studentId = row.dataset.student;
      body.totalScore = String(totalScore);
      try { await api('/api/academic/mock-scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); row.querySelector('.save-status').firstChild.textContent = 'Saved '; status.textContent = 'Mock score saved.'; }
      catch (error) { status.textContent = error.message; }
    };
  });
}
context.elements.classId.addEventListener('change', () => loadSubjects().catch((error) => { status.textContent = error.message; }));
context.elements.academicYear.addEventListener('change', () => loadSubjects().catch((error) => { status.textContent = error.message; }));
context.elements.term.addEventListener('change', () => loadSubjects().catch((error) => { status.textContent = error.message; }));
context.onsubmit = async (event) => { event.preventDefault(); status.textContent = 'Loading Students…'; try { const query = selectedContext(); const data = await api(`/api/academic/mock-scores/roster?${query}`); render(data.students || []); status.textContent = `${(data.students || []).length} student(s) loaded.`; } catch (error) { status.textContent = error.message; } };
load().catch((error) => { status.textContent = error.message; });
