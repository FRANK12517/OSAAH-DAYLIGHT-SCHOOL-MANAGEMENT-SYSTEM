const form = document.querySelector('#internal-registration-form');
const status = document.querySelector('#registration-status');
const success = document.querySelector('#registration-success');
const idOutput = document.querySelector('#permanent-student-id');
const idHelp = document.querySelector('#student-id-help');
const submitButton = form.querySelector('#submit-registration');
const generateButton = form.querySelector('#generate-student-id');
const categoryField = form.elements.admissionType;
const existingIdField = form.elements.existingPermanentStudentId;
const existingIdError = document.querySelector('#existing-id-error');
const existingStudentIdField = form.elements.existingStudentId;
const identificationChoice = form.elements.existingIdChoice;
const existingStudentMatch = document.querySelector('#existing-student-match');
const classField = form.elements.classId;
const yearField = form.elements.academicYearId;
const termField = form.elements.termId;
const draftStatus = document.querySelector('#registration-draft-status');
let draftKey = null;
const defaultAcademicYear = '2026/2027';
let classes = [];
let terms = [];
let saving = false;
let completed = false;
let restoringDraft = false;
let registeredStudentId = null;

function setStatus(message, kind = '') {
  status.textContent = message;
  status.classList.toggle('status-error', kind === 'error');
  status.classList.toggle('status-success', kind === 'success');
  if (message) {
    status.scrollIntoView({ block: 'nearest' });
    status.focus({ preventScroll: true });
  }
}

function setExistingIdError(message = '') {
  existingIdError.textContent = message;
  existingIdError.hidden = !message;
  if (message) existingIdField.setAttribute('aria-invalid', 'true');
  else existingIdField.removeAttribute('aria-invalid');
}

function saveDraft() {
  if (restoringDraft || !draftKey) return;
  try {
    if (completed && registeredStudentId) {
      const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
      if (saved?.data) localStorage.setItem(draftKey, JSON.stringify({ ...saved, registeredStudentId, updatedAt: new Date().toISOString() }));
      return;
    }
    const data = Object.fromEntries(new FormData(form).entries());
    localStorage.setItem(draftKey, JSON.stringify({ version: 2, savedAt: new Date().toISOString(), registeredStudentId, data }));
    draftStatus.textContent = 'Draft saved on this device.';
  } catch { draftStatus.textContent = 'Draft could not be saved on this device.'; }
}

function restoreDraft() {
  if (!draftKey) return;
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
    if (![1, 2].includes(saved?.version) || !saved.data || typeof saved.data !== 'object') return;
    restoringDraft = true;
    if (saved.data.admissionType) categoryField.value = saved.data.admissionType;
    const savedIdChoice = ['NO_ID', 'HAVE_ID'].includes(saved.data.existingIdChoice) ? saved.data.existingIdChoice : 'NO_ID';
    [...identificationChoice].forEach((item) => { item.checked = item.value === savedIdChoice; });
    syncCategory();
    for (const [name, value] of Object.entries(saved.data)) {
      if (name === 'existingIdChoice') continue;
      const field = form.elements.namedItem(name);
      if (field && 'value' in field) field.value = String(value ?? '');
    }
    registeredStudentId = saved.registeredStudentId ?? null;
    form.elements.registrationToken.value ||= saved.data.registrationToken ?? '';
    if (!registeredStudentId) form.elements.resolvedPermanentStudentId.value = '';
    if (identificationChoice.value === 'HAVE_ID' && form.elements.existingStudentId.value) {
      existingStudentMatch.textContent = 'Recovered existing student selection. Verify the student identity before submitting.';
      existingStudentMatch.hidden = false;
    }
    updateAge();
    draftStatus.textContent = registeredStudentId ? 'Recovered a saved registration. Checking its database status…' : 'Recovered an incomplete registration draft from this device.';
    if (registeredStudentId) void recoverRegisteredStudent();
  } catch { draftStatus.textContent = 'A saved draft could not be restored.'; }
  finally { restoringDraft = false; }
}

