-- Enable required extensions
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Unschedule existing job if present (returns false if it didn't exist)
select cron.unschedule('scrape_screenings_nightly');

-- Schedule nightly run at 02:00 UTC to invoke the edge function
select
  cron.schedule(
    'scrape_screenings_nightly',
    '0 2 * * *',
    $$
    select net.http_post(
      url := 'https://dlhkvzslowervdyzideq.supabase.co/functions/v1/scrape_screenings',
      headers := '{
        "Content-Type": "application/json",
        "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsaGt2enNsb3dlcnZkeXppZGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2NTgwMDQsImV4cCI6MjA3MDIzNDAwNH0.oRo21So_ZA4QcknaOBnsuP0oaAssH1MGQiPv7MeQIZ8",
        "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsaGt2enNsb3dlcnZkeXppZGVxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ2NTgwMDQsImV4cCI6MjA3MDIzNDAwNH0.oRo21So_ZA4QcknaOBnsuP0oaAssH1MGQiPv7MeQIZ8"
      }'::jsonb,
      body := '{"source":"ica"}'::jsonb
    )
    $$
  );