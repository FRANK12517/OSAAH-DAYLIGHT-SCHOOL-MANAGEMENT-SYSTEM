const enquiryForm = document.querySelector('#admission-enquiry');
const enquiryStatus = document.querySelector('#enquiry-status');
const applicationsStatus = document.querySelector('#applications-status');
const applicationsList = document.querySelector('#applications-list');
const classField = enquiryForm.elements.classId;
const academicYearField = enquiryForm.elements.academicYear;
let submitting = false;
const requestIdKey = 'osaah.admissions.enquiryRequestId';
const workflowStages = ['ENQUIRY', 'APPLICATION', 'DOCUMENT_REVIEW', 'ASSESSMENT', 'DECISION', 'ADMISSION_OFFER', 'ACCEPTANCE', 'REGISTRATION', 'FEE_ASSESSMENT', 'ENROLLMENT', 'STUDENT_ID', 'CLASS_ASSIGNMENT'];

function normalizeGhanaPhone(value) {
  const digits = String(value ?? '').replace(/[\s()-]/g, '');
  if (/^0[235]\d{8}$/.test(digits)) return `+233${digits.slice(1)}`;
  if (/^233[235]\d{8}$/.test(digits)) return `+${digits}`;
  if (/^\+233[235]\d{8}$/.test(digits)) return digits;
  throw new Error('Enter a valid Ghanaian mobile number, such as 0241234567.');
}

async function jsonRequest(url, options) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? 'The request could not be completed.');
  return result;
}

async function loadOptions() {
  try {
    const options = await jsonRequest('/api/admission-workflow/options');
    classField.replaceChildren(new Option('Select class', ''));
    for (const item of options.classes ?? []) classField.add(new Option(item.name, item.id));
    academicYearField.replaceChildren(new Option('Select academic year', ''));
    for (const item of options.academicYears ?? []) academicYearField.add(new Option(item.name, JSON.stringify({ id: item.id, name: item.name, admissionYear: item.admissionYear })));
    const termField = enquiryForm.elements.term;
    termField.replaceChildren(new Option('Select term', ''));
    for (const item of options.terms ?? []) termField.add(new Option(item.name, JSON.stringify({ id: item.id, name: item.name })));
    if (!academicYearField.options.length) academicYearField.add(new Option(String(new Date().getFullYear()), String(new Date().getFullYear())));
  } catch (error) {
    enquiryStatus.textContent = `Unable to load school classes and years: ${error.message}`;
  }
}

