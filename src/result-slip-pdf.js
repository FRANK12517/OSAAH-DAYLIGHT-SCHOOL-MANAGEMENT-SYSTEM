import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const HEADER = join(publicRoot, 'assets/osaah-result-header.png');
const WATERMARK = join(publicRoot, 'assets/branding-osaah-watermark.png');
const safe = (value, fallback = 'Result') => String(value ?? fallback).replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 90) || fallback;
const text = (value, fallback = '—') => String(value ?? fallback);
const COLORS = Object.freeze({ navy: '#102a43', gold: '#d4a72c', ink: '#102a43', muted: '#486581', rule: '#829ab1', pale: '#f4f7fa', white: '#ffffff' });
const CONTENT = Object.freeze({ x: 42, width: 511, bottom: 782 });

export function resultPdfFilename(result) {
  const type = result.resultType === 'MOCK' ? safe(result.mockLabel, 'Mock') : 'End-of-Term';
  const samplePrefix = result.isSample === true ? 'SAMPLE_' : '';
  return `OSAAH_${samplePrefix}${type}_Result_${safe(result.studentIndexNumber, 'Student')}_${safe(result.academicYear, 'Academic-Year')}_${safe(result.term, 'Term')}.pdf`;
}

function textWidth(document, value, font, size) {
  return document.font(font).fontSize(size).widthOfString(String(value));
}

function splitLongWord(document, word, width, font, size) {
  const parts = [];
  let part = '';
  for (const character of Array.from(word)) {
    const candidate = part + character;
    if (part && textWidth(document, candidate, font, size) > width) {
      parts.push(part);
      part = character;
    } else part = candidate;
  }
  if (part) parts.push(part);
  return parts.length ? parts : [''];
}

