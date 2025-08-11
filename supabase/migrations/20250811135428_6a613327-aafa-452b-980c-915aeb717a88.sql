
-- 1) Ensure 'name' is unique so lookups are deterministic
CREATE UNIQUE INDEX IF NOT EXISTS cinemas_name_key ON public.cinemas (name);

-- 2) Seed required cinemas idempotently
INSERT INTO public.cinemas (name)
VALUES 
  ('ICA'),
  ('BFI Southbank')
ON CONFLICT (name) DO NOTHING;
