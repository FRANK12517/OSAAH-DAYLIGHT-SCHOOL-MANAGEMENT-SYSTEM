const RETRYABLE_CONNECTION_CODES = new Set(['ETIMEDOUT', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ECONNREFUSED']);

export function isRetryableConnectionError(error) {
  return RETRYABLE_CONNECTION_CODES.has(String(error?.code ?? '').toUpperCase());
}

export async function executeWithConnectionRetry({ createAdapter, operation, sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)), maxAttempts = 3 }) {
  if (typeof createAdapter !== 'function' || typeof operation !== 'function') throw new TypeError('createAdapter and operation are required.');
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const adapter = createAdapter();
    let retry = false;
    try {
      return await operation(adapter, attempt);
    } catch (error) {
      lastError = error;
      if (!isRetryableConnectionError(error) || attempt === maxAttempts) throw error;
      retry = true;
    } finally {
      await adapter.close?.();
    }
    if (retry) await sleep(1000 * attempt);
  }
  throw lastError;
}
