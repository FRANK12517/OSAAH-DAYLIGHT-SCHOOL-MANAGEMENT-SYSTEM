const form = document.querySelector('#internal-registration-form');
const status = document.querySelector('#registration-status');
const success = document.querySelector('#registration-success');
const idOutput = document.querySelector('#permanent-student-id');
const generateButton = document.querySelector('#generate-student-id');
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

function saveDraft() {
  if (restoringDraft || completed || !draftKey) return;
  try {
    const data = Object.fromEntries(new FormData(form).entries());
    localStorage.setItem(draftKey, JSON.stringify({ version: 1, savedAt: new Date().toISOString(), data }));
    draftStatus.textContent = 'Draft saved on this device.';
  } catch { draftStatus.textContent = 'Draft could not be saved on this device.'; }
}

function restoreDraft() {
  if (!draftKey) return;
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey) ?? 'null');
    if (saved?.version !== 1 || !saved.data || typeof saved.data !== 'object') return;
    restoringDraft = true;
    if (saved.data.admissionType) categoryField.value = saved.data.admissionType;
    if (saved.data.existingIdChoice) [...identificationChoice].forEach((item) => { item.checked = item.value === saved.data.existingIdChoice; });
    syncCategory();
    for (const [name, value] of Object.entries(saved.data)) {
      if (name === 'existingIdChoice') continue;
      const field = form.elements.namedItem(name);
      if (field && 'value' in field) field.value = String(value ?? '');
    }
    if (saved.data.reservationToken) {
      form.elements.resolvedPermanentStudentId.value = saved.data.resolvedPermanentStudentId ?? '';
      idOutput.textContent = form.elements.resolvedPermanentStudentId.value || 'Reservation ready to recover';
      generateButton.textContent = 'ID Successfully Generated';
    }
    if (form.elements.existingStudentId.value) {
      existingStudentMatch.textContent = 'Recovered existing student selection. Verify the student identity before submitting.';
      existingStudentMatch.hidden = false;
    }
    updateAge();
    draftStatus.textContent = 'Recovered an incomplete registration draft from this device. Generate or verify the permanent ID, then submit.';
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

function syncCategory() {
  const existing = categoryField.value === 'ALREADY_ENROLLED';
  const transfer = categoryField.value === 'TRANSFER';
  document.querySelectorAll('[data-existing-field]').forEach((element) => { element.hidden = !existing; });
  document.querySelectorAll('[data-existing-id-entry]').forEach((element) => { element.hidden = !existing || identificationChoice.value !== 'HAVE_ID'; });
  document.querySelectorAll('[data-existing-no-id]').forEach((element) => { element.hidden = !existing || identificationChoice.value !== 'NO_ID'; });
  document.querySelectorAll('[data-transfer-field]').forEach((element) => { element.hidden = !transfer; });
  existingIdField.required = existing && identificationChoice.value === 'HAVE_ID';
  form.elements.previousSchool.required = transfer;
  form.elements.reservationToken.value = '';
  form.elements.resolvedPermanentStudentId.value = '';
  existingIdField.value = '';
  existingStudentIdField.value = '';
  existingStudentMatch.hidden = true;
  existingStudentMatch.textContent = '';
  idOutput.textContent = 'Not generated';
  generateButton.disabled = false;
  generateButton.textContent = existing ? identificationChoice.value === 'HAVE_ID' ? 'Find Existing Student' : 'Find Student and Generate ID' : 'Generate Permanent Student ID';
}

function syncExistingIdChoice() {
  document.querySelectorAll('[data-existing-id-entry]').forEach((element) => { element.hidden = categoryField.value !== 'ALREADY_ENROLLED' || identificationChoice.value !== 'HAVE_ID'; });
  document.querySelectorAll('[data-existing-no-id]').forEach((element) => { element.hidden = categoryField.value !== 'ALREADY_ENROLLED' || identificationChoice.value !== 'NO_ID'; });
  existingIdField.required = categoryField.value === 'ALREADY_ENROLLED' && identificationChoice.value === 'HAVE_ID';
  form.elements.resolvedPermanentStudentId.value = '';
  existingIdField.value = '';
  existingStudentIdField.value = '';
  form.elements.reservationToken.value = '';
  existingStudentMatch.hidden = true;
  existingStudentMatch.textContent = '';
  idOutput.textContent = 'Not generated';
  generateButton.disabled = false;
  generateButton.textContent = identificationChoice.value === 'NO_ID' ? 'Find Student and Generate ID' : 'Find Existing Student';
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
  form.reset();
  status.textContent = '';
  success.replaceChildren();
  success.hidden = true;
  form.elements.reservationToken.value = '';
  form.elements.resolvedPermanentStudentId.value = '';
  existingStudentIdField.value = '';
  if (draftKey) localStorage.removeItem(draftKey);
  idOutput.textContent = 'Not generated';
  generateButton.disabled = false;
  generateButton.textContent = 'Generate Permanent Student ID';
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = false;
  submit.textContent = 'Submit Registered Student';
  syncCategory();
  updateAge();
  loadOptions();
});

