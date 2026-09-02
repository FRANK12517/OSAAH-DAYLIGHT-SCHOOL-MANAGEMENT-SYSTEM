import { deflateSync, inflateSync } from 'node:zlib';
import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RECEIPT_HEADER_ASSET = '/assets/branding-osaah-receipt-header.png';
export const RECEIPT_WATERMARK_ASSET = '/assets/branding-osaah-watermark.png';
export const RECEIPT_FONT_ASSET = '/assets/fonts/DejaVuSans.ttf';
const root = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');
const assetCache = new Map();
function esc(value) { return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
export function formatGhanaCurrency(value) { return `GH₵ ${Number(value ?? 0).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function money(value) { return formatGhanaCurrency(value); }
function canRead(user, payment, invoice) { if (!user || user.schoolId !== payment.schoolId) return false; if (user.portal === 'parent') return invoice.parentUserId === user.id; return ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ACCOUNTANT_BURSAR'].includes(user.roleKey) || user.permissions?.has?.('fees.read') || user.permissions?.has?.('*'); }
function cachedAsset(path) { if (!assetCache.has(path)) assetCache.set(path, readFile(path).catch(() => { assetCache.delete(path); throw new Error('Receipt branding assets are unavailable.'); })); return assetCache.get(path); }

function pngRgb(buffer) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) throw new Error('Invalid receipt image.');
  let width = 0; let height = 0; let type = 0; const chunks = [];
  for (let offset = 8; offset < buffer.length;) { const size = buffer.readUInt32BE(offset); const name = buffer.toString('ascii', offset + 4, offset + 8); const data = buffer.subarray(offset + 8, offset + 8 + size); if (name === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); type = data[9]; if (data[8] !== 8 || ![2, 6].includes(type)) throw new Error('Unsupported receipt image format.'); } if (name === 'IDAT') chunks.push(data); offset += size + 12; }
  const bpp = type === 6 ? 4 : 3; const raw = inflateSync(Buffer.concat(chunks)); const stride = width * bpp; const rows = Buffer.alloc(height * stride); let source = 0;
  for (let y = 0; y < height; y += 1) { const filter = raw[source++]; const row = rows.subarray(y * stride, (y + 1) * stride); const previous = y ? rows.subarray((y - 1) * stride, y * stride) : null; for (let x = 0; x < stride; x += 1) { const left = x >= bpp ? row[x - bpp] : 0; const up = previous?.[x] ?? 0; const upperLeft = x >= bpp ? previous?.[x - bpp] ?? 0 : 0; const value = raw[source++]; row[x] = filter === 0 ? value : filter === 1 ? value + left : filter === 2 ? value + up : filter === 3 ? value + Math.floor((left + up) / 2) : value + (Math.abs(left + up - upperLeft) <= Math.abs(up - upperLeft) && Math.abs(left + up - upperLeft) <= Math.abs(left - upperLeft) ? left : Math.abs(up - upperLeft) <= Math.abs(left - upperLeft) ? up : upperLeft); } }
  const rgb = Buffer.alloc(width * height * 3); const alpha = type === 6 ? Buffer.alloc(width * height) : null; let out = 0; let alphaOut = 0; for (let i = 0; i < rows.length; i += bpp) { rgb[out++] = rows[i]; rgb[out++] = rows[i + 1]; rgb[out++] = rows[i + 2]; if (alpha) alpha[alphaOut++] = rows[i + 3]; }
  return { width, height, rgb, alpha };
}

function pdfString(value) { return String(value ?? '').replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)').replace(/[^\x20-\x7E]/g, '?'); }
function makeUnicodePdf(receipt, headerFile, watermarkFile, fontFile) { return new Promise((resolve, reject) => { const document = new PDFDocument({ size: 'A4', margin: 40, autoFirstPage: true }); const chunks = []; document.on('data', (chunk) => chunks.push(chunk)); document.on('end', () => resolve(Buffer.concat(chunks))); document.on('error', reject); document.image(headerFile, 40, 30, { width: 515 }); document.save(); document.opacity(0.1); document.image(watermarkFile, 230, 310, { width: 135 }); document.restore(); document.font(fontFile).fontSize(14).text('PAYMENT RECEIPT', 0, 195, { align: 'center' }); document.fontSize(9).text(`Receipt No: ${receipt.receiptNumber}`, 40, 245); const lines = [`Date: ${receipt.date}`, `Student: ${receipt.studentName}`, `Index No: ${receipt.studentIndexNumber}`, `Class: ${receipt.className}`, `Description: ${receipt.description}`, `Amount Paid: ${money(receipt.amount)}`, `Previous Balance: ${money(receipt.previousBalance)}`, `Outstanding Balance: ${money(receipt.balance)}`, `Payment Method: ${receipt.paymentMethod}`, `Transaction Ref: ${receipt.transactionReference}`, `Received By: ${receipt.receivedBy}`]; document.text(lines.join('\n'), 40, 270, { lineGap: 8 }); document.end(); }); }
function makePdf(receipt, header, watermark) {
  const lines = ['PAYMENT RECEIPT', `Receipt No: ${receipt.receiptNumber}`, `Date: ${receipt.date}`, `Student: ${receipt.studentName}`, `Index No: ${receipt.studentIndexNumber}`, `Class: ${receipt.className}`, `Description: ${receipt.description}`, `Amount Paid: ${money(receipt.amount)}`, `Previous Balance: ${money(receipt.previousBalance)}`, `Outstanding Balance: ${money(receipt.balance)}`, `Payment Method: ${receipt.paymentMethod}`, `Transaction Ref: ${receipt.transactionReference}`, `Received By: ${receipt.receivedBy}`];
  const content = ['q', '135 0 0 166 230 310 cm', '/Watermark Do', 'Q', 'q', '515 0 0 100 40 725 cm', '/Header Do', 'Q', 'BT', '/F1 14 Tf', '210 690 Td', `(${pdfString(lines[0])}) Tj`, '/F1 9 Tf', '-170 -28 Td', ...lines.slice(1).flatMap((line) => [`(${pdfString(line)}) Tj`, '0 -17 Td']), 'ET'].join('\n');
  const objects = [
    { raw: '<< /Type /Catalog /Pages 2 0 R >>' },
    { raw: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>' },
    { raw: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Header 5 0 R /Watermark 7 0 R >> /Font << /F1 4 0 R >> >> /Contents 9 0 R >>' },
    { raw: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' },
    { dict: `<< /Type /XObject /Subtype /Image /Width ${header.width} /Height ${header.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 6 0 R`, stream: header.rgb },
    { dict: `<< /Type /XObject /Subtype /Image /Width ${header.width} /Height ${header.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, stream: header.alpha },
    { dict: `<< /Type /XObject /Subtype /Image /Width ${watermark.width} /Height ${watermark.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 8 0 R`, stream: watermark.rgb },
    { dict: `<< /Type /XObject /Subtype /Image /Width ${watermark.width} /Height ${watermark.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, stream: watermark.alpha },
    { raw: `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream` }
  ];
  let output = Buffer.from('%PDF-1.4\n'); const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) { offsets.push(output.length); const object = objects[index]; const body = object.stream ? Buffer.concat([Buffer.from(`${index + 1} 0 obj\n${object.dict}\n/Length ${object.stream.length} >>\nstream\n`), object.stream, Buffer.from('\nendstream\nendobj\n')]) : Buffer.from(`${index + 1} 0 obj\n${object.raw}\nendobj\n`); output = Buffer.concat([output, body]); }
  const xref = output.length; return Buffer.concat([output, Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `).join('\n')}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`)])
    ;
}

export function createReceiptBrandingService({ fees, students, schoolId = 'school-osaah-daylight' } = {}) {
  function get(receiptNumber, user) { const payment = fees.listPayments().find((item) => item.receiptNumber === receiptNumber && item.schoolId === schoolId); if (!payment) throw new Error('Receipt not found.'); const invoice = fees.listInvoices().find((item) => item.invoiceNumber === payment.invoiceNumber && item.schoolId === schoolId); if (!invoice || !canRead(user, payment, invoice)) throw new Error('Forbidden.'); const student = students?.getStudent?.(payment.studentId, { requestedSchoolId: schoolId }) ?? {}; const previousBalance = Number(invoice.balance ?? 0) + Number(payment.amount ?? 0); return { receiptNumber: payment.receiptNumber, date: payment.createdAt, studentName: [student.firstName, student.middleName, student.surname].filter(Boolean).join(' ') || payment.studentId, studentIndexNumber: student.permanentStudentId ?? student.indexNumber ?? payment.studentId, className: student.classId ?? 'Unavailable', description: invoice.lineItems.map((item) => item.type).join(', ') || 'School payment', amount: payment.amount, previousBalance, balance: invoice.balance, paymentMethod: payment.method, transactionReference: payment.id, receivedBy: payment.enteredBy, status: payment.status, schoolId }; }
  function markup(receipt) { return `<article class="official-receipt"><img class="receipt-header-image" src="${RECEIPT_HEADER_ASSET}" alt="Official Osaah Daylight School Complex receipt header"><div class="receipt-body"><img class="receipt-watermark" src="${RECEIPT_WATERMARK_ASSET}" alt="" aria-hidden="true"><div class="receipt-content"><div class="receipt-title-row"><h1>PAYMENT RECEIPT</h1><strong>RECEIPT NO: ${esc(receipt.receiptNumber)}</strong></div><dl class="receipt-grid"><dt>Date</dt><dd>${esc(receipt.date)}</dd><dt>Academic Year</dt><dd>As recorded</dd><dt>Student Name</dt><dd>${esc(receipt.studentName)}</dd><dt>Student Index No.</dt><dd>${esc(receipt.studentIndexNumber)}</dd><dt>Class</dt><dd>${esc(receipt.className)}</dd><dt>Description</dt><dd>${esc(receipt.description)}</dd><dt>Amount Paid</dt><dd>${esc(money(receipt.amount))}</dd><dt>Previous Balance</dt><dd>${esc(money(receipt.previousBalance))}</dd><dt>Outstanding Balance</dt><dd>${esc(money(receipt.balance))}</dd><dt>Payment Method</dt><dd>${esc(receipt.paymentMethod)}</dd><dt>Transaction Ref.</dt><dd>${esc(receipt.transactionReference)}</dd><dt>Received By</dt><dd>${esc(receipt.receivedBy)}</dd></dl></div></div></article>`; }
  async function validateAssets() { await Promise.all([cachedAsset(join(root, RECEIPT_HEADER_ASSET)), cachedAsset(join(root, RECEIPT_WATERMARK_ASSET)), cachedAsset(join(root, RECEIPT_FONT_ASSET))]); return true; }
  async function pdf(receipt) { const [headerFile, watermarkFile, fontFile] = await Promise.all([cachedAsset(join(root, RECEIPT_HEADER_ASSET)), cachedAsset(join(root, RECEIPT_WATERMARK_ASSET)), cachedAsset(join(root, RECEIPT_FONT_ASSET))]); return makeUnicodePdf(receipt, headerFile, watermarkFile, fontFile); }
  // All Osaah payment receipt modules must use this centralized branding and generation layer.
  return { get, markup, pdf, buildReceiptModel: get, renderReceiptHtml: markup, generateReceiptPdf: pdf, validateAssets, assets: { header: RECEIPT_HEADER_ASSET, watermark: RECEIPT_WATERMARK_ASSET, font: RECEIPT_FONT_ASSET } };
}
