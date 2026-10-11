import { createAdmissionFormNavigator, requiredAdmissionDocumentTypes } from './admission-form-navigation.js';

const form = document.querySelector('#admission-form');
const classField = document.querySelector('#class-applied');
const quote = document.querySelector('#fee-quote');
const status = document.querySelector('#form-status');
form.before(status);
const documentStorageStatus = document.querySelector('#document-storage-status');
const feeAssessment = document.createElement('section');
feeAssessment.className = 'card'; feeAssessment.hidden = true; feeAssessment.setAttribute('aria-live', 'polite');
feeAssessment.innerHTML = '<h3>Admission Fee Assessment</h3><p class="fee-assessment-summary"></p><ul class="fee-assessment-items"></ul><p class="muted">Assessment is not a payment. No payment or receipt is created here.</p>';
quote.after(feeAssessment);
const offerPanel = document.createElement('section');
offerPanel.className = 'card'; offerPanel.hidden = true; offerPanel.setAttribute('aria-live', 'polite');
form.before(offerPanel);
const saveButton = document.createElement('button');
saveButton.type = 'button'; saveButton.className = 'text-button'; saveButton.textContent = 'Save Draft';
const backButton = document.createElement('button'); backButton.type = 'button'; backButton.className = 'text-button'; backButton.textContent = 'Back'; backButton.disabled = true;
const nextButton = form.querySelector('button[type="submit"]'); nextButton.textContent = 'Next'; nextButton.type = 'button';
form.noValidate = true;
nextButton.before(saveButton, backButton);
const reviewPanel = document.createElement('section'); reviewPanel.className = 'card'; reviewPanel.hidden = true; reviewPanel.setAttribute('aria-live', 'polite'); form.before(reviewPanel);
const receiptFieldset = [...form.querySelectorAll('fieldset')].find((field) => field.querySelector('legend')?.textContent.includes('SUPPORTING DOCUMENTS'));
if (receiptFieldset && !form.elements.admissionReceipt) { const label = document.createElement('label'); label.textContent = 'Admission Receipt'; const input = document.createElement('input'); input.name = 'admissionReceipt'; input.type = 'file'; input.accept = 'image/jpeg,image/png,application/pdf'; label.append(input); receiptFieldset.append(label); }
function addTextField(name, label, { type = 'text', required = false, before = null } = {}) {
  if (form.elements.namedItem(name)) return;
  const fieldLabel = document.createElement('label'); fieldLabel.textContent = label;
  const input = document.createElement('input'); input.name = name; input.type = type; input.required = required;
  fieldLabel.append(input);
  const target = before ?? form.querySelector('fieldset'); target.append(fieldLabel);
}
addTextField('placeOfBirth', 'Place of Birth');
addTextField('primaryGuardianRelationship', 'Relationship to Student', { required: true, before: form.querySelectorAll('fieldset')[2] });
addTextField('primaryGuardianEmail', 'Parent / Guardian Email', { type: 'email', before: form.querySelectorAll('fieldset')[2] });
addTextField('primaryGuardianResidentialAddress', 'Parent / Guardian Residential Address', { before: form.querySelectorAll('fieldset')[2] });
const query = new URLSearchParams(location.search);
let applicationNumber = query.get('applicationNumber');
let working = false;
let existingDocuments = [];
const stepProgress = document.createElement('ol'); stepProgress.className = 'admission-step-progress'; stepProgress.setAttribute('aria-label', 'Admission form progress');
const stepStatus = document.createElement('p'); stepStatus.className = 'muted'; stepStatus.setAttribute('role', 'status'); stepStatus.setAttribute('aria-live', 'polite');
form.before(stepProgress, stepStatus);
const allFieldsets = [...form.querySelectorAll('fieldset')];
const officialUseFieldset = allFieldsets.find((fieldset) => fieldset.querySelector('legend')?.textContent.includes('OFFICIAL USE ONLY'));
if (officialUseFieldset) officialUseFieldset.hidden = true;
const stepFieldsets = allFieldsets.filter((fieldset) => fieldset !== officialUseFieldset);
for (const fieldset of stepFieldsets) {
  const item = document.createElement('li'); item.textContent = fieldset.querySelector('legend')?.textContent.replace(/\s+/g, ' ').trim() ?? 'Admission details'; stepProgress.append(item);
}
const stepIndicators = [...stepProgress.children];
let staffAdmission = false;
const wizard = createAdmissionFormNavigator({
  steps: stepFieldsets,
  validateStep: (fieldset) => {
    const invalid = [...fieldset.querySelectorAll('input, select, textarea')].find((control) => control.willValidate && !control.checkValidity());
    if (!invalid) return true;
    invalid.reportValidity();
    return false;
  },
  onStepChange: ({ currentStep, totalSteps }) => {
    stepStatus.textContent = `Section ${currentStep + 1} of ${totalSteps}: ${stepIndicators[currentStep]?.textContent ?? 'Admission details'}`;
    stepIndicators.forEach((indicator, index) => {
      if (index === currentStep) indicator.setAttribute('aria-current', 'step');
      else indicator.removeAttribute('aria-current');
    });
    backButton.disabled = currentStep === 0 && !applicationNumber;
    backButton.textContent = currentStep === 0 ? 'Back to Enquiry' : 'Back';
    nextButton.textContent = currentStep === totalSteps - 1
      ? (staffAdmission ? 'Review Admission' : 'Submit Application')
      : 'Next';
  },
});
const yearField = document.createElement('input'); yearField.type = 'hidden'; yearField.name = 'academicYear'; yearField.value = String(new Date().getFullYear()); form.append(yearField);
const yearIdField = document.createElement('input'); yearIdField.type = 'hidden'; yearIdField.name = 'academicYearId'; form.append(yearIdField);
const termField = document.createElement('input'); termField.type = 'hidden'; termField.name = 'admissionTerm'; termField.value = 'TERM_1'; form.append(termField);
const termIdField = document.createElement('input'); termIdField.type = 'hidden'; termIdField.name = 'termId'; form.append(termIdField);
const admissionTypeField = document.createElement('input'); admissionTypeField.type = 'hidden'; admissionTypeField.name = 'admissionType'; form.append(admissionTypeField);
const historicalAdmissionYearLabel = document.createElement('label'); historicalAdmissionYearLabel.textContent = 'Year Admitted into the School';
const historicalAdmissionYearField = document.createElement('input'); historicalAdmissionYearField.name = 'historicalAdmissionYear'; historicalAdmissionYearField.type = 'text'; historicalAdmissionYearField.inputMode = 'numeric'; historicalAdmissionYearField.pattern = '\\d{4}'; historicalAdmissionYearField.maxLength = 4;
historicalAdmissionYearLabel.append(historicalAdmissionYearField); form.querySelector('fieldset').append(historicalAdmissionYearLabel);
function syncHistoricalAdmissionYear() {
  staffAdmission = ['ALREADY_ENROLLED', 'TRANSFER', 'FIRST_TIME'].includes(admissionTypeField.value);
  const required = admissionTypeField.value === 'ALREADY_ENROLLED';
  historicalAdmissionYearLabel.hidden = !required;
  historicalAdmissionYearField.required = required;
  nextButton.textContent = wizard.isLastStep ? (staffAdmission ? 'Review Admission' : 'Submit Application') : 'Next';
  updateDocumentRequirementNote();
}
const documentFields = { passport: 'PASSPORT_PHOTOGRAPHS', identity: 'BIRTH_CERTIFICATE_OR_GHANA_CARD', nhis: 'NHIS_CARD', report: 'LAST_ACADEMIC_REPORT', admissionReceipt: 'ADMISSION_RECEIPT' };
const documentFieldset = stepFieldsets.find((fieldset) => fieldset.querySelector('legend')?.textContent.includes('SUPPORTING DOCUMENTS'));
const documentRequirementNote = document.createElement('p'); documentRequirementNote.className = 'muted'; documentRequirementNote.setAttribute('role', 'status');
documentFieldset?.insertBefore(documentRequirementNote, documentFieldset.querySelector('label'));
function requiredDocumentTypes() {
  const className = String(classField.selectedOptions?.[0]?.textContent ?? classField.value ?? '');
  return requiredAdmissionDocumentTypes({ admissionType: admissionTypeField.value, className });
}
function updateDocumentRequirementNote() {
  if (!documentRequirementNote) return;
  const required = requiredDocumentTypes();
  documentRequirementNote.textContent = admissionTypeField.value === 'ALREADY_ENROLLED'
    ? 'Supporting documents and the admission receipt are optional for this Already-Enrolled application.'
    : `Required for this application: ${required.map((type) => type.replaceAll('_', ' ').toLowerCase()).join(', ')}.`;
}
function missingRequiredDocuments({ uploadedOnly = false } = {}) {
  return requiredDocumentTypes().filter((type) => {
    const uploaded = existingDocuments.some((item) => item.documentType === type && item.uploadStatus === 'UPLOADED');
    if (uploaded) return false;
    if (uploadedOnly) return true;
    const fieldName = Object.keys(documentFields).find((key) => documentFields[key] === type);
    return !fieldName || ![...(form.elements[fieldName]?.files ?? [])].length;
  });
}
function showDocumentRequirementError(missing) {
  const names = missing.map((type) => type.replaceAll('_', ' ').toLowerCase());
  status.textContent = `Upload the required document${names.length === 1 ? '' : 's'} before continuing: ${names.join(', ')}.`;
  const fieldName = Object.keys(documentFields).find((key) => documentFields[key] === missing[0]);
  const input = form.elements[fieldName];
  focusStepControl(input);
}
function focusStepControl(control) {
  form.hidden = false; stepProgress.hidden = false; stepStatus.hidden = false; reviewPanel.hidden = true;
  const targetStep = stepFieldsets.indexOf(control?.closest('fieldset'));
  while (targetStep >= 0 && wizard.currentStep > targetStep) wizard.back();
  form.scrollIntoView({ behavior: 'smooth' });
  control?.focus();
}
syncHistoricalAdmissionYear();
const money = (value) => `GH₵${Number(value).toFixed(2)}`;

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'The request could not be completed.');
  return result;
}

