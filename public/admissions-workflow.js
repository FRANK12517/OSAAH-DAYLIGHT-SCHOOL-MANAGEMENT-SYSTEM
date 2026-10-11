const categoryForm = document.querySelector('#registration-category');
const panel = document.querySelector('#registration-panel');
const status = document.querySelector('#registration-status');

let migrationPreview = null;

function showStatus(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

async function api(path, options) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) } });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
  return result;
}

function renderMigration(preview) {
  migrationPreview = preview;
  panel.replaceChildren();
  const heading = document.createElement('h2');
  heading.textContent = 'Already-enrolled student migration';
  const explanation = document.createElement('p');
  explanation.textContent = 'This dry run only checks existing student records that already have a profile and enrollment. Eligible records receive an ID based on their verified OSAAH admission year. Students with uncertain years, duplicate identities, or inconsistent links require manual reconciliation.';
  panel.append(heading, explanation);

  const counts = document.createElement('p');
  counts.textContent = `${preview.counts.eligible} eligible · ${preview.counts.alreadyHasId} already have an ID · ${preview.counts.blocked} need review`;
  panel.append(counts);

  const list = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Eligible records';
  list.append(legend);
  const eligible = preview.records.filter((record) => record.action === 'ASSIGN_ID_FOR_VERIFIED_YEAR');
  if (!eligible.length) {
    const empty = document.createElement('p');
    empty.textContent = 'There are no eligible records in this preview.';
    list.append(empty);
  }
  for (const record of eligible) {
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.name = 'studentRef';
    checkbox.value = record.studentRef;
    checkbox.checked = true;
    label.append(checkbox, document.createTextNode(` Student reference ${record.studentRef} · verified admission year ${record.admissionYear}`));
    list.append(label);
  }
  const review = preview.records.filter((record) => record.action === 'MANUAL_REVIEW');
  if (review.length) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = `Records requiring manual review (${review.length})`;
    details.append(summary);
    for (const record of review) {
      const item = document.createElement('p');
      item.textContent = `${record.studentRef}: ${record.reasons.join(', ')}`;
      details.append(item);
    }
    list.append(details);
  }
  const execute = document.createElement('button');
  execute.type = 'button';
  execute.className = 'primary-button';
  execute.textContent = 'Assign IDs to selected eligible records';
  execute.disabled = eligible.length === 0;
  execute.addEventListener('click', () => executeMigration(list, execute));
  panel.append(list, execute);
  panel.hidden = false;
}

async function loadMigrationPreview() {
  showStatus('Loading a read-only migration preview…');
  panel.hidden = true;
  const preview = await api('/api/staff-admissions/migration-preview');
  renderMigration(preview);
  showStatus('Preview complete. No student records have been changed.');
}

async function executeMigration(list, button) {
  const studentRefs = [...list.querySelectorAll('input[name="studentRef"]:checked')].map((input) => input.value);
  if (!studentRefs.length) return showStatus('Select at least one eligible record.', 'error');
  if (!window.confirm(`Assign Permanent Student IDs to ${studentRefs.length} selected existing records? This action is audited and cannot be undone automatically.`)) return;
  button.disabled = true;
  showStatus('Applying the selected migration…');
  try {
    const result = await api('/api/staff-admissions/migration', {
      method: 'POST',
      body: JSON.stringify({ execute: true, requestKey: crypto.randomUUID(), previewFingerprint: migrationPreview.fingerprint, studentRefs })
    });
    const migrated = result.summary?.migrated ?? 0;
    const preserved = result.summary?.preserved ?? 0;
    const flagged = (result.summary?.needsReview ?? 0) + (result.summary?.failed ?? 0);
    const completionMessage = `Migration finished: ${migrated} ID${migrated === 1 ? '' : 's'} assigned; ${preserved} existing ID${preserved === 1 ? '' : 's'} preserved; ${flagged} record${flagged === 1 ? '' : 's'} flagged.`;
    await loadMigrationPreview();
    const completed = (result.items ?? []).filter((item) => ['MIGRATED', 'PRESERVED'].includes(item.outcome));
    if (completed.length) {
      const resultHeading = document.createElement('h2');
      resultHeading.textContent = 'Completed student IDs';
      const resultList = document.createElement('ul');
      for (const item of completed) {
        const row = document.createElement('li');
        row.textContent = `Student reference ${item.studentRef}: ${item.permanentStudentId}`;
        resultList.append(row);
      }
      panel.append(resultHeading, resultList);
    }
    showStatus(completionMessage);
  } catch (error) {
    showStatus(`${error.message} Reload the preview before retrying.`, 'error');
    button.disabled = false;
  }
}

async function restrictMigrationCategory() {
  const migrationOption = categoryForm.querySelector('input[value="EXISTING_STUDENT"]')?.closest('label');
  if (!migrationOption) return;
  try {
    const { user } = await api('/api/sidebar');
    const canReviewMigration = user?.portal === 'school' && ['PROPRIETOR', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'].includes(user.roleKey);
    if (!canReviewMigration) migrationOption.remove();
  } catch {
    migrationOption.remove();
    showStatus('Staff permissions could not be verified. Reload after signing in to the school portal.', 'error');
  }
}

function renderOtherCategory(category) {
  panel.replaceChildren();
  const transfer = category === 'TRANSFER';
  const heading = document.createElement('h2');
  heading.textContent = transfer ? 'Transfer student' : 'First-time student';
  const explanation = document.createElement('p');
  explanation.textContent = transfer
    ? 'Transfer students must follow the school’s applicable transfer review, document, and approval requirements. They cannot use the existing-student migration shortcut.'
    : 'First-time students must complete the existing application, document, assessment, and approval steps. They cannot use the existing-student migration shortcut.';
  const next = document.createElement('p');
  next.textContent = 'The staff-assisted application persistence and enrollment path is not available in this release. Continue through the school’s approved admission process; do not create a student profile directly.';
  panel.append(heading, explanation, next);
  panel.hidden = false;
}

categoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const category = new FormData(categoryForm).get('category');
  if (category === 'EXISTING_STUDENT') {
    try { await loadMigrationPreview(); }
    catch (error) { showStatus(error.message, 'error'); }
    return;
  }
  if (category === 'TRANSFER' || category === 'FIRST_TIME') renderOtherCategory(category);
});

restrictMigrationCategory();
