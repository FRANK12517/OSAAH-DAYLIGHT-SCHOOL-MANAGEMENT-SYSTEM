(() => {
  const page = document.querySelector('main');
  if (!page) return;
  const mockPage = location.pathname.includes('mock-results');
  const style = document.createElement('style');
  style.textContent = '.result-access-manager{margin:1rem auto;max-width:1100px}.result-access-manager form{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:.75rem;align-items:end}.result-access-manager label{display:grid;gap:.35rem}.result-access-manager select,.result-access-manager button{min-height:42px}.result-access-actions{display:flex;flex-wrap:wrap;gap:.6rem;margin:1rem 0}.result-access-status{min-height:1.4em}.result-access-table{width:100%;border-collapse:collapse}.result-access-table th,.result-access-table td{padding:.55rem;border-bottom:1px solid #d9e2ec;text-align:left}.result-access-table-wrap{max-width:100%;overflow:auto}@media(max-width:600px){.result-access-actions{display:grid}.result-access-actions button{width:100%}.result-access-table{min-width:580px}}';
  document.head.append(style);
  const section = document.createElement('section');
  section.className = 'card result-access-manager no-print';
  section.innerHTML = `<h2>Publish and manage result access</h2><p>Choose the academic scope, then review saved results and parent access blocks before taking action.</p><form id="result-access-form"><label>Academic year<select name="academicYear" required><option value="">Loading…</option></select></label><label>Term<select name="term" required><option value="">Loading…</option></select></label>${mockPage ? '<label>Mock examination<select name="mockLabel" required><option value="">Loading…</option></select></label>' : '<label>Examination<select name="resultType"><option value="TERMINAL">End of Term</option><option value="MIDTERM">Midterm</option></select></label>'}<label>Class<select name="classId" required><option value="">Loading…</option></select></label><button type="submit">Load scope</button></form><p id="result-access-status" class="result-access-status" role="status" aria-live="polite"></p><div id="result-access-summary"></div><div class="result-access-actions" id="result-access-actions"></div><div class="result-access-table-wrap" id="result-access-students"></div>`;
  page.append(section);
  const form = section.querySelector('form');
  const status = section.querySelector('#result-access-status');
  const summary = section.querySelector('#result-access-summary');
  const actions = section.querySelector('#result-access-actions');
  const students = section.querySelector('#result-access-students');
  const controls = Object.fromEntries([...form.elements].filter((el) => el.name).map((el) => [el.name, el]));
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let current = null;

  async function json(url, options) {
    const response = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json', ...(options?.body ? { 'Content-Type': 'application/json' } : {}) }, ...options });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Request failed.');
    return body;
  }
  function fill(select, rows, title) {
    select.innerHTML = `<option value="">Select ${title}</option>` + rows.map((row) => `<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('');
    const preferred = rows.find((row) => row.isCurrent);
    if (preferred) select.value = preferred.id;
  }
  function scope(studentId = null) { return { academicYear: controls.academicYear.value, term: controls.term.value, classId: controls.classId.value, resultType: mockPage ? 'MOCK' : controls.resultType.value, ...(mockPage ? { mockLabel: controls.mockLabel.value } : {}), ...(studentId ? { studentId } : {}) }; }
  function draw(data) {
    current = data;
    summary.innerHTML = `<p><strong>${esc(data.className)}</strong> · ${esc(data.academicYear)} · ${esc(data.term)} · ${esc(data.resultType === 'MOCK' ? data.mockLabel : data.resultType === 'MIDTERM' ? 'Midterm' : 'End of Term')}</p><p>Class access: <strong>${esc(data.classBlock?.status ?? 'UNBLOCKED')}</strong> · ${data.eligibleStudents} saved and ready · ${data.publishedStudents} already published · ${data.rosterCount} enrolled</p>`;
    students.innerHTML = `<table class="result-access-table"><thead><tr><th>Student</th><th>Result status</th><th>Parent access</th></tr></thead><tbody>${data.students.map((student) => `<tr><td>${esc(student.name)} (${esc(student.permanentStudentId)})</td><td>${esc(student.resultStatus)}</td><td>${esc(student.block?.status ?? 'UNBLOCKED')}</td></tr>`).join('')}</tbody></table>`;
    actions.replaceChildren();
    const add = (label, fn, disabled = false) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.disabled = disabled; button.addEventListener('click', fn); actions.append(button); };
    const post = async (path, payload, confirmText, success) => {
      if (!window.confirm(confirmText)) return;
      const reason = window.prompt('Enter the reason for this access change:');
      if (!reason?.trim()) { status.textContent = 'A reason is required. No change was made.'; return; }
      status.textContent = 'Saving…';
      try { const result = await json(path, { method: 'POST', body: JSON.stringify({ ...payload, reason: reason.trim() }) }); await load(); status.textContent = `${success} ${result.affectedStudents ?? ''}`; }
      catch (error) { status.textContent = error.message; }
    };
    if (data.capabilities.canPublish) add(`Publish saved results (${data.eligibleStudents})`, () => post('/api/academic/results/publish-class', scope(), `Publish all ${data.eligibleStudents} saved results for ${data.className}, ${data.academicYear}, ${data.term}${data.resultType === 'MOCK' ? `, ${data.mockLabel}` : data.resultType === 'MIDTERM' ? ', Midterm' : ''}?`, 'Publication complete. Results published:'), data.eligibleStudents === 0);
    const affectedCount = data.students.filter((student) => ['SAVED', 'PUBLISHED'].includes(student.resultStatus)).length;
    if (data.capabilities.canBlock && data.classBlock?.status !== 'BLOCKED') add('Block class access', () => post('/api/academic/results/blocks', scope(), `Block Parent Portal access to ${data.className} results for ${data.academicYear}, ${data.term}${data.resultType === 'MOCK' ? `, ${data.mockLabel}` : data.resultType === 'MIDTERM' ? ', Midterm' : ''}? This scope currently has ${affectedCount} saved or published results.`, 'Class access blocked for'));
    if (data.capabilities.canDirectUnblock && data.classBlock?.status === 'BLOCKED') add('Unblock class access', () => post('/api/academic/results/unblock', scope(), `Restore Parent Portal access to ${data.className} results for this scope? This scope currently has ${affectedCount} saved or published results.`, 'Class access restored for'));
    const candidates = data.students.filter((student) => ['SAVED', 'PUBLISHED'].includes(student.resultStatus));
    if (data.capabilities.canBlock && candidates.length) {
      const label = document.createElement('label'); label.textContent = 'Student';
      const select = document.createElement('select'); select.setAttribute('aria-label', 'Student for individual block'); select.innerHTML = '<option value="">Select student</option>' + candidates.map((student) => `<option value="${esc(student.id)}">${esc(student.name)}</option>`).join(''); label.append(select); actions.append(label);
      add('Block selected student', () => { if (!select.value) { status.textContent = 'Select a student first.'; return; } const student = candidates.find((row) => String(row.id) === select.value); post('/api/academic/results/blocks', scope(student.id), `Block Parent Portal access to ${student.name}’s result for this scope?`, 'Student access blocked for'); });
    }
    if (data.capabilities.canDirectUnblock) {
      const blockedStudents = data.students.filter((student) => student.block?.status === 'BLOCKED' && student.block.scope === 'STUDENT');
      if (blockedStudents.length) {
        const label = document.createElement('label'); label.textContent = 'Blocked student';
        const select = document.createElement('select'); select.setAttribute('aria-label', 'Blocked student to unblock'); select.innerHTML = '<option value="">Select blocked student</option>' + blockedStudents.map((student) => `<option value="${esc(student.id)}">${esc(student.name)}</option>`).join(''); label.append(select); actions.append(label);
        add('Unblock selected student', () => { if (!select.value) { status.textContent = 'Select a blocked student first.'; return; } const student = blockedStudents.find((row) => String(row.id) === select.value); post('/api/academic/results/unblock', scope(student.id), `Restore Parent Portal access to ${student.name}’s result for this scope?`, 'Student access restored for'); });
      }
    }
    if (data.capabilities.canRequestUnblock) {
      const blocker = data.students.find((student) => student.block?.status === 'BLOCKED' && student.block.scope === 'STUDENT') ?? (data.classBlock?.status === 'BLOCKED' ? { ...data, id: null } : null);
      if (blocker) add('Request unblock approval', async () => { const reason = window.prompt('Why should access be restored?'); if (!reason?.trim()) return; if (!window.confirm('Submit this unblock request to the Headteacher for review?')) return; status.textContent = 'Saving…'; try { await json('/api/academic/results/unblock-requests', { method: 'POST', body: JSON.stringify({ ...scope(blocker.id), reason: reason.trim() }) }); status.textContent = 'Unblock request submitted for Headteacher review.'; await load(); } catch (error) { status.textContent = error.message; } });
    }
  }
  async function load() {
    if (!controls.academicYear.value || !controls.term.value || !controls.classId.value || mockPage && !controls.mockLabel.value) return;
    status.textContent = 'Loading scope…'; summary.replaceChildren(); students.replaceChildren(); actions.replaceChildren();
    try { const query = new URLSearchParams(scope()); draw(await json(`/api/academic/results/access-management?${query}`)); status.textContent = ''; }
    catch (error) { current = null; status.textContent = error.message; }
  }
  form.addEventListener('submit', (event) => { event.preventDefault(); load(); });
  json('/api/academic/options').then((data) => {
    fill(controls.academicYear, data.academicYears ?? [], 'academic year');
    fill(controls.term, data.terms ?? [], 'term');
    fill(controls.classId, data.classes ?? [], 'class');
    if (mockPage) fill(controls.mockLabel, data.mockTypes ?? [], 'mock examination');
    for (const select of [controls.academicYear, controls.term, controls.classId, ...(mockPage ? [controls.mockLabel] : [controls.resultType])]) select.addEventListener('change', () => { current = null; summary.replaceChildren(); students.replaceChildren(); actions.replaceChildren(); });
    status.textContent = 'Select a complete scope and load it to manage publication and access.';
  }).catch((error) => { status.textContent = error.message; });
})();