function wrappedLines(document, value, width, font, size) {
  const words = String(value ?? '—').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return ['—'];
  const lines = [];
  let line = '';
  for (const originalWord of words) {
    for (const word of splitLongWord(document, originalWord, width, font, size)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && textWidth(document, candidate, font, size) > width) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : ['—'];
}

function drawLines(document, lines, x, y, width, { font = 'Helvetica', size = 8, lineHeight = size * 1.18, color = COLORS.ink, align = 'left' } = {}) {
  lines.forEach((line, index) => {
    const actualWidth = textWidth(document, line, font, size);
    const left = align === 'center' ? x + Math.max(0, (width - actualWidth) / 2) : align === 'right' ? x + Math.max(0, width - actualWidth) : x;
    document.font(font).fontSize(size).fillColor(color).text(line, left, y + index * lineHeight, { lineBreak: false });
  });
  return y + lines.length * lineHeight;
}

function drawWrapped(document, value, x, y, width, options = {}) {
  const lines = wrappedLines(document, value, width, options.font ?? 'Helvetica', options.size ?? 8);
  drawLines(document, lines, x, y, width, options);
  return lines;
}

function cardHeight(document, item, width, { labelSize = 5.7, valueSize = 7.6, valueLineHeight = valueSize * 1.12, padding = 4 } = {}) {
  const innerWidth = Math.max(8, width - padding * 2);
  const labelLines = wrappedLines(document, item.label, innerWidth, 'Helvetica-Bold', labelSize);
  const valueLines = wrappedLines(document, item.value, innerWidth, 'Helvetica', valueSize);
  return Math.max(21, padding + labelLines.length * (labelSize * 1.12) + 1.5 + valueLines.length * valueLineHeight + padding);
}

function drawCard(document, item, x, y, width, height, { labelSize = 5.7, valueSize = 7.6, valueLineHeight = valueSize * 1.12, padding = 4, fill = COLORS.pale, valueAlign = 'left' } = {}) {
  document.save().lineWidth(0.45).strokeColor(COLORS.rule).fillColor(fill).rect(x, y, width, height).fillAndStroke(fill, COLORS.rule).restore();
  const innerWidth = Math.max(8, width - padding * 2);
  const labelLines = wrappedLines(document, item.label, innerWidth, 'Helvetica-Bold', labelSize);
  const valueLines = wrappedLines(document, item.value, innerWidth, 'Helvetica', valueSize);
  drawLines(document, labelLines, x + padding, y + padding, innerWidth, { font: 'Helvetica-Bold', size: labelSize, lineHeight: labelSize * 1.12, color: COLORS.navy });
  const valueY = y + padding + labelLines.length * (labelSize * 1.12) + 1.5;
  drawLines(document, valueLines, x + padding, valueY, innerWidth, { font: 'Helvetica', size: valueSize, lineHeight: valueLineHeight, color: COLORS.ink, align: valueAlign });
}

function sectionHeading(document, title, y) {
  drawLines(document, [title.toUpperCase()], CONTENT.x, y, CONTENT.width, { font: 'Helvetica-Bold', size: 8.5, lineHeight: 10, color: COLORS.navy });
  document.save().lineWidth(0.8).strokeColor(COLORS.gold).moveTo(CONTENT.x, y + 12).lineTo(CONTENT.x + CONTENT.width, y + 12).stroke().restore();
  return y + 15;
}

function drawResultTable(document, result, y) {
  const isMock = result.resultType === 'MOCK';
  const columns = isMock
    ? [['#', 19, 'center'], ['Subject', 112, 'left'], ['Total Score', 54, 'center'], ['Grade', 45, 'center'], ['Subject Position', 72, 'center'], ['Remark', 209, 'left']]
    : [['#', 19, 'center'], ['Subject', 96, 'left'], ['Class Score', 47, 'center'], ['Exam Score', 47, 'center'], ['Total Score', 50, 'center'], ['Subject Position', 52, 'center'], ['Grade', 38, 'center'], ['Remark', 162, 'left']];
  const headerSize = 6.2;
  const rowSize = 6.8;
  const lineHeight = 7.6;
  const paddingX = 2.5;
  const headerLines = columns.map(([label, width]) => wrappedLines(document, label, width - paddingX * 2, 'Helvetica-Bold', headerSize));
  const headerHeight = Math.max(17, Math.max(...headerLines.map((lines) => lines.length)) * 7.1 + 5);
  let x = CONTENT.x;
  columns.forEach(([label, width], index) => {
    document.save().lineWidth(0.4).strokeColor(COLORS.rule).fillColor('#e8eef4').rect(x, y, width, headerHeight).fillAndStroke('#e8eef4', COLORS.rule).restore();
    drawLines(document, headerLines[index], x + paddingX, y + 2, width - paddingX * 2, { font: 'Helvetica-Bold', size: headerSize, lineHeight: 7.1, color: COLORS.navy, align: columns[index][2] });
    x += width;
  });
  y += headerHeight;
  const subjects = result.subjects ?? [];
  const rows = subjects.length ? subjects : [{ subjectName: 'No submitted subjects found.', remark: 'Not recorded' }];
  rows.forEach((subject, rowIndex) => {
    const values = isMock
      ? [rowIndex + 1, subject.subjectName ?? subject.subjectId ?? '—', subject.totalScore ?? '—', subject.grade ?? '—', subject.subjectPosition ?? subject.position ?? '—', subject.remark ?? 'Not recorded']
      : [rowIndex + 1, subject.subjectName ?? subject.subjectId ?? '—', subject.caScore ?? '—', subject.examScore ?? '—', subject.totalScore ?? '—', subject.subjectPosition ?? subject.position ?? '—', subject.grade ?? '—', subject.remark ?? 'Not recorded'];
    const rowLines = columns.map(([, width], index) => wrappedLines(document, values[index], width - paddingX * 2, 'Helvetica', rowSize));
    const rowHeight = Math.max(15, Math.max(...rowLines.map((lines) => lines.length)) * lineHeight + 4);
    x = CONTENT.x;
    columns.forEach(([, width, align], index) => {
      const fill = rowIndex % 2 ? COLORS.white : '#fbfcfd';
      document.save().lineWidth(0.35).strokeColor('#aab7c4').fillColor(fill).rect(x, y, width, rowHeight).fillAndStroke(fill, '#aab7c4').restore();
      drawLines(document, rowLines[index], x + paddingX, y + 2, width - paddingX * 2, { font: 'Helvetica', size: rowSize, lineHeight, color: COLORS.ink, align });
      x += width;
    });
    y += rowHeight;
  });
  return y;
}

function sampleSignatureBytes(signature) {
  const data = String(signature?.data ?? '').trim();
  const dataMatch = data.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (dataMatch) return Buffer.from(dataMatch[2], 'base64');
  const key = String(signature?.storageKey ?? '').trim();
  if (!key || isAbsolute(key) || !/^signatures\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:png|jpe?g)$/i.test(key)) return null;
  const path = resolve(publicRoot, key);
  const relativePath = relative(publicRoot, path);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) return null;
  return path;
}

