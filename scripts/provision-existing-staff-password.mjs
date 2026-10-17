/*
Owner-controlled, interactive credential provisioning. Passwords are read without terminal echo.
Requires OSAAH_POSTGRES_URL. Disposable mode additionally requires the local-database acknowledgement.
Production mode additionally requires recovery-restore evidence, owner approval, and
OSAAH_PRODUCTION_CREDENTIAL_RESET_APPROVED=I_CONFIRM_OWNER_AUTHORIZED_PRODUCTION_RESET.
Never pass a password or connection URL as an argument.
*/
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { createDatabaseAdapter } from '../src/ai/postgres-database-adapter.js';
import { passwordHash } from '../src/password-hash.js';
import { passwordMeetsPolicy } from '../src/durable-credential-management.js';

const PRODUCTION_PROJECT_REF = 'douzohkmnuqwbpwcezke';
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DISPOSABLE_ACK = 'I_ACKNOWLEDGE_THIS_IS_A_NEW_DISPOSABLE_LOCAL_DATABASE';
const STAFF_ROLES = new Set(['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER', 'ASSISTANT_HEADTEACHER', 'ACCOUNTANT_BURSAR', 'TEACHER']);
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

export function parseArguments(argv) {
  const args = Object.fromEntries(argv.filter((arg) => arg.startsWith('--')).map((arg) => {
    const [key, ...rest] = arg.slice(2).split('='); return [key, rest.join('=')];
  }));
  if (Object.keys(args).some((key) => !['environment','project-ref','help'].includes(key))) fail('USAGE','Unknown option; passwords and URLs must never be command-line arguments.');
  if (args.help !== undefined) return { help: true };
  if (!['production', 'disposable'].includes(args.environment) || !args['project-ref']) fail('USAGE', 'Specify --environment=production|disposable and --project-ref=<project-ref>.');
  return { environment: args.environment, projectRef: args['project-ref'] };
}

