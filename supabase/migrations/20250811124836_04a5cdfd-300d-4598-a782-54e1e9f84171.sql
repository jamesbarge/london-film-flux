-- Add film description and screening booking/source URLs
ALTER TABLE public.films
  ADD COLUMN IF NOT EXISTS description TEXT;

ALTER TABLE public.screenings
  ADD COLUMN IF NOT EXISTS booking_url TEXT,
  ADD COLUMN IF NOT EXISTS source_url TEXT;