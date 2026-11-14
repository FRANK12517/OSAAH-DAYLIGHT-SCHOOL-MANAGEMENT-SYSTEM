const form = document.querySelector('#internal-registration-form');
const status = document.querySelector('#registration-status');
const success = document.querySelector('#registration-success');
const idOutput = document.querySelector('#permanent-student-id');
const idHelp = document.querySelector('#student-id-help');
const submitButton = form.querySelector('#submit-registration');
const generateButton = form.querySelector('#generate-student-id');
const categoryField = form.elements.admissionType;
const existingIdField = form.elements.existingPermanentStudentId;
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
    if (saved.data.existingIdChoice) [...identificationChoice].forEach((item) => { item.checked = item.value === saved.data.existingIdChoice; });
    syncCategory();
    for (const [name, value] of Object.entries(saved.data)) {
      if (name === 'existingIdChoice') continue;
      const field = form.elements.namedItem(name);
      if (field && 'value' in field) field.value = String(value ?? '');
    }
    registeredStudentId = saved.registeredStudentId ?? null;
    form.elements.registrationToken.value ||= saved.data.registrationToken ?? '';
    if (!registeredStudentId) form.elements.resolvedPermanentStudentId.value = '';
    if (form.elements.existingStudentId.value) {
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
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'The request could not be completed.');
  return result;
}

function showRegistrationSaved(student, className) {
  const fullStudentName = [student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ');
  success.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent = 'Submitted Successfully';
  const detail = document.createElement('p'); detail.textContent = `${fullStudentName || 'Student'} is saved in the school database.`;
  const placement = document.createElement('p'); placement.textContent = student.permanentStudentId ? `Permanent Student ID: ${student.permanentStudentId}.` : className ? `Class placement: ${className}. Generate the permanent ID to complete registration.` : 'Generate the permanent ID to complete registration.';
  success.append(heading, detail, placement);
  success.hidden = false;
  completed = true;
  registeredStudentId = student.studentId ?? student.id ?? registeredStudentId;
  if (student.permanentStudentId) {
    form.elements.resolvedPermanentStudentId.value = student.permanentStudentId;
    idOutput.textContent = `Permanent Student ID: ${student.permanentStudentId}`;
    idOutput.hidden = false;
    submitButton.disabled = true;
    submitButton.textContent = 'Registration Saved';
    generateButton.disabled = true;
    generateButton.textContent = 'Permanent Student ID Assigned';
    idHelp.hidden = true;
  } else {
    idOutput.textContent = '';
    idOutput.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = 'Registration Saved';
    generateButton.disabled = false;
    generateButton.textContent = 'Generate Permanent Student ID';
    idHelp.textContent = 'Registration saved. Generate the Permanent Student ID.';
    idHelp.hidden = false;
  }
  saveDraft();
  form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = true; });
}

async function recoverRegisteredStudent() {
  try {
    const student = await request(`/api/internal-student-registration/student-id?studentId=${encodeURIComponent(registeredStudentId)}`);
    showRegistrationSaved(student, null);
    draftStatus.textContent = 'Submitted Successfully. Registration confirmed in the school database.';
    status.textContent = '';
  } catch (error) {
    registeredStudentId = null;
    completed = false;
    generateButton.disabled = true;
    generateButton.textContent = 'Generate Permanent Student ID';
    submitButton.disabled = false;
    submitButton.textContent = 'Submit Registered Student';
    draftStatus.textContent = `Saved registration could not be confirmed: ${error.message}`;
    status.textContent = 'Retry the registration submission. The saved registration token prevents duplicate student creation.';
  }
}

async function generatePermanentStudentId() {
  if (saving || !completed || !registeredStudentId || form.elements.resolvedPermanentStudentId.value) return;
  saving = true;
  generateButton.disabled = true;
  generateButton.textContent = 'Generating Permanent ID...';
  form.setAttribute('aria-busy', 'true');
  status.textContent = 'Registration is saved. Generating its Permanent Student ID...';
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
    status.textContent = `Permanent Student ID ${result.permanentStudentId} is saved to this student record.`;
    submitButton.textContent = 'Registration Saved';
    generateButton.textContent = 'Registration Complete';
    idHelp.hidden = true;
    saveDraft();
  } catch (error) {
    status.textContent = error.message;
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
  submitButton.textContent = 'Submit Registered Student';
  generateButton.disabled = true;
  generateButton.textContent = 'Generate Permanent Student ID';
  idHelp.hidden = false;
  idHelp.textContent = 'Submit and save registration first.';
}

function syncExistingIdChoice() {
  document.querySelectorAll('[data-existing-id-entry]').forEach((element) => { element.hidden = categoryField.value !== 'ALREADY_ENROLLED' || identificationChoice.value !== 'HAVE_ID'; });
  document.querySelectorAll('[data-existing-no-id]').forEach((element) => { element.hidden = categoryField.value !== 'ALREADY_ENROLLED' || identificationChoice.value !== 'NO_ID'; });
  existingIdField.required = categoryField.value === 'ALREADY_ENROLLED' && identificationChoice.value === 'HAVE_ID';
  form.elements.resolvedPermanentStudentId.value = '';
  existingIdField.value = '';
  existingStudentIdField.value = '';
  existingStudentMatch.hidden = true;
  existingStudentMatch.textContent = '';
  idOutput.textContent = '';
  idOutput.hidden = true;
  submitButton.disabled = false;
  submitButton.textContent = 'Submit Registered Student';
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
    if (!classes.length) status.textContent = 'No active school classes are available. Ask an administrator to check the class setup.';
    restoreDraft();
    refreshTerms();
  } catch (error) { status.textContent = `Unable to load school classes and academic periods: ${error.message}`; }
}

