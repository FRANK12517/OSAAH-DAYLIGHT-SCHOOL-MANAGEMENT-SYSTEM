const form = document.querySelector('#internal-registration-form');
const status = document.querySelector('#registration-status');
const success = document.querySelector('#registration-success');
const idOutput = document.querySelector('#permanent-student-id');
const generateButton = document.querySelector('#generate-student-id');
const categoryField = form.elements.admissionType;
const existingIdField = form.elements.existingPermanentStudentId;
const classField = form.elements.classId;
const yearField = form.elements.academicYearId;
const termField = form.elements.termId;
let classes = [];
let terms = [];
let saving = false;

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
  document.querySelectorAll('[data-transfer-field]').forEach((element) => { element.hidden = !transfer; });
  existingIdField.required = existing;
  form.elements.previousSchool.required = transfer;
  form.elements.reservationToken.value = '';
  form.elements.resolvedPermanentStudentId.value = '';
  idOutput.textContent = 'Not generated';
  generateButton.disabled = false;
  generateButton.textContent = existing ? 'Find existing Student ID' : 'Generate Permanent Student ID';
}

function updateAge() {
  const raw = form.elements.dateOfBirth.value;
  if (!raw) { form.elements.age.value = ''; return; }
  const birth = new Date(`${raw}T00:00:00`), today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate()) age -= 1;
  form.elements.age.value = age >= 0 ? String(age) : '';
}

function syncTerms() {
  const yearId = yearField.value;
  const available = terms.filter((term) => String(term.academicYearId ?? '') === String(yearId));
  termField.replaceChildren(new Option(available.length ? 'Select term' : 'No terms available for this year', ''));
  for (const term of available) termField.add(new Option(term.name, term.id));
  if (available.length === 1) termField.value = String(available[0].id);
}

async function loadOptions() {
  try {
    const options = await request('/api/admission-workflow/options');
    classes = options.classes ?? [];
    classField.replaceChildren(new Option('Select class', ''));
    for (const item of classes) classField.add(new Option(item.name, item.id));
    const years = options.academicYears ?? [];
    yearField.replaceChildren(new Option('Select academic year', ''));
    for (const item of years) yearField.add(new Option(item.name, item.id));
    terms = options.terms ?? [];
    syncTerms();
    const current = years.find((item) => item.isCurrent === true || item.isCurrent === 1);
    if (current) { yearField.value = String(current.id); syncTerms(); }
    const currentTerm = terms.find((term) => String(term.academicYearId ?? '') === String(yearField.value) && (term.isCurrent === true || term.isCurrent === 1));
    if (currentTerm) termField.value = String(currentTerm.id);
    if (!classes.length) status.textContent = 'No active school classes are available. Ask an administrator to check the class setup.';
  } catch (error) { status.textContent = `Unable to load school classes and academic periods: ${error.message}`; }
}

categoryField.addEventListener('change', syncCategory);
form.elements.dateOfBirth.addEventListener('change', updateAge);
yearField.addEventListener('change', syncTerms);

generateButton.addEventListener('click', async () => {
  if (categoryField.value === 'ALREADY_ENROLLED') {
    const permanentStudentId = existingIdField.value.trim();
    if (!permanentStudentId) { existingIdField.focus(); status.textContent = 'Enter the existing permanent Student ID first.'; return; }
    generateButton.disabled = true;
    status.textContent = 'Checking existing student record…';
    try {
      const result = await request('/api/internal-student-registration/existing-student', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ permanentStudentId }) });
      form.elements.resolvedPermanentStudentId.value = result.student.permanentStudentId;
      idOutput.textContent = result.student.permanentStudentId;
      status.textContent = `Existing record found for ${[result.student.firstName, result.student.middleName, result.student.lastName].filter(Boolean).join(' ')}. Its permanent ID will be reused.`;
    } catch (error) { form.elements.resolvedPermanentStudentId.value = ''; idOutput.textContent = 'Not found'; status.textContent = error.message; }
    finally { generateButton.disabled = false; }
    return;
  }
  if (!['FIRST_TIME', 'TRANSFER'].includes(categoryField.value)) { status.textContent = 'Select an admission category first.'; categoryField.focus(); return; }
  generateButton.disabled = true;
  status.textContent = 'Reserving a permanent Student ID…';
  try {
    const result = await request('/api/internal-student-registration/student-id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    form.elements.reservationToken.value = result.reservationToken;
    form.elements.resolvedPermanentStudentId.value = result.permanentStudentId;
    idOutput.textContent = result.permanentStudentId;
    status.textContent = 'Permanent Student ID reserved. Complete the form and submit registration.';
  } catch (error) { status.textContent = error.message; generateButton.disabled = false; return; }
  generateButton.textContent = 'ID Reserved';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (saving) return;
  status.textContent = '';
  success.hidden = true;
  if (!form.reportValidity()) return;
  if (!['FIRST_TIME', 'TRANSFER', 'ALREADY_ENROLLED'].includes(categoryField.value)) { status.textContent = 'Select an admission category.'; return; }
  if (categoryField.value === 'ALREADY_ENROLLED' && !form.elements.resolvedPermanentStudentId.value) { status.textContent = 'Find and verify the existing student record before submitting.'; return; }
  if (categoryField.value !== 'ALREADY_ENROLLED' && !form.elements.reservationToken.value) { status.textContent = 'Generate and reserve the permanent Student ID before submitting.'; return; }

  const fullName = form.elements.fullName.value.trim().replace(/\s+/g, ' ');
  const nameParts = fullName.split(' ');
  if (nameParts.length < 2) { status.textContent = 'Enter the pupil’s first and last name.'; form.elements.fullName.focus(); return; }
  const data = new FormData(form);
  const payload = Object.fromEntries(data.entries());
  Object.assign(payload, {
    firstName: nameParts[0], middleName: nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : '', lastName: nameParts.at(-1),
    existingPermanentStudentId: form.elements.resolvedPermanentStudentId.value || form.elements.existingPermanentStudentId.value.trim()
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
    const detail = document.createElement('p'); detail.textContent = `${fullStudentName} is registered in ${result.className}. Permanent Student ID: ${result.permanentStudentId}.`;
    success.append(heading, detail);
    success.hidden = false;
    status.textContent = '';
    form.reset();
    syncCategory(); updateAge(); syncTerms();
  } catch (error) { status.textContent = error.message; }
  finally { saving = false; submit.disabled = false; submit.textContent = 'Submit Registered Student'; form.removeAttribute('aria-busy'); }
});

syncCategory();
loadOptions();
