const form = document.querySelector('#attendance-form');
const classField = document.querySelector('#attendance-class');
const dateField = document.querySelector('#attendance-date');
const tbody = document.querySelector('#attendance-register');
const status = document.querySelector('#attendance-status');
dateField.value = new Date().toISOString().slice(0, 10);
let register = [];

function escape(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
document.querySelector('#load-register').addEventListener('click', async () => {
  if (!classField.value) return;
  status.textContent = 'Loading register…';
  const response = await fetch(`/api/attendance/register?classId=${encodeURIComponent(classField.value)}`);
  const result = await response.json();
  if (!response.ok) { status.textContent = result.error ?? 'Register could not be loaded.'; return; }
  register = result.register;
  tbody.innerHTML = register.length ? register.map((row) => `<tr data-student-id="${escape(row.studentId)}"><td>${row.number}</td><td>${escape(row.permanentStudentId)}</td><td>${escape(row.studentName)}</td><td><select><option>PRESENT</option><option>ABSENT</option><option>LATE</option><option>EXCUSED_ABSENCE</option></select></td></tr>`).join('') : '<tr><td colspan="4">No enrolled students in this class.</td></tr>';
  status.textContent = `${register.length} student${register.length === 1 ? '' : 's'} loaded.`;
});
form.addEventListener('submit', async (event) => {
  event.preventDefault(); if (!register.length) return;
  const entries = [...tbody.querySelectorAll('tr[data-student-id]')].map((row) => ({ studentId: row.dataset.studentId, classId: classField.value, date: dateField.value, status: row.querySelector('select').value, method: 'MANUAL' }));
  const response = await fetch('/api/attendance/students/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }) });
  const result = await response.json(); status.textContent = response.ok ? `${result.synced.length} attendance record(s) saved.` : result.error ?? 'Attendance could not be saved.';
});
