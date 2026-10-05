window.downloadResultPdf = async function downloadResultPdf(result, { mock = false, status = null } = {}) {
  const sample = result?.isSample === true;
  const query = new URLSearchParams({ studentId: result.studentId || '', classId: result.classId || '', academicYear: result.academicYear || '', term: result.term || '' });
  let endpoint;
  let init = { credentials: 'same-origin', headers: { Accept: 'application/pdf' } };
  if (sample) {
    endpoint = '/api/academic/sample/result/pdf';
    init = {
      ...init,
      method: 'POST',
      headers: { ...init.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sampleStudentId: result.permanentStudentId || result.studentIndexNumber || '',
        classId: result.classId || '',
        academicYear: result.academicYear || '',
        term: result.term || '',
        resultType: mock ? 'MOCK' : 'TERMINAL',
        ...(mock ? { mockLabel: result.mockLabel || '1st Mock' } : {})
      })
    };
  } else {
    if (mock) query.set('mockLabel', result.mockLabel || '');
    endpoint = mock ? '/api/academic/mock-result/pdf' : '/api/academic/result/pdf';
  }
  const response = await fetch(`${endpoint}${sample ? '' : `?${query}`}`, init);
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw Error(body.error || 'PDF export failed.'); }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/i);
  const filename = match?.[1] || `OSAAH_${mock ? 'Mock' : 'End-of-Term'}_Result.pdf`;
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.hidden = true; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); if (status) status.textContent = 'PDF downloaded.';
};
