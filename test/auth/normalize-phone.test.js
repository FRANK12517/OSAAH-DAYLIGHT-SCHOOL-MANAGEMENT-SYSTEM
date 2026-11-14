import test from 'node:test';
import assert from 'node:assert/strict';
import { ghanaPhoneLookupValues, isValidGhanaPhone, normalizeGhanaPhone } from '../../src/utils/normalize-phone.js';

test('normalizes domestic and international Ghana numbers to E.164', () => {
  assert.equal(normalizeGhanaPhone('0247293733'), '+233247293733');
  assert.equal(normalizeGhanaPhone('+233247293733'), '+233247293733');
  assert.equal(normalizeGhanaPhone('020 123 4567'), '+233201234567');
  assert.equal(normalizeGhanaPhone('+233 59 123 4567'), '+233591234567');
  assert.equal(normalizeGhanaPhone('0291234567'), null);
  assert.equal(normalizeGhanaPhone('0301234567'), null);
  assert.deepEqual(ghanaPhoneLookupValues('0247293733'), ['233247293733', '0247293733', '+233247293733']);
  assert.equal(isValidGhanaPhone('invalid'), false);
});
