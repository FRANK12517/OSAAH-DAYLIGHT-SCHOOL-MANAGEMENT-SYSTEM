export function createAuditLog(input, clock = () => new Date().toISOString()) {
  if (!input?.action || !input?.entity) throw new Error('Audit action and entity are required');
  return Object.freeze({ id: input.id ?? crypto.randomUUID(), schoolId: input.schoolId ?? null, userId: input.userId ?? null, roleId: input.roleId ?? null, action: input.action, entity: input.entity, entityId: input.entityId ?? null, previousValue: input.previousValue ?? null, newValue: input.newValue ?? null, ipAddress: input.ipAddress ?? null, sessionId: input.sessionId ?? null, deviceMetadata: input.deviceMetadata ?? null, occurredAt: clock() });
}