async function request(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try { response = await fetch(url, { credentials: 'same-origin', ...options, signal: controller.signal }); }
  catch (error) { if (error.name === 'AbortError') throw new Error('The request timed out. Check your connection and retry.'); throw error; }
  finally { clearTimeout(timeout); }
  const responseText = await response.text();
  let result = {};
  try { result = responseText ? JSON.parse(responseText) : {}; } catch { /* Keep the HTTP status for non-JSON server responses. */ }
  if (!response.ok) throw new Error(result.error ?? result.message ?? `Request failed (HTTP ${response.status}).`);
  return result;
}

function showRegistrationSaved(student, className, idStatus = student.permanentStudentId ? 'EXISTING' : 'PENDING_GENERATION', found = false) {
  const fullStudentName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');
  success.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent = 'Submitted Successfully';
  const detail = document.createElement('p'); detail.textContent = found ? `${fullStudentName || 'Student'} matched an existing school record.` : `${fullStudentName || 'Student'} is saved in the school database.`;
  const placement = document.createElement('p'); placement.textContent = student.permanentStudentId ? `Permanent Student ID: ${student.permanentStudentId}.` : className ? `Class placement: ${className}. Generate the permanent ID to complete registration.` : 'Generate the permanent ID to complete registration.';
  success.append(heading, detail, placement);
  success.hidden = false;
  completed = true;
  registeredStudentId = student.studentId ?? student.id ?? registeredStudentId;
  if (idStatus === 'EXISTING' && student.permanentStudentId) {
    form.elements.resolvedPermanentStudentId.value = student.permanentStudentId;
    idOutput.textContent = `Permanent Student ID: ${student.permanentStudentId}`;
    idOutput.hidden = false;
    submitButton.disabled = true;
    submitButton.textContent = 'Submit';
    generateButton.disabled = true;
    generateButton.textContent = 'Permanent Student ID Assigned';
    idHelp.hidden = true;
  } else {
    idOutput.textContent = '';
    idOutput.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Submit';
    generateButton.disabled = false;
    generateButton.textContent = 'Generate Permanent Student ID';
    idHelp.hidden = true;
  }
  setStatus('✅ Submitted successfully', 'success');
  saveDraft();
  form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = true; });
}

async function recoverRegisteredStudent() {
  try {
    const student = await request(`/api/internal-student-registration/student-id?studentId=${encodeURIComponent(registeredStudentId)}`);
    showRegistrationSaved(student, null, student.permanentStudentId ? 'EXISTING' : 'PENDING_GENERATION', true);
    draftStatus.textContent = 'Submitted Successfully. Registration confirmed in the school database.';
    setStatus('✅ Submitted successfully', 'success');
  } catch (error) {
    registeredStudentId = null;
    completed = false;
    generateButton.disabled = true;
    generateButton.textContent = 'Generate Permanent Student ID';
    submitButton.disabled = false;
    submitButton.textContent = 'Submit';
    draftStatus.textContent = `Saved registration could not be confirmed: ${error.message}`;
    setStatus(`Saved registration could not be confirmed: ${error.message}. Retry the submission; its saved registration token prevents duplicate student creation.`, 'error');
  }
}

