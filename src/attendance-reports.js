import { randomUUID } from 'node:crypto';
import PDFDocument from 'pdfkit';

const CANONICAL_CLASSES = Object.freeze(['Nursery 1', 'Nursery 2', 'KG 1', 'KG 2', 'Primary 1', 'Primary 2', 'Primary 3', 'Primary 4', 'Primary 5', 'Primary 6', 'JHS 1', 'JHS 2', 'JHS 3']);
const REPORT_TYPES = new Set(['STUDENT', 'STAFF', 'CLASS', 'GENDER', 'WEEKLY', 'MONTHLY', 'TERM', 'ACADEMIC_YEAR']);
const PERIODS = new Set(['DAILY', 'WEEKLY', 'MONTHLY', 'TERM', 'ACADEMIC_YEAR', 'CUSTOM']);
const PRESENT = new Set(['PRESENT', 'LATE', 'CHECKED_IN', 'CHECKED_OUT']);
const ABSENT = new Set(['ABSENT', 'UNEXCUSED_ABSENCE', 'SICK_ABSENCE']);
const EXCUSED = new Set(['EXCUSED', 'EXCUSED_ABSENCE', 'ON_LEAVE']);
const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const array = (value) => Array.isArray(value) ? value : [];
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const round = (value) => Math.round(number(value) * 100) / 100;
const percentage = (present, denominator) => denominator ? round((number(present) / number(denominator)) * 100) : null;
const statusOf = (row) => upper(row.status ?? row.attendanceStatus ?? row.attendance_status);
const dateOf = (row) => text(row.date ?? row.attendanceDate ?? row.attendance_date);
const personIdOf = (row) => text(row.profileId ?? row.studentId ?? row.student_id ?? row.staffId ?? row.staff_id ?? row.employeeId);
const idOf = (value) => text(value);
function fail(message, status = 400, code = 'ATTENDANCE_REPORT_ERROR') { throw Object.assign(new Error(message), { status, code }); }
function escXml(value) { return text(value).replace(/[<>&'\"]/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[char])); }
function safeFilename(value) { return text(value).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'attendance-report'; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function dateMatches(row, filters) {
  const date = dateOf(row); if (!date) return false;
  if (filters.academicYear && text(row.academicYear ?? row.academicYearId ?? row.academic_year_id) && text(row.academicYear ?? row.academicYearId ?? row.academic_year_id) !== text(filters.academicYear?.id ?? filters.academicYear)) return false;
  if (filters.term && text(row.term ?? row.termId ?? row.term_id) && text(row.term ?? row.termId ?? row.term_id) !== text(filters.term?.id ?? filters.term)) return false;
  if (filters.date && date !== filters.date) return false;
  if (filters.startDate && date < filters.startDate) return false;
  if (filters.endDate && date > filters.endDate) return false;
  if (filters.month && date.slice(0, 7) !== filters.month) return false;
  if (filters.week) { const match = /^(\d{4})-W(\d{2})$/.exec(text(filters.week)); if (match) { const jan4 = new Date(Date.UTC(Number(match[1]), 0, 4)); const day = jan4.getUTCDay() || 7; const start = new Date(jan4); start.setUTCDate(jan4.getUTCDate() - day + 1 + (Number(match[2]) - 1) * 7); const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6); const current = new Date(`${date}T00:00:00Z`); if (current < start || current > end) return false; } }
  if (filters.classId && text(row.classId ?? row.class_id) && text(row.classId ?? row.class_id) !== text(filters.classId)) return false;
  if (filters.status && statusOf(row) !== upper(filters.status)) return false;
  return true;
}
function effectiveRecords(records) {
  const latest = new Map();
  for (const row of array(records)) {
    if (!personIdOf(row) || !dateOf(row) || row.isTestRecord || upper(row.provenance) === 'TEST') continue;
    const key = `${personIdOf(row)}\u0000${dateOf(row)}`;
    const current = latest.get(key); const version = number(row.version); const currentVersion = number(current?.version ?? -1);
    const updated = text(row.updatedAt ?? row.updated_at ?? row.recordedAt ?? row.recorded_at);
    const currentUpdated = text(current?.updatedAt ?? current?.updated_at ?? current?.recordedAt ?? current?.recorded_at);
    if (!current || version > currentVersion || (version === currentVersion && updated >= currentUpdated)) latest.set(key, { ...row, status: statusOf(row) });
  }
  return [...latest.values()];
}
function summarize(records) {
  const result = { present: 0, absent: 0, excused: 0, other: 0, unmarked: 0 };
  for (const row of records) { const status = statusOf(row); if (PRESENT.has(status)) result.present += 1; else if (ABSENT.has(status)) result.absent += 1; else if (EXCUSED.has(status)) result.excused += 1; else result.other += 1; }
  return { ...result, observed: records.length, attendancePercentage: percentage(result.present, result.present + result.absent + result.other) };
}
function queryForPeriod(filters) {
  const period = upper(filters.period ?? 'TERM');
  const query = { ...filters };
  if (period === 'DAILY' && !query.date && query.startDate) query.date = query.startDate;
  if (period === 'CUSTOM' && (!query.startDate || !query.endDate)) fail('Custom reporting period requires startDate and endDate.');
  if (period === 'WEEKLY' && query.week && !/^\d{4}-W\d{2}$/.test(text(query.week))) fail('Week must use ISO YYYY-Www format.');
  if (period === 'MONTHLY' && query.month && !/^\d{4}-\d{2}$/.test(text(query.month))) fail('Month must use YYYY-MM format.');
  return query;
}
function classifyGender(value) { const gender = upper(value); return gender === 'MALE' || gender === 'BOYS' ? 'BOYS' : gender === 'FEMALE' || gender === 'GIRLS' ? 'GIRLS' : 'UNSPECIFIED'; }
function fullName(person) { return text(person?.fullName ?? [person?.firstName, person?.middleName, person?.lastName ?? person?.surname].filter(Boolean).join(' ')); }
function recordCounts(records) { const summary = summarize(records); return { daysPresent: summary.present, daysAbsent: summary.absent, recognizedExcusedDays: summary.excused, unmarkedEligibleDays: summary.unmarked, attendancePercentage: summary.attendancePercentage }; }
function canReadStaffPhone(user) { return ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER'].includes(upper(user?.roleKey)) || Boolean(user?.permissions?.has?.('staff.read')); }

// Small dependency-free ZIP writer used for valid XLSX files. All worksheet XML is stored uncompressed;
// this is intentionally simple, bounded by the report row limit, and avoids spreadsheet-parser risk.
const CRC_TABLE = (() => { const table = []; for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
function crc32(buffer) { let crc = 0xffffffff; for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function u16(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
function u32(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value >>> 0); return b; }
function zipStore(files) {
  const local = []; const central = []; let offset = 0; const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const [name, content] of files) {
    const nameBuffer = Buffer.from(name); const data = Buffer.from(content); const crc = crc32(data);
    const header = Buffer.concat([Buffer.from('PK\x03\x04', 'binary'), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), nameBuffer]);
    local.push(header, data);
    const entry = Buffer.concat([Buffer.from('PK\x01\x02', 'binary'), u16(20), u16(20), u16(0), u16(0), u16(dosTime), u16(dosDate), u32(crc), u32(data.length), u32(data.length), u16(nameBuffer.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameBuffer]);
    central.push(entry); offset += header.length + data.length;
  }
  const centralData = Buffer.concat(central); const localData = Buffer.concat(local); const end = Buffer.concat([Buffer.from('PK\x05\x06', 'binary'), u16(0), u16(0), u16(files.length), u16(files.length), u32(centralData.length), u32(localData.length), u16(0)]);
  return Buffer.concat([localData, centralData, end]);
}
function sheetXml(rows) { const xmlRows = rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((value, columnIndex) => `<c r="${String.fromCharCode(65 + Math.min(columnIndex, 25))}${rowIndex + 1}" t="inlineStr"><is><t>${escXml(value)}</t></is></c>`).join('')}</row>`).join(''); return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetData>${xmlRows}</sheetData><autoFilter ref="A1:Z${Math.max(1, rows.length)}"/></worksheet>`; }
function xlsxBuffer(report) {
  const summaryRows = [['OSAAH DAYLIGHT SCHOOL', 'Attendance Report'], ['Report type', report.reportType], ['Academic year', report.filters.academicYear ?? 'All'], ['Term', report.filters.term ?? 'All'], ['Reporting period', report.period.label], ['Generated at', report.generatedAt], [], ['Metric', 'Value'], ...Object.entries(report.summary ?? {}).map(([key, value]) => [key, typeof value === 'object' ? JSON.stringify(value) : value])];
  const detailRows = [Object.keys(report.rows?.[0] ?? { message: 'No observations' }), ...(report.rows?.length ? report.rows.map((row) => Object.values(row)) : [['No observations']])];
  const classRows = [['Class', 'Boys Enrolled', 'Girls Enrolled', 'Unspecified Enrolled', 'Total Enrolled', 'Boys Present', 'Girls Present', 'Total Present', 'Boys Absent', 'Girls Absent', 'Total Absent', 'Unmarked Student-Days', 'Attendance Percentage'], ...(report.classSummary ?? []).map((row) => [row.className, row.boysEnrolled, row.girlsEnrolled, row.unspecifiedGenderEnrolled, row.totalEnrolled, row.boysPresent, row.girlsPresent, row.totalPresent, row.boysAbsent, row.girlsAbsent, row.totalAbsent, row.unmarkedStudentDays, row.attendancePercentage])];
  const genderRows = [['Gender', 'Enrolled', 'Present', 'Absent', 'Eligible Student-Days', 'Attendance Rate'], ...(report.genderSummary ?? []).map((row) => [row.gender, row.enrolled, row.present, row.absent, row.eligibleStudentDays, row.attendanceRate])];
  const files = [['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet4.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`], ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`], ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report Summary" sheetId="1" r:id="rId1"/><sheet name="Detailed Attendance" sheetId="2" r:id="rId2"/><sheet name="Class Summary" sheetId="3" r:id="rId3"/><sheet name="Gender Summary" sheetId="4" r:id="rId4"/></sheets></workbook>`], ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet4.xml"/></Relationships>`], ['xl/worksheets/sheet1.xml', sheetXml(summaryRows)], ['xl/worksheets/sheet2.xml', sheetXml(detailRows)], ['xl/worksheets/sheet3.xml', sheetXml(classRows)], ['xl/worksheets/sheet4.xml', sheetXml(genderRows)]];
  return zipStore(files);
}
function pdfBuffer(report) {
  return new Promise((resolve, reject) => {
    const landscape = ['CLASS', 'GENDER', 'STUDENT', 'STAFF'].includes(report.reportType); const doc = new PDFDocument({ autoFirstPage: true, layout: landscape ? 'landscape' : 'portrait', margin: 42, bufferPages: true }); const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk)); doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks)));
    const width = landscape ? 760 : 510;
    const lines = [`OSAAH DAYLIGHT SCHOOL`, report.title, `${report.filters.academicYear ?? 'All academic years'} · ${report.filters.term ?? 'All terms'} · ${report.period.label}`, `Generated ${report.generatedAt}`, ''];
    doc.font('Helvetica-Bold').fontSize(16).text(lines[0]); doc.fontSize(12).text(lines[1]); doc.font('Helvetica').fontSize(9).text(lines[2]).text(lines[3]).moveDown();
    doc.font('Helvetica-Bold').fontSize(9).text('Summary'); doc.font('Helvetica').fontSize(8).text(Object.entries(report.summary ?? {}).map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`).join('   '), { width }); doc.moveDown();
    const rows = report.rows?.length ? report.rows : [{ message: 'No authoritative observations for this scope.' }]; const headers = Object.keys(rows[0]);
    const drawHeader = () => { doc.font('Helvetica-Bold').fontSize(7).text(headers.join(' | '), { width }); doc.moveDown(.25); doc.font('Helvetica').fontSize(7); };
    drawHeader();
    for (const row of rows) { const line = headers.map((key) => text(row[key] ?? '—').replace(/[\r\n]+/g, ' ')).join(' | '); if (doc.y > doc.page.height - 55) { doc.addPage({ layout: landscape ? 'landscape' : 'portrait', margin: 42 }); drawHeader(); } doc.text(line, { width }); }
    const pageCount = doc.bufferedPageRange(); for (let index = 0; index < pageCount.count; index += 1) { doc.switchToPage(index); doc.fontSize(7).fillColor('#666666').text(`OSAAH Daylight · Page ${index + 1} of ${pageCount.count}`, 42, doc.page.height - 28, { width: doc.page.width - 84, align: 'right' }).fillColor('#000000'); }
    doc.end();
  });
}

export function createAttendanceReportsService({ attendanceAnalytics, studentOverview, staffOverview, attendanceRepository = null, attendance = null, students = null, staff = null, schoolProfile = null, schoolId = 'school-osaah-daylight', audit = () => {}, now = () => new Date().toISOString() } = {}) {
  function rawStudentRecords(actor, filters) { const source = attendanceRepository?.listStudentRecords ? attendanceRepository.listStudentRecords({ schoolId: actor.schoolId, academicYear: filters.academicYear, term: filters.term }) : Promise.resolve(attendance?.listStudentRecords?.().filter((row) => row.schoolId === actor.schoolId) ?? []); return Promise.resolve(source).then((rows) => effectiveRecords(rows.filter((row) => dateMatches(row, filters)))); }
  function rawStaffRecords(actor, filters) { const source = attendanceRepository?.listStaffRecords ? attendanceRepository.listStaffRecords({ schoolId: actor.schoolId, academicYear: filters.academicYear, term: filters.term }) : Promise.resolve(attendance?.listStaffRecords?.().filter((row) => row.schoolId === actor.schoolId) ?? []); return Promise.resolve(source).then((rows) => effectiveRecords(rows.filter((row) => dateMatches(row, filters)))); }
  function studentsFor(actor) { return array(students?.listStudents?.({ requestedSchoolId: actor.schoolId, includeTestRecords: false })).filter((row) => !row.isTestRecord); }
  function staffFor(actor) { return array(staff?.listProfiles?.({ requestedSchoolId: actor.schoolId })).filter((row) => row.schoolId === actor.schoolId && row.employmentStatus !== 'INACTIVE'); }
  function periodMeta(filters, analytics) { const period = upper(filters.period ?? 'TERM'); return { type: period, label: analytics.period?.label ?? (period === 'CUSTOM' ? `${filters.startDate} – ${filters.endDate}` : period), startDate: filters.startDate ?? null, endDate: filters.endDate ?? null }; }
  async function report(inputFilters = {}, actor = {}) {
    if (!attendanceAnalytics?.overview) fail('Canonical attendance analytics service is unavailable.', 503, 'ANALYTICS_UNAVAILABLE');
    const filters = queryForPeriod({ reportType: 'CLASS', period: 'TERM', ...inputFilters }); const reportType = upper(filters.reportType ?? 'CLASS'); if (!REPORT_TYPES.has(reportType)) fail('Invalid attendance report type.'); if (!PERIODS.has(upper(filters.period))) fail('Invalid reporting period.');
    const analytics = await attendanceAnalytics.overview(filters, actor); const [studentRecords, staffRecords, profileRows, staffRows] = await Promise.all([rawStudentRecords(actor, filters), rawStaffRecords(actor, filters), Promise.resolve(studentsFor(actor)), Promise.resolve(staffFor(actor))]);
    const profileMap = new Map(profileRows.map((row) => [idOf(row.id), row])); const staffMap = new Map(staffRows.map((row) => [idOf(row.id ?? row.staffId ?? row.employeeId), row]));
    const studentGroups = new Map(); for (const record of studentRecords) { const id = personIdOf(record); const student = profileMap.get(id) ?? {}; const current = studentGroups.get(id) ?? { records: [], student, classId: record.classId ?? record.class_id ?? student.classId }; current.records.push(record); if (!current.classId) current.classId = record.classId ?? record.class_id; studentGroups.set(id, current); }
    const staffGroups = new Map(); for (const record of staffRecords) { const id = personIdOf(record); const member = staffMap.get(id) ?? {}; const current = staffGroups.get(id) ?? { records: [], member }; current.records.push(record); staffGroups.set(id, current); }
    const includePhone = canReadStaffPhone(actor);
    const studentRows = [...studentGroups.entries()].map(([id, group]) => ({ permanentStudentId: group.student.permanentStudentId ?? group.student.studentIndexNumber ?? id, studentName: fullName(group.student) || id, class: group.classId ?? 'Unassigned', gender: classifyGender(group.student.gender), ...recordCounts(group.records) }));
    const staffReportRows = [...staffGroups.entries()].map(([id, group]) => ({ staffId: group.member.staffId ?? group.member.employeeId ?? id, staffName: fullName(group.member) || id, role: group.member.roleKey ?? group.member.role ?? 'Staff', ...(includePhone ? { phone: group.member.phone ?? group.member.telephone ?? null } : {}), ...recordCounts(group.records) }));
    const classSummary = array(analytics.classAttendance).map((row) => ({ className: row.className, boysEnrolled: row.boys?.enrolled ?? row.totalBoysEnrolled ?? 0, girlsEnrolled: row.girls?.enrolled ?? row.totalGirlsEnrolled ?? 0, unspecifiedGenderEnrolled: row.unspecifiedGenderEnrolled ?? 0, totalEnrolled: row.totalEnrolled ?? number(row.boys?.enrolled) + number(row.girls?.enrolled) + number(row.unspecifiedGenderEnrolled), boysPresent: row.boys?.present ?? row.boysPresent ?? 0, girlsPresent: row.girls?.present ?? row.girlsPresent ?? 0, totalPresent: row.presentStudentDays ?? row.totalPresent ?? 0, boysAbsent: row.boys?.absent ?? row.boysAbsent ?? 0, girlsAbsent: row.girls?.absent ?? row.girlsAbsent ?? 0, totalAbsent: row.absentStudentDays ?? row.totalAbsent ?? 0, unmarkedStudentDays: row.unmarkedStudentDays ?? 0, attendancePercentage: row.attendanceRate ?? null }));
    const enrolledByGender = profileRows.reduce((result, student) => { const gender = classifyGender(student.gender); result[gender] = number(result[gender]) + 1; return result; }, { BOYS: 0, GIRLS: 0, UNSPECIFIED: 0 });
    const genderSummary = array(analytics.genderDistribution?.items).map((row) => { const gender = upper(row.label) === 'PRESENT' ? 'PRESENT' : upper(row.label) === 'ABSENT' ? 'ABSENT' : upper(row.label); const item = gender === 'BOYS' || gender === 'GIRLS' || gender === 'UNSPECIFIED' ? row : null; return { gender: item?.label ?? row.label, enrolled: enrolledByGender[gender] ?? row.enrolled ?? 0, present: item?.present ?? row.present ?? row.count ?? 0, absent: item?.absent ?? row.absent ?? 0, eligibleStudentDays: number(item?.present ?? row.present) + number(item?.absent ?? row.absent), attendanceRate: item?.rate ?? row.rate ?? (number(item?.present ?? row.present) + number(item?.absent ?? row.absent) ? percentage(item?.present ?? row.present, number(item?.present ?? row.present) + number(item?.absent ?? row.absent)) : null) }; });
    const periodRows = (analytics.trends?.students?.[upper(filters.period) === 'WEEKLY' ? 'weekly' : upper(filters.period) === 'MONTHLY' ? 'monthly' : 'term'] ?? []).map((row) => ({ period: row.period, present: row.present, absent: row.absent, excused: row.excused ?? 0, unmarked: row.unmarked ?? 0, attendancePercentage: row.attendanceRate }));
    const rows = reportType === 'STUDENT' ? studentRows : reportType === 'STAFF' ? staffReportRows : reportType === 'CLASS' ? classSummary : reportType === 'GENDER' ? genderSummary : periodRows;
    const profile = await Promise.resolve(schoolProfile?.read?.(actor)).catch(() => null);
    const result = { id: randomUUID(), reportType, title: `${reportType.replaceAll('_', ' ')} ATTENDANCE REPORT`, schoolId: actor.schoolId ?? schoolId, school: { name: profile?.profile?.name ?? profile?.schoolInformation?.name ?? 'OSAAH DAYLIGHT SCHOOL', motto: profile?.profile?.motto ?? profile?.schoolInformation?.motto ?? 'AIM HIGH, ACADEMIC IS OUR CORE VALUE', logoPath: profile?.profile?.logoPath ?? '/assets/osaah-daylight-logo.png' }, generatedAt: now(), generatedBy: actor.id ?? null, filters: clone(filters), period: periodMeta(filters, analytics), summary: clone(analytics.summary ?? {}), rows, classSummary, genderSummary, source: 'TiDB-backed canonical attendance services', authoritative: true, sampleDataExcluded: true };
    audit({ schoolId: result.schoolId, userId: actor.id, roleId: actor.roleKey, action: 'ATTENDANCE_REPORT_GENERATED', entity: 'AttendanceReport', entityId: result.id, newValue: { reportType, filters: result.filters, rowCount: rows.length, source: result.source } });
    return result;
  }
  async function exportReport(inputFilters, actor, format) { const result = await report(inputFilters, actor); const normalized = upper(format); if (!['PDF', 'XLSX'].includes(normalized)) fail('Unsupported export format.'); audit({ schoolId: result.schoolId, userId: actor.id, roleId: actor.roleKey, action: `ATTENDANCE_REPORT_EXPORTED_${normalized}`, entity: 'AttendanceReport', entityId: result.id, newValue: { reportType: result.reportType, filters: result.filters } }); return { report: result, content: normalized === 'PDF' ? await pdfBuffer(result) : xlsxBuffer(result), filename: `OSAAH-${safeFilename(result.title)}-${safeFilename(result.generatedAt)}.${normalized.toLowerCase()}`, contentType: normalized === 'PDF' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }; }
  return Object.freeze({ report, exportReport, pdf: pdfBuffer, xlsx: xlsxBuffer });
}

export default createAttendanceReportsService;
