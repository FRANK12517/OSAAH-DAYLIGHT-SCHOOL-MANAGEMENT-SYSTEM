import { SCHOOL_CLASS_CATALOGUE } from '/class-catalogue.js';

const context = document.querySelector('#score-context');
const status = document.querySelector('#status');
const studentsHost = document.querySelector('#students');
const classSelect = context.elements.classId;
const subjectSelect = context.elements.subjectId;
const timers = new WeakMap();
const sequences = new WeakMap();
const classNames = new Map(SCHOOL_CLASS_CATALOGUE.map((item) => [item.id, item.label]));
let options = { classes: [] };
let currentClass = '';
let subjectRequest = 0;

const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const grade = (total, classId) => String(classId).toUpperCase().startsWith('JHS') ? (total >= 80 ? '1' : total >= 70 ? '2' : total >= 60 ? '3' : total >= 55 ? '4' : total >= 50 ? '5' : total >= 45 ? '6' : total >= 40 ? '7' : total >= 35 ? '8' : '9') : (total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : total >= 50 ? 'D' : 'F');

async function api(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({ error: `Server returned an unreadable response (${response.status}).` }));
  if (!response.ok) throw Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function showMessage(message, kind = 'error') {
  status.textContent = message;
  status.className = kind;
}

function clearRoster(message = 'Choose a class and subject.') {
  studentsHost.querySelectorAll('tr[data-student]').forEach((row) => {
    clearTimeout(timers.get(row));
    sequences.set(row, (sequences.get(row) || 0) + 1);
  });
  studentsHost.innerHTML = `<tr><td colspan="7">${esc(message)}</td></tr>`;
}

async function loadSubjects() {
  const classId = classSelect.value;
  const requestNumber = ++subjectRequest;
  subjectSelect.innerHTML = classId ? '<option value="">Loading subjects…</option>' : '<option value="">Select Class First</option>';
  subjectSelect.disabled = true;
  currentClass = classId;
  if (!classId) return;
  const params = new URLSearchParams({ classId, academicYearId: context.elements.academicYear.value.trim(), termId: context.elements.term.value });
  try {
    const result = await api(`/api/subjects?${params}`);
    if (requestNumber !== subjectRequest || currentClass !== classSelect.value) return;
    subjectSelect.innerHTML = '<option value="">Select Subject</option>' + result.subjects.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    subjectSelect.disabled = result.subjects.length === 0;
    if (result.subjects.length === 0) subjectSelect.innerHTML = '<option value="">No subjects configured for this class.</option>';
    showMessage(result.subjects.length ? '' : 'No subjects configured for this class.', result.subjects.length ? 'muted' : 'error');
  } catch (error) {
    if (requestNumber === subjectRequest && currentClass === classSelect.value) {
      subjectSelect.innerHTML = '<option value="">Subjects unavailable</option>';
      showMessage(error.message || 'Unable to load subjects. Please try again.');
    }
  }
}

function render(students, classId) {
  studentsHost.innerHTML = students.map((student) => {
    const ca = student.caScore ?? 0;
    const exam = student.examScore ?? 0;
    const total = student.totalScore ?? 0;
    return `<tr data-student="${esc(student.studentId)}"><td>${esc(student.permanentStudentId)}</td><td>${esc(student.studentName)}</td><td><input class="ca" type="number" min="0" max="50" step="0.01" value="${esc(ca)}" aria-label="CA score for ${esc(student.studentName)}"></td><td><input class="exam" type="number" min="0" max="50" step="0.01" value="${esc(exam)}" aria-label="Exam score for ${esc(student.studentName)}"></td><td class="total">${Number(total).toFixed(2)}</td><td class="grade">${esc(student.grade ?? grade(total, classId))}</td><td class="save-status">${student.saved ? 'Saved' : 'Not saved'}</td></tr>`;
  }).join('') || '<tr><td colspan="7">No students found for the selected class and academic year.</td></tr>';
  studentsHost.querySelectorAll('tr[data-student]').forEach((row) => {
    const totalCell = row.querySelector('.total');
    const gradeCell = row.querySelector('.grade');
    const stateCell = row.querySelector('.save-status');
    const update = () => {
      const caInput = row.querySelector('.ca');
      const examInput = row.querySelector('.exam');
      const ca = Number(caInput.value);
      const exam = Number(examInput.value);
      if (!Number.isFinite(ca) || ca < 0 || ca > 50 || !Number.isFinite(exam) || exam < 0 || exam > 50) {
        clearTimeout(timers.get(row));
        sequences.set(row, (sequences.get(row) || 0) + 1);
        stateCell.textContent = 'Invalid score: use 0–50';
        return;
      }
      const total = ca + exam;
      totalCell.textContent = total.toFixed(2);
      gradeCell.textContent = grade(total, classId);
      stateCell.textContent = 'Unsaved changes';
      scheduleSave(row, ca, exam, stateCell);
    };
    row.querySelectorAll('input').forEach((input) => { input.addEventListener('input', update); input.addEventListener('blur', update); });
  });
}