function populate(record) {
  existingDocuments = record.documents ?? [];
  renderOfferAcceptance(record);
  const values = { ...(record.section1 ?? {}), ...(record.section2 ?? {}), ...(record.section3 ?? {}) };
  for (const [name, value] of Object.entries(values)) {
    const field = form.elements.namedItem(name);
    if (!field || field.type === 'file') continue;
    if (field.type === 'checkbox') { field.checked = Boolean(value); continue; }
    field.value = value ?? '';
  }
  const guardianPhone = values.primaryGuardianPrimaryPhone ?? values.parentPhone;
  if (guardianPhone) form.elements.primaryGuardianPrimaryPhone.value = guardianPhone;
  admissionTypeField.value = String(values.admissionType ?? ''); historicalAdmissionYearField.value = String(values.historicalAdmissionYear ?? ''); syncHistoricalAdmissionYear();
  yearField.value = String(record.academicYear ?? values.academicYear ?? yearField.value);
  termField.value = String(record.admissionTerm ?? values.admissionTerm ?? termField.value);
  yearIdField.value = String(values.academicYearId ?? ''); termIdField.value = String(values.termId ?? '');
  if (form.elements.academicYearSelect) {
    const selectedYear = [...form.elements.academicYearSelect.options].find((option) => { try { const item = JSON.parse(option.value); return item.id === yearIdField.value || item.name === yearField.value; } catch { return false; } });
    if (selectedYear) form.elements.academicYearSelect.value = selectedYear.value;
  }
  if (form.elements.admissionTermSelect) {
    const selectedTerm = [...form.elements.admissionTermSelect.options].find((option) => { try { const item = JSON.parse(option.value); return item.id === termIdField.value || item.name === termField.value; } catch { return false; } });
    if (selectedTerm) form.elements.admissionTermSelect.value = selectedTerm.value;
  }
  if (record.applicationNumber) status.textContent = `Draft ${record.applicationNumber} loaded. Changes are saved to this application.`;
  renderFeeAssessment(record.feeAssessment);
}

