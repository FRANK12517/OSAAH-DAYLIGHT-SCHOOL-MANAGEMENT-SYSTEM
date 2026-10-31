BEGIN;
CREATE TABLE IF NOT EXISTS public.parent_auth_challenges (
  id varchar(64) PRIMARY KEY,
  school_id varchar(64) NOT NULL REFERENCES public.schools(id),
  user_id varchar(64) NOT NULL REFERENCES public.users(id),
  normalized_phone varchar(20) NOT NULL,
  purpose varchar(32) NOT NULL,
  code_digest char(64) NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  consumed_at timestamptz,
  invalidated_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_parent_auth_challenges_active ON public.parent_auth_challenges(school_id,user_id,purpose,expires_at);
CREATE INDEX IF NOT EXISTS idx_parent_auth_challenges_phone ON public.parent_auth_challenges(school_id,normalized_phone,purpose,created_at);
CREATE TABLE IF NOT EXISTS public.parent_auth_rate_limits (
  bucket_hash char(64) PRIMARY KEY,
  window_started_at timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parent_auth_rate_limits_updated ON public.parent_auth_rate_limits(updated_at);
ALTER TABLE public.parent_auth_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parent_auth_rate_limits ENABLE ROW LEVEL SECURITY;
COMMIT;