function renderApplications(applications) {
  applicationsList.replaceChildren();
  if (!applications.length) { applicationsStatus.textContent = 'No saved applications yet.'; return; }
  applicationsStatus.textContent = `${applications.length} application${applications.length === 1 ? '' : 's'} found.`;
  const list = document.createElement('ul');
  for (const application of applications) {
    const item = document.createElement('li');
    const name = [application.section1?.studentFirstName, application.section1?.studentSurname].filter(Boolean).join(' ') || application.applicationNumber;
    const link = document.createElement('a');
    link.href = `/admission-application.html?applicationNumber=${encodeURIComponent(application.applicationNumber)}`;
    link.textContent = `${name} — ${application.applicationNumber} (${application.status})`;
    const stage = document.createElement('p'); stage.textContent = `Current stage: ${String(application.workflow?.currentStage ?? 'APPLICATION').replaceAll('_', ' ')}`;
    item.append(link, stage);
    if (application.workflow?.assessment) { const assessment = document.createElement('p'); assessment.textContent = `Assessment: ${application.workflow.assessment.assessmentDate ?? 'date not recorded'} · ${application.workflow.assessment.score ?? 'score pending'}/100 · ${application.workflow.assessment.remarks ?? 'No remarks'}`; item.append(assessment); }
    if (application.workflow?.decision) { const decision = document.createElement('p'); decision.textContent = `Decision: ${application.workflow.decision.status} · ${application.workflow.decision.decidedAt ?? ''}${application.workflow.decision.reason ? ` · ${application.workflow.decision.reason}` : ''}`; item.append(decision); }
    if (application.workflow?.offer?.issuedAt) { const offer = document.createElement('section'); offer.className = 'card'; const heading = document.createElement('h3'); heading.textContent = 'Admission Offer'; const detail = document.createElement('p'); detail.textContent = `Offer issued ${new Date(application.workflow.offer.issuedAt).toLocaleDateString()}. ${application.workflow.offer.acceptedAt ? `Accepted ${new Date(application.workflow.offer.acceptedAt).toLocaleDateString()}.` : 'Awaiting acceptance.'}`; offer.append(heading, detail); item.append(offer); }
    if (application.feeAssessment) { const fee = document.createElement('p'); fee.textContent = `Fee assessment: GH₵${Number(application.feeAssessment.total ?? 0).toFixed(2)} · ${application.feeAssessment.paymentStatus ?? 'NOT_PAID'}`; item.append(fee); }
    const progress = document.createElement('ol'); progress.setAttribute('aria-label', `Workflow progress for ${application.applicationNumber}`);
    const completed = new Set(application.workflow?.completedStages ?? []);
    for (const workflowStage of workflowStages) { const step = document.createElement('li'); step.textContent = `${completed.has(workflowStage) ? '✓' : '○'} ${workflowStage.replaceAll('_', ' ')}`; progress.append(step); }
    item.append(progress);
    const action = (label, run) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button'; button.textContent = label; button.addEventListener('click', async () => { button.disabled = true; try { await run(); await loadApplications(); } catch (error) { applicationsStatus.textContent = error.message; button.disabled = false; } }); item.append(button); };
    for (const document of application.documents ?? []) {
      const download = documentLink(application.applicationNumber, document);
      item.append(download);
      if (document.reviewStatus === 'PENDING') {
        action(`Approve ${document.documentType.replaceAll('_', ' ')}`, async () => { const note = window.prompt('Review note (optional):', 'Verified'); return jsonRequest(`/api/admission-applications/${encodeURIComponent(application.applicationNumber)}/documents/${encodeURIComponent(document.id)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'APPROVED', note: note ?? '' }) }); });
        action(`Flag ${document.documentType.replaceAll('_', ' ')}`, async () => { const note = window.prompt('Reason this document needs attention:'); if (!note?.trim()) throw new Error('A reason is required to flag a document.'); return jsonRequest(`/api/admission-applications/${encodeURIComponent(application.applicationNumber)}/documents/${encodeURIComponent(document.id)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'FLAGGED', note }) }); });
      }
    }
    if (application.status === 'SUBMITTED') action('Record assessment / interview', async () => {
      const assessmentDate = window.prompt('Assessment / interview date (YYYY-MM-DD):', new Date().toISOString().slice(0, 10));
      if (!assessmentDate) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(assessmentDate) || Number.isNaN(Date.parse(`${assessmentDate}T00:00:00Z`))) throw new Error('Enter the assessment date as YYYY-MM-DD.');
      const enteredScore = window.prompt('Assessment score (0–100):');
      if (enteredScore === null) return;
      const score = Number(enteredScore);
      if (!Number.isFinite(score) || score < 0 || score > 100) throw new Error('Enter an assessment score from 0 to 100.');
      const remarks = window.prompt('Assessment / interview remarks:');
      if (!remarks?.trim()) throw new Error('Assessment remarks are required.');
      return jsonRequest(`/api/admission-applications/${encodeURIComponent(application.applicationNumber)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'UNDER_REVIEW', assessmentDate, assessmentScore: score, assessmentRemarks: remarks }) });
    });
    if (application.status === 'UNDER_REVIEW') {
      action('Approve and issue offer', async () => {
        const classAssigned = application.section1?.classAppliedFor;
        if (!classAssigned) throw new Error('Requested class is missing. Reopen the application and select a class.');
        const decisionReason = window.prompt('Approval remarks / decision reason:', 'Approved following assessment.');
        if (!decisionReason?.trim()) throw new Error('Decision remarks are required.');
        return jsonRequest(`/api/admission-applications/${encodeURIComponent(application.applicationNumber)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'ACCEPTED', entranceAssessmentScore: application.workflow?.assessment?.score, assessmentDate: application.workflow?.assessment?.assessmentDate, assessmentRemarks: application.workflow?.assessment?.remarks, decisionReason, classAssigned }) });
      });
      action('Reject application', async () => { const rejectionReason = window.prompt('Reason for rejection:'); if (!rejectionReason?.trim()) throw new Error('A rejection reason is required.'); return jsonRequest(`/api/admission-applications/${encodeURIComponent(application.applicationNumber)}/review`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'REJECTED', rejectionReason }) }); });
    }
    if (application.status === 'ACCEPTED' && !application.workflow?.offer?.acceptedAt) action('Record offer acceptance', async () => jsonRequest(`/api/admission-applications/${encodeURIComponent(application.applicationNumber)}/offer-acceptance`, { method: 'POST' }));
    if (application.status === 'ACCEPTED' && application.workflow?.offer?.acceptedAt && !application.studentId) action('Complete registration, enrollment, Student ID, and class assignment', async () => jsonRequest(`/api/admission-applications/${encodeURIComponent(application.applicationNumber)}/enroll`, { method: 'POST' }));
    if (application.studentId) { const identity = document.createElement('p'); identity.textContent = `Student ID: ${application.officialUse?.permanentStudentId ?? 'allocated'} · Enrollment: complete`; item.append(identity); }
    list.append(item);
  }
  applicationsList.append(list);
}