function renderOfferAcceptance(record) {
  const offer = record.workflow?.offer;
  if (!offer?.issuedAt) { offerPanel.hidden = true; return; }
  offerPanel.hidden = false; offerPanel.replaceChildren();
  const heading = document.createElement('h2'); heading.textContent = 'Admission Offer';
  const details = document.createElement('p'); details.textContent = `Offer issued ${new Date(offer.issuedAt).toLocaleDateString()}. ${offer.acceptedAt ? `Accepted ${new Date(offer.acceptedAt).toLocaleDateString()}.` : 'Please record your response below.'}`;
  offerPanel.append(heading, details);
  if (!offer.acceptedAt && applicationNumber) {
    const accept = document.createElement('button'); accept.type = 'button'; accept.className = 'primary-button'; accept.textContent = 'Accept Admission Offer';
    accept.addEventListener('click', async () => { accept.disabled = true; try { const updated = await request(`/api/admission-applications/${encodeURIComponent(applicationNumber)}/offer-acceptance`, { method: 'POST' }); renderOfferAcceptance(updated); status.textContent = 'Your acceptance was saved. The school will complete registration and class placement.'; } catch (error) { status.textContent = error.message; accept.disabled = false; } });
    offerPanel.append(accept);
  }
}

async function uploadSelectedDocuments() {
  for (const [fieldName, documentType] of Object.entries(documentFields)) {
    const files = [...form.elements[fieldName].files];
    try {
      for (const [index, file] of files.entries()) {
        if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.type)) throw new Error(`${file.name} must be a PDF, JPEG, or PNG file.`);
        if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(`${file.name} must be between 1 byte and 10 MB.`);
        const replace = index === 0 ? existingDocuments.find((item) => item.documentType === documentType) : null;
        const url = `/api/admission-applications/${encodeURIComponent(applicationNumber)}/documents${replace ? `/${encodeURIComponent(replace.id)}` : ''}`;
        const response = await fetch(url, { method: replace ? 'PUT' : 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type, 'X-Document-Type': documentType, 'X-Original-Name': file.name }, body: file });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error ?? `Could not upload ${file.name}.`);
        existingDocuments = replace ? existingDocuments.map((item) => item.id === replace.id ? result : item) : [...existingDocuments, result];
      }
    } catch (error) { focusStepControl(form.elements[fieldName]); throw error; }
    if (files.length) form.elements[fieldName].value = '';
  }
}