function normalizeTerm(value) {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return ({ '1st term': '1st Term', 'first term': '1st Term', 'term 1': '1st Term', '2nd term': '2nd Term', 'second term': '2nd Term', 'term 2': '2nd Term', '3rd term': '3rd Term', 'third term': '3rd Term', 'term 3': '3rd Term' })[normalized] ?? normalized;
}

categoryField.addEventListener('change', () => { if (!completed) syncCategory(); });
identificationChoice.forEach((radio) => radio.addEventListener('change', () => { if (!completed) syncExistingIdChoice(); }));
form.elements.dateOfBirth.addEventListener('change', updateAge);
form.addEventListener('input', saveDraft);
form.addEventListener('change', saveDraft);

document.querySelector('#reset-registration-form').addEventListener('click', () => {
  if (saving) return;
  completed = false;
  registeredStudentId = null;
  form.querySelectorAll('input, select, textarea').forEach((field) => { field.disabled = false; });
  form.reset();
  status.textContent = '';
  success.replaceChildren();
  success.hidden = true;
  form.elements.registrationToken.value = '';
  form.elements.resolvedPermanentStudentId.value = '';
  existingStudentIdField.value = '';
  if (draftKey) localStorage.removeItem(draftKey);
  idOutput.textContent = '';
  idOutput.hidden = true;
  submitButton.disabled = false;
  submitButton.textContent = 'Submit Registered Student';
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
    status.textContent = 'Registration is already saved. Use Generate Permanent Student ID to continue.';
    return;
  }
  status.textContent = '';
  success.hidden = true;
  if (!form.reportValidity()) return;
  if (!['FIRST_TIME', 'TRANSFER', 'ALREADY_ENROLLED'].includes(categoryField.value)) { status.textContent = 'Select an admission category.'; return; }
  if (!yearField.value || !termField.value) { status.textContent = 'Select an academic year and one valid term before submitting.'; (yearField.value ? termField : yearField).focus(); return; }

  const fullName = form.elements.fullName.value.trim().replace(/\s+/g, ' ');
  const nameParts = fullName.split(' ');
  if (nameParts.length < 2) { status.textContent = 'Enter the pupil’s first and last name.'; form.elements.fullName.focus(); return; }
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  Object.assign(payload, {
    firstName: nameParts[0], middleName: nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '', lastName: nameParts.at(-1),
    existingPermanentStudentId: form.elements.resolvedPermanentStudentId.value || form.elements.existingPermanentStudentId.value.trim(),
    existingStudentId: existingStudentIdField.value,
    existingIdChoice: identificationChoice.value
  });
  if (categoryField.value === 'ALREADY_ENROLLED' && !payload.existingStudentId) {
    const suppliedId = identificationChoice.value === 'HAVE_ID' ? existingIdField.value.trim() : '';
    if (identificationChoice.value === 'HAVE_ID' && !suppliedId) { status.textContent = 'Enter the existing Student ID before submitting.'; existingIdField.focus(); return; }
    try {
      const identity = suppliedId
        ? { permanentStudentId: suppliedId }
        : { firstName: nameParts[0], lastName: nameParts.at(-1), dateOfBirth: form.elements.dateOfBirth.value };
      const match = await request('/api/internal-student-registration/existing-student', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identity) });
      payload.existingStudentId = match.student.studentId;
      if (!payload.existingPermanentStudentId) payload.existingPermanentStudentId = match.student.permanentStudentId ?? '';
      existingStudentIdField.value = match.student.studentId;
      existingStudentMatch.textContent = `Matched existing student: ${[match.student.firstName, match.student.middleName, match.student.lastName].filter(Boolean).join(' ')} · ${match.student.permanentStudentId ? `ID ${match.student.permanentStudentId}` : 'No permanent ID recorded'}.`;
      existingStudentMatch.hidden = false;
    } catch (error) { status.textContent = error.message; return; }
  }
  if (categoryField.value !== 'ALREADY_ENROLLED' && !form.elements.registrationToken.value) form.elements.registrationToken.value = crypto.randomUUID();
  payload.registrationToken = form.elements.registrationToken.value;
  saveDraft();
  saving = true;
  submitButton.disabled = true;
  submitButton.textContent = 'Submitting...';
  form.setAttribute('aria-busy', 'true');
  status.textContent = 'Saving the student profile, health details, parent contact, and class assignment…';
  try {
    const result = await request('/api/internal-student-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    registeredStudentId = result.studentId ?? result.student.studentId ?? result.student.id;
    if (!registeredStudentId) throw new Error('The database response did not include the saved student identifier. Retry or ask an administrator to verify the registration.');
    showRegistrationSaved({ ...result.student, studentId: registeredStudentId, permanentStudentId: result.permanentStudentId }, result.className);
    status.textContent = result.permanentStudentId ? `Submitted Successfully. Existing permanent ID ${result.permanentStudentId} was retained.` : 'Submitted Successfully. Registration and class placement are confirmed. Generate the Permanent Student ID to complete registration.';
  } catch (error) {
    status.textContent = error.message;
  }
  finally {
    saving = false;
    submitButton.disabled = completed;
    submitButton.textContent = completed ? 'Registration Saved' : 'Submit Registered Student';
    form.removeAttribute('aria-busy');
  }
});

generateButton.addEventListener('click', () => { void generatePermanentStudentId(); });

syncCategory();
loadOptions();
