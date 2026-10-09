import { createHash, randomUUID } from 'node:crypto';

const MAX_BYTES = 10 * 1024 * 1024;
const DOCUMENT_TYPES = new Set(['PASSPORT_PHOTOGRAPHS', 'BIRTH_CERTIFICATE_OR_GHANA_CARD', 'NHIS_CARD', 'LAST_ACADEMIC_REPORT']);
const MIME_EXTENSIONS = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png']
]);
function matchesFileSignature(bytes, mimeType) {
  if (mimeType === 'application/pdf') return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}
function safeOriginalName(value, fallback) {
  const name = String(value ?? '').replace(/\\/g, '/').split('/').at(-1).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 160);
  return name && name !== '.' && name !== '..' ? name : fallback;
}

function safeSegment(value) {
  const segment = String(value ?? '').trim();
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(segment)) throw new Error('Invalid admission document scope.');
  return segment;
}

export function createAdmissionDocumentStorage({ provider, idFactory = randomUUID, maxBytes = MAX_BYTES } = {}) {
  if (!provider?.put || !provider?.get || !provider?.delete) throw new Error('A private document storage provider is required.');
  async function upload({ bytes, mimeType, documentType, schoolId, applicationId, originalName }) {
    const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? []);
    const extension = MIME_EXTENSIONS.get(String(mimeType ?? '').toLowerCase());
    if (!extension) throw new Error('Admission documents must be PDF, JPEG, or PNG files.');
    if (!DOCUMENT_TYPES.has(documentType)) throw new Error('Unsupported admission document type.');
    if (!body.length || body.length > maxBytes) throw new Error(`Admission documents must be between 1 byte and ${maxBytes} bytes.`);
    if (!matchesFileSignature(body, String(mimeType).toLowerCase())) throw new Error('The uploaded bytes do not match the declared PDF, JPEG, or PNG file type.');
    const pathname = `${safeSegment(schoolId)}/admissions/${safeSegment(applicationId)}/${documentType.toLowerCase()}/${idFactory()}.${extension}`;
    const blob = await provider.put(pathname, body, { access: 'private', contentType: mimeType });
    if (!blob?.pathname) throw new Error('Private document storage did not confirm the uploaded file.');
    return { storageKey: blob.pathname, mimeType: String(mimeType).toLowerCase(), size: body.length, sha256: createHash('sha256').update(body).digest('hex'), originalName: safeOriginalName(originalName, `document.${extension}`) };
  }
  return Object.freeze({
    upload,
    async download(storageKey) {
      const key = String(storageKey ?? '');
      if (!key || key.startsWith('/') || key.includes('..') || key.includes('\\')) return null;
      return provider.get(key, { access: 'private' });
    },
    async replace(input) {
      const { previousKey, ...uploadInput } = input;
      const next = await upload(uploadInput);
      if (previousKey && previousKey !== next.storageKey) {
        try { await provider.delete(previousKey); }
        catch (error) {
          try { await provider.delete(next.storageKey); } catch {}
          throw error;
        }
      }
      return next;
    },
    async remove(storageKey) {
      const key = String(storageKey ?? '');
      if (key && !key.startsWith('/') && !key.includes('..') && !key.includes('\\')) await provider.delete(key);
    }
  });
}

export function createVercelPrivateBlobProvider({ put, get, del }) {
  return {
    put: (pathname, body, options) => put(pathname, body, { ...options, access: 'private' }),
    get: (pathname, options) => get(pathname, { ...options, access: 'private', useCache: false }),
    delete: (pathname) => del(pathname)
  };
}

export const ADMISSION_DOCUMENT_MAX_BYTES = MAX_BYTES;
