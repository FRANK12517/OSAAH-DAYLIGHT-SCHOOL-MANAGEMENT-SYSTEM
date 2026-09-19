const context = document.querySelector('#score-context');
const status = document.querySelector('#status');
const studentsHost = document.querySelector('#students');
let options = {};
const timers = new WeakMap();
const sequences = new WeakMap();
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const grade = (total, classId) => String(classId).toUpperCase().startsWith('JHS') ? (total >= 80 ? '1' : total >= 70 ? '2' : total >= 60 ? '3' : total >= 55 ? '4' : total >= 50 ? '5' : total >= 45 ? '6' : total >= 40 ? '7' : total >= 35 ? '8' : '9') : (total >= 80 ? 'A' : total >= 70 ? 'B' : total >= 60 ? 'C' : total >= 50 ? 'D' : 'F');
async function api(url, init) { const response = await fetch(url, init); const body = await response.json().catch(() => ({ error: 'Request failed.' })); if (!response.ok) throw Error(body.error || 'Request failed.'); return body; }
async function load() { options = await api('/api/academic/options'); context.elements.classId.innerHTML = options.classes.map((item) => `<option value="${esc(item)}">${esc(item)}</option>`).join(''); const subjects = await api('/api/subjects'); context.elements.subjectId.innerHTML = subjects.subjects.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join(''); }
function render() {
  const classId = context.elements.classId.value;
  const rows = options.students.filter((student) => student.classId === classId);
  studentsHost.innerHTML = rows.map((student) => `<tr data-student="${esc(student.id)}"><td>${esc(student.indexNumber)}</td><td>${esc(student.name)}</td><td><input class="ca" type="number" min="0" max="50" step="0.01" value="0" aria-label="CA score for ${esc(student.name)}"></td><td><input class="exam" type="number" min="0" max="50" step="0.01" value="0" aria-label="Exam score for ${esc(student.name)}"></td><td class="total">0.00</td><td class="grade">${grade(0, classId)}</td><td class="save-status">Not saved</td></tr>`).join('') || '<tr><td colspan="7">No students are registered in this class.</td></tr>';
  studentsHost.querySelectorAll('tr[data-student]').forEach((row) => {
    const totalCell = row.querySelector('.total'); const gradeCell = row.querySelector('.grade'); const stateCell = row.querySelector('.save-status');
    const update = () => { const ca = Number(row.querySelector('.ca').value || 0); const exam = Number(row.querySelector('.exam').value || 0); const total = ca + exam; totalCell.textContent = Number.isFinite(total) ? total.toFixed(2) : '—'; gradeCell.textContent = Number.isFinite(total) ? grade(total, classId) : '—'; stateCell.textContent = 'Unsaved changes'; scheduleSave(row, ca, exam, stateCell); };
    row.querySelectorAll('input').forEach((input) => { input.addEventListener('input', update); input.addEventListener('blur', update); });
  });
}
function scheduleSave(row, caScore, examScore, stateCell) { clearTimeout(timers.get(row)); const sequence = (sequences.get(row) || 0) + 1; sequences.set(row, sequence); timers.set(row, setTimeout(() => save(row, caScore, examScore, stateCell, sequence), 450)); }
async function save(row, caScore, examScore, stateCell, sequence) { if (sequence !== sequences.get(row)) return; stateCell.textContent = 'Saving…'; const data = Object.fromEntries(new FormData(context)); data.studentId = row.dataset.student; data.caScore = caScore; data.examScore = examScore; try { await api('/api/academic/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); if (sequence === sequences.get(row)) stateCell.textContent = 'Saved'; } catch (error) { if (sequence === sequences.get(row)) stateCell.textContent = `Error saving: ${error.message}`; } }
context.addEventListener('submit', (event) => { event.preventDefault(); render(); });
load().catch((error) => { status.textContent = error.message; });
