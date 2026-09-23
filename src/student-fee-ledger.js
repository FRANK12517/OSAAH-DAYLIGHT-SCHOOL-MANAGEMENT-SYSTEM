import { randomUUID } from 'node:crypto';

export const FEE_LEDGER_TRANSACTION_TYPES = Object.freeze([
  'CHARGE',
  'ADJUSTMENT',
  'DISCOUNT',
  'PAYMENT',
  'REVERSAL'
]);

const DEBIT_TYPES = new Set(['CHARGE']);
const CREDIT_TYPES = new Set(['DISCOUNT', 'PAYMENT']);

export function createStudentFeeLedgerService({ now = () => new Date().toISOString(), schoolId = 'school-osaah-daylight' } = {}) {
  const entries = new Map();

  function record(input = {}, actor = {}) {
    const type = String(input.transactionType ?? '').trim().toUpperCase();
    if (!FEE_LEDGER_TRANSACTION_TYPES.includes(type)) fail('INVALID_TRANSACTION_TYPE', `Unsupported fee ledger transaction type: ${type || 'missing'}`);
    const recordedBy = actor.userId ?? actor.id ?? input.recordedBy;
    if (!recordedBy) fail('RECORDED_BY_REQUIRED', 'A recording actor is required.');
    if (input.schoolId && input.schoolId !== schoolId) fail('CROSS_SCHOOL_DENIED', 'Fee ledger transaction belongs to another school.');
    const amount = number(input.amount);
    let balanceEffect;
    let reference = null;

    if (type === 'REVERSAL') {
      if (!input.referenceId) fail('REVERSAL_REFERENCE_REQUIRED', 'A reversal must reference a ledger transaction.');
      reference = entries.get(input.referenceId);
      if (!reference || reference.schoolId !== schoolId) fail('REVERSAL_REFERENCE_NOT_FOUND', 'Referenced ledger transaction was not found.');
      if (reference.transactionType === 'REVERSAL') fail('REVERSAL_CHAIN_NOT_ALLOWED', 'A reversal cannot reverse another reversal.');
      if (reference.status !== 'ACTIVE') fail('TRANSACTION_NOT_ACTIVE', 'Only an active transaction can be reversed.');
      if ([...entries.values()].some((entry) => entry.transactionType === 'REVERSAL' && entry.referenceId === reference.id && entry.status === 'ACTIVE')) fail('TRANSACTION_ALREADY_REVERSED', 'The referenced transaction has already been reversed.');
      balanceEffect = -reference.balanceEffect;
    } else if (type === 'ADJUSTMENT') {
      if (!Number.isFinite(amount) || amount === 0) fail('INVALID_ADJUSTMENT_AMOUNT', 'An adjustment must be a non-zero amount.');
      balanceEffect = amount;
    } else {
      if (!Number.isFinite(amount) || amount <= 0) fail('INVALID_TRANSACTION_AMOUNT', `${type} amount must be greater than zero.`);
      balanceEffect = DEBIT_TYPES.has(type) ? amount : -amount;
    }

    const entry = {
      id: input.id ?? randomUUID(),
      schoolId,
      accountId: input.accountId ?? null,
      permanentStudentId: input.permanentStudentId ?? null,
      academicYearId: input.academicYearId ?? null,
      termId: input.termId ?? null,
      classId: input.classId ?? null,
      transactionType: type,
      feeType: input.feeType ?? null,
      amount: type === 'REVERSAL' ? Math.abs(balanceEffect) : amount,
      balanceEffect,
      referenceType: input.referenceType ?? (type === 'REVERSAL' ? 'LEDGER' : null),
      referenceId: input.referenceId ?? null,
      description: input.description ?? null,
      transactionDate: input.transactionDate ?? now(),
      source: input.source ?? 'MANUAL',
      recordedBy,
      recordedAt: now(),
      reversedBy: null,
      reversedAt: null,
      reversalReason: null,
      status: 'ACTIVE'
    };
    if (entries.has(entry.id)) fail('DUPLICATE_TRANSACTION', 'A fee ledger transaction with this ID already exists.');
    entries.set(entry.id, entry);
    return structured(entry);
  }

  function reverse(id, actor, reason) {
    const original = entries.get(id);
    if (!original) fail('TRANSACTION_NOT_FOUND', 'Fee ledger transaction was not found.');
    const reversal = record({
      transactionType: 'REVERSAL',
      accountId: original.accountId,
      permanentStudentId: original.permanentStudentId,
      academicYearId: original.academicYearId,
      termId: original.termId,
      classId: original.classId,
      referenceId: original.id,
      description: reason ?? `Reversal of ${original.id}`
    }, actor);
    original.status = 'REVERSED';
    original.reversedBy = actor.userId ?? actor.id;
    original.reversedAt = now();
    original.reversalReason = reason ?? null;
    return structured(reversal);
  }

  function list({ accountId = null, permanentStudentId = null, includeReversed = true } = {}) {
    return [...entries.values()].filter((entry) => (!accountId || entry.accountId === accountId) && (!permanentStudentId || entry.permanentStudentId === permanentStudentId) && (includeReversed || entry.status === 'ACTIVE')).map(structured);
  }

  function balance(scope = {}) {
    return list({ ...scope, includeReversed: true }).reduce((total, entry) => total + entry.balanceEffect, 0);
  }

  function get(id) { return entries.has(id) ? structured(entries.get(id)) : null; }
  return { record, reverse, list, balance, get, transactionTypes: () => [...FEE_LEDGER_TRANSACTION_TYPES] };
}

function number(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())) return Number(value);
  return Number.NaN;
}

function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function structured(value) { return JSON.parse(JSON.stringify(value)); }
