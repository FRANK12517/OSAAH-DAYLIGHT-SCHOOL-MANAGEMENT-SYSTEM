# How to add a future OSAAH AI-enabled module

OSAAH modules are not AI-enabled automatically. A new module must first register its normal module manifest, navigation metadata, permissions, audit policy, production-data classification, dependencies, and regression tests. The safe default is `ai.enabled = false` with a documented reason.

## Validation sequence

1. Register the module through `createOSAAHModuleManifestRegistry`. Use a unique module ID, absolute route, semantic version, explicit sidebar roles, and explicit RBAC permissions.
2. Keep AI disabled until the module has production provenance, deterministic calculations, quality tests, and security review.
3. Register an operational analytics provider with `createOperationalAnalyticsRegistry`. The provider must declare its capability ID, supported and dashboard metrics, required permissions, health, production-only policy, quality rules, exception rules, and deterministic `calculate`/`summarize` functions.
4. Register only READ or ANALYZE tools returned by `createOperationalTools`. Never accept table names, model names, SQL, database handles, or caller-supplied school/role identity.
5. Activate the manifest with `ai.enabled = true` only after declaring tools, metrics, `health`, `productionDataOnly: true`, and `dataQualityAware: true`.
6. Add regression tests for authorization, cross-school isolation, Production Data Guard exclusions, quality degradation, unknown metrics/tools, WRITE denial, dashboard visibility, exceptions, and provider outage.

Example test-only registration:

```js
manifestRegistry.register({
  id: 'future-test', name: 'Future Test', version: '1.0.0', category: 'OPERATIONS', route: '/future-test',
  sidebarPlacement: { roles: ['SCHOOL_ADMIN'] }, permissions: ['future-test.read'], metrics: ['future-test.count'],
  audit: { required: true }, productionData: { classification: 'PRODUCTION' }, dependencies: [], regressionTests: ['future-test'],
  ai: { enabled: true, capabilityId: 'future-test', tools: ['future-test.status'], metrics: ['future-test.count'], health: 'ACTIVE', productionDataOnly: true, dataQualityAware: true }
});
```

The analytics registry discovers this provider at runtime. No switch statement or edit to Gateway, Orchestrator, or other AI-core files is required. An absent provider returns `UNSUPPORTED`; a disabled provider returns `DISABLED`. Dashboard cards appear only when the provider is active, declares dashboard metrics, and the authenticated role has every required permission.
