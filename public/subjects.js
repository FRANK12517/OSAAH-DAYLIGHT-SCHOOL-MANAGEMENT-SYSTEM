const DEFAULT_CLASS_ORDER = [
  'Nursery 1', 'Nursery 2', 'KG 1', 'KG 2',
  'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6',
  'JHS 1', 'JHS 2', 'JHS 3'
];
const byId = (id) => document.getElementById(id);
const yearSelect = byId('academic-year');
const classSelect = byId('class-select');
const classSubjects = byId('class-subjects');
const configurationLoadStatus = byId('configuration-load-status');
const configurationStatus = byId('configuration-status');
const configureButton = byId('configure-defaults');
const catalogueHost = byId('subjects');
const catalogueStatus = byId('catalogue-status');
const form = byId('subject-form');
const formStatus = byId('subject-form-status');
let loadSequence = 0;
const busySubjects = new Set();

const esc = (value) => String(value ?? '').replace(/[&<>\'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));

async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const body = await response.json().catch(() => ({ error: `Request failed (${response.status}).` }));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function classOrder(name) {
  const normalized = String(name ?? '').trim().replace(/^Basic\s*([1-6])$/i, 'Primary $1').replace(/^KG\s*([12])$/i, 'KG $1');
  const index = DEFAULT_CLASS_ORDER.indexOf(normalized);
  return index < 0 ? DEFAULT_CLASS_ORDER.length : index;
}

function renderSubjectRows(subjects) {
  if (!subjects.length) {
    classSubjects.innerHTML = '<tr><td colspan="6">No subjects are configured for this class and academic year. Synchronize approved defaults or assign a subject to begin.</td></tr>';
    return;
  }
  classSubjects.innerHTML = subjects.map((subject) => {
    const active = subject.active === true;
    const mandatory = subject.mandatory === true;
    const action = active && mandatory
      ? '<span class="muted">Required</span>'
      : `<button class="text-button" type="button" data-toggle-subject="${esc(subject.id)}" data-active="${active ? 'true' : 'false'}" ${busySubjects.has(subject.id) ? 'disabled' : ''}>${active ? 'Deactivate for this year' : subject.assigned === false ? 'Add for this year' : 'Activate for this year'}</button>`;
    const classification = String(subject.subjectType ?? 'ELECTIVE').toUpperCase();
    const activeLabel = active ? 'Active' : subject.assigned === false ? 'Not assigned' : 'Inactive';
    return `<tr>
      <td><strong>${esc(subject.name)}</strong><br><small>${esc(subject.code ?? '')}</small></td>
      <td>${esc(classification.replaceAll('_', ' '))}</td>
      <td>${mandatory ? 'Yes' : subject.optional ? 'Optional' : 'No'}</td>
      <td>${subject.isScoring === false || Number(subject.isScoring) === 0 ? 'Non-scoring' : 'Scoring'}</td>
      <td>${activeLabel}</td>
      <td>${action}</td>
    </tr>`;
  }).join('');
}

async function loadConfiguration({ savedMessage = '' } = {}) {
  const sequence = ++loadSequence;
  const yearId = yearSelect.value;
  const classId = classSelect.value;
  if (!yearId || !classId) {
    classSubjects.innerHTML = '<tr><td colspan="6">Choose an academic year and class.</td></tr>';
    configurationLoadStatus.textContent = 'Choose an academic year and class.';
    return;
  }
  classSubjects.innerHTML = '<tr><td colspan="6">Loading class subjects…</td></tr>';
  configurationLoadStatus.textContent = 'Loading subjects from the school server…';
  try {
    const query = new URLSearchParams({ academicYearId: yearId, classId });
    const result = await api(`/api/subjects/configuration?${query}`);
    if (sequence !== loadSequence) return;
    if (!Array.isArray(result.subjects)) throw new Error('The server returned an invalid subject configuration.');
    renderSubjectRows(result.subjects);
    configurationLoadStatus.textContent = savedMessage || `${result.subjects.length} subject${result.subjects.length === 1 ? '' : 's'} loaded for ${result.className} · ${result.academicYear}.`;
  } catch (error) {
    if (sequence !== loadSequence) return;
    classSubjects.innerHTML = `<tr><td colspan="6">Unable to load this configuration: ${esc(error.message)}</td></tr>`;
    configurationLoadStatus.textContent = 'Subject configuration could not be loaded. Check your access or try again.';
  }
}

async function loadCatalogue() {
  catalogueStatus.textContent = 'Loading subjects from the school server…';
  catalogueHost.innerHTML = '<tr><td colspan="5">Loading subjects…</td></tr>';
  try {
    const result = await api('/api/subjects?includeInactive=true');
    const subjects = Array.isArray(result.subjects) ? result.subjects : [];
    catalogueHost.innerHTML = subjects.map((subject) => `<tr>
      <td>${esc(subject.code)}</td><td>${esc(subject.name)}</td>
      <td>${esc((subject.classNames ?? subject.classIds ?? []).join(', '))}</td>
      <td>${subject.active === false ? 'INACTIVE' : 'ACTIVE'}</td>
      <td>${subject.active === false ? 'Archived' : `<button class="text-button" type="button" data-deactivate-subject="${esc(subject.id)}">Deactivate</button>`}</td>
    </tr>`).join('') || '<tr><td colspan="5">No subject records found.</td></tr>';
    catalogueStatus.textContent = `${subjects.length} subject record${subjects.length === 1 ? '' : 's'} loaded.`;
  } catch (error) {
    catalogueHost.innerHTML = `<tr><td colspan="5">Unable to load the catalogue: ${esc(error.message)}</td></tr>`;
    catalogueStatus.textContent = 'The catalogue is unavailable. No local or memory-only data was substituted.';
  }
}

async function loadOptions() {
  yearSelect.disabled = true;
  classSelect.disabled = true;
  try {
    const options = await api('/api/academic/options');
    const years = Array.isArray(options.academicYears) ? options.academicYears : [];
    const classes = (Array.isArray(options.classes) ? options.classes : []).slice().sort((left, right) => classOrder(left.name) - classOrder(right.name) || String(left.name).localeCompare(String(right.name)));
    yearSelect.innerHTML = '<option value="">Select an academic year</option>' + years.map((year) => `<option value="${esc(year.id)}">${esc(year.name)}${Number(year.isCurrent) === 1 ? ' (current)' : ''}</option>`).join('');
    classSelect.innerHTML = '<option value="">Select one class</option>' + classes.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
    const currentYear = years.find((year) => Number(year.isCurrent) === 1);
    if (currentYear) yearSelect.value = currentYear.id;
    if (classes.length) classSelect.value = classes[0].id;
    if (!years.length || !classes.length) {
      classSubjects.innerHTML = `<tr><td colspan="6">${!years.length ? 'No academic years are available for this school.' : 'No classes are assigned to this account.'}</td></tr>`;
      configurationLoadStatus.textContent = 'Academic-year and class options are required before subject configuration can be loaded.';
      return;
    }
    await loadConfiguration();
  } catch (error) {
    yearSelect.innerHTML = '<option value="">Academic years unavailable</option>';
    classSelect.innerHTML = '<option value="">Classes unavailable</option>';
    classSubjects.innerHTML = `<tr><td colspan="6">Unable to load academic options: ${esc(error.message)}</td></tr>`;
    configurationLoadStatus.textContent = 'Academic options could not be loaded. Please retry after access or connectivity is restored.';
  } finally {
    yearSelect.disabled = false;
    classSelect.disabled = false;
  }
}

yearSelect.addEventListener('change', () => loadConfiguration());
classSelect.addEventListener('change', () => loadConfiguration());

classSubjects.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-toggle-subject]');
  if (!button) return;
  const subjectId = button.dataset.toggleSubject;
  const wasActive = button.dataset.active === 'true';
  const yearId = yearSelect.value;
  const classId = classSelect.value;
  if (!subjectId || !yearId || !classId || busySubjects.has(subjectId)) return;
  busySubjects.add(subjectId);
  button.disabled = true;
  configurationLoadStatus.textContent = 'Saving the class assignment…';
  try {
    if (wasActive) {
      const query = new URLSearchParams({ classId, academicYearId: yearId });
      await api(`/api/subjects/${encodeURIComponent(subjectId)}/assignments?${query}`, { method: 'DELETE' });
    } else {
      await api(`/api/subjects/${encodeURIComponent(subjectId)}/assignments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId, academicYearId: yearId })
      });
    }
    busySubjects.delete(subjectId);
    await loadConfiguration({ savedMessage: 'Saved and confirmed by the school server.' });
  } catch (error) {
    configurationLoadStatus.textContent = `Save failed; no success was reported. ${error.message}`;
  } finally {
    busySubjects.delete(subjectId);
  }
});

configureButton.addEventListener('click', async () => {
  configureButton.disabled = true;
  configurationStatus.textContent = 'Synchronizing approved defaults with the server…';
  try {
    const result = await api('/api/subjects/configure-defaults', { method: 'POST' });
    configurationStatus.textContent = `Server confirmed configuration v${result.configurationVersion}: ${result.classesConfigured} classes, ${result.subjectsCreated} subjects created, ${result.assignmentsCreated} assignments created, ${result.mandatoryAssignmentsRestored} mandatory assignments restored. Baseline: ${result.expectedBaseline?.assignmentSlots ?? 105} class-subject slots across ${result.expectedBaseline?.distinctSubjectNames ?? 18} subject names. Nursery preserved.`;
    await Promise.all([loadConfiguration(), loadCatalogue()]);
  } catch (error) {
    configurationStatus.textContent = `Synchronization failed; no success was reported. ${error.message}`;
  } finally {
    configureButton.disabled = false;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  formStatus.textContent = 'Saving subject record…';
  try {
    await api('/api/subjects', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    form.reset();
    formStatus.textContent = 'Subject record saved by the server.';
    await loadCatalogue();
  } catch (error) {
    formStatus.textContent = `Save failed; no success was reported. ${error.message}`;
  } finally {
    submit.disabled = false;
  }
});

catalogueHost.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-deactivate-subject]');
  if (!button) return;
  button.disabled = true;
  catalogueStatus.textContent = 'Saving subject status…';
  try {
    await api(`/api/subjects/${encodeURIComponent(button.dataset.deactivateSubject)}/deactivate`, { method: 'POST' });
    catalogueStatus.textContent = 'Deactivation saved by the server.';
    await Promise.all([loadCatalogue(), loadConfiguration()]);
  } catch (error) {
    catalogueStatus.textContent = `Deactivation failed; no success was reported. ${error.message}`;
    button.disabled = false;
  }
});

loadOptions();
loadCatalogue();
