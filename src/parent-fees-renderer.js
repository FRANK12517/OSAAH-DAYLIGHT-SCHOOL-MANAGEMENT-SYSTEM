export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function amountFromMinorUnits(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'Unavailable';
  return `GH₵ ${new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 100)}`;
}

function feeDescription(obligation) {
  const feeType = obligation.feeTypeName || obligation.feeType || obligation.customFeeTypeName || obligation.feeStructureId || 'Published fee';
  const academicYear = obligation.academicYearName || obligation.academicYearId || 'Academic year unavailable';
  const term = obligation.termName || obligation.termId || 'Term unavailable';
  return `<li><strong>${escapeHtml(feeType)}</strong><br><span>Amount: ${escapeHtml(amountFromMinorUnits(obligation.amountMinor ?? obligation.amount_minor))}</span><br><span>Academic year: ${escapeHtml(academicYear)} · Term: ${escapeHtml(term)}</span><br><small>Payment allocation unavailable</small></li>`;
}

export function renderParentFeeGroups(payload) {
  const groups = payload?.children ?? payload ?? [];
  return groups.map(({ student = {}, obligations = [] }) => `<article class="card"><h2>${escapeHtml(student.name || student.studentName || 'Child')}</h2><small>${escapeHtml(student.permanentStudentId || '')}</small>${obligations.length ? `<ul>${obligations.map(feeDescription).join('')}</ul>` : '<p>No published fees for the selected period</p>'}</article>`).join('') || '<p>No linked children.</p>';
}
