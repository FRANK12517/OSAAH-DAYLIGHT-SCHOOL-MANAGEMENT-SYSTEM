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

