-- Compatibility migration for the verified UUID-backed Supabase starter schema.
-- Preserve existing user/role UUIDs and assignments. No credentials are invented.
BEGIN;

DO $preflight$
DECLARE
  expected RECORD;
  actual_type text;
  actual_roles text[];
  role_key_conflict boolean;
BEGIN
  IF to_regclass('public.users') IS NULL OR to_regclass('public.auth_sessions') IS NULL
     OR to_regclass('public.roles') IS NULL OR to_regclass('public.user_roles') IS NULL
     OR to_regclass('public.permissions') IS NULL OR to_regclass('public.role_permissions') IS NULL THEN
    RAISE EXCEPTION 'OSAAH auth compatibility preflight: one or more verified starter relations are missing';
  END IF;

  FOR expected IN SELECT * FROM (VALUES
    ('users','id','uuid'),('users','email','text'),('users','role','text'),('users','is_active','bool'),
    ('auth_sessions','id','uuid'),('auth_sessions','user_id','uuid'),('auth_sessions','token_hash','text'),('auth_sessions','expires_at','timestamptz'),('auth_sessions','created_at','timestamptz'),
    ('roles','id','uuid'),('roles','name','text'),('user_roles','id','uuid'),('user_roles','user_id','uuid'),('user_roles','role_id','uuid'),
    ('permissions','id','uuid'),('permissions','name','text'),('role_permissions','id','uuid'),('role_permissions','role_id','uuid'),('role_permissions','permission_id','uuid')
  ) AS columns_to_check(table_name,column_name,udt_name)
  LOOP
    SELECT c.udt_name INTO actual_type
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.table_name=expected.table_name AND c.column_name=expected.column_name;
    IF actual_type IS DISTINCT FROM expected.udt_name THEN
      RAISE EXCEPTION 'OSAAH auth compatibility preflight: public.%.% expected type %, found %', expected.table_name, expected.column_name, expected.udt_name, COALESCE(actual_type,'missing');
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND contype='p')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.users'::regclass AND contype='u' AND conname='users_email_key')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_roles'::regclass AND confrelid='public.users'::regclass AND contype='f')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.user_roles'::regclass AND confrelid='public.roles'::regclass AND contype='f')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.role_permissions'::regclass AND confrelid='public.roles'::regclass AND contype='f')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.role_permissions'::regclass AND confrelid='public.permissions'::regclass AND contype='f')
     OR NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.auth_sessions'::regclass AND confrelid='public.users'::regclass AND contype='f') THEN
    RAISE EXCEPTION 'OSAAH auth compatibility preflight: expected primary, unique, or UUID foreign-key constraints differ';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname IN ('users','auth_sessions','roles','user_roles','permissions','role_permissions')
      AND c.relkind IN ('r','p') AND NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'OSAAH auth compatibility preflight: RLS must remain enabled on all auth relations';
  END IF;

  -- The first application is intentionally bound to the exact live inventory.
  -- Once school_id exists, reruns skip these initial row-count assertions.
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='school_id') THEN
    IF (SELECT count(*) FROM public.users) <> 6
       OR (SELECT count(*) FROM public.users WHERE is_active IS TRUE) <> 6
       OR (SELECT count(*) FROM public.roles) <> 6
       OR (SELECT count(*) FROM public.user_roles) <> 6
       OR (SELECT count(*) FROM public.permissions) <> 0
       OR (SELECT count(*) FROM public.role_permissions) <> 0
       OR (SELECT count(*) FROM public.auth_sessions) <> 0 THEN
      RAISE EXCEPTION 'OSAAH auth compatibility preflight: live row counts changed; re-inventory before applying';
    END IF;

    SELECT array_agg(lower(btrim(name)) ORDER BY lower(btrim(name))) INTO actual_roles FROM public.roles;
    IF actual_roles IS DISTINCT FROM ARRAY['accountant','admin','assistant_headteacher','headteacher','proprietor','teacher']::text[] THEN
      RAISE EXCEPTION 'OSAAH auth compatibility preflight: role names differ from the verified six-role inventory';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.users u
      WHERE NOT EXISTS (
        SELECT 1 FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id
        WHERE ur.user_id=u.id AND lower(btrim(r.name))=lower(btrim(u.role))
      ) OR (SELECT count(*) FROM public.user_roles ur WHERE ur.user_id=u.id) <> 1
    ) THEN
      RAISE EXCEPTION 'OSAAH auth compatibility preflight: an account has a missing, multiple, or mismatched role assignment';
    END IF;
    IF EXISTS (SELECT lower(btrim(email)) FROM public.users GROUP BY lower(btrim(email)) HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'OSAAH auth compatibility preflight: case-insensitive email collision prevents safe username backfill';
    END IF;
    IF EXISTS (SELECT 1 FROM public.roles WHERE lower(btrim(name)) NOT IN ('proprietor','admin','headteacher','assistant_headteacher','accountant','teacher')) THEN
      RAISE EXCEPTION 'OSAAH auth compatibility preflight: an unrecognized role cannot be mapped safely';
    END IF;
    IF EXISTS (SELECT 1 FROM public.permissions) THEN
      RAISE EXCEPTION 'OSAAH auth compatibility preflight: permission records appeared; map them explicitly before migration';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='school_id' AND udt_name NOT IN ('text','varchar'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='username' AND udt_name NOT IN ('text','varchar'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='password_hash' AND udt_name NOT IN ('text','varchar'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='status' AND udt_name NOT IN ('text','varchar'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roles' AND column_name='role_key' AND udt_name NOT IN ('text','varchar'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roles' AND column_name='oversight_rank' AND udt_name <> 'int4')
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='permissions' AND column_name='permission_key' AND udt_name NOT IN ('text','varchar'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_sessions' AND column_name='school_id' AND udt_name NOT IN ('text','varchar'))
     OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='auth_sessions' AND column_name IN ('revoked_at','last_used_at') AND udt_name <> 'timestamptz') THEN
    RAISE EXCEPTION 'OSAAH auth compatibility preflight: a previously added auth column has an incompatible type';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='roles' AND column_name='role_key') THEN
    EXECUTE $check$
      SELECT EXISTS (
        SELECT 1 FROM public.roles
        WHERE lower(btrim(name)) IN ('proprietor','admin','headteacher','assistant_headteacher','accountant','teacher')
          AND role_key IS NOT NULL
          AND role_key <> CASE lower(btrim(name))
            WHEN 'proprietor' THEN 'PROPRIETOR' WHEN 'admin' THEN 'SCHOOL_ADMIN'
            WHEN 'headteacher' THEN 'HEADTEACHER' WHEN 'assistant_headteacher' THEN 'ASSISTANT_HEADTEACHER'
            WHEN 'accountant' THEN 'ACCOUNTANT_BURSAR' WHEN 'teacher' THEN 'TEACHER'
          END
      )
    $check$ INTO role_key_conflict;
    IF role_key_conflict THEN
      RAISE EXCEPTION 'OSAAH auth compatibility preflight: an existing role_key conflicts with the verified role name';
    END IF;
  END IF;
END
$preflight$;

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS username text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS school_id text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS status text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS role_key text;
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS oversight_rank integer;
ALTER TABLE public.permissions ADD COLUMN IF NOT EXISTS permission_key text;
ALTER TABLE public.auth_sessions ADD COLUMN IF NOT EXISTS school_id text;
ALTER TABLE public.auth_sessions ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE public.auth_sessions ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

UPDATE public.users SET username=COALESCE(NULLIF(btrim(username),''),email) WHERE username IS NULL OR btrim(username)='';
UPDATE public.users SET school_id=COALESCE(NULLIF(btrim(school_id),''),'sch_default_01') WHERE school_id IS NULL OR btrim(school_id)='';
UPDATE public.users SET status=CASE WHEN is_active IS TRUE THEN 'ACTIVE' ELSE 'DISABLED' END WHERE status IS NULL OR btrim(status)='';
UPDATE public.roles SET role_key=CASE lower(btrim(name)) WHEN 'proprietor' THEN 'PROPRIETOR' WHEN 'admin' THEN 'SCHOOL_ADMIN' WHEN 'headteacher' THEN 'HEADTEACHER' WHEN 'assistant_headteacher' THEN 'ASSISTANT_HEADTEACHER' WHEN 'accountant' THEN 'ACCOUNTANT_BURSAR' WHEN 'teacher' THEN 'TEACHER' END WHERE role_key IS NULL;
UPDATE public.roles SET oversight_rank=CASE role_key WHEN 'PROPRIETOR' THEN 100 WHEN 'SCHOOL_ADMIN' THEN 90 WHEN 'HEADTEACHER' THEN 80 WHEN 'ASSISTANT_HEADTEACHER' THEN 70 WHEN 'ACCOUNTANT_BURSAR' THEN 50 WHEN 'TEACHER' THEN 40 END WHERE oversight_rank IS NULL;
UPDATE public.auth_sessions s SET school_id=u.school_id FROM public.users u WHERE s.user_id=u.id AND s.school_id IS NULL;

ALTER TABLE public.users ALTER COLUMN username SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN school_id SET DEFAULT 'sch_default_01';
ALTER TABLE public.users ALTER COLUMN school_id SET NOT NULL;
ALTER TABLE public.users ALTER COLUMN status SET DEFAULT 'ACTIVE';
ALTER TABLE public.users ALTER COLUMN status SET NOT NULL;
ALTER TABLE public.roles ALTER COLUMN role_key SET NOT NULL;
ALTER TABLE public.roles ALTER COLUMN oversight_rank SET DEFAULT 0;
ALTER TABLE public.roles ALTER COLUMN oversight_rank SET NOT NULL;
ALTER TABLE public.permissions ALTER COLUMN permission_key SET NOT NULL;
ALTER TABLE public.auth_sessions ALTER COLUMN school_id SET DEFAULT 'sch_default_01';
ALTER TABLE public.auth_sessions ALTER COLUMN school_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON public.users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS roles_role_key_key ON public.roles (role_key);
CREATE UNIQUE INDEX IF NOT EXISTS permissions_permission_key_key ON public.permissions (permission_key);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_key ON public.auth_sessions (token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_user_lifecycle_idx ON public.auth_sessions (user_id, revoked_at, expires_at);

DO $postflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.users WHERE username IS NULL OR school_id <> 'sch_default_01' OR status IS NULL)
     OR EXISTS (SELECT 1 FROM public.roles WHERE role_key IS NULL OR oversight_rank IS NULL)
     OR EXISTS (SELECT 1 FROM public.permissions WHERE permission_key IS NULL)
     OR EXISTS (SELECT 1 FROM public.auth_sessions WHERE school_id IS NULL) THEN
    RAISE EXCEPTION 'OSAAH auth compatibility postflight failed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('users','auth_sessions','roles','user_roles','permissions','role_permissions') AND c.relkind IN ('r','p') AND NOT c.relrowsecurity) THEN
    RAISE EXCEPTION 'OSAAH auth compatibility postflight: RLS state changed';
  END IF;
END
$postflight$;

COMMIT;
