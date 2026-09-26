window.downloadResultPdf = async function downloadResultPdf(result, { mock = false, status = null } = {}) {
  const query = new URLSearchParams({ studentId: result.studentId || '', classId: result.classId || '', academicYear: result.academicYear || '', term: result.term || '' });
  if (result.isPreview) query.set('sample', 'true');
  if (mock) query.set('mockLabel', result.mockLabel || '');
  const endpoint = mock ? '/api/academic/mock-result/pdf' : '/api/academic/result/pdf';
  const response = await fetch(`${endpoint}?${query}`, { credentials: 'same-origin', headers: { Accept: 'application/pdf' } });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw Error(body.error || 'PDF export failed.'); }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || `OSAAH_${mock ? 'Mock' : 'End-of-Term'}_Result.pdf`;
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.hidden = true; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); if (status) status.textContent = 'PDF downloaded.';
};
