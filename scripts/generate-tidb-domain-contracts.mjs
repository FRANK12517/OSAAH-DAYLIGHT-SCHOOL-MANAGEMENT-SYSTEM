import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const docsDir = resolve(root, 'docs/tidb-domain-contracts');
const manifestPath = resolve(root, 'docs/tidb-schema-requirements-manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const reconciliation = manifest.runtimeContractReconciliation;
const domains = reconciliation.domainCompletionMatrix;
const tables = new Map(manifest.tables.map((table) => [table.name, table]));
const views = new Map(reconciliation.viewDispositions.map((view) => [view.name, view]));
const findingsByDomain = {
  'Authentication and RBAC': ['Login resolves the account by username or email, checks ACTIVE status, verifies the stored hash, then resolves permissions through user_roles, roles, role_permissions, and permissions. The application also has legacy salt:hash verification behavior.', 'Current writers insert user_roles.id, but no current reader selects it. Evidence supports retaining the inserted id column and enforcing one assignment per user/role pair; it does not settle whether id or the pair should be the primary key.', 'Durable sessions store hashed tokens, compare fixed ISO expiry values, update last_used_at on restore, and revoke on logout or account/credential changes. Expiry is not extended during restore.'],
  'Proprietor and Administrator': ['Proprietor login uses a separate portal_users lookup, bcrypt verification, PROPRIETOR role check, and is_active flag. The route does not create the ordinary osaah_session cookie/session row.', 'No portal_users provisioning writer or initial proprietor bootstrap command was found. The endpoint therefore cannot be guaranteed to work on a clean installation from the available code.'],
  'Staff and Teachers': ['Staff provisioning generates a UUID shared by users.id, staff.id, and staff_profiles.id; staff_number is supplied by the caller, checked for duplicates within school scope, and returned as staffId.', 'The writer updates staff_number on both staff and staff_profiles, but historical staff_profiles definitions use another HR shape. Physical staff_number uniqueness and any relationship to employee_id remain unproven.'],
  'Students and Parents': ['Admission creates a master students row, student_profiles row, and parent_student_links row transactionally. The profile links to the master by student_master_id and keeps the permanent ID bridge in student_id.', 'Parent authentication and student/fee access filter ACTIVE links and scope students by school. Current source evidence does not establish a primary guardian flag or a link deactivation/archive workflow.'],
  'School Configuration and Academics': ['Academic workflows scope years, terms, classes, streams, and subject assignments by school/year and use current-period flags/configuration. Three-term configuration has explicit runtime/readiness paths.', 'class_subjects remains an optional legacy mapping fallback; it is not established as required for a fresh installation.'],
  'Attendance and Assessments': ['Attendance writes carry status, method, timestamps, version, and updater/entry identity where the writer supports them. Application services preserve present/absent/tardy/excused distinctions and school/class/year scope.', 'Assessment storage is split across examination, marks, and newer academic score/result stores. Numeric precision and uniqueness across these stores are not fully reconciled.'],
  'Results and Report Cards': ['Result workflows join student, class, subject, year, and term context, and result-blocking preserves a scoped uniqueness rule across result type and mock label.', 'Published result/report-card behavior is distributed across runtime services and migration guards; there is no single complete current TiDB definition for all legacy and canonical result stores.'],
  'Financial Management': ['Current fee writers/readers use fee accounts, ledger/payment/invoice/receipt/obligation repositories and school/year/term scopes. Minor-unit fields are used in collection records; other financial modules also expose decimal amount fields.', 'Historical views disagree on source tables, aliases, and payment amount columns. Select the supported current reporting API and its base contracts before selecting one view definition.'],
  'Reports, Notifications and Auditing': ['Runtime modules write audit logs and announcement/notification records; reporting and dashboard access is spread across service modules and authorization routes.', 'The class database views have historical definitions but no confirmed current direct runtime SELECT. A full module/feature-gate review is still needed to distinguish supported reporting from retired history.']
};
const cell = (value) => String(value ?? '').replaceAll('|', '/').replaceAll('\r', ' ').replaceAll('\n', ' ').replace(/\s+/g, ' ').trim();
const linkSource = (source) => '[' + source + '](../../' + source + ')';
const renderTable = (name) => {
  const table = tables.get(name);
  if (!table) return '| `' + name + '` | Not inventoried as a table; see view inventory or unresolved register. |';
  const operations = table.runtimeOperations;
  const files = table.sourceFiles.filter((file) => file.startsWith('src/')).map(linkSource).join(', ') || 'None statically linked';
  const writes = table.runtimeWriteColumns.join(', ') || 'No INSERT/UPDATE columns extracted';
  const projections = table.runtimeSelectProjectionEvidence.slice(0, 8).map(cell).join('; ') || 'No literal projection extracted';
  const historical = table.historicalColumnCandidates.slice(0, 12).map((column) => column.name + ':' + (column.observedType ?? 'type unknown')).join(', ') || 'No historical type candidates';
  const sample = table.runtimeSqlEvidence.slice(0, 5).map((item) => item.operation.toUpperCase() + ' ' + item.source + ':' + item.line + ' [' + cell(item.statementPrefix) + ']').join('<br>');
  return '| `' + name + '` | ' + table.classification + ' / ' + (reconciliation.tableDispositions.find((item) => item.name === name)?.disposition ?? 'UNRESOLVED') + ' | ' + operations.read + '/' + operations.join + '/' + operations.insert + '/' + operations.update + '/' + operations.delete + ' | ' + cell(writes) + ' | ' + cell(projections) + ' | ' + cell(historical) + ' | ' + (sample || 'No query extracted') + ' | ' + files + ' |';
};

await mkdir(docsDir, { recursive: true });
for (const domain of domains) {
  const slug = domain.domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const coreNames = domain.coreTables ?? [];
  const domainViews = domain.views ?? [];
  const tableRows = coreNames.map(renderTable);
  const viewRows = domainViews.map((name) => {
    const view = views.get(name);
    if (!view) return '| `' + name + '` | No historical view definition found | UNRESOLVED |';
    const deps = [...new Set(view.definitionHistory.flatMap((item) => item.dependencies))].join(', ');
    return '| `' + name + '` | ' + view.definitionHistory.map((item) => item.migration).join(', ') + ' | ' + cell(deps) + ' | ' + view.disposition + '; ' + view.definitionAssessment + ' |';
  });
  const evidenceFiles = domain.evidence.map(linkSource).join(', ');
  const lines = [
    '# ' + domain.domain + ' database contract', '',
    '> Status: **' + domain.status + '**. This is an evidence reconstruction, not approved canonical TiDB DDL. Historical types/constraints are candidate evidence only.', '',
    '## Scope and runtime evidence', '',
    'Target database: `' + manifest.targetDatabase + '`; school scope: `' + manifest.singleSchoolId + '`.',
    'Primary current-code and schema references: ' + evidenceFiles + '.',
    'The operation summary below is read/join/insert/update/delete counts extracted from current source SQL. Samples include source line and SQL prefix. Dynamic SQL, indirect calls, and feature-gated branches may not be fully captured.', '',
    '## Observed application contract', '',
    ...(findingsByDomain[domain.domain] ?? []).map((finding) => '- ' + finding), '',
    ...(domain.domain === 'Authentication and RBAC' ? [
      '### Password and session specifics',
      '',
      '- src/auth.js writes staff/admin credential hashes as scryptSync output: a random 16-byte salt encoded as hex, a 32-byte derived key encoded as hex, serialized as salt:hash. The service verifies this format and bcrypt hashes using bcrypt.compare.',
      '- src/admission-enrollment.js creates a random high-entropy parent password and bcrypt hash with cost 12; the user does not receive that password in the admission response. Proprietor login verifies bcrypt only. No plaintext password is stored.',
      '- Staff account creation enforces a 12-character minimum plus uppercase, lowercase, numeric, and symbol characters. No durable auth_sessions cleanup/deletion job was found; expiry/revocation does not itself remove rows.',
      ''
    ] : []),
    ...(domain.domain === 'Proprietor and Administrator' ? [
      '- The repository contains no proprietor password-hash writer or approved hash work factor for a bootstrap tool. Product/security owners must approve the bcrypt cost and identity table before implementation.',
      ''
    ] : []),
    '## Table evidence matrix', '',
    '| Table | Evidence class / disposition | SQL ops R/J/I/U/D | Runtime write columns | Runtime read projections | Historical type candidates (not canonical) | SQL samples | Source modules |',
    '|---|---|---:|---|---|---|---|---|',
    ...tableRows,
    ...(tableRows.length ? [] : ['| No tables listed | Domain is evidenced through modules/views below; required object inventory remains elsewhere. |']), '',
    ...(domainViews.length ? ['## Views', '', '| View | Definition migrations | Dependencies | Disposition / finding |', '|---|---|---|---|', ...viewRows, ''] : []),
    ...(domain.domain === 'Proprietor and Administrator' ? [
      '## Secure initial proprietor provisioning design',
      '',
      'Keep schema initialization separate from creating an operational identity. A future one-shot operator CLI should require an explicit provisioning authorization, collect the email/name and password through a protected interactive prompt or secret handoff, hash the password with the application bcrypt policy, verify the target database identity, and refuse if an active proprietor already exists. In one transaction it should insert the proprietor identity, role mapping, and an audit event; print only a non-secret completion result; and have no network endpoint or default credentials. Before implementation, define whether this identity belongs in portal_users or users/RBAC and how its login obtains a standard durable session.',
      ''
    ] : []),
    '## Per-object unresolved evidence', '',
    ...coreNames.flatMap((name) => {
      const item = reconciliation.tableDispositions.find((candidate) => candidate.name === name);
      const table = tables.get(name);
      const keys = table ? [
        ...(table.historicalPrimaryKeyEvidence ?? []).map((value) => 'PK ' + value),
        ...(table.historicalUniqueEvidence ?? []).map((value) => 'UNIQUE ' + value),
        ...(table.historicalIndexEvidence ?? []).map((value) => 'INDEX ' + value),
        ...(table.historicalForeignKeyEvidence ?? []).map((value) => 'FK ' + value)
      ] : [];
      return item ? ['### ' + name, '', '- Historical key/index/FK candidates (not canonical): ' + (keys.join('; ') || 'None found in indexed evidence.'), ...item.missingEvidence.map((gap) => '- Missing: ' + gap), '- Insufficient because: ' + item.whyRepositoryEvidenceIsInsufficient, '- Required decision/evidence: ' + item.requiredExternalDecision, '- Affected source/workflow evidence: ' + (item.affectedWorkflowEvidence.join(', ') || 'No current source path found.'), ''] : [];
    }),
    ...(domainViews.length ? domainViews.flatMap((name) => {
      const item = views.get(name);
      return item ? ['### View ' + name, '', ...item.missingEvidence.map((gap) => '- Missing: ' + gap), '- Insufficient because: ' + item.whyRepositoryEvidenceIsInsufficient, '- Required decision/evidence: ' + item.requiredExternalDecision, '- Affected source/workflow evidence: ' + (item.affectedWorkflowEvidence.join(', ') || 'No current direct consumer identified.'), ''] : [];
    }) : []),
    '## Contract status and unresolved requirements', '',
    ...domain.blockers.map((item) => '- ' + item),
    '- Exact SQL types, lengths/precision, nullability, defaults, primary/unique/index constraints, FK actions, charset/collation, and target-version compatibility remain unresolved unless a specific field is established by runtime behavior. The manifest preserves operation-level evidence; this document does not infer a full definition from a historical CREATE TABLE.',
    '- Decisions requiring business-owner approval: identifier lifecycle, uniqueness scope, retention/deactivation, authorization policy, and clean-install workflow choices listed above.', '',
    '## Validation evidence', '',
    '- Relevant automated tests are recorded in the phase report and repository test suite; those tests validate application behavior, not a live TiDB schema.',
    '- No production database was queried and no DDL was executed.', ''
  ];
  await writeFile(resolve(docsDir, slug + '.md'), lines.join('\n'));
}

const matrixLines = [
  '# Phase 2E domain contract completion matrix', '',
  '> No domain is complete. The required database contracts remain evidence-only and no production DDL is approved.', '',
  '| Domain | Status | Core tables | Views | Evidence modules | Business-owner decisions / blockers |',
  '|---|---|---|---|---|---|',
  ...domains.map((domain) => '| ' + domain.domain + ' | ' + domain.status + ' | ' + domain.coreTables.map((name) => '`' + name + '`').join(', ') + ' | ' + (domain.views ?? []).map((name) => '`' + name + '`').join(', ') + ' | ' + domain.evidence.join(', ') + ' | ' + domain.blockers.join('; ') + ' |'), '',
  '## Completion totals', '',
  '- Fully resolved required tables: **0 of 71**.',
  '- Fully resolved required views: **0 of 5**. Historical SELECT definitions are retained, but definition conflicts and base-table contracts are unresolved.',
  '- Historical table names: 164 total; 66 required current runtime, five required supported workflow, one legacy compatibility only, zero obsolete with evidence, 92 unresolved. Each table disposition carries missing evidence, insufficiency rationale, required external decision, and affected workflow/source evidence in the machine-readable manifest.',
  '- Historical views: eight total; five required supported workflow and three unresolved. All five required-view definitions remain unverified as canonical.',
  '- All nine domains are partial; no domain meets its complete contract requirements. All eight historical views retain a disposition and explicit unresolved evidence; the two class database views remain unresolved because no supported consumer or approved retirement evidence was found.',
  '- Global blockers: actual target TiDB version; 17 source-linked tables without extracted SQL; 75 historical-only table dispositions; critical user/RBAC, proprietor, staff, parent identity, view, FK and generated-column contract gaps.', '',
  '- Adapter configuration is `OSAAH_DATABASE_ADAPTER=tidb` with mysql2; it accepts `DATABASE_URL` (`mysql://` or `mysql2://`) or component host/user/password/database/port variables. The database is enforced as `osaahdaylightschool`, default port is 3306, TLS minimum is 1.2 with `rejectUnauthorized=true` and optional `TIDB_CA_CERT`, pool size is 10, and connect timeout is 15 seconds. Transactions use one checked-out connection with begin/commit/rollback. sql_mode, default charset/collation, and session time zone are unspecified by repository configuration.',
  '- If enforced foreign keys are selected, TiDB v8.5.0+ is the documented GA minimum; v6.6.0 introduced experimental support. The target version remains an external prerequisite. Generated-column indexes, JSON behavior, date/time session semantics, transaction behavior, and FK actions need testing against the target version.',
  '## Explicit business-owner decisions', '',
  '- Choose and authorize proprietor bootstrap/identity linking and audit workflow; application has no secure initial-account provisioning path in the inspected runtime.',
  '- Decide canonical uniqueness scopes for user identifiers and cross-school account lookup.',
  '- Resolve whether user_roles requires an id in addition to its natural user/role pair.',
  '- Decide staff employee identifier meaning, reassignment rules, and staff_profiles relationship to the HR record.',
  '- Define parent guardian priority, multi-guardian behavior, link deactivation/archive rules, and delete retention.',
  '- Choose which historical financial/result projections are supported and approve their view output contracts.',
  '- Specify target TiDB version and FK policy, including delete/update actions.', ''
];
await writeFile(resolve(docsDir, 'completion-matrix.md'), matrixLines.join('\n'));

manifest.domainDocumentation = {
  directory: 'docs/tidb-domain-contracts',
  domainCount: domains.length,
  fullyResolvedDomains: domains.filter((domain) => domain.status === 'COMPLETE').map((domain) => domain.domain),
  partialDomains: domains.filter((domain) => domain.status === 'PARTIAL').map((domain) => domain.domain),
  unresolvedRequiredTableContracts: 71,
  unresolvedRequiredViewContracts: 5,
  documents: [...domains.map((domain) => domain.domain.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.md'), 'completion-matrix.md']
};
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
process.stdout.write(JSON.stringify({ ok: true, directory: relative(root, docsDir), domains: domains.length, files: manifest.domainDocumentation.documents.length, fullyResolvedTables: 0, fullyResolvedViews: 0 }) + '\n');
