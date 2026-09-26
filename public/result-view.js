const form = document.querySelector('#result-context'); const status = document.querySelector('#status'); const host = document.querySelector('#result'); let options = {};
const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const ordinal = (n) => { n = Number(n); if (!Number.isFinite(n) || n < 1) return '—'; const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({1:'st',2:'nd',3:'rd'}[n % 10] || 'th'); return `${n}${s}`; };
async function api(url, init = {}) { const r = await fetch(url, init); const b = await r.json().catch(() => ({error:'Request failed.'})); if (!r.ok) throw Object.assign(Error(b.error || 'Request failed.'), { status: r.status }); return b; }
const classOrder = ['Nursery', 'KG 1', 'KG 2', 'Basic 1', 'Basic 2', 'Basic 3', 'Basic 4', 'Basic 5', 'Basic 6', 'JHS 1', 'JHS 2', 'JHS 3'];
const classLabel = (name) => String(name ?? '').trim().replace(/^Nursery 1$/i, 'Nursery').replace(/^KG\s*([12])$/i, 'KG $1').replace(/^Primary ([1-6])$/i, 'Basic $1');
const generateButton = form.querySelector('button[type="submit"]');
const retryButton = document.querySelector('#retry-options');
const retryStudentsButton = document.querySelector('#retry-students');
let studentRequestVersion = 0;
let studentController;
let resultContextVersion = 0;
let resultController;
const retryResultButton = document.querySelector('#retry-result');
function updateModeControls() {
  const sample = form.elements.sampleMode.checked;
  const validContext = form.elements.academicYear.value.trim() && form.elements.term.value && form.elements.classId.value && !form.elements.classId.disabled;
  form.elements.studentId.required = !sample;
  form.elements.studentId.disabled = sample || !(options.students || []).length;
  generateButton.disabled = !validContext || (!sample && !(options.students || []).some((student) => student.id === form.elements.studentId.value));
  generateButton.textContent = 'Load Result';
}
function syncTerms() {
  if (!Array.isArray(options.terms) || !Array.isArray(options.academicYears)) return;
  const year = options.academicYears.find((item) => item.name === form.elements.academicYear.value || item.id === form.elements.academicYear.value);
  const terms = options.terms.filter((item) => item.academicYearId === year?.id);
  const previous = form.elements.term.value;
  form.elements.term.innerHTML = terms.map((item) => `<option value="${esc(item.name)}">${esc(item.name)}</option>`).join('') || '<option value="">No terms configured for this year</option>';
  form.elements.term.disabled = terms.length === 0;
  if (terms.some((item) => item.name === previous)) form.elements.term.value = previous;
  else if (terms.some((item) => Number(item.isCurrent) === 1)) form.elements.term.value = terms.find((item) => Number(item.isCurrent) === 1).name;
}
async function load() {
  resetStudentContext();
  const select = form.elements.classId;
  select.disabled = true;
  select.innerHTML = '<option value="">Loading classes…</option>';
  form.elements.studentId.disabled = true;
  generateButton.disabled = true;
  retryButton.hidden = true;
  status.textContent = 'Loading academic options…';
  const controller = new AbortController();
  let timer;
  try {
    options = await Promise.race([
      api('/api/academic/options', { signal: controller.signal }),
      new Promise((_, reject) => { timer = setTimeout(() => { reject(Error('Academic options timed out. Please retry.')); controller.abort(); }, 15000); })
    ]);
    if (!Array.isArray(options.classes)) throw Error('Invalid academic options response. Please retry.');
    const classes = options.classes.map((item) => typeof item === 'string' ? { id: item, name: item } : item)
      .filter((item) => item?.id && classOrder.includes(classLabel(item.name)))
      .sort((a, b) => classOrder.indexOf(classLabel(a.name)) - classOrder.indexOf(classLabel(b.name)));
    // IDs always come from the response, never from the presentation labels.
    select.innerHTML = '<option value="">Select Class</option>' + classes.map((item) => `<option value="${esc(item.id)}">${esc(classLabel(item.name))}</option>`).join('');
    select.disabled = classes.length === 0;
    if (!classes.length) select.innerHTML = '<option value="">No classes configured</option>';
    // Student choices always come from the durable membership endpoint.
    options.students = [];
    if (Array.isArray(options.academicYears)) {
      document.querySelector('#result-academic-years').innerHTML = options.academicYears.map((item) => `<option value="${esc(item.name)}"></option>`).join('');
      const current = options.academicYears.find((item) => Number(item.isCurrent) === 1);
      if (current) form.elements.academicYear.value = current.name;
      syncTerms();
    }
    status.textContent = !classes.length ? 'No classes configured for your school or assignment.' : 'Choose a class to load students.';
  } catch (error) {
    options = { students: [] };
    select.innerHTML = '<option value="">Classes unavailable — retry</option>';
    select.disabled = true;
    resetStudentContext();
    status.textContent = error.message;
    retryButton.hidden = false;
  } finally { clearTimeout(timer); }
}
function resetResultState() {
  resultContextVersion += 1;
  resultController?.abort();
  host.hidden = true;
  host.innerHTML = '';
  if (retryResultButton) retryResultButton.hidden = true;
  status.textContent = '';
}
function resetStudentContext() {
  studentRequestVersion += 1;
  studentController?.abort();
  options.students = [];
  form.elements.studentId.innerHTML = '<option value="">Choose a class first</option>';
  form.elements.studentId.value = '';
  form.elements.studentId.disabled = true;
  form.elements.permanentStudentId.value = '';
  generateButton.disabled = true;
  retryStudentsButton.hidden = true;
  resetResultState();
  updateModeControls();
}
async function syncStudents() {
  resetStudentContext();
  const classId = form.elements.classId.value;
  const academicYear = form.elements.academicYear.value.trim();
  const term = form.elements.term.value;
  if (!classId || !academicYear || !term || form.elements.classId.disabled) {
    form.elements.studentId.innerHTML = '<option value="">Choose Academic Year, Term and Class</option>';
    return;
  }
  const requestVersion = studentRequestVersion;
  const controller = new AbortController();
  studentController = controller;
  const select = form.elements.studentId;
  select.innerHTML = '<option value="">Loading students...</option>';
  if (!form.elements.sampleMode.checked) status.textContent = 'Loading students...';
  let timer;
  try {
    const query = new URLSearchParams({ classId, academicYear, term });
    const data = await Promise.race([
      api('/api/academic/result-students?' + query, { signal: controller.signal }),
      new Promise((_, reject) => { timer = setTimeout(() => { reject(Error('Student lookup timed out.')); controller.abort(); }, 15000); })
    ]);
    if (requestVersion !== studentRequestVersion) return;
    if (!Array.isArray(data.students) || data.students.some((student) => !student?.id || typeof student.name !== 'string' || student.classId !== classId)) throw Error('Invalid student response.');
    options.students = data.students;
    select.innerHTML = data.students.length ? '<option value="">Select Student</option>' + data.students.map((student) => `<option value="${esc(student.id)}">${esc(student.name)}${student.permanentStudentId ? ` — ${esc(student.permanentStudentId)}` : ' — Permanent Student ID not recorded'}</option>`).join('') : '<option value="">No students found for the selected class.</option>';
    updateModeControls();
    if (!form.elements.sampleMode.checked) status.textContent = data.students.length ? '' : 'No students found for the selected class.';
  } catch {
    if (requestVersion !== studentRequestVersion) return;
    options.students = [];
    select.innerHTML = '<option value="">Unable to load students. Please try again.</option>';
    select.disabled = true;
    updateModeControls();
    if (!form.elements.sampleMode.checked) status.textContent = 'Unable to load students. Please try again.';
    retryStudentsButton.hidden = false;
  } finally { clearTimeout(timer); }
}
retryButton.addEventListener('click', load);
retryStudentsButton.addEventListener('click', syncStudents);
form.elements.academicYear.addEventListener('input', () => { syncTerms(); return syncStudents(); });
form.elements.academicYear.addEventListener('change', () => { syncTerms(); return syncStudents(); });
form.elements.term.addEventListener('change', syncStudents);
form.elements.studentId.addEventListener('change', () => {
  resetResultState();
  const selected = options.students.find((student) => student.id === form.elements.studentId.value);
  form.elements.permanentStudentId.value = selected?.permanentStudentId ?? '';
  updateModeControls();
});
form.elements.sampleMode.addEventListener('change', () => {
  resetResultState();
  form.elements.studentId.value = '';
  form.elements.permanentStudentId.value = '';
  updateModeControls();
});
retryResultButton?.addEventListener('click', () => loadResult({ preventDefault() {} }));
function storageKey(x) { return ['osaah-assessment', x.schoolId || '', x.studentId || '', x.academicYear || '', x.term || '', x.classId || '', 'TERMINAL'].join(':'); }
function savedAssessment(x) { if (x.gesAssessmentDurable) return {}; try { return JSON.parse(localStorage.getItem(storageKey(x)) || '{}'); } catch { return {}; } }
function assessmentField(label, key, saved) { const library = (window.OSAAH_GES_ASSESSMENT_LIBRARIES || {})[key] || { positive: [], negative: [] }; const selected = saved[key] || ''; const selectedSentiment = !selected || library.positive.includes(selected) ? 'positive' : 'negative'; const options = (sentiment) => ['<option value="">Not recorded</option>'].concat((library[sentiment] || []).map((text) => `<option value="${esc(text)}"${text === selected ? ' selected' : ''}>${esc(text)}</option>`)).join(''); return `<div class="assessment-card"><label>${label}</label><div class="no-print" style="display:flex;gap:.35rem;margin-bottom:.35rem"><button type="button" class="assessment-sentiment" data-assessment-sentiment="positive" data-assessment-key="${key}">Positive</button><button type="button" class="assessment-sentiment" data-assessment-sentiment="negative" data-assessment-key="${key}">Negative</button></div><select id="assessment-${key}" data-assessment="${key}" data-assessment-sentiment="${selectedSentiment}">${options(selectedSentiment)}</select><div class="static-value" data-static="${key}">${esc(selected || 'Not recorded')}</div><select class="no-print" hidden data-assessment-source="positive">${options('positive')}</select><select class="no-print" hidden data-assessment-source="negative">${options('negative')}</select></div>`; }
function signatureSrc(signature) { const value = String(signature?.data || signature?.storageKey || '').trim(); if (!value) return ''; if (/^data:image\/(png|jpeg|svg\+xml);base64,/i.test(value)) return value; if (value.startsWith('/') && !value.startsWith('//')) return value; if (/^signatures\/[A-Za-z0-9._/-]+$/.test(value)) return `/${value}`; return ''; }
function signatureBlock(role, signature) { const label = role === 'CLASS_TEACHER' ? 'Class Teacher Signature' : 'Headteacher Signature'; const image = signatureSrc(signature); return `<div class="signature-box"><b>${label}</b><div class="signature-name">Name: ${esc(signature?.name || signature?.fullName || 'Name not configured')}</div><div class="signature-phone">Phone: ${esc(signature?.phone || 'Phone not configured')}</div>${image ? `<img src="${esc(image)}" alt="${label}">` : '<div class="signature-missing">Signature not uploaded</div>'}</div>`; }
function attendanceField(label, key, value) { return `<div><b>${label}</b><span class="attendance-value">${esc(value ?? 'Not recorded')}</span><input class="no-print attendance-input" data-attendance="${key}" type="number" min="0" step="1" value="${value ?? ''}" aria-label="${label}"></div>`; }
async function publishResult(x, button) { if (x.isPreview) return; const contextVersion = resultContextVersion; if (button.disabled || x.lifecycle?.status === 'PUBLISHED') return; button.disabled = true; button.textContent = 'Publishing…'; const attendance = Object.fromEntries([...host.querySelectorAll('[data-attendance]')].map((input) => [input.dataset.attendance, input.value])); const assessment = Object.fromEntries([...host.querySelectorAll('[data-assessment]')].map((select) => [select.dataset.assessment, select.value])); try { const result = await api('/api/academic/results/publish', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ studentId: x.studentId, classId: x.classId, academicYear: x.academicYear, term: x.term, examination: x.resultType === 'MOCK' ? 'MOCK' : 'TERMINAL', expectedVersion: x.lifecycle?.version, attendance, assessment }) }); if (contextVersion !== resultContextVersion) return; status.textContent = 'Result published successfully.'; render({ ...x, lifecycle: { ...(x.lifecycle || {}), status: 'PUBLISHED', dirty: false }, attendance, assessment }); } catch (error) { if (contextVersion !== resultContextVersion) return; status.textContent = error.message; button.disabled = false; button.textContent = 'Publish Result'; } }
async function saveResult(x, button) { if (x.isPreview || x.isSample) return; const contextVersion = resultContextVersion; if (button.disabled) return; button.disabled = true; button.textContent = 'Saving…'; status.textContent = ''; const attendance = Object.fromEntries([...host.querySelectorAll('[data-attendance]')].map((input) => [input.dataset.attendance, input.value])); const assessment = Object.fromEntries([...host.querySelectorAll('[data-assessment]')].map((select) => [select.dataset.assessment, select.value])); try { if (x.gesAssessmentDurable) { const saved = await api('/api/academic/ges-assessment', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ studentId: x.studentId, classId: x.classId, academicYear: x.academicYear, term: x.term, assessment }) }); if (contextVersion !== resultContextVersion) return; status.textContent = 'GES Assessment saved successfully.'; render({ ...x, assessment: saved.assessment }); return; } const saved = await api('/api/academic/results/save', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ studentId: x.studentId, permanentStudentId: x.studentIndexNumber, classId: x.classId, academicYear: x.academicYear, term: x.term, examination: x.resultType === 'MOCK' ? 'MOCK' : 'TERMINAL', attendance, assessment }) }); if (contextVersion !== resultContextVersion) return; status.textContent = 'Result saved successfully.'; render({ ...x, attendance, assessment, lifecycle: saved }); } catch (error) { if (contextVersion !== resultContextVersion) return; status.textContent = error.message; status.focus?.(); } finally { button.disabled = false; button.textContent = x.gesAssessmentDurable ? 'Save GES Assessment' : 'Save Result'; } }
function render(x) { const assess = { ...(x.assessment || {}), ...(x.assessments || {}), ...savedAssessment(x) }; const subjects = Array.isArray(x.subjects) ? x.subjects : []; const total = Number(x.totalScore ?? subjects.reduce((s, r) => s + Number(r.totalScore || 0), 0)); const average = Number(x.average ?? (subjects.length ? total / subjects.length : 0)); const attendance = x.attendance || {}; const lifecycle = x.lifecycle || { status: 'UNSAVED/INCOMPLETE', dirty: true, version: 0 }; const publishReady = !x.isPreview && lifecycle.status === 'SAVED' && !lifecycle.dirty; host.innerHTML = `<div class="no-print" style="display:flex;justify-content:flex-end;gap:.5rem"><button class="primary-button" id="save-result" type="button"${x.isPreview || x.isSample ? ' disabled title="Sample result cannot be saved as a real academic record."' : ''}>${x.gesAssessmentDurable ? 'Save GES Assessment' : 'Save Result'}</button><button class="primary-button" id="publish-result" type="button"${publishReady ? '' : ' disabled title="Save this result before publishing."'}>${lifecycle.status === 'PUBLISHED' ? 'Published' : 'Publish Result'}</button><button class="primary-button" id="export-pdf" type="button">EXPORT / DOWNLOAD PDF</button><button class="text-button" id="print-result" type="button">Print</button>${x.isSample && !x.isPreview ? '<button class="primary-button" id="publish-sample" type="button">Publish Sample Result</button><button class="text-button" id="reset-sample" type="button">Reset Sample</button>' : ''}</div><div class="result-header" aria-hidden="true"></div><section class="result-slip"><header class="slip-header">${x.isSample ? '<p><strong>SAMPLE DATA / DEMONSTRATION</strong></p>' : ''}<img class="slip-logo" src="${esc(x.headerAsset || '')}" alt="Osaah Daylight School Complex logo"><h2>OSAAH DAYLIGHT SCHOOL COMPLEX</h2><p>${x.resultType === 'MOCK' ? 'Mock Examination Result Slip' : 'Terminal Examination Result Slip'}</p></header><div class="slip-meta"><div><b>STUDENT NAME</b>${esc(x.studentName || '—')}</div><div><b>Permanent Student ID</b>${esc(x.studentIndexNumber || '—')}</div><div><b>Gender</b>${esc(x.gender || 'Not Recorded')}</div><div><b>Class</b>${esc(x.className || x.classId)}</div><div><b>TOTAL BOYS IN CLASS</b>${esc(x.classGenderDistribution?.totalBoys ?? 0)}</div><div><b>TOTAL GIRLS IN CLASS</b>${esc(x.classGenderDistribution?.totalGirls ?? 0)}</div><div><b>TOTAL STUDENTS IN CLASS</b>${esc(x.classGenderDistribution?.totalStudents ?? 0)}</div><div><b>Academic Year</b>${esc(x.academicYear)}</div><div><b>Term</b>${esc(x.term)}</div><div><b>Examination</b>${esc(x.resultType || 'TERMINAL')}</div></div><h3 class="slip-section-title">Examination Results</h3><div class="table-scroll" style="overflow-x:auto"><table class="slip-table"><thead><tr>${x.resultType === 'MOCK' ? '<th>#</th><th>Subject</th><th>Total Score</th><th>Grade</th><th>Subject Position</th><th>Remark</th>' : '<th>#</th><th>Subject</th><th>Class Score</th><th>Exam Score</th><th>Total Score</th><th>Subject Position</th><th>Grade</th><th>Remark</th>'}</tr></thead><tbody>${subjects.map((s,i) => x.resultType === 'MOCK' ? `<tr><td>${i+1}</td><td>${esc(s.subjectName || s.subjectId)}</td><td>${esc(s.totalScore)}</td><td>${esc(s.grade)}</td><td>${esc(s.subjectPosition || ordinal(s.position))}</td><td>${esc(s.remark)}</td></tr>` : `<tr><td>${i+1}</td><td>${esc(s.subjectName || s.subjectId)}</td><td>${esc(s.caScore)}</td><td>${esc(s.examScore)}</td><td>${esc(s.totalScore)}</td><td>${esc(s.subjectPosition || ordinal(s.position))}</td><td>${esc(s.grade)}</td><td>${esc(s.remark)}</td></tr>`).join('') || `<tr><td colspan="${x.resultType === 'MOCK' ? 6 : 8}">No submitted subjects found.</td></tr>`}</tbody></table></div><div class="slip-summary"><div><b>TOTAL SCORE</b>${esc(total)}</div><div><b>AGGREGATE</b>${esc(x.aggregate ?? 'N/A')}</div><div><b>CLASS POSITION</b>${esc(x.classPosition ?? x.position ?? '—')}</div><div><b>SUBJECTS SAT</b>${esc(x.subjectsSat ?? subjects.length)}</div><div><b>AVERAGE SCORE</b>${esc(average.toFixed(2))}</div></div><h3 class="slip-section-title">GES Teacher Assessment</h3><div class="slip-assessment">${assessmentField('Conduct','conduct',assess)}${assessmentField('Attitude','attitude',assess)}${assessmentField('Interest','interest',assess)}${assessmentField('Class Teacher Remarks','classTeacherRemarks',assess)}${assessmentField('Headteacher Remarks','headteacherRemarks',assess)}</div><h3 class="slip-section-title">Attendance</h3><div class="slip-attendance">${attendanceField('Times Present','timesPresent',attendance.timesPresent)}${attendanceField('Times Absent','timesAbsent',attendance.timesAbsent)}${attendanceField('Total School Days','totalSchoolDays',attendance.totalSchoolDays)}</div><div class="signature-grid">${signatureBlock('CLASS_TEACHER', (x.signatures || []).find((signature) => signature.signatoryRole === 'CLASS_TEACHER'))}${signatureBlock('HEADTEACHER', (x.signatures || []).find((signature) => signature.signatoryRole === 'HEADTEACHER'))}</div></section>`; host.hidden = false; host.querySelector('#save-result').onclick = () => saveResult(x, host.querySelector('#save-result')); host.querySelector('#publish-result').onclick = () => publishResult(x, host.querySelector('#publish-result')); host.querySelectorAll('[data-attendance]').forEach((input) => input.addEventListener('input', () => { input.closest('div').querySelector('.attendance-value').textContent = input.value || 'Not recorded'; })); host.querySelector('#export-pdf').onclick = async () => { try { await window.downloadResultPdf(x, { mock: false, status }); } catch (error) { status.textContent = error.message; } }; host.querySelector('#print-result').onclick = () => window.print(); if (x.isSample && !x.isPreview) { host.querySelector('#publish-sample').onclick = async () => { const ok = window.confirm('Publish this SAMPLE DATA result? No parent SMS or production communication will be sent.'); if (!ok) return; await api('/api/academic/sample/publish', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ permanentStudentId: x.studentIndexNumber, classId: x.classId, academicYear: x.academicYear, term: x.term }) }); status.textContent = 'Sample result published.'; }; host.querySelector('#reset-sample').onclick = async () => { const ok = window.confirm('Reset this SAMPLE DATA result?'); if (!ok) return; await api('/api/academic/sample/reset', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ permanentStudentId: x.studentIndexNumber, classId: x.classId, academicYear: x.academicYear, term: x.term }) }); status.textContent = 'Sample result reset.'; }; } host.querySelectorAll('[data-assessment]').forEach((select) => select.addEventListener('change', () => { if (!x.gesAssessmentDurable) { const next = savedAssessment(x); next[select.dataset.assessment] = select.value; localStorage.setItem(storageKey(x), JSON.stringify(next)); } select.closest('.assessment-card').querySelector('.static-value').textContent = select.value || 'Not recorded'; })); host.querySelectorAll('[data-assessment-sentiment]').forEach((button) => button.addEventListener('click', () => { const card = button.closest('.assessment-card'); const key = button.dataset.assessmentKey; const sentiment = button.dataset.assessmentSentiment; const source = card.querySelector(`[data-assessment-source="${sentiment}"]`); const target = card.querySelector(`[data-assessment="${key}"]`); target.innerHTML = source.innerHTML; target.value = source.value; target.dataset.assessmentSentiment = sentiment; target.dispatchEvent(new Event('change')); })); }
form.elements.classId.addEventListener('change', syncStudents);
async function loadResult(event) {
  event.preventDefault();
  updateModeControls();
  if (generateButton.disabled) return;
  resetResultState();
  const contextVersion = resultContextVersion;
  const sample = form.elements.sampleMode.checked;
  const controller = new AbortController(); resultController = controller;
  const values = Object.fromEntries(new FormData(form));
  const sampleInput = { classId: values.classId, academicYear: values.academicYear, term: values.term, examinationType: 'TERMINAL' };
  status.textContent = sample ? 'Loading sample result...' : 'Generating…';
  let timer;
  try {
    const request = sample ? api('/api/academic/sample/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sampleInput), signal: controller.signal }) : api('/api/academic/result?' + new URLSearchParams(values), { signal: controller.signal });
    const data = await Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => { reject(Error('Result request timed out.')); controller.abort(); }, 15000); })]);
    if (contextVersion !== resultContextVersion) return;
    if (sample && (!data.result?.isSample || data.result.classId !== values.classId)) throw Error('Invalid sample context.');
    render(data.result); status.textContent = '';
  } catch (error) {
    if (contextVersion !== resultContextVersion) return;
    host.hidden = true; host.innerHTML = '';
    status.textContent = sample ? error.status === 404 || error.status === 400 ? 'Sample result is unavailable for the selected class.' : error.status === 403 ? 'Forbidden.' : 'Unable to load sample result. Please try again.' : error.message;
    if (retryResultButton) retryResultButton.hidden = error.status === 401 || error.status === 403;
  } finally { clearTimeout(timer); }
}
form.addEventListener('submit', loadResult);
load().catch((error) => { status.textContent = error.message; });