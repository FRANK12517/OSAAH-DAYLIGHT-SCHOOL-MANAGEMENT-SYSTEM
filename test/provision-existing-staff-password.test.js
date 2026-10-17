import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { parseArguments, provisionExistingAccount, askSecret, validateTarget } from '../scripts/provision-existing-staff-password.mjs';
import { passwordHash, passwordMatches } from '../src/password-hash.js';

const projectRef = 'douzohkmnuqwbpwcezke';
const ack = 'I_ACKNOWLEDGE_THIS_IS_A_NEW_DISPOSABLE_LOCAL_DATABASE';
const password = 'Correct-Horse-42!';
const userId = '00000000-0000-4000-8000-000000000006';
const baseEnv = { OSAAH_POSTGRES_URL: 'postgresql://dbuser:URL-SECRET@localhost/osaah_test_authrestore', OSAAH_PG_INTEGRATION_DISPOSABLE: ack };
const args = { environment: 'disposable', projectRef };
const requiredColumns = [
  ['users','id','uuid'],['users','email','text'],['users','username','text'],['users','password_hash','text'],['users','school_id','text'],['users','status','text'],['users','role','text'],['users','is_active','bool'],
  ['roles','id','uuid'],['roles','role_key','text'],['roles','oversight_rank','int4'],['user_roles','user_id','uuid'],['user_roles','role_id','uuid'],
  ['permissions','id','uuid'],['permissions','permission_key','text'],['role_permissions','role_id','uuid'],['role_permissions','permission_id','uuid'],
  ['auth_sessions','id','uuid'],['auth_sessions','user_id','uuid'],['auth_sessions','school_id','text'],['auth_sessions','token_hash','text'],['auth_sessions','created_at','timestamptz'],['auth_sessions','expires_at','timestamptz'],['auth_sessions','revoked_at','timestamptz'],['auth_sessions','last_used_at','timestamptz']
].map(([table_name,column_name,udt_name])=>({table_name,column_name,udt_name}));

function fixtureDatabase({ accountRows = null, missingHash = false, databaseName = 'osaah_test_authrestore' } = {}) {
  const writes = [], db = {};
  db.query = async (sql) => {
    if (sql.includes('current_database')) return [{database_name:databaseName}];
    if (sql.includes('information_schema.columns')) return missingHash ? requiredColumns.filter((row)=>row.column_name!=='password_hash') : requiredColumns;
    if (sql.includes('pg_class')) return ['users','roles','user_roles','permissions','role_permissions','auth_sessions'].map((table_name)=>({table_name,rls_enabled:true}));
    if (sql.includes('pg_policies')) return [];
    if (sql.includes('pg_constraint')) return [
      ...[['users','PRIMARY KEY (id)'],['users','UNIQUE (email)'],['roles','PRIMARY KEY (id)'],['roles','UNIQUE (name)'],['user_roles','PRIMARY KEY (id)'],['user_roles','UNIQUE (user_id, role_id)'],['permissions','PRIMARY KEY (id)'],['permissions','UNIQUE (name)'],['role_permissions','PRIMARY KEY (id)'],['role_permissions','UNIQUE (role_id, permission_id)'],['auth_sessions','PRIMARY KEY (id)']].map(([source,definition])=>({source,type:definition.startsWith('PRIMARY')?'p':'u',definition})),
      ...[['auth_sessions','users'],['user_roles','users'],['user_roles','roles'],['role_permissions','roles'],['role_permissions','permissions']].map(([source,target])=>({source,target,type:'f'}))
    ];
    if (sql.includes('array_agg')) return accountRows ?? [{id:userId,email:'teacher@example.test',role:'teacher',school_id:'sch_default_01',status:'ACTIVE',role_keys:['TEACHER']}];
    if (sql.includes('FOR UPDATE')) return [{id:userId}];
    return [];
  };
  db.transaction = async (callback, options) => { writes.push(['transaction',options]); return callback(db); };
  db.execute = async (sql, params) => { writes.push([sql,params]); return {affectedRows:1}; };
  db.close = async () => { writes.push(['close']); };
  return { db, writes };
}

test('CLI accepts only the explicit environment and project reference', () => {
  assert.deepEqual(parseArguments(['--environment=disposable',`--project-ref=${projectRef}`]),args);
  assert.throws(()=>parseArguments([]),{code:'USAGE'});
  assert.throws(()=>validateTarget({...baseEnv,OSAAH_POSTGRES_URL:'postgresql://localhost/osaah_test_authrestore'},{...args,projectRef:'other'}),{code:'PROJECT_REF_MISMATCH'});
  assert.throws(()=>validateTarget({OSAAH_POSTGRES_URL:'postgresql://db.douzohkmnuqwbpwcezke.supabase.co/postgres'},{environment:'production',projectRef}),{code:'PRODUCTION_GATES_REQUIRED'});
  assert.throws(()=>validateTarget({...baseEnv,OSAAH_POSTGRES_URL:'postgresql://remote.example/osaah_test_authrestore'},args),{code:'DISPOSABLE_TARGET_REQUIRED'});
});

