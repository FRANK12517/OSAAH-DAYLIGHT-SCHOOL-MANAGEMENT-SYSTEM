# OSAAH AI Capability Registration Standard

AI capability manifests live in `src/ai/capabilities` and use the `*.capability.js` suffix. The discovery service loads these manifests deterministically, so adding a future module does not require editing the AI registry core.

A capability references an existing sidebar `moduleId` but remains independent from sidebar rendering. Hidden server modules may be supported by passing their authoritative module metadata to `buildAIRegistry`.

## Future module template: Library Management

Library already exists in OSAAH; this is a registration example only and does not activate new library behavior.

```js
export const capabilities = [{
  capability: {
    id: 'library',
    moduleId: 'library',
    moduleName: 'Library',
    category: 'LIBRARY MANAGEMENT',
    version: '1.0.0',
    enabled: true,
    description: 'Authorized library circulation intelligence.',
    requiredPermissions: ['library.read'],
    requiredRoles: ['HEADTEACHER', 'LIBRARIAN'],
    dataDomain: 'LIBRARY',
    tools: ['library.overdue-books', 'library.usage'],
    metrics: ['booksBorrowed', 'overdueCount'],
    reports: [],
    actions: [],
    dashboardWidgets: [],
    productionDataOnly: true,
    dataQualityRequirements: ['PROVENANCE', 'FRESHNESS', 'COMPLETENESS'],
    auditRequired: true
  },
  tools: [{
    name: 'library.overdue-books',
    capabilityId: 'library',
    description: 'Read overdue books from the authorized school scope.',
    operationType: 'READ',
    requiredPermission: 'library.read',
    inputSchema: { type: 'object', additionalProperties: false },
    outputSchema: { type: 'object' },
    productionDataOnly: true,
    schoolScoped: true,
    dataQualityAware: true,
    auditRequired: true,
    enabled: true
  }]
}];
```

An enabled capability must declare a permission and at least one tool or metric. Disabled capabilities require a reason. Enabled tools must be `READ` or `ANALYZE`; `PREPARE_ACTION` and `WRITE` remain blocked. Tool names are globally unique, schemas must declare a type, and module references must resolve against authoritative module metadata.
