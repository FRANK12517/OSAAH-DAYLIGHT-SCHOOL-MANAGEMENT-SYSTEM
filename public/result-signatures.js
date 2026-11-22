import { processSignatureImage } from './signature-image-processor.js';

const form = document.querySelector('#signature-form');
const mapping = document.querySelector('#mapping-fields');
const host = document.querySelector('#signatures');
const status = document.querySelector('#status');
const role = form.elements.signatoryRole;
const classField = form.elements.classId;
const teacherField = form.elements.teacherId;
const fileField = form.elements.signatureFile;
const preview = document.querySelector('#preview');
const beforePreview = document.querySelector('#before-preview');
const afterPreview = document.querySelector('#after-preview');
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
let options = { classes: [], teachers: [], headteacher: null };
let processed = null;
let beforeUrl = null;

async function api(url, init) {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({ error: 'Request failed.' }));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function activeTeachers() { return Array.isArray(options.teachers) ? options.teachers : []; }

function normalizedClass(value) { return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^basic/, 'primary'); }
function selectedExistingProfile() {
  const year = String(form.elements.academicYear.value ?? '').trim();
  const term = String(form.elements.term.value ?? '').trim();
  const classId = String(classField.value ?? '').trim();
  return (options.signatures ?? []).find((item) => {
    const normalizedRole = String(item.signatoryRole ?? item.role ?? '').toUpperCase().replace(/[ _-]/g, '');
    return normalizedRole.startsWith('CLASSTEACHER')
      && normalizedClass(item.classId) === normalizedClass(classId)
      && String(item.academicYear ?? '') === year
      && String(item.term ?? '') === term
      && item.active !== false;
  }) ?? null;
}

function populateTeachers(preferredId = '') {
  const teachers = activeTeachers();
  const nameCounts = new Map();
  for (const teacher of teachers) nameCounts.set(String(teacher.name ?? '').trim().toLowerCase(), (nameCounts.get(String(teacher.name ?? '').trim().toLowerCase()) ?? 0) + 1);
  const currentId = preferredId || teacherField.value;
  const existingId = selectedExistingProfile()?.teacherId ?? '';
  teacherField.innerHTML = `<option value="">${teachers.length ? 'Select Class Teacher' : 'No registered teachers available'}</option>` + teachers.map((teacher) => {
    const detail = nameCounts.get(String(teacher.name ?? '').trim().toLowerCase()) > 1 && teacher.staffId ? ` · ${teacher.staffId}` : '';
    return `<option value="${esc(teacher.id)}">${esc(teacher.name)}${esc(detail)}</option>`;
  }).join('');
  const target = [currentId, existingId].find((id) => id && teachers.some((teacher) => String(teacher.id) === String(id)));
  teacherField.value = target ? String(target) : '';
  teacherField.disabled = false;
}

function syncRole() {
  const classRole = role.value === 'CLASS_TEACHER';
  mapping.hidden = !classRole;
  for (const name of ['academicYear', 'term', 'classId', 'teacherId']) form.elements[name].required = classRole;
  const selected = classRole ? activeTeachers().find((teacher) => String(teacher.id) === teacherField.value) : null;
  const identity = classRole ? selected : options.headteacher;
  form.elements.fullName.value = identity?.name || '';
  form.elements.phone.value = identity?.phone || '';
  form.elements.fullName.readOnly = classRole;
  form.elements.phone.readOnly = classRole;
}

function fillOptions() {
  const priorClass = classField.value;
  classField.innerHTML = '<option value="">Select Class</option>' + options.classes.map((item) => {
    const id = typeof item === 'string' ? item : item.id;
    const label = typeof item === 'string' ? item : item.name ?? item.id;
    return `<option value="${esc(id)}">${esc(label)}</option>`;
  }).join('');
  if ([...classField.options].some((item) => item.value === priorClass)) classField.value = priorClass;
  populateTeachers(selectedExistingProfile()?.teacherId ?? '');
  syncRole();
}

async function load() {
  host.innerHTML = '<tr><td colspan="6">Loading…</td></tr>';
  teacherField.disabled = true;
  teacherField.innerHTML = '<option value="">Loading registered teachers…</option>';
  try {
    const response = await api('/api/result-signatures');
    options = { ...options, ...(response.options || {}), signatures: response.signatures || [] };
    fillOptions();
    host.innerHTML = (response.signatures || []).map((signature) => {
      const scope = signature.classId ? `${signature.classId} · ${signature.academicYear || ''} · ${signature.term || ''}` : 'School-wide';
      const image = signature.data ? `<img class="signature-thumb" src="${esc(signature.data)}" alt="Processed signature for ${esc(signature.fullName || signature.name)}">` : '—';
      return `<tr><td>${esc(String(signature.signatoryRole || '').replaceAll('_', ' '))}</td><td>${esc(signature.fullName || signature.name || '—')}</td><td>${esc(signature.phone || '—')}</td><td>${esc(scope)}</td><td>${image}</td><td>${signature.active ? 'ACTIVE' : 'INACTIVE'}</td></tr>`;
    }).join('') || '<tr><td colspan="6">No signatures configured.</td></tr>';
    return true;
  } catch (error) {
    teacherField.disabled = true;
    teacherField.innerHTML = '<option value="">Teacher list unavailable</option>';
    host.innerHTML = `<tr><td colspan="6">${esc(error.message)}</td></tr>`;
    throw error;
  }
}

role.addEventListener('change', () => { if (role.value === 'CLASS_TEACHER') populateTeachers(selectedExistingProfile()?.teacherId ?? ''); syncRole(); });
for (const field of [classField, form.elements.academicYear, form.elements.term]) field.addEventListener('change', () => {
  const existing = selectedExistingProfile();
  populateTeachers(existing?.teacherId ?? teacherField.value);
  syncRole();
});
teacherField.addEventListener('change', syncRole);
fileField.addEventListener('change', async () => {
  processed = null;
  preview.hidden = true;
  const file = fileField.files?.[0];
  if (!file) return;
  status.className = 'muted'; status.textContent = 'Processing image…';
  try {
    if (beforeUrl) URL.revokeObjectURL(beforeUrl);
    beforeUrl = URL.createObjectURL(file);
    beforePreview.src = beforeUrl;
    processed = await processSignatureImage(file);
    afterPreview.src = processed.dataUrl;
    preview.hidden = false;
    status.textContent = `Processed ${processed.sourceWidth} × ${processed.sourceHeight} image; preserved proportions and removed the paper background.`;
  } catch (error) {
    fileField.value = '';
    status.className = 'error'; status.textContent = error.message;
  }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  status.className = 'error'; status.textContent = '';
  if (!processed) { status.textContent = 'Upload and preview a signature image first.'; return; }
  const button = form.querySelector('button[type="submit"]'); button.disabled = true;
  try {
    const payload = Object.fromEntries(new FormData(form));
    delete payload.signatureFile;
    payload.mimeType = 'image/png';
    payload.size = Math.floor(processed.dataUrl.length * 3 / 4);
    payload.processedImageData = processed.dataUrl;
    await api('/api/result-signatures', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    status.className = 'success'; status.textContent = 'Signature profile saved.';
    try { await load(); } catch (error) { status.textContent = `Signature profile saved; list refresh failed: ${error.message}`; }
  } catch (error) {
    status.className = 'error'; status.textContent = error.message;
  } finally { button.disabled = false; }
});

load().catch((error) => { status.className = 'error'; status.textContent = error.message; });