function renderFeeAssessment(assessment) {
  if (!assessment) { feeAssessment.hidden = true; return; }
  feeAssessment.hidden = false;
  feeAssessment.querySelector('.fee-assessment-summary').textContent = `GH₵${Number(assessment.total ?? 0).toFixed(2)} · ${assessment.paymentStatus ?? 'NOT_PAID'} · ${assessment.assessedAt ? new Date(assessment.assessedAt).toLocaleDateString() : 'Assessed'}`;
  const items = feeAssessment.querySelector('.fee-assessment-items'); items.replaceChildren();
  for (const line of assessment.items ?? []) { const item = document.createElement('li'); item.textContent = `${line.type}: GH₵${Number(line.amount).toFixed(2)}`; items.append(item); }
  if (!items.childElementCount) { const item = document.createElement('li'); item.textContent = 'No published admission fee applies to this class and academic period.'; items.append(item); }
}

async function loadOptions() {
  for (const url of ['/api/admission-workflow/options', '/api/admission-prospectus/options', '/api/public/admission-prospectus/options']) {
    try {
      const options = await request(url);
      if (documentStorageStatus) {
        documentStorageStatus.textContent = options.documentStorageAvailable
          ? 'Private document storage is available. Files upload to the school’s private store.'
          : 'Private document storage is not configured. Files cannot be uploaded yet; your draft can still be saved.';
        documentStorageStatus.classList.toggle('error', !options.documentStorageAvailable);
      }
      if (options.classes?.length) {
        const current = classField.value; classField.replaceChildren(new Option('Select class', ''));
        for (const item of options.classes) classField.add(new Option(item.name, item.id));
        if (current) classField.value = current;
      }
      if (options.academicYears?.length) {
        const admissionYear = document.createElement('label'); admissionYear.textContent = 'Academic Year of Admission';
        const select = document.createElement('select'); select.name = 'academicYearSelect'; select.required = true;
        select.add(new Option('Select academic year', ''));
        for (const item of options.academicYears) select.add(new Option(item.name, JSON.stringify({ id: item.id, name: item.name, admissionYear: item.admissionYear ?? String(item.name).match(/^\d{4}/)?.[0] })));

        select.addEventListener('change', () => { if (!select.value) return; const choice = JSON.parse(select.value); yearField.value = choice.name; yearIdField.value = choice.id; });
        admissionYear.append(select); form.querySelector('fieldset').append(admissionYear);
      }
      if (options.terms?.length) {
        const admissionTerm = document.createElement('label'); admissionTerm.textContent = 'Admission Term';
        const select = document.createElement('select'); select.name = 'admissionTermSelect'; select.required = true; select.add(new Option('Select term', ''));
        for (const item of options.terms) select.add(new Option(item.name, JSON.stringify({ id: item.id, name: item.name })));
        select.addEventListener('change', () => { if (!select.value) return; const choice = JSON.parse(select.value); termField.value = choice.name; termIdField.value = choice.id; });
        admissionTerm.append(select); form.querySelector('fieldset').append(admissionTerm);
      }
      return;
    } catch {}
  }
}

