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
let classes = [];
let terms = [];
let saving = false;
let completed = false;

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
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
    classes = options.classes ?? [];
    classField.replaceChildren(new Option('Select class', ''));
    for (const item of classes) classField.add(new Option(item.name, item.id));
    const years = options.academicYears ?? [];
    terms = options.terms ?? [];
    const current = years.find((item) => item.isCurrent === true || item.isCurrent === 1);
    if (current) yearField.value = String(current.id);
    const currentTerm = terms.find((term) => String(term.academicYearId ?? '') === String(yearField.value) && (term.isCurrent === true || term.isCurrent === 1));
    if (currentTerm) termField.value = String(currentTerm.id);
    if (!classes.length) status.textContent = 'No active school classes are available. Ask an administrator to check the class setup.';
  } catch (error) { status.textContent = `Unable to load school classes and academic periods: ${error.message}`; }
}

categoryField.addEventListener('change', () => { if (!completed) syncCategory(); });
identificationChoice.forEach((radio) => radio.addEventListener('change', () => { if (!completed) syncExistingIdChoice(); }));
form.elements.dateOfBirth.addEventListener('change', updateAge);

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
  if (form.elements.reservationToken.value || form.elements.resolvedPermanentStudentId.value && categoryField.value === 'ALREADY_ENROLLED') {
    form.requestSubmit();
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
        const reservation = await request('/api/internal-student-registration/student-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
        form.elements.reservationToken.value = reservation.reservationToken;
        form.elements.resolvedPermanentStudentId.value = reservation.permanentStudentId;
        idOutput.textContent = reservation.permanentStudentId;
      }
      generateButton.textContent = 'Registering Student…';
      status.textContent = 'Completing registration and Class Database enrolment…';
      form.requestSubmit();
    } catch (error) { form.elements.resolvedPermanentStudentId.value = ''; form.elements.reservationToken.value = ''; existingStudentIdField.value = ''; idOutput.textContent = 'Not found'; status.textContent = error.message; generateButton.disabled = false; generateButton.textContent = choice === 'HAVE_ID' ? 'Find Existing Student' : 'Find Student and Generate ID'; }
    return;
  }
  if (!['FIRST_TIME', 'TRANSFER'].includes(categoryField.value)) { status.textContent = 'Select an admission category first.'; categoryField.focus(); return; }
  generateButton.disabled = true;
  generateButton.textContent = 'Generating ID…';
  status.textContent = 'Generating a permanent Student ID for the current calendar year…';
  try {
    const result = await request('/api/internal-student-registration/student-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    form.elements.reservationToken.value = result.reservationToken;
    form.elements.resolvedPermanentStudentId.value = result.permanentStudentId;
    idOutput.textContent = result.permanentStudentId;
    status.textContent = 'ID reserved. Completing student registration and class enrolment…';
  } catch (error) { status.textContent = error.message; generateButton.disabled = false; generateButton.textContent = 'Generate Permanent Student ID'; return; }
  generateButton.textContent = 'Registering Student…';
  form.requestSubmit();
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
    form.reset();
    syncCategory(); updateAge(); loadOptions();
    idOutput.textContent = result.permanentStudentId;
    generateButton.disabled = true;
    generateButton.textContent = 'ID Successfully Generated';
  } catch (error) { status.textContent = error.message; generateButton.disabled = false; generateButton.textContent = form.elements.reservationToken.value ? 'Retry Student Registration' : 'Generate Permanent Student ID'; }
  finally { saving = false; submit.disabled = completed; submit.textContent = completed ? 'Student Registered' : 'Submit Registered Student'; form.removeAttribute('aria-busy'); }
});

syncCategory();
loadOptions();
