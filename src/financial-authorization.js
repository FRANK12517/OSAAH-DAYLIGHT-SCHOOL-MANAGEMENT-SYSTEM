const RESOURCE_KEYS = Object.freeze(['fees', 'feeStructures', 'studentFees', 'payments', 'invoices', 'receipts']);
const ACTIONS = Object.freeze(['READ', 'CREATE', 'UPDATE', 'DELETE', 'PUBLISH', 'VOID_REVERSE', 'PRINT_EXPORT']);

// Deliberately least-privilege: role names are normalized by auth.js, while
// explicit permissions remain an override for configured production roles.
const ROLE_ACTIONS = Object.freeze({
  PROPRIETOR: new Set(ACTIONS),
  SCHOOL_ADMIN: new Set(['READ', 'CREATE', 'UPDATE', 'DELETE', 'PUBLISH', 'PRINT_EXPORT']),
  ACCOUNTANT_BURSAR: new Set(['READ', 'CREATE', 'UPDATE', 'PRINT_EXPORT']),
  HEADTEACHER: new Set(['READ', 'PRINT_EXPORT']),
  ASSISTANT_HEADTEACHER: new Set(['READ', 'PRINT_EXPORT']),
  TEACHER: new Set(),
  ADMINISTRATOR: new Set(['READ', 'CREATE', 'UPDATE', 'DELETE', 'PUBLISH', 'PRINT_EXPORT'])
});

const LEGACY_PERMISSION_ACTIONS = Object.freeze({
  READ: ['fees.read', 'finance.read'],
  CREATE: ['fees.create', 'fees.write', 'fees.collect'],
  UPDATE: ['fees.update', 'fees.write', 'fees.configure'],
  DELETE: ['fees.delete'],
  PUBLISH: ['fees.publish'],
  VOID_REVERSE: ['fees.void', 'fees.reverse'],
  PRINT_EXPORT: ['fees.print', 'fees.export', 'fees.read', 'finance.read']
});

export class FinancialAuthorizationError extends Error {
  constructor(message = 'Financial authorization required.', code = 'FINANCIAL_FORBIDDEN', status = 403) {
    super(message); this.name = 'FinancialAuthorizationError'; this.code = code; this.status = status;
  }
}

export function normalizeFinancialRole(roleKey) {
  const role = String(roleKey ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return role === 'ACCOUNTANT' ? 'ACCOUNTANT_BURSAR' : role === 'ADMINISTRATOR' ? 'SCHOOL_ADMIN' : role;
}

export function assertSchoolScope(actor, requestedSchoolId = null) {
  if (!actor?.id || typeof actor.schoolId !== 'string' || !actor.schoolId) throw new FinancialAuthorizationError('Authenticated school scope is required.', 'SCHOOL_SCOPE_REQUIRED', 403);
  if (requestedSchoolId != null && String(requestedSchoolId) !== actor.schoolId) throw new FinancialAuthorizationError('Cross-school financial access is forbidden.', 'CROSS_SCHOOL_ACCESS', 403);
  return actor.schoolId;
}

export function canFinancial(actor, action, resource = 'fees') {
  if (!ACTIONS.includes(action) || !RESOURCE_KEYS.includes(resource) || !actor?.schoolId) return false;
  if (actor.permissions?.has?.('*')) return true;
  const permissions = actor.permissions instanceof Set ? actor.permissions : new Set(actor.permissions ?? []);
  const resourcePermission = resource === 'feeStructures' ? 'fees' : resource === 'studentFees' ? 'fees' : resource;
  if (LEGACY_PERMISSION_ACTIONS[action].some((permission) => permissions.has(`${resourcePermission}.${permission.split('.')[1]}`) || permissions.has(permission))) return true;
  return ROLE_ACTIONS[normalizeFinancialRole(actor.roleKey)]?.has(action) ?? false;
}

export function authorizeFinancial(actor, action, resource = 'fees', requestedSchoolId = null) {
  assertSchoolScope(actor, requestedSchoolId);
  if (!canFinancial(actor, action, resource)) throw new FinancialAuthorizationError(`Financial ${action.toLowerCase().replace('_', '/')} permission required.`);
  return actor.schoolId;
}

export function assertInputSchool(actor, input) {
  assertSchoolScope(actor, input?.schoolId ?? input?.school_id ?? null);
  return actor.schoolId;
}

export function financialAudit({ audit = () => {}, actor, action, entity, entityId = null, transactionReference = null, previousValue = null, newValue = null, schoolId = null }) {
  assertSchoolScope(actor, schoolId ?? actor?.schoolId);
  audit({ schoolId: actor.schoolId, userId: actor.id, roleId: normalizeFinancialRole(actor.roleKey), action, entity, entityId, transactionReference, previousValue, newValue });
}

export const FINANCIAL_ACTIONS = ACTIONS;
export const FINANCIAL_RESOURCES = RESOURCE_KEYS;
export const FINANCIAL_ROLE_ACTIONS = ROLE_ACTIONS;
