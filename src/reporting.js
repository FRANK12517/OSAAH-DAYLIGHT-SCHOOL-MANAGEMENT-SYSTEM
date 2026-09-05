import { randomUUID } from 'node:crypto';

const BRAND = { schoolName: 'OSAAH DAYLIGHT SCH. COM.', location: 'BOGOSO', motto: 'AIM HIGH, ACADEMIC IS OUR CORE VALUE' };
const TERMS = ['1st Term', '2nd Term', '3rd Term'];
const REPORT_TYPES = ['ACADEMIC_PERFORMANCE', 'FINANCIAL', 'STUDENT_PERFORMANCE', 'CLASS_PERFORMANCE', 'SUBJECT_PERFORMANCE', 'TEACHER_PERFORMANCE', 'ATTENDANCE_PERFORMANCE', 'ENROLLMENT', 'ADMISSIONS', 'PROMOTION', 'REVENUE', 'FEES', 'ARREARS', 'COLLECTIONS', 'OPERATIONS', 'COMPLIANCE'];
const DEFAULT_SCOPE = 'WHOLE_SCHOOL';
const VALID_FINANCIAL_STATUSES = new Set(['VALID']);
const MONEY = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS', maximumFractionDigits: 2 });

function pdfEscape(value) { return String(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)'); }
function makePdf(lines) { const content = ['BT', '/F1 12 Tf', '72 760 Td', ...lines.flatMap((line, index) => [`(${pdfEscape(line)}) Tj`, index < lines.length - 1 ? '0 -18 Td' : '']), 'ET'].join('\n'); const objects = [`<< /Type /Catalog /Pages 2 0 R >>`, `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`, `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`]; let output = '%PDF-1.4\n'; const offsets = [0]; for (let index = 0; index < objects.length; index += 1) { offsets.push(output.length); output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`; } const xref = output.length; output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return output; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function asNumber(value) { const number = Number(value); return Number.isFinite(number) ? number : 0; }
function normalize(value) { return String(value ?? '').trim().toLowerCase(); }
function classLevel(classId) { const label = normalize(classId); if (label.includes('kg')) return 'KG'; if (label.includes('jhs')) return 'JHS'; if (label.includes('primary') || label.includes('basic')) return 'PRIMARY'; return 'OTHER'; }
function classLabel(classId) { return String(classId ?? '').replaceAll('-', ' ').replaceAll('_', ' '); }
function classMatchesScope(classId, scope) { if (!classId) return false; if (!scope || scope === DEFAULT_SCOPE) return true; const level = classLevel(classId); return level === scope || normalize(classId) === normalize(scope) || normalize(classLabel(classId)) === normalize(scope); }
function gradeFor(score) { if (score >= 80) return 'A'; if (score >= 70) return 'B'; if (score >= 60) return 'C'; if (score >= 50) return 'D'; return 'F'; }
function canViewAcademic(user) { return ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'TEACHER'].includes(user?.roleKey); }
function canViewFinancial(user) { return ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'].includes(user?.roleKey); }
function isTeacher(user) { return user?.roleKey === 'TEACHER'; }

export function createReportingService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight' } = {}) {
  const reportAudit = [];
  const officialDocuments = [];
  function audit(event) { reportAudit.push({ id: randomUUID(), schoolId, ...event, createdAt: now() }); }

  function availableAcademicYears({ examinations, fees, attendance }) {
    const values = new Set();
    for (const exam of examinations ?? []) if (exam.academicYearId) values.add(exam.academicYearId);
    for (const fee of fees?.structures ?? []) if (fee.academicYear) values.add(fee.academicYear);
    for (const record of attendance ?? []) if (record.academicYearId) values.add(record.academicYearId);
    return [...values];
  }

  function resolveScope(user, requestedScope, students) {
    if (!canViewAcademic(user) && !canViewFinancial(user)) throw new Error('Forbidden.');
    const requested = String(requestedScope?.scope ?? requestedScope?.classId ?? requestedScope ?? DEFAULT_SCOPE).trim() || DEFAULT_SCOPE;
    if (isTeacher(user)) {
      const assigned = [...new Set((user.assignedClassIds ?? []).filter(Boolean))];
      if (!assigned.length) throw new Error('No class assignment found for the authenticated teacher.');
      if (requested === DEFAULT_SCOPE) throw new Error('Class teachers may only generate reports for their assigned class.');
      if (!assigned.includes(requested)) throw new Error('Unauthorized class scope.');
      return { scope: requested, classIds: [requested] };
    }
    return { scope: requested, classIds: requested === DEFAULT_SCOPE ? [...new Set(students.map((student) => student.classId).filter(Boolean))] : [...new Set(students.filter((student) => classMatchesScope(student.classId, requested)).map((student) => student.classId).filter(Boolean))] };
  }

  function buildAcademicReport(filters = {}, user = {}, feeds = {}) {
    if (!canViewAcademic(user)) throw new Error('Forbidden.');
    const students = feeds.students?.listStudents?.({ requestedSchoolId: schoolId }) ?? [];
    const attendance = feeds.attendance?.listStudentRecords?.({ requestedSchoolId: schoolId }) ?? [];
    const marks = feeds.examinations?.listMarks?.({ requestedSchoolId: schoolId }) ?? [];
    const examinations = feeds.examinations?.listExaminations?.({ requestedSchoolId: schoolId }) ?? [];
    const scopeInfo = resolveScope(user, filters.scope ?? filters.classId ?? DEFAULT_SCOPE, students);
    const academicYear = filters.academicYear ?? availableAcademicYears({ examinations, fees: feeds.fees, attendance })[0] ?? null;
    const term = filters.term ?? TERMS[0];
    const scopedStudents = students.filter((student) => scopeInfo.scope === DEFAULT_SCOPE || classMatchesScope(student.classId, scopeInfo.scope));
    const scopedIds = new Set(scopedStudents.map((student) => student.id));
    const scopedMarks = marks.filter((mark) => scopedIds.has(mark.studentId) && (!filters.subjectId || mark.subjectId === filters.subjectId));
    const studentTotals = new Map();
    const subjectTotals = new Map();
    for (const mark of scopedMarks) {
      const score = asNumber(mark.weightedMarks ?? mark.rawMarks);
      const student = studentTotals.get(mark.studentId) ?? { total: 0, count: 0 };
      student.total += score;
      student.count += 1;
      studentTotals.set(mark.studentId, student);
      const subject = subjectTotals.get(mark.subjectId) ?? { total: 0, count: 0, highest: -Infinity, lowest: Infinity };
      subject.total += score;
      subject.count += 1;
      subject.highest = Math.max(subject.highest, score);
      subject.lowest = Math.min(subject.lowest, score);
      subjectTotals.set(mark.subjectId, subject);
    }
    const studentPerformance = scopedStudents.map((student) => {
      const totals = studentTotals.get(student.id);
      const averageScore = totals?.count ? Math.round((totals.total / totals.count) * 100) / 100 : null;
      return { studentId: student.id, studentName: [student.firstName, student.middleName, student.surname].filter(Boolean).join(' '), classId: student.classId ?? null, averageScore, assessmentCount: totals?.count ?? 0, grade: averageScore === null ? null : gradeFor(averageScore) };
    }).sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1));
    const classGroups = new Map();
    for (const student of scopedStudents) {
      const key = student.classId ?? 'UNASSIGNED';
      const group = classGroups.get(key) ?? { classId: key, className: classLabel(key), total: 0, count: 0, studentCount: 0 };
      const row = studentPerformance.find((item) => item.studentId === student.id);
      group.studentCount += 1;
      if (row?.averageScore !== null) {
        group.total += row.averageScore;
        group.count += 1;
      }
      classGroups.set(key, group);
    }
    const subjectPerformance = [...subjectTotals.entries()].map(([subjectId, subject]) => ({ subjectId, averageScore: subject.count ? Math.round((subject.total / subject.count) * 100) / 100 : null, highestScore: subject.highest === -Infinity ? null : subject.highest, lowestScore: subject.lowest === Infinity ? null : subject.lowest, assessedCount: subject.count })).sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1));
    const attendanceRows = attendance.filter((record) => scopedIds.has(record.studentId));
    const attendanceSummary = Object.fromEntries(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED_ABSENCE', 'UNEXCUSED_ABSENCE', 'EARLY_DEPARTURE', 'SICK_ABSENCE'].map((status) => [status, attendanceRows.filter((record) => record.status === status).length]));
    const assessedStudents = studentPerformance.filter((row) => row.assessmentCount > 0).length;
    const totalAverage = studentPerformance.filter((row) => row.averageScore !== null).reduce((sum, row) => sum + row.averageScore, 0);
    const report = {
      id: randomUUID(),
      reportType: 'ACADEMIC_PERFORMANCE',
      schoolId,
      schoolName: BRAND.schoolName,
      schoolLogo: '/assets/osaah-daylight-logo.png',
      title: 'Academic Performance Report',
      generatedAt: now(),
      generatedBy: user.id ?? user.userId ?? null,
      generatedByName: user.fullName ?? user.username ?? user.id ?? null,
      generatedByRole: user.roleKey ?? null,
      academicYear,
      term,
      scope: scopeInfo.scope,
      summary: {
        totalStudents: scopedStudents.length,
        totalAssessed: assessedStudents,
        incompleteResults: scopedStudents.length - assessedStudents,
        overallAverage: assessedStudents ? Math.round((totalAverage / assessedStudents) * 100) / 100 : null,
        passRate: assessedStudents ? Math.round((studentPerformance.filter((row) => (row.averageScore ?? 0) >= 50).length / assessedStudents) * 10000) / 100 : 0,
        failRate: assessedStudents ? Math.round((studentPerformance.filter((row) => (row.averageScore ?? 0) < 50).length / assessedStudents) * 10000) / 100 : 0,
        attendance: attendanceSummary
      },
      classPerformance: [...classGroups.values()].map((group) => ({ classId: group.classId, className: group.className, studentCount: group.studentCount, averageScore: group.count ? Math.round((group.total / group.count) * 100) / 100 : null })).sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1)),
      subjectPerformance,
      studentPerformance,
      highestPerformers: studentPerformance.slice(0, 5),
      lowestPerformers: [...studentPerformance].sort((a, b) => (a.averageScore ?? 101) - (b.averageScore ?? 101)).slice(0, 5),
      availableAcademicYears: availableAcademicYears({ examinations, fees: feeds.fees, attendance }),
      termOptions: TERMS,
      missingData: assessedStudents < scopedStudents.length ? ['Some learners have incomplete results.'] : [],
      reportDate: now()
    };
    audit({ action: 'ACADEMIC_REPORT_GENERATED', userId: user.id ?? user.userId ?? null, roleKey: user.roleKey ?? null, reportType: report.reportType, scope: report.scope, academicYear: report.academicYear, term: report.term });
    return report;
  }

  function buildFinancialReport(filters = {}, user = {}, feeds = {}) {
    if (!canViewFinancial(user)) throw new Error('Forbidden.');
    const academicYear = filters.academicYear ?? null;
    const term = filters.term ?? null;
    const dateFrom = filters.dateFrom ?? null;
    const dateTo = filters.dateTo ?? null;
    const incomes = feeds.fees?.listIncomes?.({ requestedSchoolId: schoolId }) ?? [];
    const expenses = feeds.fees?.listExpenses?.({ requestedSchoolId: schoolId }) ?? [];
    const invoices = feeds.fees?.listInvoices?.({ requestedSchoolId: schoolId }) ?? [];
    const payments = (feeds.fees?.listPayments?.() ?? []).filter((payment) => payment.schoolId === schoolId && payment.status === 'VALID');
    const withinDates = (item) => (!dateFrom || item.date >= dateFrom) && (!dateTo || item.date <= dateTo);
    const matchAcademic = (item) => (!academicYear || !item.academicYearId && !item.academicYear || item.academicYearId === academicYear || item.academicYear === academicYear);
    const matchTerm = (item) => (!term || !item.termId && !item.term || item.termId === term || item.term === term);
    const validIncome = incomes.filter((item) => item.schoolId === schoolId && VALID_FINANCIAL_STATUSES.has(String(item.status ?? 'VALID').toUpperCase()) && withinDates(item) && matchAcademic(item) && matchTerm(item));
    const validExpenses = expenses.filter((item) => item.schoolId === schoolId && VALID_FINANCIAL_STATUSES.has(String(item.status ?? 'VALID').toUpperCase()) && withinDates(item) && matchAcademic(item) && matchTerm(item));
    const totalIncome = validIncome.reduce((sum, item) => sum + asNumber(item.amount), 0) + payments.reduce((sum, payment) => sum + asNumber(payment.amount), 0);
    const totalExpenses = validExpenses.reduce((sum, item) => sum + asNumber(item.amount), 0);
    const totalExpectedFees = invoices.reduce((sum, invoice) => sum + asNumber(invoice.total), 0);
    const totalFeesCollected = payments.reduce((sum, payment) => sum + asNumber(payment.amount), 0);
    const totalOutstandingFees = invoices.reduce((sum, invoice) => sum + asNumber(invoice.balance), 0);
    const collectionRate = totalExpectedFees ? Math.round((totalFeesCollected / totalExpectedFees) * 10000) / 100 : 0;
    const report = {
      id: randomUUID(),
      reportType: 'FINANCIAL',
      reportVariant: filters.reportType ?? 'FINANCIAL_SUMMARY',
      schoolId,
      schoolName: BRAND.schoolName,
      schoolLogo: '/assets/osaah-daylight-logo.png',
      title: 'Financial Report',
      generatedAt: now(),
      generatedBy: user.id ?? user.userId ?? null,
      generatedByName: user.fullName ?? user.username ?? user.id ?? null,
      generatedByRole: user.roleKey ?? null,
      academicYear,
      term,
      dateFrom,
      dateTo,
      summary: {
        openingBalance: asNumber(filters.openingBalance),
        totalIncome,
        totalExpenses,
        netSurplusDeficit: totalIncome - totalExpenses,
        totalExpectedFees,
        totalFeesCollected,
        totalOutstandingFees,
        collectionRate,
        incomeVsExpenses: totalIncome - totalExpenses
      },
      incomeByCategory: Object.values(validIncome.reduce((acc, item) => { const key = item.category ?? 'OTHER'; acc[key] = acc[key] ?? { category: key, total: 0, count: 0 }; acc[key].total += asNumber(item.amount); acc[key].count += 1; return acc; }, {})),
      expenseByCategory: Object.values(validExpenses.reduce((acc, item) => { const key = item.category ?? 'OTHER'; acc[key] = acc[key] ?? { category: key, total: 0, count: 0 }; acc[key].total += asNumber(item.amount); acc[key].count += 1; return acc; }, {})),
      incomeTransactions: validIncome,
      expenseTransactions: validExpenses,
      feeCollection: { totalExpectedFees, totalFeesCollected, totalOutstandingFees, collectionRate },
      reportDate: now()
    };
    audit({ action: 'FINANCIAL_REPORT_GENERATED', userId: user.id ?? user.userId ?? null, roleKey: user.roleKey ?? null, reportType: report.reportType, academicYear, term, dateFrom, dateTo });
    return report;
  }

  function buildReport(type, filters = {}, user = {}, feeds = {}) { if (type === 'ACADEMIC_PERFORMANCE') return buildAcademicReport(filters, user, feeds); if (type === 'FINANCIAL') return buildFinancialReport(filters, user, feeds); if (!REPORT_TYPES.includes(type)) throw new Error('Invalid report type'); return { schoolId, reportType: type, filters: { academicYear: filters.academicYear ?? null, term: filters.term ?? null, classId: filters.classId ?? null, streamId: filters.streamId ?? null, subjectId: filters.subjectId ?? null, dateFrom: filters.dateFrom ?? null, dateTo: filters.dateTo ?? null, studentId: filters.studentId ?? null, staffId: filters.staffId ?? null }, generatedAt: now(), generatedBy: user.id ?? user.userId ?? null, rows: filters.rows ?? [], summary: filters.summary ?? {} }; }
  function generateOfficialDocument(input, actor) { const document = { id: randomUUID(), schoolId, provenance: 'PRODUCTION', documentNumber: `OFF-${String(officialDocuments.length + 1).padStart(6, '0')}`, type: input.type, recipientId: input.recipientId ?? null, studentId: input.studentId ?? null, date: input.date ?? now().slice(0, 10), title: input.title ?? String(input.type ?? 'DOCUMENT').replaceAll('_', ' '), body: input.body ?? '', signatures: input.signatures ?? [], stamp: input.stamp ?? null, verificationCode: randomUUID(), createdBy: actor.id ?? actor.userId ?? null, createdAt: now() }; document.pdf = makePdf([BRAND.schoolName, BRAND.location, BRAND.motto, document.title, `Document No: ${document.documentNumber}`, `Date: ${document.date}`, document.body, 'Official school document']); officialDocuments.push(document); return { ...document }; }
  function verifyOfficialDocument(code) { const document = officialDocuments.find((item) => item.schoolId === schoolId && item.verificationCode === code); return document ? { authentic: true, documentNumber: document.documentNumber, type: document.type, title: document.title, date: document.date } : { authentic: false }; }
  function exportReport(report, format = 'csv') { const safeFormat = String(format ?? 'csv').toLowerCase(); if (!['csv', 'excel', 'pdf', 'json'].includes(safeFormat)) throw new Error('Unsupported export format'); if (safeFormat === 'json') return { format: 'json', mimeType: 'application/json', filename: `${String(report.reportType ?? 'report').toLowerCase()}.json`, content: JSON.stringify(report, null, 2) }; const rows = report.studentPerformance ?? report.incomeTransactions ?? report.rows ?? []; if (safeFormat === 'pdf') return { format: 'pdf', mimeType: 'application/pdf', filename: `${String(report.reportType ?? 'report').toLowerCase()}.pdf`, content: makePdf([BRAND.schoolName, report.title ?? report.reportType ?? 'Report', `Generated: ${report.generatedAt}`, `Generated by: ${report.generatedByRole ?? ''}`, `Scope: ${report.scope ?? ''}`, `Academic year: ${report.academicYear ?? ''}`, `Term: ${report.term ?? ''}`, ...Object.entries(report.summary ?? {}).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.length : typeof value === 'object' && value !== null ? JSON.stringify(value) : value ?? ''}`), ...rows.slice(0, 20).map((row) => Object.values(row).join(' | '))]) }; const csv = [Object.keys(rows[0] ?? report.summary ?? {}).join(','), ...rows.map((row) => Object.values(row).map((value) => JSON.stringify(value ?? '')).join(','))].join('\n'); return { format: safeFormat, mimeType: safeFormat === 'excel' ? 'application/vnd.ms-excel' : 'text/csv', filename: `${String(report.reportType ?? 'report').toLowerCase()}.${safeFormat === 'excel' ? 'xls' : 'csv'}`, content: csv }; }
  function listDocuments(user = {}) { return officialDocuments.filter((document) => document.schoolId === schoolId && (document.recipientId === user.id || document.studentId === user.studentId || user.roleKey === 'PROPRIETOR' || user.roleKey === 'SCHOOL_ADMIN')).map(({ verificationCode, pdf, ...safe }) => safe); }
  return { buildReport, buildAcademicReport, buildFinancialReport, exportReport, generateOfficialDocument, verifyOfficialDocument, listDocuments, terms: () => [...TERMS], auditTrail: () => reportAudit.map((event) => ({ ...event })), availableAcademicYears, counts: () => ({ audits: reportAudit.length, officialDocuments: officialDocuments.length }) };
}
