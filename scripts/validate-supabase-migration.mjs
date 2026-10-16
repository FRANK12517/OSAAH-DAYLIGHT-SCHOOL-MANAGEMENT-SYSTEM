#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const migrationPath = resolve('supabase/migrations/202610150001_osaah_daylight_schema.sql');
const setupPath = resolve('supabase/osaah_supabase_setup.sql');
const normalize = (value) => value.replace(/--[^\r\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
const sql = normalize(await readFile(migrationPath, 'utf8'));
const setup = normalize(await readFile(setupPath, 'utf8'));
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

const tables = [...sql.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
const views = [...sql.matchAll(/create\s+or\s+replace\s+view\s+public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
const setupTables = [...setup.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
const setupViews = [...setup.matchAll(/create\s+view\s+public\.([a-z_][a-z0-9_]*)/g)].map((m) => m[1]);
const tableDdl = (text) => [...text.matchAll(/create\s+table\s+if\s+not\s+exists\s+public\.[a-z_][a-z0-9_]*[\s\S]*?;/g)].map((m) => m[0].trim()).sort();
const viewDdl = (text, replaceable) => [...text.matchAll(new RegExp(`create\\s+${replaceable ? 'or\\s+replace\\s+' : ''}view\\s+public\\.[a-z_][a-z0-9_]*[\\s\\S]*?;`, 'g'))].map((m) => m[0].replace(/create\s+or\s+replace\s+view/i, 'create view').trim()).sort();
const unique = (values) => new Set(values).size === values.length;
check(tables.length > 0, 'No public CREATE TABLE statements were found.');
check(unique(tables), 'Duplicate table declaration found.');
check(unique(views), 'Duplicate view declaration found.');
check(unique(setupTables) && JSON.stringify([...tables].sort()) === JSON.stringify([...setupTables].sort()), 'SQL Editor setup table set differs from the canonical migration.');
check(unique(setupViews) && JSON.stringify([...views].sort()) === JSON.stringify([...setupViews].sort()), 'SQL Editor setup view set differs from the canonical migration.');
check(JSON.stringify(tableDdl(sql)) === JSON.stringify(tableDdl(setup)), 'SQL Editor setup table columns, types, defaults, or constraints differ from the canonical migration.');
check(JSON.stringify(viewDdl(sql, true)) === JSON.stringify(viewDdl(setup, false)), 'SQL Editor setup view definitions differ from the canonical migration.');
check(tables.includes('schools'), 'schools table is missing.');
check(/insert\s+into\s+public\.schools\s*\(\s*id\s*,\s*name\s*\)[\s\S]*?values\s*\(\s*'sch_default_01'/i.test(sql), 'Canonical sch_default_01 seed is missing.');

const tableSet = new Set(tables);
const refs = [...sql.matchAll(/references\s+public\.([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1]);
for (const ref of refs) check(tableSet.has(ref), `Foreign key target public.${ref} has no table declaration.`);

const indexes = [...sql.matchAll(/create\s+(unique\s+)?index\s+if\s+not\s+exists\s+([a-z_][a-z0-9_]*)\s+on\s+public\.([a-z_][a-z0-9_]*)/g)];
const setupIndexes = [...setup.matchAll(/create\s+(unique\s+)?index\s+if\s+not\s+exists\s+([a-z_][a-z0-9_]*)\s+on\s+public\.([a-z_][a-z0-9_]*)/g)];
const indexNames = indexes.map((m) => m[2]);
check(unique(indexNames), 'Duplicate explicit index name found.');
check(JSON.stringify(indexNames.sort()) === JSON.stringify(setupIndexes.map((m) => m[2]).sort()), 'SQL Editor setup explicit index set differs from the canonical migration.');
for (const [, , name, table] of indexes) check(tableSet.has(table), `Index ${name} targets undeclared table ${table}.`);

check(/enable\s+row\s+level\s+security/.test(sql), 'RLS enablement statements are missing.');
const dynamicRlsLoop = /for\s+\w+\s+in\s+select\s+tablename\s+from\s+pg_tables\s+where\s+schemaname\s*=\s*'public'[\s\S]*?execute\s+format\s*\(\s*'alter table public\.%i enable row level security'/i.test(sql);
if (!dynamicRlsLoop) for (const table of tables) {
  check(new RegExp(`alter table public\\.${table} enable row level security`).test(sql), `RLS is not enabled for public.${table}.`);
}
check(!/\b(mysql|mariadb|auto_increment|on\s+duplicate\s+key|group_concat|datetime)\b/.test(sql), 'MySQL-specific DDL token found.');
check(!/\b(mysql|mariadb|auto_increment|on\s+duplicate\s+key|group_concat|datetime)\b/.test(setup), 'MySQL-specific DDL token found in SQL Editor setup.');
check(!/create\s+or\s+replace\s+view/.test(setup), 'SQL Editor setup must not replace existing views.');
check(!/create\s+role\s+(anon|authenticated|service_role)/.test(setup), 'SQL Editor setup must not create Supabase-managed roles.');
check(/rolname\s*=\s*'anon'/.test(setup) && /rolname\s*=\s*'authenticated'/.test(setup) && /rolname\s*=\s*'service_role'\s+and\s+rolbypassrls/.test(setup), 'SQL Editor setup must verify Supabase-managed roles without creating them.');
check(/setup stopped: public\.% already exists/.test(setup), 'SQL Editor setup object-collision guard is missing.');
const guardNames = [...(setup.match(/c\.relname\s*=\s*any\s*\(\s*array\s*\[([^\]]+)\]/)?.[1] ?? '').matchAll(/'([a-z_][a-z0-9_]*)'/g)].map((m) => m[1]);
check(unique(guardNames) && JSON.stringify([...tables, ...views].sort()) === JSON.stringify(guardNames.sort()), 'SQL Editor setup collision guard does not cover every declared table and view.');
check(/grant all privileges on all tables in schema public to service_role/.test(setup), 'SQL Editor setup backend service_role table grant is missing.');
check(/grant usage on schema public to service_role/.test(setup), 'SQL Editor setup backend service_role schema grant is missing.');
check(!/create\s+extension/.test(setup), 'SQL Editor setup must not assume optional extensions are available.');
const baselineReferences = [...sql.matchAll(/references\s+public\.([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1]);
const setupReferences = [...setup.matchAll(/references\s+public\.([a-z_][a-z0-9_]*)\s*\(/g)].map((m) => m[1]);
check(JSON.stringify(baselineReferences) === JSON.stringify(setupReferences), 'SQL Editor setup foreign-key references differ from the canonical migration.');
const policies = [...sql.matchAll(/create\s+policy\s+([a-z_][a-z0-9_]*)\s+on\s+public\.([a-z_][a-z0-9_]*)/g)].map((m) => `${m[1]}:${m[2]}`);
const setupPolicies = [...setup.matchAll(/create\s+policy\s+([a-z_][a-z0-9_]*)\s+on\s+public\.([a-z_][a-z0-9_]*)/g)].map((m) => `${m[1]}:${m[2]}`);
check(JSON.stringify(policies) === JSON.stringify(setupPolicies), 'SQL Editor setup RLS policy declarations differ from the canonical migration.');

if (failures.length) {
  console.error(`Supabase migration static validation failed (${failures.length} issue(s)):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Supabase migration static validation passed: ${tables.length} tables, ${views.length} views, ${indexes.length} explicit indexes, ${refs.length} foreign-key references; RLS enablement present for every table.`);
}