function documentLink(applicationNumber, document) {
  const link = document.createElement('a');
  link.href = `/api/admission-applications/${encodeURIComponent(applicationNumber)}/documents/${encodeURIComponent(document.id)}/download`;
  link.textContent = `${document.documentType.replaceAll('_', ' ')} · ${document.uploadStatus ?? 'UPLOADED'} · ${document.reviewStatus ?? 'PENDING'}${document.originalName ? ` · ${document.originalName}` : ''}`;
  link.rel = 'noopener';
  return link;
}

async function loadApplications() {
  try { const result = await jsonRequest('/api/admission-applications'); renderApplications(result.applications ?? []); }
  catch (error) { applicationsStatus.textContent = `Unable to load applications: ${error.message}`; }
}

enquiryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (submitting) return;
  submitting = true;
  const button = enquiryForm.querySelector('button[type="submit"]'); button.disabled = true;
  enquiryStatus.textContent = 'Saving enquiry…';
  try {
    const values = new FormData(enquiryForm);
    const fullName = String(values.get('applicantName') ?? '').trim().replace(/\s+/g, ' ');
    const parts = fullName.split(' ');
    if (parts.length < 2) throw new Error('Enter the applicant’s first and last name.');
    const parentPhone = normalizeGhanaPhone(values.get('parentPhone'));
    let enquiryRequestId = sessionStorage.getItem(requestIdKey);
    if (!enquiryRequestId) { enquiryRequestId = crypto.randomUUID(); sessionStorage.setItem(requestIdKey, enquiryRequestId); }
    const classId = String(values.get('classId'));
    const className = classField.selectedOptions[0]?.textContent ?? '';
    const yearSelection = JSON.parse(String(values.get('academicYear')));
    const termSelection = JSON.parse(String(values.get('term')));
    const created = await jsonRequest('/api/admission-applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ studentFirstName: parts.slice(0, -1).join(' '), studentSurname: parts.at(-1), classAppliedFor: classId, className, primaryGuardianPrimaryPhone: parentPhone, academicYear: yearSelection.name, admissionYear: yearSelection.admissionYear, academicYearId: yearSelection.id, admissionTerm: termSelection.name, termId: termSelection.id, enquiryRequestId, enquiry: { applicantName: fullName, parentPhone, classId, className } }) });
    sessionStorage.removeItem(requestIdKey);
    window.location.assign(`/admission-application.html?applicationNumber=${encodeURIComponent(created.applicationNumber)}&step=2`);
  } catch (error) {
    enquiryStatus.textContent = error.message;
    submitting = false; button.disabled = false;
  }
});

Promise.all([loadOptions(), loadApplications()]);
