import test from 'node:test';
import assert from 'node:assert/strict';
import { ghanaPhoneLookupValues, isValidGhanaPhone, normalizeGhanaPhone } from '../../src/utils/normalize-phone.js';

test('normalizes domestic and international Ghana numbers to E.164', () => {
  assert.equal(normalizeGhanaPhone('0247293733'), '+233247293733');
  assert.equal(normalizeGhanaPhone('+233247293733'), '+233247293733');
  assert.deepEqual(ghanaPhoneLookupValues('0247293733'), ['233247293733', '0247293733', '+233247293733']);
  assert.equal(isValidGhanaPhone('invalid'), false);
});