async function generatePermanentStudentId() {
  if (saving || !completed || !registeredStudentId || form.elements.resolvedPermanentStudentId.value) return;
  saving = true;
  generateButton.disabled = true;
  generateButton.textContent = 'Generating Permanent ID...';
  form.setAttribute('aria-busy', 'true');
  setStatus('Registration is saved. Generating its Permanent Student ID...');
  idHelp.textContent = 'Generating Permanent Student ID...';
  try {
    const result = await request('/api/internal-student-registration/student-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentId: registeredStudentId }) });
    if (!result.permanentStudentId) throw new Error('The database did not confirm a Permanent Student ID. Retry using this button.');
    form.elements.resolvedPermanentStudentId.value = result.permanentStudentId;
    idOutput.textContent = `Permanent Student ID: ${result.permanentStudentId}`;
    idOutput.hidden = false;
    success.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = 'Submitted Successfully';
    const detail = document.createElement('p'); detail.textContent = 'Registration and Permanent Student ID are confirmed in the school database.';
    const placement = document.createElement('p'); placement.textContent = `Permanent Student ID: ${result.permanentStudentId}.`;
    success.append(heading, detail, placement);
    success.hidden = false;
    setStatus(`Permanent Student ID ${result.permanentStudentId} is saved to this student record.`, 'success');
    submitButton.textContent = 'Submit';
    generateButton.textContent = 'Registration Complete';
    idHelp.hidden = true;
    saveDraft();
  } catch (error) {
    setStatus(error.message, 'error');
    idOutput.hidden = true;
    generateButton.disabled = false;
    generateButton.textContent = 'Retry Permanent ID Generation';
    idHelp.hidden = false;
    idHelp.textContent = 'Registration is saved. Permanent Student ID generation failed. Use the button to retry.';
  } finally {
    saving = false;
    generateButton.disabled = Boolean(form.elements.resolvedPermanentStudentId.value);
    form.removeAttribute('aria-busy');
  }
}

function syncCategory() {
  const existing = categoryField.value === 'ALREADY_ENROLLED';
  const transfer = categoryField.value === 'TRANSFER';
  document.querySelectorAll('[data-existing-field]').forEach((element) => { element.hidden = !existing; });
  document.querySelectorAll('[data-existing-id-entry]').forEach((element) => { element.hidden = !existing || identificationChoice.value !== 'HAVE_ID'; });
  document.querySelectorAll('[data-existing-no-id]').forEach((element) => { element.hidden = !existing || identificationChoice.value !== 'NO_ID'; });
  document.querySelectorAll('[data-transfer-field]').forEach((element) => { element.hidden = !transfer; });
  existingIdField.required = existing && identificationChoice.value === 'HAVE_ID';
  setExistingIdError('');
  form.elements.previousSchool.required = transfer;
  form.elements.resolvedPermanentStudentId.value = '';
  existingIdField.value = '';
  existingStudentIdField.value = '';
  existingStudentMatch.hidden = true;
  existingStudentMatch.textContent = '';
  registeredStudentId = null;
  idOutput.textContent = '';
  idOutput.hidden = true;
  submitButton.disabled = false;
  submitButton.textContent = 'Submit';
  generateButton.disabled = true;
  generateButton.textContent = 'Generate Permanent Student ID';
  idHelp.hidden = false;
  idHelp.textContent = 'Submit and save registration first.';
}

function syncExistingIdChoice() {
  document.querySelectorAll('[data-existing-id-entry]').forEach((element) => { element.hidden = categoryField.value !== 'ALREADY_ENROLLED' || identificationChoice.value !== 'HAVE_ID'; });
  document.querySelectorAll('[data-existing-no-id]').forEach((element) => { element.hidden = categoryField.value !== 'ALREADY_ENROLLED' || identificationChoice.value !== 'NO_ID'; });
  existingIdField.required = categoryField.value === 'ALREADY_ENROLLED' && identificationChoice.value === 'HAVE_ID';
  setExistingIdError('');
  status.textContent = '';
  status.classList.remove('status-error', 'status-success');
  form.elements.resolvedPermanentStudentId.value = '';
  existingIdField.value = '';
  existingStudentIdField.value = '';
  existingStudentMatch.hidden = true;
  existingStudentMatch.textContent = '';
  idOutput.textContent = '';
  idOutput.hidden = true;
  submitButton.disabled = false;
  submitButton.textContent = 'Submit';
  generateButton.disabled = true;
  generateButton.textContent = 'Generate Permanent Student ID';
  idHelp.hidden = false;
  idHelp.textContent = 'Submit and save registration first.';
}

function updateAge() {
  const raw = form.elements.dateOfBirth.value;
  if (!raw) { form.elements.age.value = ''; return; }
  const birth = new Date(`${raw}T00:00:00`), today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate()) age -= 1;
  form.elements.age.value = age >= 0 ? String(age) : '';
}