export function validateTarget(environment, args) {
  const raw = environment.OSAAH_POSTGRES_URL;
  if (!raw) fail('POSTGRES_URL_REQUIRED', 'OSAAH_POSTGRES_URL is required; other URL variables are ignored.');
  let url;
  try { url = new URL(raw); } catch { fail('POSTGRES_URL_INVALID', 'OSAAH_POSTGRES_URL is not a valid PostgreSQL URL.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('POSTGRES_URL_INVALID', 'The target must use PostgreSQL.');
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (args.environment === 'production') {
    if (args.projectRef !== PRODUCTION_PROJECT_REF) fail('PROJECT_REF_MISMATCH', 'Production project reference does not match the approved OSAAH project.');
    const direct = url.hostname.toLowerCase() === `db.${PRODUCTION_PROJECT_REF}.supabase.co`;
    const pooler = url.hostname.toLowerCase().endsWith('.pooler.supabase.com') && decodeURIComponent(url.username) === `postgres.${PRODUCTION_PROJECT_REF}`;
    if (!direct && !pooler) fail('DATABASE_TARGET_AMBIGUOUS', 'Connection target cannot be verified as the specified Supabase project.');
    if (!environment.OSAAH_PRODUCTION_RECOVERY_RESTORE_ID || !environment.OSAAH_PRODUCTION_OWNER_APPROVAL || environment.OSAAH_PRODUCTION_CREDENTIAL_RESET_APPROVED !== 'I_CONFIRM_OWNER_AUTHORIZED_PRODUCTION_RESET') fail('PRODUCTION_GATES_REQUIRED', 'Verified recovery restore, owner approval, and the explicit Production reset gate are required before credential provisioning.');
    return { database, projectRef: args.projectRef, environment: args.environment };
  }
  if (args.projectRef !== PRODUCTION_PROJECT_REF) fail('PROJECT_REF_MISMATCH','Disposable restore must identify the OSAAH source project.');
  if (!LOOPBACK.has(url.hostname.toLowerCase()) || !/^osaah_test_[a-z0-9_]{3,48}$/i.test(database)) fail('DISPOSABLE_TARGET_REQUIRED', 'Disposable mode requires a loopback osaah_test_* database restored from the OSAAH project.');
  if (environment.OSAAH_PG_INTEGRATION_DISPOSABLE !== DISPOSABLE_ACK) fail('DISPOSABLE_ACK_REQUIRED', 'The disposable database acknowledgement is required.');
  return { database, projectRef: args.projectRef, environment: args.environment };
}

const REQUIRED_COLUMNS = new Map([
  ['users.id','uuid'], ['users.email','text'], ['users.username','text'], ['users.password_hash','text'], ['users.school_id','text'], ['users.status','text'], ['users.role','text'], ['users.is_active','bool'],
  ['roles.id','uuid'], ['roles.role_key','text'], ['roles.oversight_rank','int4'], ['user_roles.user_id','uuid'], ['user_roles.role_id','uuid'],
  ['permissions.id','uuid'], ['permissions.permission_key','text'], ['role_permissions.role_id','uuid'], ['role_permissions.permission_id','uuid'],
  ['auth_sessions.id','uuid'], ['auth_sessions.user_id','uuid'], ['auth_sessions.school_id','text'], ['auth_sessions.token_hash','text'], ['auth_sessions.created_at','timestamptz'], ['auth_sessions.expires_at','timestamptz'], ['auth_sessions.revoked_at','timestamptz'], ['auth_sessions.last_used_at','timestamptz']
]);
export async function validateAuthSchema(database) {
  const columns = await database.query("SELECT table_name AS table_name,column_name AS column_name,udt_name AS udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name IN ('users','roles','user_roles','permissions','role_permissions','auth_sessions')");
  const found = new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row.udt_name]));
  for (const [name, type] of REQUIRED_COLUMNS) if (found.get(name) !== type) fail('AUTH_SCHEMA_INCOMPATIBLE', `Required authentication column ${name} is missing or has the wrong type.`);
  const relations = await database.query("SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('users','roles','user_roles','permissions','role_permissions','auth_sessions') AND c.relkind IN ('r','p')");
  if (relations.length !== 6 || relations.some((row) => row.rls_enabled !== true)) fail('AUTH_SCHEMA_INCOMPATIBLE', 'Required authentication relations or RLS state are incompatible.');
  const policies = await database.query("SELECT tablename FROM pg_policies WHERE schemaname='public' AND tablename IN ('users','roles','user_roles','permissions','role_permissions','auth_sessions')");
  if (policies.length !== 0) fail('AUTH_SCHEMA_INCOMPATIBLE', 'Authentication policies differ from the reviewed source inventory.');
  const constraints = await database.query("SELECT conrelid::regclass::text AS source,confrelid::regclass::text AS target,contype AS type,pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid IN ('public.users'::regclass,'public.auth_sessions'::regclass,'public.roles'::regclass,'public.user_roles'::regclass,'public.permissions'::regclass,'public.role_permissions'::regclass)");
  const definitions = new Set(constraints.filter((row) => row.type === 'p' || row.type === 'u').map((row) => `${row.source}:${row.definition}`));
  for (const signature of ['users:PRIMARY KEY (id)','users:UNIQUE (email)','roles:PRIMARY KEY (id)','roles:UNIQUE (name)','user_roles:PRIMARY KEY (id)','user_roles:UNIQUE (user_id, role_id)','permissions:PRIMARY KEY (id)','permissions:UNIQUE (name)','role_permissions:PRIMARY KEY (id)','role_permissions:UNIQUE (role_id, permission_id)','auth_sessions:PRIMARY KEY (id)']) if (!definitions.has(signature)) fail('AUTH_SCHEMA_INCOMPATIBLE', 'A required authentication primary or unique constraint is missing.');
  const fks = constraints.filter((row) => row.type === 'f');
  const pairs = new Set(fks.map((row) => `${row.source}->${row.target}`));
  for (const pair of ['auth_sessions->users','user_roles->users','user_roles->roles','role_permissions->roles','role_permissions->permissions']) if (!pairs.has(pair)) fail('AUTH_SCHEMA_INCOMPATIBLE', 'A required authentication foreign key is missing.');
}

function askLine(prompt, input = process.stdin, output = process.stdout) {
  const readline = createInterface({ input, output });
  return new Promise((resolve) => readline.question(prompt, (answer) => { readline.close(); resolve(answer.trim()); }));
}
export function askSecret(prompt, input = process.stdin, output = process.stdout) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') return Promise.reject(Object.assign(new Error('Password input requires an interactive terminal.'), { code: 'TTY_REQUIRED' }));
  output.write(prompt); input.setRawMode(true); input.setEncoding('utf8'); input.resume();
  return new Promise((resolve, reject) => {
    let secret = '';
    const finish = (error) => { input.setRawMode(false); input.pause(); input.removeListener('data', onData); output.write('\n'); error ? reject(error) : resolve(secret); };
    const onData = (chunk) => { for (const char of chunk) {
      if (char === '\u0003' || char === '\u0004') return finish(Object.assign(new Error('Password entry cancelled.'), { code: 'CANCELLED' }));
      if (char === '\r' || char === '\n') return finish();
      if (char === '\u007f' || char === '\b') secret = secret.slice(0, -1);
      else if (char >= ' ' && char !== '\u007f' && secret.length < 512) secret += char;
    } };
    input.on('data', onData);
  });
}
function roleKey(value) { const role = String(value ?? '').trim().toUpperCase(); return ({ ADMIN: 'SCHOOL_ADMIN', ACCOUNTANT: 'ACCOUNTANT_BURSAR' })[role] ?? role; }
async function findAccount(database, email) {
  const rows = await database.query(`SELECT u.id::text AS id,u.email AS email,u.role AS role,u.school_id AS school_id,u.status AS status,
    array_remove(array_agg(r.role_key ORDER BY r.role_key),NULL) AS role_keys FROM public.users u
    LEFT JOIN public.user_roles ur ON ur.user_id=u.id LEFT JOIN public.roles r ON r.id=ur.role_id
    WHERE lower(u.email)=lower(?) GROUP BY u.id,u.email,u.school_id,u.status`, [email]);
  if (rows.length !== 1) fail('ACCOUNT_NOT_UNIQUE', 'Exactly one existing account must match; no account was created.');
  const user = rows[0], roles = user.role_keys ?? [];
  if (user.school_id !== 'sch_default_01' || String(user.status).toUpperCase() !== 'ACTIVE') fail('ACCOUNT_NOT_ACTIVE', 'The existing account is not active in sch_default_01.');
  if (roles.length !== 1 || !STAFF_ROLES.has(roleKey(roles[0])) || roleKey(user.role) !== roleKey(roles[0])) fail('ACCOUNT_ROLE_INVALID', 'The account must have one recognized role assignment matching its account role.');
  return { ...user, roleKey: roleKey(roles[0]) };
}

