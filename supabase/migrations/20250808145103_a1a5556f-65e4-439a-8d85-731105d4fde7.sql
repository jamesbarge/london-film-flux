-- Recreate RPC with fixed search_path per linter recommendation
create or replace function public.get_server_time()
returns timestamptz
language sql
stable
set search_path = public
as $$
  select now();
$$;

-- Re-grant execute to client roles
grant execute on function public.get_server_time() to anon, authenticated;