async function saveDraft() {
  if (working) return false;
  working = true; setFormBusy(true);
  status.textContent = 'Saving draft…';
  try {
    const data = Object.fromEntries(new FormData(form));
    for (const field of ['passport', 'identity', 'nhis', 'report', 'admissionReceipt']) delete data[field];
    data.academicYear = String(yearField.value); data.admissionTerm = String(termField.value);
    data.parentDeclarationAccepted = form.elements.parentDeclarationAccepted.checked;
    if (!applicationNumber) {
      const created = await request('/api/admission-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      applicationNumber = created.applicationNumber;
      history.replaceState({}, '', `${location.pathname}?applicationNumber=${encodeURIComponent(applicationNumber)}&step=2`);
    }
    const updated = await request(`/api/admission-applications/${encodeURIComponent(applicationNumber)}/update`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    status.textContent = `Draft ${updated.applicationNumber} saved. You can return to it from Admissions Workflow.`;
    return true;
  } catch (error) { status.textContent = error.message; return false; }
  finally { working = false; setFormBusy(false); }
}

function showReview() {
  const data = Object.fromEntries(new FormData(form));
  const rows = Object.entries(data).filter(([name]) => !['passport', 'identity', 'nhis', 'report', 'admissionReceipt'].includes(name)).map(([name, value]) => `<dt>${name.replace(/([A-Z])/g, ' $1')}</dt><dd>${String(value || 'Not provided').replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character])}</dd>`).join('');
  const documents = existingDocuments.map((document) => `<li>${document.documentType.replaceAll('_', ' ')}: ${document.uploadStatus ?? 'UPLOADED'}</li>`).join('') || '<li>No documents uploaded.</li>';
  reviewPanel.innerHTML = `<h2>Review Admission</h2><p>Review the saved details and document status before final submission. Select Edit Admission to make changes.</p><dl>${rows}</dl><h3>Private documents</h3><ul>${documents}</ul><button type="button" class="text-button" data-edit-admission>Edit Admission</button><button type="button" class="primary-button" data-confirm-admission>Confirm and Submit Admission</button>`;
  reviewPanel.querySelector('[data-edit-admission]').addEventListener('click', () => { reviewPanel.hidden = true; form.hidden = false; stepProgress.hidden = false; stepStatus.hidden = false; status.textContent = 'Edit the draft, then review it again before submitting.'; form.scrollIntoView({ behavior: 'smooth' }); });
  reviewPanel.querySelector('[data-confirm-admission]').addEventListener('click', submitApplication);
  form.hidden = true; stepProgress.hidden = true; stepStatus.hidden = true; reviewPanel.hidden = false;
}

function setFormBusy(busy) {
  saveButton.disabled = busy;
  nextButton.disabled = busy;
  backButton.disabled = busy || wizard.currentStep === 0;
}

async function reviewAndSubmit() {
  if (working || !wizard.validateCurrentStep()) return;
  const missing = missingRequiredDocuments();
  if (missing.length) { showDocumentRequirementError(missing); return; }
  if (!staffAdmission) { await submitApplication(); return; }
  if (!(await saveDraft())) return;
  setFormBusy(true);
  status.textContent = 'Uploading private supporting documents…';
  try {
    await uploadSelectedDocuments();
    const notUploaded = missingRequiredDocuments({ uploadedOnly: true });
    if (notUploaded.length) { showDocumentRequirementError(notUploaded); return; }
    showReview();
    status.textContent = `Application ${applicationNumber} is saved. Review the details, then confirm submission.`;
  } catch (error) { status.textContent = error.message; }
  finally { setFormBusy(false); }
}

async function handleNext() {
  if (working) return;
  if (!wizard.isLastStep) {
    if (wizard.next()) status.textContent = '';
    return;
  }
  await reviewAndSubmit();
}

classField.addEventListener('change', async () => {
  updateDocumentRequirementNote();
  if (!classField.value) return;
  quote.textContent = 'Loading published fees…';
  try {
    const className = classField.selectedOptions[0]?.textContent ?? classField.value;
    const fee = (await request(`/api/admission-fees/quote?classAppliedFor=${encodeURIComponent(className)}&academicYear=${encodeURIComponent(yearField.value)}&term=${encodeURIComponent(termField.value)}`)).fee;
    quote.innerHTML = `<strong>${fee.level}</strong><br>Tuition &amp; Academic Fees: ${money(fee.tuitionAcademicFee)}<br>ICT &amp; Lab / Library Fee: ${money(fee.ictLabLibraryFee)}<br>PTA &amp; Utility Charges: ${money(fee.ptaUtilityCharges)}<br><strong>Total Termly Fee: ${money(fee.totalTermlyFee)}</strong><hr>Admission &amp; Registration: ${money(fee.admissionRegistrationFee)}<br>Uniform: ${money(fee.schoolUniformFee)}<br>PE Kit / Sportswear: ${money(fee.peKitSportswearFee)}`;
  } catch (error) { quote.textContent = error.message; }
});

saveButton.addEventListener('click', saveDraft);
backButton.addEventListener('click', () => {
  if (working) return;
  if (wizard.currentStep === 0 && applicationNumber) {
    window.location.assign(`/admissions?applicationNumber=${encodeURIComponent(applicationNumber)}`);
    return;
  }
  wizard.back(); status.textContent = '';
});
nextButton.addEventListener('click', handleNext);
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await handleNext();
});

