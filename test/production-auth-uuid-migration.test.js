import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migrationPath = new URL('../supabase/migrations/202610170001_production_auth_uuid_compatibility.sql', import.meta.url);
const roles = ['proprietor', 'admin', 'headteacher', 'assistant_headteacher', 'accountant', 'teacher'];

async function liveSchemaFixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.users (
      id uuid PRIMARY KEY, email text NOT NULL CONSTRAINT users_email_key UNIQUE,
      full_name text NOT NULL, role text NOT NULL,
      is_active boolean DEFAULT true, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
    );
    CREATE TABLE public.auth_sessions (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
      token_hash text NOT NULL, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.roles (id uuid PRIMARY KEY, name text NOT NULL UNIQUE, description text, created_at timestamptz DEFAULT now());
    CREATE TABLE public.user_roles (
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id), role_id uuid NOT NULL REFERENCES public.roles(id),
      created_at timestamptz DEFAULT now(), UNIQUE(user_id, role_id)
    );
    CREATE TABLE public.permissions (id uuid PRIMARY KEY, name text NOT NULL UNIQUE, description text, created_at timestamptz DEFAULT now());
    CREATE TABLE public.role_permissions (
      id uuid PRIMARY KEY, role_id uuid NOT NULL REFERENCES public.roles(id), permission_id uuid NOT NULL REFERENCES public.permissions(id),
      created_at timestamptz DEFAULT now(), UNIQUE(role_id, permission_id)
    );
    ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
  `);
  for (let i = 0; i < roles.length; i += 1) {
    const userId = `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    const roleId = `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
    await db.query('INSERT INTO public.users(id,email,full_name,role,is_active) VALUES ($1,$2,$3,$4,true)', [userId, `${roles[i]}@example.test`, roles[i], roles[i]]);
    await db.query('INSERT INTO public.roles(id,name) VALUES ($1,$2)', [roleId, roles[i]]);
    await db.query('INSERT INTO public.user_roles(id,user_id,role_id) VALUES ($1,$2,$3)', [`20000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`, userId, roleId]);
  }
  return db;
}

test('production auth compatibility migration preserves UUID accounts and role assignments', async () => {
  const db = await liveSchemaFixture();
  try {
    const before = await db.query('SELECT id,email,role FROM public.users ORDER BY id');
    const assignments = await db.query('SELECT user_id,role_id FROM public.user_roles ORDER BY user_id');
    const migration = await readFile(migrationPath, 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const after = await db.query('SELECT id,email,role FROM public.users ORDER BY id');
    assert.deepEqual(after.rows, before.rows);
    assert.deepEqual((await db.query('SELECT user_id,role_id FROM public.user_roles ORDER BY user_id')).rows, assignments.rows);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM public.users WHERE password_hash IS NOT NULL')).rows[0].n, 0);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM public.users WHERE status <> 'ACTIVE' OR school_id <> 'sch_default_01'")).rows[0].n, 0);
    assert.deepEqual((await db.query('SELECT role_key FROM public.roles ORDER BY role_key')).rows.map((row) => row.role_key), ['ACCOUNTANT_BURSAR','ASSISTANT_HEADTEACHER','HEADTEACHER','PROPRIETOR','SCHOOL_ADMIN','TEACHER']);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_class WHERE relname IN ('users','auth_sessions','roles','user_roles','permissions','role_permissions') AND relrowsecurity")).rows[0].n, 6);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename IN ('users','auth_sessions','roles','user_roles','permissions','role_permissions')")).rows[0].n, 0);
  } finally {
    await db.close();
  }
});

test('production auth compatibility migration fails closed when verified inventory changes', async () => {
  const db = await liveSchemaFixture();
  try {
    await db.exec("UPDATE public.users SET is_active=false WHERE email='teacher@example.test'");
    const migration = await readFile(migrationPath, 'utf8');
    await assert.rejects(() => db.exec(migration), /row counts changed/);
  } finally {
    await db.close();
  }
});
