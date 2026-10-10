const MONEY_PATTERN = /^\d+(?:\.\d{1,2})?$/;
const MAX_MINOR_UNITS = BigInt(Number.MAX_SAFE_INTEGER);

/** Convert a user-entered Ghana cedi amount to integer pesewas without floats. */
export function parsePositiveGhsAmountToMinorUnits(value) {
  const text = String(value ?? '').trim();
  if (!MONEY_PATTERN.test(text)) {
    throw new Error('Enter a valid positive amount with no more than two decimal places.');
  }

  const [wholeText, fractionText = ''] = text.split('.');
  const minorUnits = BigInt(wholeText) * 100n + BigInt((fractionText + '00').slice(0, 2));
  if (minorUnits <= 0n || minorUnits > MAX_MINOR_UNITS) {
    throw new Error('Enter a valid positive amount within the supported range.');
  }
  return Number(minorUnits);
}