function scheduleSave(row, caScore, examScore, stateCell) {
  clearTimeout(timers.get(row));
  const sequence = (sequences.get(row) || 0) + 1;
  sequences.set(row, sequence);
  timers.set(row, setTimeout(() => save(row, caScore, examScore, stateCell, sequence), 450));
}

async function save(row, caScore, examScore, stateCell, sequence) {
  if (sequence !== sequences.get(row)) return;
  stateCell.textContent = 'Saving…';
  const data = { academicYear: context.elements.academicYear.value.trim(), term: context.elements.term.value, classId: classSelect.value, subjectId: subjectSelect.value, studentId: row.dataset.student, caScore, examScore };
  try {
    const saved = await api('/api/academic/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (sequence === sequences.get(row)) {
      stateCell.textContent = 'Saved';
      row.querySelector('.total').textContent = Number(saved.totalScore).toFixed(2);
      row.querySelector('.grade').textContent = String(saved.grade);
    }
  } catch (error) {
    if (sequence === sequences.get(row)) stateCell.textContent = `Error saving: ${error.message}`;
  }
}

async function load() {
  options = await api('/api/academic/options');
  classSelect.innerHTML = '<option value="">Select Class</option>' + options.classes.map((id) => `<option value="${esc(id)}">${esc(classNames.get(id) ?? id)}</option>`).join('');
  subjectSelect.innerHTML = '<option value="">Select Class First</option>';
  subjectSelect.disabled = true;
  clearRoster();
}

classSelect.addEventListener('change', () => {
  subjectSelect.value = '';
  clearRoster();
  loadSubjects();
});
subjectSelect.addEventListener('change', () => clearRoster('Select the academic context, class, and subject, then load students.'));
for (const field of [context.elements.academicYear, context.elements.term]) {
  field.addEventListener('change', () => {
    subjectSelect.value = '';
    clearRoster();
    loadSubjects();
  });
}

context.addEventListener('submit', async (event) => {
  event.preventDefault();
  const filters = { academicYear: context.elements.academicYear.value.trim(), term: context.elements.term.value, classId: classSelect.value, subjectId: subjectSelect.value };
  const missing = Object.entries(filters).find(([, value]) => !value);
  if (missing) {
    const labels = { academicYear: 'academic year', term: 'term', classId: 'class', subjectId: 'subject' };
    showMessage(`Select a valid ${labels[missing[0]]} before loading students.`);
    return;
  }
  showMessage('Loading students…', 'muted');
  clearRoster('Loading students…');
  try {
    const params = new URLSearchParams(filters);
    const result = await api(`/api/academic/score-entry/roster?${params}`);
    render(result.students, filters.classId);
    showMessage(result.students.length ? `${result.students.length} student${result.students.length === 1 ? '' : 's'} loaded.` : 'No students found for the selected class and academic year.', result.students.length ? 'success' : 'muted');
  } catch (error) {
    clearRoster('Students could not be loaded.');
    showMessage(error.message || 'Unable to load students. Please try again.');
  }
});

load().catch((error) => showMessage(error.message || 'Unable to load Score Entry options. Please try again.'));