async function signatureImage(signature) {
  try {
    const source = sampleSignatureBytes(signature);
    if (!source) return null;
    return Buffer.isBuffer(source) ? source : await readFile(source);
  } catch {
    return null;
  }
}

function drawSignatures(document, signatures, images, y) {
  y = sectionHeading(document, 'Signatures', y);
  const gap = 12;
  const width = (CONTENT.width - gap) / 2;
  const height = 59;
  for (let index = 0; index < 2; index += 1) {
    const [role, label] = index === 0 ? ['CLASS_TEACHER', 'Class Teacher'] : ['HEADTEACHER', 'Headteacher'];
    const signature = signatures.get(role);
    const x = CONTENT.x + index * (width + gap);
    document.save().lineWidth(0.55).strokeColor(COLORS.rule).rect(x, y, width, height).stroke().restore();
    drawWrapped(document, `${label} Signature`, x + 5, y + 4, width - 10, { font: 'Helvetica-Bold', size: 7.1, lineHeight: 8, color: COLORS.navy, align: 'center' });
    drawWrapped(document, `Name: ${signature?.name ?? signature?.fullName ?? 'Name not configured'}`, x + 6, y + 15, width - 12, { font: 'Helvetica', size: 6.5, lineHeight: 7.5, color: COLORS.ink, align: 'center' });
    drawWrapped(document, `Phone: ${signature?.phone ?? 'Phone not configured'}`, x + 6, y + 24, width - 12, { font: 'Helvetica', size: 6.5, lineHeight: 7.5, color: COLORS.ink, align: 'center' });
    const image = images[index];
    if (image) {
      try { document.image(image, x + 10, y + 33, { fit: [width - 20, 22], align: 'center', valign: 'center' }); }
      catch { drawLines(document, ['Signature on file'], x + 6, y + 40, width - 12, { font: 'Helvetica-Oblique', size: 6.2, lineHeight: 7, color: COLORS.muted, align: 'center' }); }
    } else {
      const hasSignature = Boolean(signature?.data || signature?.storageKey);
      drawLines(document, [hasSignature ? 'Signature on file' : 'Signature not uploaded'], x + 6, y + 40, width - 12, { font: 'Helvetica-Oblique', size: 6.2, lineHeight: 7, color: COLORS.muted, align: 'center' });
    }
  }
  return y + height;
}

