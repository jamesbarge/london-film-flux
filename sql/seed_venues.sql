-- Seed venues (requires table public.venues with columns: id text primary key, name text, website text)
insert into public.venues (id, name, website) values
  ('ica', 'ICA', 'https://www.ica.art'),
  ('bfi-southbank', 'BFI Southbank', 'https://whatson.bfi.org.uk'),
  ('genesis', 'Genesis Cinema', 'https://www.genesiscinema.co.uk'),
  ('rio', 'Rio Cinema', 'https://riocinema.org.uk'),
  ('the-nickel', 'The Nickel Cinema', 'https://thenickelcinema.com'),
  ('picturehouse-central', 'Picturehouse Central', 'https://www.picturehouses.com/cinema/picturehouse-central')
on conflict (id) do nothing;