generateButton.addEventListener('click', async () => {
  if (generateButton.disabled || saving) return;
  if (form.elements.reservationToken.value || form.elements.resolvedPermanentStudentId.value && categoryField.value === 'ALREADY_ENROLLED') {
    status.textContent = form.elements.resolvedPermanentStudentId.value
      ? `Permanent ID ${form.elements.resolvedPermanentStudentId.value} is already reserved or assigned. Complete the form and submit registration.`
      : 'A prior ID request can be retried using the same reservation. Select Generate again to recover it.';
    if (!form.elements.reservationToken.value) return;
    generateButton.disabled = true;
    generateButton.textContent = 'Checking Reservation…';
    try {
      const reservation = await request('/api/internal-student-registration/student-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationToken: form.elements.reservationToken.value }) });
      form.elements.resolvedPermanentStudentId.value = reservation.permanentStudentId;
      idOutput.textContent = reservation.permanentStudentId;
      status.textContent = `Permanent ID ${reservation.permanentStudentId} confirmed. Complete the form and submit registration.`;
    } catch (error) { status.textContent = error.message; }
    finally { generateButton.disabled = false; generateButton.textContent = form.elements.resolvedPermanentStudentId.value ? 'ID Successfully Generated' : 'Retry ID Generation'; }
    return;
  }
  if (!form.reportValidity()) return;
  if (categoryField.value === 'ALREADY_ENROLLED') {
    const choice = identificationChoice.value;
    const fullName = form.elements.fullName.value.trim().replace(/\s+/g, ' ');
    const nameParts = fullName.split(' ');
    const identity = choice === 'HAVE_ID'
      ? { permanentStudentId: existingIdField.value.trim() }
      : { firstName: nameParts[0], lastName: nameParts.at(-1), dateOfBirth: form.elements.dateOfBirth.value };
    if (choice === 'HAVE_ID' && !identity.permanentStudentId) { existingIdField.focus(); status.textContent = 'Enter the student’s existing ID number.'; return; }
    generateButton.disabled = true;
    generateButton.textContent = 'Finding Student…';
    status.textContent = 'Checking existing student record…';
    try {
      const result = await request('/api/internal-student-registration/existing-student', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(identity) });
      const matched = result.student;
      existingStudentIdField.value = matched.studentId;
      form.elements.resolvedPermanentStudentId.value = matched.permanentStudentId ?? '';
      if (matched.classId && classes.some((item) => String(item.id) === String(matched.classId))) classField.value = String(matched.classId);
      existingStudentMatch.textContent = `Matched existing student: ${[matched.firstName, matched.middleName, matched.lastName].filter(Boolean).join(' ')} · ${matched.permanentStudentId ? `ID ${matched.permanentStudentId}` : 'No permanent ID recorded'}.`;
      existingStudentMatch.hidden = false;
      idOutput.textContent = matched.permanentStudentId ?? 'ID will be generated';
      if (choice === 'HAVE_ID' && !matched.permanentStudentId) {
        const suppliedId = identity.permanentStudentId;
        if (matched.admissionNumber !== suppliedId) throw new Error('Student ID not found. Please verify the ID number and try again.');
        form.elements.resolvedPermanentStudentId.value = suppliedId;
      }
      if (choice === 'NO_ID' && !matched.permanentStudentId) {
        generateButton.textContent = 'Generating ID…';
        status.textContent = 'Existing student found. Generating a permanent OSAAH ID for the current calendar year…';
        const reservationToken = crypto.randomUUID();
        form.elements.reservationToken.value = reservationToken;
        saveDraft();
        const reservation = await request('/api/internal-student-registration/student-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationToken }) });
        form.elements.reservationToken.value = reservation.reservationToken;
        form.elements.resolvedPermanentStudentId.value = reservation.permanentStudentId;
        idOutput.textContent = reservation.permanentStudentId;
        saveDraft();
      }
      status.textContent = matched.permanentStudentId
        ? `Existing permanent ID ${matched.permanentStudentId} retrieved. Submit registration when ready.`
        : `Permanent ID ${form.elements.resolvedPermanentStudentId.value} reserved. Complete the remaining details, then submit registration.`;
      generateButton.textContent = matched.permanentStudentId ? 'Existing Student Found' : 'ID Successfully Generated';
    } catch (error) { form.elements.resolvedPermanentStudentId.value = ''; form.elements.reservationToken.value = ''; existingStudentIdField.value = ''; idOutput.textContent = 'Not found'; status.textContent = error.message; }
    finally { generateButton.disabled = false; if (!form.elements.resolvedPermanentStudentId.value) generateButton.textContent = choice === 'HAVE_ID' ? 'Find Existing Student' : 'Find Student and Generate ID'; }
    return;
  }
  if (!['FIRST_TIME', 'TRANSFER'].includes(categoryField.value)) { status.textContent = 'Select an admission category first.'; categoryField.focus(); return; }
  generateButton.disabled = true;
  generateButton.textContent = 'Generating ID…';
  status.textContent = 'Generating a permanent Student ID for the current calendar year…';
  try {
    const reservationToken = crypto.randomUUID();
    form.elements.reservationToken.value = reservationToken;
    saveDraft();
    const result = await request('/api/internal-student-registration/student-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reservationToken }) });
    form.elements.reservationToken.value = result.reservationToken;
    form.elements.resolvedPermanentStudentId.value = result.permanentStudentId;
    idOutput.textContent = result.permanentStudentId;
    saveDraft();
    status.textContent = 'ID reserved. Complete the remaining details, then submit registration.';
    generateButton.textContent = 'ID Successfully Generated';
  } catch (error) { status.textContent = error.message; generateButton.textContent = 'Retry ID Generation'; }
  finally { generateButton.disabled = false; }
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving || completed) return;
  status.textContent = '';
  success.hidden = true;
  if (!form.reportValidity()) return;
  if (!['FIRST_TIME', 'TRANSFER', 'ALREADY_ENROLLED'].includes(categoryField.value)) { status.textContent = 'Select an admission category.'; return; }
  if (categoryField.value === 'ALREADY_ENROLLED' && !existingStudentIdField.value) { status.textContent = 'Find and verify the existing student record before submitting.'; return; }
  if (categoryField.value !== 'ALREADY_ENROLLED' && !form.elements.reservationToken.value) { status.textContent = 'Generate and reserve the permanent Student ID before submitting.'; return; }
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
  saving = true;
  const submit = form.querySelector('[type="submit"]');
  submit.disabled = true;
  submit.textContent = 'Registering student…';
  form.setAttribute('aria-busy', 'true');
  status.textContent = 'Saving the student profile, health details, parent contact, and class assignment…';
  try {
    const result = await request('/api/internal-student-registration', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const fullStudentName = [result.student.firstName, result.student.middleName, result.student.lastName].filter(Boolean).join(' ') || fullName;
    success.replaceChildren();
    const heading = document.createElement('h2'); heading.textContent = 'Registration complete';
    const detail = document.createElement('p'); detail.textContent = `Hi ${fullStudentName}, your permanent student ID is ${result.permanentStudentId}.`;
    const instruction = document.createElement('p'); instruction.textContent = 'PLEASE WRITE AND SAVE THE NAME AND PERMANENT ID OF THE REGISTERED STUDENT OR LOOK FOR IT IN THE CLASS DATABASE.';
    const placement = document.createElement('p'); placement.textContent = `Class placement: ${result.className}.`;
    success.append(heading, detail, instruction, placement);
    success.hidden = false;
    status.textContent = '';
    completed = true;
    if (draftKey) localStorage.removeItem(draftKey);
    form.reset();
    syncCategory(); updateAge(); loadOptions();
    idOutput.textContent = result.permanentStudentId;
    generateButton.disabled = true;
    generateButton.textContent = 'ID Successfully Generated';
  } catch (error) {
    status.textContent = error.message;
    generateButton.disabled = false;
    generateButton.textContent = form.elements.reservationToken.value ? 'Retry Student Registration' : 'Generate Permanent Student ID';
    if (form.elements.reservationToken.value) idOutput.textContent = form.elements.resolvedPermanentStudentId.value;
  }
  finally { saving = false; submit.disabled = completed; submit.textContent = completed ? 'Student Registered' : 'Submit Registered Student'; form.removeAttribute('aria-busy'); }
});

syncCategory();
loadOptions();
