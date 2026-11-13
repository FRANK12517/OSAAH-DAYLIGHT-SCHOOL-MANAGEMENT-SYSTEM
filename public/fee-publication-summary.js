const valueOf = (row, camel, snake) => row?.[camel] ?? row?.[snake] ?? null;

function parsePublishedAt(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (value == null || value === '') return null;
  const text = String(value).trim();
  const timestamp = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)
    ? text
    : `${text.replace(' ', 'T')}Z`;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function latestPublishedFeeSummary(rows = []) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (String(valueOf(row, 'status', 'status') ?? '').toUpperCase() !== 'PUBLISHED') continue;
    const feeStructureId = valueOf(row, 'feeStructureId', 'fee_structure_id');
    const academicYearId = valueOf(row, 'academicYearId', 'academic_year_id');
    const termId = valueOf(row, 'termId', 'term_id');
    const scope = valueOf(row, 'applicabilityType', 'applicability_type');
    const classId = valueOf(row, 'classId', 'class_id');
    const amountMinor = Number(valueOf(row, 'amountMinor', 'amount_minor'));
    const customFeeTypeName = valueOf(row, 'customFeeTypeName', 'custom_fee_type_name');
    const key = JSON.stringify([feeStructureId, academicYearId, termId, scope, classId, amountMinor, customFeeTypeName]);
    const publishedAt = valueOf(row, 'publishedAt', 'published_at');
    const publishedDate = parsePublishedAt(publishedAt);
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, {
        feeStructureId,
        feeType: valueOf(row, 'feeTypeName', 'fee_type_name') || customFeeTypeName || feeStructureId || 'Published fee',
        customFeeTypeName,
        academicYearId,
        academicYearName: valueOf(row, 'academicYearName', 'academic_year_name') || academicYearId,
        termId,
        termName: valueOf(row, 'termName', 'term_name') || termId,
        scope,
        classId,
        amountMinor,
        publishedAt,
        timestamp: publishedDate?.getTime() ?? Number.NEGATIVE_INFINITY,
        studentCount: 1,
      });
      continue;
    }
    current.studentCount += 1;
    if (publishedDate && publishedDate.getTime() > current.timestamp) {
      current.publishedAt = publishedAt;
      current.timestamp = publishedDate.getTime();
    }
  }
  return [...grouped.values()].sort((left, right) => right.timestamp - left.timestamp)[0] ?? null;
}

export function formatFeeAmountFromMinorUnits(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '—';
  return `GH₵ ${new Intl.NumberFormat('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount / 100)}`;
}

export function formatPublishedDateTime(value) {
  const date = parsePublishedAt(value);
  if (!date) return { date: 'Unavailable', time: 'Unavailable' };
  const options = { timeZone: 'Africa/Accra' };
  return {
    date: new Intl.DateTimeFormat('en-GH', { ...options, day: 'numeric', month: 'short', year: 'numeric' }).format(date),
    time: new Intl.DateTimeFormat('en-GH', { ...options, hour: 'numeric', minute: '2-digit', hour12: true }).format(date),
  };
}

export function renderPublishedFeeSummary(container, rows = []) {
  if (!container) return null;
  const summary = latestPublishedFeeSummary(rows);
  container.replaceChildren();
  if (!summary) {
    container.hidden = true;
    return null;
  }

  const heading = document.createElement('h2');
  heading.textContent = 'Latest published fee';
  const definitionList = document.createElement('dl');
  const { date, time } = formatPublishedDateTime(summary.publishedAt);
  const target = summary.scope === 'SPECIFIC_CLASS' ? `Specific class · ${summary.classId ?? 'Unavailable'}` : 'Whole school';
  const details = [
    ['Fee Type', summary.feeType],
    ['Target', target],
    ['Academic Year', summary.academicYearName ?? summary.academicYearId ?? 'Unavailable'],
    ['Term', summary.termName ?? summary.termId ?? 'Unavailable'],
    ['Date Published', date],
    ['Amount', formatFeeAmountFromMinorUnits(summary.amountMinor)],
    ['Time Published', time],
  ];
  for (const [label, value] of details) {
    const term = document.createElement('dt');
    term.textContent = label;
    const description = document.createElement('dd');
    description.textContent = String(value ?? 'Unavailable');
    definitionList.append(term, description);
  }
  container.append(heading, definitionList);
  container.hidden = false;
  return summary;
}
