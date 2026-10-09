/** Build a fee assessment from the same published structures exposed by Fee Setup. */
export function assessAdmissionFees({ structures = [], schoolId, classId, academicYearId, termId, assessedAt = new Date().toISOString() } = {}) {
  const items = structures.filter((fee) => fee.schoolId === schoolId
    && String(fee.status ?? '').toUpperCase() === 'PUBLISHED'
    && String(fee.type ?? '').toUpperCase() === 'ADMISSION'
    && (!fee.classId || fee.classId === classId)
    && (!fee.academicYearId || fee.academicYearId === academicYearId)
    && (!fee.termId || fee.termId === termId)
    && !fee.studentId)
    .map((fee) => {
      const amount = Number(fee.amount);
      if (!Number.isFinite(amount) || amount < 0) throw new Error('A published admission fee has an invalid amount.');
      return { feeStructureId: fee.id, type: fee.type, amount };
    });
  const total = Math.round(items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0)) / 100;
  return {
    source: 'FEE_SETUP', status: 'ASSESSED', paymentStatus: 'NOT_PAID', assessedAt,
    schoolId, classId, academicYearId, termId, currency: 'GHS', items, total
  };
}
