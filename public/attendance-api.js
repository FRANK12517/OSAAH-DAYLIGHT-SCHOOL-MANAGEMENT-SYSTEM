export class AttendanceApiError extends Error {
  constructor(message, { status = null, code = 'ATTENDANCE_API_ERROR', endpoint = null, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'AttendanceApiError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

function messageForStatus(status) {
  if (status === 401) return 'Your session has expired. Sign in again, then reload the register.';
  if (status === 403) return 'You do not have permission to load or update this attendance register.';
  if (status === 404) return 'The attendance service or selected class could not be found.';
  if (status === 408 || status === 504) return 'The attendance request timed out. Check your connection and retry.';
  if (status >= 500) return 'The attendance service is temporarily unavailable. Your selections are unchanged; please retry.';
  return 'The attendance request could not be completed. Check your selections and retry.';
}

export async function requestAttendanceJson(url, options = {}, { fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const endpoint = new URL(url, globalThis.location?.href ?? 'http://localhost').pathname;
  const controller = new AbortController();
  const externalSignal = options.signal;
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException('Request timed out', 'TimeoutError')), timeoutMs);
  const cleanup = () => { clearTimeout(timer); externalSignal?.removeEventListener('abort', abortFromCaller); };
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    cleanup();
    const timedOut = controller.signal.aborted && (controller.signal.reason?.name === 'TimeoutError' || error?.name === 'TimeoutError');
    throw new AttendanceApiError(timedOut ? messageForStatus(408) : 'Could not reach the attendance service. Check your connection and retry.', {
      status: timedOut ? 408 : null, code: timedOut ? 'ATTENDANCE_REQUEST_TIMEOUT' : 'ATTENDANCE_NETWORK_ERROR', endpoint, cause: error
    });
  }

  const contentType = response.headers?.get?.('content-type') ?? '';
  const isJson = /(?:application\/json|\+json)(?:\s*;|$)/i.test(contentType);
  let raw;
  try {
    raw = await response.text();
  } catch (error) {
    const timedOut = controller.signal.aborted && controller.signal.reason?.name === 'TimeoutError';
    cleanup();
    if (timedOut) throw new AttendanceApiError(messageForStatus(408), { status: 408, code: 'ATTENDANCE_REQUEST_TIMEOUT', endpoint, cause: error });
    throw new AttendanceApiError('The attendance service returned an unreadable response. Please retry.', {
      status: response.status, code: 'ATTENDANCE_RESPONSE_READ_FAILED', endpoint, cause: error
    });
  }
  cleanup();

  if (!isJson) {
    const code = response.status === 401 ? 'ATTENDANCE_AUTH_REQUIRED' : response.status === 403 ? 'ATTENDANCE_FORBIDDEN' : 'ATTENDANCE_UNEXPECTED_CONTENT_TYPE';
    const message = response.ok ? 'The attendance service returned an unexpected response. Your selections are unchanged; please retry.' : messageForStatus(response.status);
    throw new AttendanceApiError(message, { status: response.status, code, endpoint });
  }
  if (!raw.trim()) {
    throw new AttendanceApiError(response.ok ? 'The attendance service returned an empty response. Your register was not changed; please retry.' : messageForStatus(response.status), {
      status: response.status, code: response.ok ? 'ATTENDANCE_EMPTY_RESPONSE' : `ATTENDANCE_HTTP_${response.status}`, endpoint
    });
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw new AttendanceApiError('The attendance service returned an invalid response. Your selections are unchanged; please retry.', {
      status: response.status, code: 'ATTENDANCE_MALFORMED_JSON', endpoint, cause: error
    });
  }

  if (!response.ok || payload?.success === false) {
    const status = response.status;
    const safeStatusMessage = messageForStatus(status);
    const serverMessage = typeof payload?.message === 'string' ? payload.message : typeof payload?.error === 'string' ? payload.error : '';
    const safeClientMessage = status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 404 && status !== 408
      ? serverMessage || safeStatusMessage
      : safeStatusMessage;
    throw new AttendanceApiError(safeClientMessage, { status, code: payload?.code || `ATTENDANCE_HTTP_${status}`, endpoint });
  }
  return payload;
}