test('CLI securely prompts, updates only the existing hash, and revokes sessions', async () => {
  const {db,writes}=fixtureDatabase(), output={value:'',write(value){this.value+=value;}};
  const prompts=[ 'teacher@example.test',`RESET teacher@example.test ${userId} DISPOSABLE ${projectRef}` ];
  const hidden=[password,password];
  const result=await provisionExistingAccount({environment:baseEnv,args,adapterFactory:()=>db,hashPassword:(value)=>`test-salt:${Buffer.from(value).toString('hex')}`,checkPassword:()=>true,ask:async()=>prompts.shift(),askHidden:async()=>hidden.shift(),output});
  assert.deepEqual(result,{userId,roleKey:'TEACHER',sessionsRevoked:1});
  assert.ok(writes.some(([kind,opts])=>kind==='transaction'&&opts.isolationLevel==='SERIALIZABLE'));
  const update=writes.find(([sql])=>typeof sql==='string'&&sql.startsWith('UPDATE public.users'));
  assert.ok(update); assert.notEqual(update[1][0],password); assert.equal(Buffer.from(update[1][0].split(':')[1],'hex').toString(),password);
  assert.ok(writes.some(([sql,params])=>typeof sql==='string'&&sql.includes('UPDATE public.auth_sessions')&&params[0]===userId));
  assert.doesNotMatch(output.value,new RegExp(password)); assert.doesNotMatch(output.value,/test-salt:/); assert.doesNotMatch(output.value,/URL-SECRET/);
});

test('CLI refuses incompatible schema, ambiguous users, and mismatched account confirmation without writes', async () => {
  const badSchema=fixtureDatabase({missingHash:true});
  await assert.rejects(()=>provisionExistingAccount({environment:baseEnv,args,adapterFactory:()=>badSchema.db,ask:async()=>{throw Error('prompt should not run');},output:{write(){}}}),{code:'AUTH_SCHEMA_INCOMPATIBLE'});
  assert.equal(badSchema.writes.some(([sql])=>typeof sql==='string'&&sql.startsWith('UPDATE')),false);
  const ambiguous=fixtureDatabase({accountRows:[{id:userId,email:'teacher@example.test',role:'teacher',school_id:'sch_default_01',status:'ACTIVE',role_keys:['TEACHER']},{id:'another',email:'teacher@example.test',role:'teacher',school_id:'sch_default_01',status:'ACTIVE',role_keys:['TEACHER']}]});
  const prompts=['teacher@example.test'];
  await assert.rejects(()=>provisionExistingAccount({environment:baseEnv,args,adapterFactory:()=>ambiguous.db,ask:async()=>prompts.shift(),output:{write(){}}}),{code:'ACCOUNT_NOT_UNIQUE'});
  assert.equal(ambiguous.writes.some(([kind])=>kind==='transaction'),false);
});

test('password prompt requires a TTY and does not echo typed input', async () => {
  const input=new PassThrough(); input.isTTY=true; input.setRawMode=()=>{};
  let shown=''; const output={write(value){shown+=value;}};
  const pending=askSecret('Password: ',input,output);
  input.write(`${password}\r`);
  assert.equal(await pending,password);
  assert.equal(shown,'Password: \n');
  await assert.rejects(()=>askSecret('Password: ',new PassThrough(),output),{code:'TTY_REQUIRED'});
});
test('shared scrypt hasher preserves the supported login encoding', () => {
  const hash=passwordHash(password);
  assert.match(hash,/^[0-9a-f]{32}:[0-9a-f]{64}$/);
  assert.equal(passwordMatches(password,hash),true);
  assert.equal(passwordMatches('wrong',hash),false);
});
test('CLI refuses database mismatch, inactive accounts, and role mismatches without writes', async () => {
  const dbMismatch=fixtureDatabase({databaseName:'osaah_other_database'});
  await assert.rejects(()=>provisionExistingAccount({environment:baseEnv,args,adapterFactory:()=>dbMismatch.db,ask:async()=>{throw Error('prompt should not run');},output:{write(){}}}),{code:'DATABASE_TARGET_AMBIGUOUS'});
  assert.equal(dbMismatch.writes.some(([sql])=>typeof sql==='string'&&sql.startsWith('UPDATE')),false);
  for (const account of [
    {id:userId,email:'teacher@example.test',role:'teacher',school_id:'sch_default_01',status:'DISABLED',role_keys:['TEACHER']},
    {id:userId,email:'teacher@example.test',role:'admin',school_id:'sch_default_01',status:'ACTIVE',role_keys:['TEACHER']}
  ]) {
    const fixture=fixtureDatabase({accountRows:[account]});
    await assert.rejects(()=>provisionExistingAccount({environment:baseEnv,args,adapterFactory:()=>fixture.db,ask:async()=> 'teacher@example.test',output:{write(){}}}),{code:account.status==='DISABLED'?'ACCOUNT_NOT_ACTIVE':'ACCOUNT_ROLE_INVALID'});
    assert.equal(fixture.writes.some(([kind])=>kind==='transaction'),false);
  }
});