async function loadOptions() {
  try {
    const options = await request('/api/admission-workflow/options');
    try {
      const session = await request('/api/sidebar');
      if (session.user?.id) draftKey = `osaah.internal-registration.draft.v1.${encodeURIComponent(session.user.id)}`;
    } catch { draftStatus.textContent = 'Draft recovery is unavailable until your staff session can be verified.'; }
    classes = options.classes ?? [];
    classField.replaceChildren(new Option('Select class', ''));
    for (const item of classes) classField.add(new Option(item.name, item.id));
    const years = options.academicYears ?? [];
    terms = options.terms ?? [];
    const savedYear = yearField.value;
    yearField.replaceChildren(new Option('Select academic year', ''));
    for (const item of years) yearField.add(new Option(item.name ?? item.id, item.id));
    const year2026 = years.find((item) => item.name === defaultAcademicYear || item.id === defaultAcademicYear);
    const current = years.find((item) => item.isCurrent === true || item.isCurrent === 1);
    yearField.value = [savedYear, year2026?.id, current?.id].find((id) => id && years.some((item) => String(item.id) === String(id))) ?? '';
    const refreshTerms = () => {
      const priorTerm = termField.value;
      const yearTerms = terms.filter((term) => String(term.academicYearId ?? '') === String(yearField.value));
      termField.replaceChildren(new Option(yearField.value ? 'No terms configured for this academic year' : 'Select academic year first', ''));
      for (const canonical of ['1st Term', '2nd Term', '3rd Term']) {
        const configured = yearTerms.find((term) => normalizeTerm(term.name) === canonical);
        if (configured) termField.add(new Option(canonical, configured.id));
      }
      if (yearTerms.length) termField.value = yearTerms.some((term) => String(term.id) === String(priorTerm)) ? priorTerm : yearTerms.find((term) => term.isCurrent === true || term.isCurrent === 1)?.id ?? '';
    };
    yearField.onchange = () => { refreshTerms(); saveDraft(); };
    refreshTerms();
    if (!classes.length) setStatus('No active school classes are available. Ask an administrator to check the class setup.', 'error');
    restoreDraft();
    refreshTerms();
  } catch (error) { setStatus(`Unable to load school classes and academic periods: ${error.message}`, 'error'); }
}

function normalizeTerm(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ({ '1st term': '1st Term', 'first term': '1st Term', 'term 1': '1st Term', '2nd term': '2nd Term', 'second term': '2nd Term', 'term 2': '2nd Term', '3rd term': '3rd Term', 'third term': '3rd Term', 'term 3': '3rd Term' })[normalized] ?? normalized;
}

categoryField.addEventListener('change', () => { if (!completed) syncCategory(); });
identificationChoice.forEach((radio) => radio.addEventListener('change', () => { if (!completed) syncExistingIdChoice(); }));
form.elements.dateOfBirth.addEventListener('change', updateAge);
existingIdField.addEventListener('input', () => { if (existingIdField.value.trim()) setExistingIdError(''); });
form.addEventListener('input', saveDraft);
form.addEventListener('change', saveDraft);