async function submitApplication(event) {
  if (working) return;
  let submissionSucceeded = false;
  working = true; setFormBusy(true);
  const confirmButton = reviewPanel.querySelector('[data-confirm-admission]');
  if (confirmButton) confirmButton.disabled = true;
  status.textContent = 'Saving and submitting application…';
  try {
    const data = Object.fromEntries(new FormData(form));
    for (const field of ['passport', 'identity', 'nhis', 'report', 'admissionReceipt']) delete data[field];
    data.academicYear = String(yearField.value); data.admissionTerm = String(termField.value);
    data.parentDeclarationAccepted = form.elements.parentDeclarationAccepted.checked;
    if (!applicationNumber) {
      const created = await request('/api/admission-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      applicationNumber = created.applicationNumber;
    }
    await request(`/api/admission-applications/${encodeURIComponent(applicationNumber)}/update`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const selectedFiles = ['passport', 'identity', 'nhis', 'report', 'admissionReceipt'].flatMap((field) => [...form.elements[field].files]);
    if (selectedFiles.length) await uploadSelectedDocuments();
    const missingDocuments = missingRequiredDocuments({ uploadedOnly: true });
    if (missingDocuments.length) { showDocumentRequirementError(missingDocuments); if (confirmButton) confirmButton.disabled = false; return; }
    const result = await request(`/api/admission-applications/${encodeURIComponent(applicationNumber)}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    renderFeeAssessment(result.feeAssessment);
    status.textContent = `Application ${result.applicationNumber} submitted on ${result.updatedAt}. Status: ${result.status}.`;
    submissionSucceeded = true;
    if (confirmButton) confirmButton.disabled = true;
    nextButton.disabled = true; backButton.disabled = true; saveButton.disabled = true;
  } catch (error) { status.textContent = error.message; if (confirmButton) confirmButton.disabled = false; }
  finally {
    working = false;
    if (!submissionSucceeded) {
      if (confirmButton) confirmButton.disabled = false;
      setFormBusy(false);
    }
  }
}

if (applicationNumber) { setFormBusy(true); stepStatus.textContent = 'Loading saved application…'; }
loadOptions().then(async () => {
  if (applicationNumber) {
    try { populate(await request(`/api/admission-applications/${encodeURIComponent(applicationNumber)}`)); }
    catch (error) { status.textContent = `Unable to open this application: ${error.message}`; }
    finally { setFormBusy(false); }
  }
});
