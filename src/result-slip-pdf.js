import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const HEADER = join(publicRoot, 'assets/osaah-result-header.png');
const WATERMARK = join(publicRoot, 'assets/branding-osaah-watermark.png');
const safe = (value, fallback = 'Result') => String(value ?? fallback).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90) || fallback;
const text = (value, fallback = '—') => String(value ?? fallback);

export function resultPdfFilename(result) {
  const type = result.resultType === 'MOCK' ? safe(result.mockLabel, 'Mock') : 'End-of-Term';
  return `OSAAH_${type}_Result_${safe(result.studentIndexNumber, 'Student')}_${safe(result.academicYear, 'Academic-Year')}_${safe(result.term, 'Term')}.pdf`;
}

export function createResultSlipPdfService() {
  async function pdf(result) {
    const [header, watermark] = await Promise.all([readFile(HEADER), readFile(WATERMARK)]);
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({ size: 'A4', margins: { top: 42, right: 42, bottom: 42, left: 42 }, bufferPages: true });
      const chunks = [];
      document.on('data', (chunk) => chunks.push(chunk));
      document.on('end', () => resolve(Buffer.concat(chunks)));
      document.on('error', reject);
      const border = () => { document.save().lineWidth(3).strokeColor('#102a43').rect(24, 24, 547, 794).stroke().lineWidth(1).strokeColor('#d4af37').rect(31, 31, 533, 780).stroke().restore(); };
      const pageHeader = () => { border(); document.image(header, 55, 45, { width: 485 }); document.save().opacity(0.045).image(watermark, 190, 330, { width: 210 }).restore(); document.y = 130; };
      const ensure = (height = 50) => { if (document.y + height > 760) { document.addPage(); pageHeader(); } };
      const line = (label, value) => { ensure(18); document.fontSize(9).fillColor('#102a43').font('Helvetica-Bold').text(`${label}: `, { continued: true }).font('Helvetica').text(text(value)); };
      const section = (title) => { ensure(30); document.moveDown(.35).font('Helvetica-Bold').fontSize(11).fillColor('#102a43').text(title); document.moveTo(55, document.y + 3).lineTo(540, document.y + 3).lineWidth(1.2).strokeColor('#d4af37').stroke(); document.moveDown(.35); };
      pageHeader();
      document.font('Helvetica-Bold').fontSize(15).fillColor('#102a43').text(result.resultType === 'MOCK' ? 'MOCK EXAMINATION RESULT SLIP' : 'END-OF-TERM EXAMINATION RESULT SLIP', { align: 'center' });
      document.moveDown(.45); line('Student Name', result.studentName); line('Permanent Student ID / OSAAH Student Index', result.studentIndexNumber); line('Gender', result.gender ?? 'Not Recorded'); line('Class', result.className ?? result.classId); line('Total Boys in Class', result.classGenderDistribution?.totalBoys ?? 0); line('Total Girls in Class', result.classGenderDistribution?.totalGirls ?? 0); line('Total Students in Class', result.classGenderDistribution?.totalStudents ?? 0); line('Academic Year', result.academicYear); line('Term', result.term); line(result.resultType === 'MOCK' ? 'Mock Examination' : 'Examination', result.resultType === 'MOCK' ? result.mockLabel : 'End-of-Term');
      section('SUBJECT RESULTS');
      const columns = [['SUBJECT', 105], ['CLASS', 44], ['EXAM', 44], ['TOTAL', 48], ['GRADE', 48], ['POSITION', 58], ['REMARK', 138]];
      const drawRow = (values, header = false) => { ensure(24); const y = document.y; let x = 55; document.font(header ? 'Helvetica-Bold' : 'Helvetica').fontSize(header ? 7.5 : 7.4).fillColor(header ? '#ffffff' : '#102a43'); if (header) document.rect(55, y - 2, 485, 20).fill('#102a43'); values.forEach((value, index) => { document.text(text(value), x + 3, y + 3, { width: columns[index][1] - 6, height: 16, ellipsis: true }); x += columns[index][1]; }); document.moveTo(55, y + 20).lineTo(540, y + 20).lineWidth(.35).strokeColor('#bcccdc').stroke(); document.y = y + 22; };
      drawRow(columns.map((item) => item[0]), true);
      for (const subject of result.subjects ?? []) drawRow([subject.subjectName ?? subject.subjectId, subject.caScore ?? '—', subject.examScore ?? '—', subject.totalScore, subject.grade ?? '—', subject.subjectPosition ?? '—', subject.remark ?? 'Not recorded']);
      section('RESULT SUMMARY');
      line('Total Score', result.totalScore); line('Aggregate', result.aggregate ?? 'N/A'); line('Class Position', result.classPosition ?? result.position ?? '—'); line('Subjects Sat', result.subjectsSat ?? (result.subjects ?? []).length); line('Average Score', Number(result.average ?? 0).toFixed(2));
      section('GES TEACHER ASSESSMENT');
      const assessment = result.assessment ?? {}; line('Conduct', assessment.conduct ?? 'Not recorded'); line('Attitude', assessment.attitude ?? 'Not recorded'); line('Interest', assessment.interest ?? 'Not recorded'); line('Class Teacher Remarks', assessment.classTeacherRemarks ?? 'Not recorded'); line('Headteacher Remarks', assessment.headteacherRemarks ?? 'Not recorded');
      section('ATTENDANCE');
      const attendance = result.attendance ?? {}; line('Times Present', attendance.timesPresent ?? 'Not recorded'); line('Times Absent', attendance.timesAbsent ?? 'Not recorded'); line('Total School Days', attendance.totalSchoolDays ?? 'Not recorded');
      section('SIGNATURES');
      for (const signature of result.signatures ?? []) { line(signature.signatoryRole === 'CLASS_TEACHER' ? 'Class Teacher' : 'Headteacher', signature.name ?? 'Name not configured'); if (signature.phone) line('Phone', signature.phone); }
      document.fontSize(7).fillColor('#486581').text('Generated from the authorized Osaah Daylight School Complex result record.', 55, 770, { align: 'center', width: 485 });
      document.end();
    });
  }
  return { pdf, filename: resultPdfFilename };
}
