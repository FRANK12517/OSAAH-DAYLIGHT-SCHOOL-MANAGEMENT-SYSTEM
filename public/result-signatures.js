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

function activeTeachers() {
  const selectedClass = classField.value;
  return options.teachers.filter((teacher) => !teacher.classIds?.length || teacher.classIds.some((id) => String(id) === String(selectedClass)));
}

function syncRole() {
  const classRole = role.value === 'CLASS_TEACHER';
  mapping.hidden = !classRole;
  for (const name of ['academicYear', 'term', 'classId', 'teacherId']) form.elements[name].required = classRole;
  const candidates = classRole ? activeTeachers() : [];
  const selected = candidates.find((teacher) => String(teacher.id) === teacherField.value) ?? candidates[0];
  if (classRole && teacherField.value !== String(selected?.id ?? '')) teacherField.value = String(selected?.id ?? '');
  const identity = classRole ? selected : options.headteacher;
  form.elements.fullName.value = identity?.name || '';
  form.elements.phone.value = identity?.phone || '';
}

function fillOptions() {
  const priorClass = classField.value;
  classField.innerHTML = options.classes.map((item) => {
    const id = typeof item === 'string' ? item : item.id;
    const label = typeof item === 'string' ? item : item.name ?? item.id;
    return `<option value="${esc(id)}">${esc(label)}</option>`;
  }).join('');
  if ([...classField.options].some((item) => item.value === priorClass)) classField.value = priorClass;
  teacherField.innerHTML = activeTeachers().map((teacher) => `<option value="${esc(teacher.id)}">${esc(teacher.name)}${teacher.phone ? ` · ${esc(teacher.phone)}` : ''}</option>`).join('');
  syncRole();
}

async function load() {
  const response = await api('/api/result-signatures');
  options = response.options || options;
  fillOptions();
  host.innerHTML = (response.signatures || []).map((signature) => {
    const scope = signature.classId ? `${signature.classId} · ${signature.academicYear || ''} · ${signature.term || ''}` : 'School-wide';
    const image = signature.data ? `<img class="signature-thumb" src="${esc(signature.data)}" alt="Processed signature for ${esc(signature.fullName || signature.name)}">` : '—';
    return `<tr><td>${esc(String(signature.signatoryRole || '').replaceAll('_', ' '))}</td><td>${esc(signature.fullName || signature.name || '—')}</td><td>${esc(signature.phone || '—')}</td><td>${esc(scope)}</td><td>${image}</td><td>${signature.active ? 'ACTIVE' : 'INACTIVE'}</td></tr>`;
  }).join('') || '<tr><td colspan="6">No signatures configured.</td></tr>';
}

role.addEventListener('change', syncRole);
classField.addEventListener('change', () => { teacherField.innerHTML = activeTeachers().map((teacher) => `<option value="${esc(teacher.id)}">${esc(teacher.name)}${teacher.phone ? ` · ${esc(teacher.phone)}` : ''}</option>`).join(''); syncRole(); });
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
    await load();
    status.className = 'success'; status.textContent = 'Signature profile saved.';
  } catch (error) {
    status.className = 'error'; status.textContent = error.message;
  } finally { button.disabled = false; }
});

load().catch((error) => { status.className = 'error'; status.textContent = error.message; });
