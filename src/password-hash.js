import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
}

export function passwordMatches(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const separator = stored.indexOf(':');
  if (separator <= 0) return false;
  const salt = stored.slice(0, separator);
  const expectedHex = stored.slice(separator + 1);
  if (!/^[0-9a-f]{64}$/i.test(expectedHex)) return false;
  const actual = scryptSync(password, salt, 32);
  return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
}