export function createResultSlipPdfService() {
  async function pdf(result) {
    const [header, watermark] = await Promise.all([readFile(HEADER), readFile(WATERMARK)]);
    const signatures = new Map((result.signatures ?? []).map((signature) => [signature.signatoryRole, signature]));
    const signatureImages = await Promise.all(['CLASS_TEACHER', 'HEADTEACHER'].map((role) => signatureImage(signatures.get(role))));
    return new Promise((resolvePdf, rejectPdf) => {
      const document = new PDFDocument({ size: 'A4', margin: 0, bufferPages: false });
      const chunks = [];
      document.on('data', (chunk) => chunks.push(chunk));
      document.on('end', () => resolvePdf(Buffer.concat(chunks)));
      document.on('error', rejectPdf);

      // Preserve the existing navy/gold double frame and school watermark.
      document.save().lineWidth(3).strokeColor(COLORS.navy).rect(24, 24, 547, 794).stroke().lineWidth(1).strokeColor(COLORS.gold).rect(31, 31, 533, 780).stroke().restore();
      document.save().opacity(0.045).image(watermark, 190, 342, { width: 210 }).restore();
      document.image(header, 55, 35, { width: 485 });

      let y = 140;
      drawLines(document, ['OSAAH DAYLIGHT SCHOOL COMPLEX'], CONTENT.x, y, CONTENT.width, { font: 'Helvetica-Bold', size: 9.3, lineHeight: 11, color: COLORS.navy, align: 'center' });
      y += 13;
      if (result.isSample === true) {
        drawLines(document, ['SAMPLE DATA / DEMONSTRATION — NOT AN OFFICIAL RESULT'], CONTENT.x, y, CONTENT.width, { font: 'Helvetica-Bold', size: 7.1, lineHeight: 8, color: '#9c6d00', align: 'center' });
        y += 10;
      }
      const resultTitle = result.resultType === 'MOCK' ? 'Mock Examination Result Slip' : 'Terminal Examination Result Slip';
      drawLines(document, [resultTitle], CONTENT.x, y, CONTENT.width, { font: 'Helvetica-Bold', size: 11.2, lineHeight: 13, color: COLORS.navy, align: 'center' });
      y += 18;

      y = sectionHeading(document, 'Student Information', y);
      const distribution = result.classGenderDistribution ?? {};
      const metadata = [
        { label: 'Student Name', value: text(result.studentName) },
        { label: 'Permanent Student ID', value: text(result.studentIndexNumber) },
        { label: 'Gender', value: text(result.gender, 'Not Recorded') },
        { label: 'Class', value: text(result.classId) },
        { label: 'Total Boys in Class', value: text(distribution.totalBoys ?? 0) },
        { label: 'Total Girls in Class', value: text(distribution.totalGirls ?? 0) },
        { label: 'Total Students in Class', value: text(distribution.totalStudents ?? 0) },
        { label: 'Academic Year', value: text(result.academicYear) },
        { label: 'Term', value: text(result.term) },
        { label: result.resultType === 'MOCK' ? 'Mock Examination' : 'Examination', value: text(result.resultType === 'MOCK' ? result.mockLabel : 'Terminal Examination') }
      ];
      const metadataGap = 3;
      const metadataWidth = (CONTENT.width - metadataGap * 2) / 3;
      for (let start = 0; start < metadata.length; start += 3) {
        const row = metadata.slice(start, start + 3);
        const widths = row.length === 1 ? [CONTENT.width] : row.map(() => metadataWidth);
        const height = Math.max(...row.map((item, index) => cardHeight(document, item, widths[index], { labelSize: 5.4, valueSize: 7.2, valueLineHeight: 8, padding: 3.5 })));
        let x = CONTENT.x;
        row.forEach((item, index) => {
          drawCard(document, item, x, y, widths[index], height, { labelSize: 5.4, valueSize: 7.2, valueLineHeight: 8, padding: 3.5 });
          x += widths[index] + metadataGap;
        });
        y += height + 2.5;
      }
      y += 2;

      y = sectionHeading(document, 'Examination Results', y);
      y = drawResultTable(document, result, y);
      y += 5;

      y = sectionHeading(document, 'Result Summary', y);
      const summary = [
        { label: 'Total Score', value: result.totalMaximum ? `${text(result.totalScore, 0)} / ${text(result.totalMaximum)}` : text(result.totalScore, 0) },
        { label: 'Aggregate', value: text(result.aggregate, 'N/A') },
        { label: 'Class Position', value: text(result.classPosition ?? result.position) },
        { label: 'Subjects Sat', value: text(result.subjectsSat ?? (result.subjects ?? []).length) },
        { label: 'Average Score', value: Number(result.average ?? 0).toFixed(2) }
      ];
      const summaryGap = 3;
      const summaryWidth = (CONTENT.width - summaryGap * (summary.length - 1)) / summary.length;
      const summaryHeight = Math.max(...summary.map((item) => cardHeight(document, item, summaryWidth, { labelSize: 5.1, valueSize: 7.2, padding: 3.5 })));
      summary.forEach((item, index) => drawCard(document, item, CONTENT.x + index * (summaryWidth + summaryGap), y, summaryWidth, summaryHeight, { labelSize: 5.1, valueSize: 7.2, padding: 3.5, valueAlign: 'center' }));
      y += summaryHeight + 5;

      y = sectionHeading(document, 'GES Teacher Assessment', y);
      const assessment = result.assessment ?? result.assessments ?? {};
      const assessmentItems = [
        { label: 'Conduct', value: text(assessment.conduct, 'Not recorded') },
        { label: 'Attitude', value: text(assessment.attitude, 'Not recorded') },
        { label: 'Interest', value: text(assessment.interest, 'Not recorded') }
      ];
      const assessmentGap = 3;
      const assessmentWidth = (CONTENT.width - assessmentGap * 2) / 3;
      const firstRowHeight = Math.max(...assessmentItems.map((item) => cardHeight(document, item, assessmentWidth, { labelSize: 5.5, valueSize: 6.8, valueLineHeight: 7.6, padding: 3.5 })));
      assessmentItems.forEach((item, index) => drawCard(document, item, CONTENT.x + index * (assessmentWidth + assessmentGap), y, assessmentWidth, firstRowHeight, { labelSize: 5.5, valueSize: 6.8, valueLineHeight: 7.6, padding: 3.5 }));
      y += firstRowHeight + assessmentGap;
      const remarks = [
        { label: 'Class Teacher Remarks', value: text(assessment.classTeacherRemarks, 'Not recorded') },
        { label: 'Headteacher Remarks', value: text(assessment.headteacherRemarks, 'Not recorded') }
      ];
      const remarksWidth = (CONTENT.width - assessmentGap) / 2;
      const remarksHeight = Math.max(...remarks.map((item) => cardHeight(document, item, remarksWidth, { labelSize: 5.8, valueSize: 7.1, valueLineHeight: 8.1, padding: 4 })));
      remarks.forEach((item, index) => drawCard(document, item, CONTENT.x + index * (remarksWidth + assessmentGap), y, remarksWidth, remarksHeight, { labelSize: 5.8, valueSize: 7.1, valueLineHeight: 8.1, padding: 4 }));
      y += remarksHeight + 5;

      y = sectionHeading(document, 'Attendance', y);
      const attendance = result.attendance ?? {};
      const attendanceItems = [
        { label: 'Times Present', value: text(attendance.timesPresent, 'Not recorded') },
        { label: 'Times Absent', value: text(attendance.timesAbsent, 'Not recorded') },
        { label: 'Total School Days', value: text(attendance.totalSchoolDays, 'Not recorded') }
      ];
      const attendanceWidth = (CONTENT.width - assessmentGap * 2) / 3;
      const attendanceHeight = Math.max(...attendanceItems.map((item) => cardHeight(document, item, attendanceWidth, { labelSize: 5.5, valueSize: 7.3, padding: 3.5 })));
      attendanceItems.forEach((item, index) => drawCard(document, item, CONTENT.x + index * (attendanceWidth + assessmentGap), y, attendanceWidth, attendanceHeight, { labelSize: 5.5, valueSize: 7.3, padding: 3.5, valueAlign: 'center' }));
      y += attendanceHeight + 5;

      y = drawSignatures(document, signatures, signatureImages, y);
      if (y > CONTENT.bottom) throw new Error(`Result Slip content exceeds the single A4 page layout (${Math.ceil(y)}pt of ${CONTENT.bottom}pt).`);
      const footer = result.isSample === true
        ? 'SAMPLE DATA / DEMONSTRATION — NOT AN OFFICIAL RESULT.'
        : 'Generated from the authorized Osaah Daylight School Complex result record.';
      drawLines(document, [footer], CONTENT.x, 790, CONTENT.width, { font: 'Helvetica', size: 6.2, lineHeight: 7, color: COLORS.muted, align: 'center' });
      document.end();
    });
  }
  return { pdf, filename: resultPdfFilename };
}
