import { CORE_LEVELS } from './students.js';

const ALIASES = Object.freeze({
  'crèche': 'Nursery 1',
  creche: 'Nursery 1',
  nursery: 'Nursery 1',
  'nursery 1': 'Nursery 1',
  'nursery 2': 'Nursery 2',
  'kg 1': 'KG1',
  kg1: 'KG1',
  'kg 2': 'KG2',
  kg2: 'KG2',
  'basic 1': 'Primary 1',
  'basic 2': 'Primary 2',
  'basic 3': 'Primary 3',
  'basic 4': 'Primary 4',
  'basic 5': 'Primary 5',
  'basic 6': 'Primary 6',
  'primary 1': 'Primary 1',
  'primary 2': 'Primary 2',
  'primary 3': 'Primary 3',
  'primary 4': 'Primary 4',
  'primary 5': 'Primary 5',
  'primary 6': 'Primary 6',
  'jhs 1': 'JHS 1',
  'jhs 2': 'JHS 2',
  'jhs 3': 'JHS 3',
});

export const CANONICAL_CLASS_IDS = Object.freeze([...CORE_LEVELS]);

const TRANSFER_PREVIOUS_CLASS_LABELS = Object.freeze({
  KG1: 'KG 1',
  KG2: 'KG 2',
  'Primary 1': 'Basic 1',
  'Primary 2': 'Basic 2',
  'Primary 3': 'Basic 3',
  'Primary 4': 'Basic 4',
  'Primary 5': 'Basic 5',
  'Primary 6': 'Basic 6'
});

export const TRANSFER_PREVIOUS_CLASS_OPTIONS = Object.freeze(CORE_LEVELS
  .filter((className) => !className.startsWith('Nursery '))
  .map((value) => Object.freeze({ value, label: TRANSFER_PREVIOUS_CLASS_LABELS[value] ?? value })));

export const TRANSFER_PREVIOUS_CLASS_VALUES = Object.freeze(TRANSFER_PREVIOUS_CLASS_OPTIONS.map(({ value }) => value));

export function transferPreviousClassLabel(value) {
  return TRANSFER_PREVIOUS_CLASS_OPTIONS.find((item) => item.value === value || item.label === value)?.label ?? value ?? null;
}

export function canonicalClassId(value) {
  const key = String(value ?? '').trim().toLowerCase();
  const resolved = ALIASES[key];
  return resolved && CANONICAL_CLASS_IDS.includes(resolved) ? resolved : null;
}

export function requireCanonicalClassId(value) {
  const resolved = canonicalClassId(value);
  if (!resolved) throw new Error(`Invalid class: ${value ?? ''}`);
  return resolved;
}

export function displayClassName(value) {
  const resolved = canonicalClassId(value) ?? value;
  return resolved === 'KG1' ? 'KG 1' : resolved === 'KG2' ? 'KG 2' : resolved;
}

export function classAliases() {
  return Object.freeze({ ...ALIASES });
}

export default CANONICAL_CLASS_IDS;

