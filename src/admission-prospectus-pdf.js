import PDFDocument from 'pdfkit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROSPECTUS_HEADER_ASSET = '/assets/branding-osaah-receipt-header.png';
export const PROSPECTUS_WATERMARK_ASSET = '/assets/branding-osaah-watermark.png';
export const PROSPECTUS_FONT_ASSET = '/assets/fonts/DejaVuSans.ttf';
const publicRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

function decodeEntities(value) { return String(value ?? '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))); }
export function prospectusText(content) { return decodeEntities(String(content ?? '').replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\s*li(?:\s[^>]*)?>/gi, '\n• ').replace(/<\/(?:p|div|h[1-6]|li|ol|ul|section|article)>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim(); }

export function createAdmissionProspectusPdfService() {
  async function pdf(prospectus) {
    const [header, watermark, font] = await Promise.all([readFile(join(publicRoot, PROSPECTUS_HEADER_ASSET)), readFile(join(publicRoot, PROSPECTUS_WATERMARK_ASSET)), readFile(join(publicRoot, PROSPECTUS_FONT_ASSET))]);
    return new Promise((resolve, reject) => {
      const document = new PDFDocument({ size: 'A4', margins: { top: 205, right: 50, bottom: 55, left: 50 } }); const chunks = [];
      document.on('data', (chunk) => chunks.push(chunk)); document.on('end', () => resolve(Buffer.concat(chunks))); document.on('error', reject);
      document.image(header, 40, 28, { width: 515 }); document.save().opacity(0.055).image(watermark, 205, 330, { width: 185 }).restore();
      document.font(font).fillColor('#102a43').fontSize(17).text('ADMISSION PROSPECTUS', { align: 'center' }); document.moveDown(.45).fontSize(10).fillColor('#1769aa').text(`${prospectus.className}  •  ${prospectus.academicYear}`, { align: 'center' }); document.moveDown(1.2).fillColor('#102a43').fontSize(10.5).text(prospectusText(prospectus.content), { lineGap: 4 }); document.end();
    });
  }
  return { pdf, assets: { header: PROSPECTUS_HEADER_ASSET, watermark: PROSPECTUS_WATERMARK_ASSET, font: PROSPECTUS_FONT_ASSET } };
}
