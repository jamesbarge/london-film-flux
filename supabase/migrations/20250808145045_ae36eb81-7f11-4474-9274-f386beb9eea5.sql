-- Create an RPC to fetch server time so the frontend can verify connectivity
create or replace function public.get_server_time()
returns timestamptz
language sql
stable
as $$
  select now();
$$;

-- Ensure anon and authenticated clients can execute it
grant execute on function public.get_server_time() to anon, authenticated;