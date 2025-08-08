-- Wipe all user-defined tables in the public schema to start from scratch
-- Avoids touching any Supabase-reserved schemas

-- Drop all tables in the public schema (policies, indexes, and FKs will be dropped via CASCADE)
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  ) LOOP
    EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', r.tablename);
  END LOOP;
END $$;