
DO $$
BEGIN
  -- Create a natural-keys uniqueness so we can upsert without touching the UUID PK
  ALTER TABLE public.screenings
    ADD CONSTRAINT screenings_unique_cinema_film_start
    UNIQUE (cinema_id, film_id, start_time);
EXCEPTION
  WHEN duplicate_object THEN
    -- Constraint already exists; do nothing
    NULL;
END $$;