export async function provisionExistingAccount({ environment = process.env,args,adapterFactory=createDatabaseAdapter,hashPassword=passwordHash,checkPassword=passwordMeetsPolicy,ask=askLine,askHidden=askSecret,output=process.stdout }={}) {
  const target = validateTarget(environment,args), url = new URL(environment.OSAAH_POSTGRES_URL);
  output.write(`Target: ${target.environment} project ${target.projectRef}, database ${target.database}, host ${url.hostname}.\n`);
  const database = adapterFactory({ environment });
  try {
    const current = await database.query('SELECT current_database() AS database_name');
    if (current[0]?.database_name !== target.database) fail('DATABASE_TARGET_AMBIGUOUS','Connected database does not match the confirmed target.');
    await validateAuthSchema(database);
    const email = (await ask('Existing account email: ')).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('INVALID_EMAIL','Enter an existing staff account email.');
    const account = await findAccount(database,email);
    output.write(`Matched existing account ${account.email}, UUID ${account.id}, role ${account.roleKey}.\n`);
    const phrase = `RESET ${email} ${account.id} ${target.environment.toUpperCase()} ${target.projectRef}`;
    if ((await ask(`Type exactly "${phrase}" to continue: `)) !== phrase) fail('CONFIRMATION_MISMATCH','Confirmation did not match; no changes were made.');
    const first = await askHidden('New password (input hidden): '), second = await askHidden('Confirm new password (input hidden): ');
    if (first !== second || !checkPassword(first)) fail('PASSWORD_POLICY_FAILED','Passwords must match and satisfy the application password policy. No changes were made.');
    const hash = hashPassword(first); let sessionsRevoked = 0;
    await database.transaction(async (tx) => {
      const currentAccount = await findAccount(tx,email);
      if (currentAccount.id !== account.id || currentAccount.roleKey !== account.roleKey) fail('ACCOUNT_CHANGED','Account identity or role changed; no credential was changed.');
      const locked = await tx.query("SELECT id FROM public.users WHERE id=? AND school_id=? AND upper(status)='ACTIVE' FOR UPDATE",[account.id,'sch_default_01']);
      if (locked.length !== 1) fail('ACCOUNT_CHANGED','The existing account is no longer active.');
      const updated = await tx.execute("UPDATE public.users SET password_hash=? WHERE id=? AND lower(email)=lower(?) AND school_id='sch_default_01' AND upper(status)='ACTIVE'",[hash,account.id,email]);
      if (Number(updated?.affectedRows) !== 1) fail('ACCOUNT_CHANGED','The existing account could not be updated exactly once.');
      const revoked = await tx.execute('UPDATE public.auth_sessions SET revoked_at=now() WHERE user_id=? AND school_id=? AND revoked_at IS NULL',[account.id,'sch_default_01']);
      sessionsRevoked = Number(revoked?.affectedRows ?? 0);
    }, { isolationLevel: 'SERIALIZABLE' });
    output.write(`Password updated for the existing ${account.roleKey} account; revoked ${sessionsRevoked} active session(s). Password and hash were not displayed.\n`);
    return { userId:account.id,roleKey:account.roleKey,sessionsRevoked };
  } finally { await database.close?.(); }
}

async function main() {
  try { const args=parseArguments(process.argv.slice(2)); if (args.help) { console.log('Usage: node scripts/provision-existing-staff-password.mjs --environment=disposable|production --project-ref=<ref>'); console.log('Requires OSAAH_POSTGRES_URL; never pass passwords or URLs as arguments.'); return; } await provisionExistingAccount({ args }); }
  catch (error) { console.error(`Credential provisioning stopped (${error.code ?? 'FAILED'}): ${error.message}`); process.exitCode=1; }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) await main();