document.querySelector('#reset-registration-form').addEventListener('click', () => {
  if (saving) return;
  completed = false;
  registeredStudentId = null;
  form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = false; });
  form.reset();
  setStatus('');
  setExistingIdError('');
  success.replaceChildren();
  success.hidden = true;
  form.elements.registrationToken.value = '';
  form.elements.resolvedPermanentStudentId.value = '';
  existingStudentIdField.value = '';
  if (draftKey) localStorage.removeItem(draftKey);
  idOutput.textContent = '';
  idOutput.hidden = true;
  submitButton.disabled = false;
  submitButton.textContent = 'Submit';
  generateButton.disabled = true;
  generateButton.textContent = 'Generate Permanent Student ID';
  idHelp.hidden = false;
  idHelp.textContent = 'Submit and save registration first.';
  syncCategory();
  updateAge();
  loadOptions();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  if (completed) {
    setStatus('Registration is already saved. Use Generate Permanent Student ID to continue.');
    return;
  }
  setStatus('');
  success.hidden = true;
  if (categoryField.value === 'ALREADY_ENROLLED' && identificationChoice.value === 'HAVE_ID' && !existingIdField.value.trim()) {
    const message = 'Enter the existing Student ID before submitting.';
    setExistingIdError(message);
    setStatus(message, 'error');
    return;
  }
  if (!form.reportValidity()) {
    const invalid = form.querySelector(':invalid');
    const label = invalid?.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') ?? 'Form';
    setStatus(`${label}: ${invalid?.validationMessage || 'Please correct this field before submitting.'}`, 'error');
    return;
  }
  if (!['FIRST_TIME', 'TRANSFER', 'ALREADY_ENROLLED'].includes(categoryField.value)) { setStatus('Select an admission category.', 'error'); return; }
  if (!yearField.value || !termField.value) { setStatus('Select an academic year and one valid term before submitting.', 'error'); return; }

  const fullName = form.elements.fullName.value.trim().replace(/\s+/g, ' ');
  const nameParts = fullName.split(' ');
  if (nameParts.length < 2) { setStatus('Enter the pupil’s first and last name.', 'error'); return; }
  const data = new FormData(form);
  const payload = Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value).trim() || null]));
  const suppliedId = categoryField.value === 'ALREADY_ENROLLED' && identificationChoice.value === 'HAVE_ID' ? existingIdField.value.trim() : null;
  Object.assign(payload, {
    firstName: nameParts[0], middleName: nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '', lastName: nameParts.at(-1),
    existingPermanentStudentId: suppliedId,
    existingStudentId: categoryField.value === 'ALREADY_ENROLLED' && identificationChoice.value === 'HAVE_ID' ? existingStudentIdField.value || null : null,
    existingIdChoice: identificationChoice.value
  });

  saving = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Submitting…';
  form.setAttribute('aria-busy', 'true');
  if (categoryField.value === 'ALREADY_ENROLLED' && identificationChoice.value === 'HAVE_ID') {
    try {
      const match = await request('/api/internal-student-registration/existing-student', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permanentStudentId: suppliedId }) });
      if (match.found) {
        const matchedStudentId = match.student?.id ?? match.student?.studentId;
        if (!matchedStudentId) throw new Error('The existing student lookup returned no student record ID. Please retry.');
        payload.existingStudentId = matchedStudentId;
        existingStudentIdField.value = matchedStudentId;
        existingStudentMatch.textContent = `Matched existing student: ${[match.student.firstName, match.student.middleName, match.student.lastName].filter(Boolean).join(' ')} · ID ${match.student.permanentStudentId ?? suppliedId}.`;
        existingStudentMatch.hidden = false;
      } else {
        payload.existingStudentId = null;
        existingStudentMatch.hidden = true;
        existingStudentMatch.textContent = '';
      }
    } catch (error) {
      saving = false;
      submitButton.disabled = false;
      submitButton.textContent = 'Submit';
      form.removeAttribute('aria-busy');
      setStatus(error.message, 'error');
      return;
    }
  }
  if (categoryField.value !== 'ALREADY_ENROLLED' && !form.elements.registrationToken.value) form.elements.registrationToken.value = crypto.randomUUID();
  payload.registrationToken = form.elements.registrationToken.value;
  saveDraft();
  setStatus('Saving the student profile, health details, parent contact, and class assignment…');
  try {
    const result = await request('/api/internal-student-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const student = result.student && typeof result.student === 'object' ? result.student : {};
    registeredStudentId = student.id ?? student.studentId ?? result.studentId ?? null;
    if (!registeredStudentId) throw new Error('The server returned success without a saved student record or ID. The registration has not been confirmed; check with an administrator before retrying.');
    if (result.success !== true || !['PENDING_GENERATION', 'EXISTING'].includes(result.idStatus)) throw new Error('The server did not confirm a completed registration. Please retry.');
    const permanentStudentId = result.permanentStudentId ?? student.permanentStudentId ?? null;
    if ((result.idStatus === 'EXISTING') !== Boolean(permanentStudentId)) throw new Error('The server returned inconsistent permanent ID status. Ask an administrator to review the saved record.');
    showRegistrationSaved({ ...student, id: registeredStudentId, studentId: registeredStudentId, permanentStudentId }, result.className, result.idStatus, result.found === true);
  } catch (error) {
    completed = false;
    registeredStudentId = null;
    generateButton.disabled = true;
    setStatus(error.message || 'The registration could not be submitted. Please retry.', 'error');
  }
  finally {
    saving = false;
    submitButton.disabled = completed;
    submitButton.textContent = 'Submit';
    form.removeAttribute('aria-busy');
  }
});

generateButton.addEventListener('click', () => { void generatePermanentStudentId(); });

syncCategory();
loadOptions();
