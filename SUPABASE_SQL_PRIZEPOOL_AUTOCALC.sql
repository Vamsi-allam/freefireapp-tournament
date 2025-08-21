-- Auto-calc prize_pool in matches whenever registrations change
-- Paste in Supabase SQL editor and run once.

-- Add prize_pool column if missing
alter table if exists public.matches
  add column if not exists prize_pool numeric;

-- Helper: slots by type (reuse if not present)
create or replace function public.compute_slots_by_type(p_match_type text)
returns int
language sql
as $$
  select case upper(coalesce(p_match_type,'SQUAD'))
    when 'SOLO' then 48
    when 'DUO' then 24
    when 'SQUAD' then 12
    when 'CLASH_SQUAD' then 2
    else 12
  end
$$;

-- Helper: compute payout rate by match type
create or replace function public.compute_payout_rate(p_match_type text)
returns numeric
language sql
as $$
  select case upper(coalesce(p_match_type,''))
    when 'SOLO' then 0.80
    when 'CLASH_SQUAD' then 0.85
    when 'DUO' then 0.90
    when 'SQUAD' then 0.90
    else 0.90
  end
$$;

-- Recalculate prize_pool for a match id
create or replace function public.recalc_prize_pool_for_match(p_match_id text)
returns numeric
language plpgsql
security definer
as $$
declare
  v_type text;
  v_entry_fee numeric := 0;
  v_confirmed int := 0;
  v_rate numeric := 0.90;
  v_pool numeric := 0;
begin
  select m.match_type, coalesce(m.entry_fee,0) into v_type, v_entry_fee
  from public.matches m where m.id::text = p_match_id limit 1;

  select count(*) into v_confirmed
  from public.registrations r
  where r.match_id::text = p_match_id and r.status = 'CONFIRMED';

  v_rate := public.compute_payout_rate(v_type);
  v_pool := round(v_entry_fee * v_confirmed * v_rate);

  update public.matches set prize_pool = v_pool, updated_at = now()
  where id::text = p_match_id;

  return v_pool;
end;
$$;

revoke all on function public.recalc_prize_pool_for_match(text) from public;
grant execute on function public.recalc_prize_pool_for_match(text) to anon, authenticated, service_role;

-- Trigger: after INSERT/UPDATE on registrations, refresh prize pool for that match
create or replace function public.tg_refresh_prize_pool()
returns trigger
language plpgsql
security definer
as $$
begin
  if (tg_op = 'INSERT') then
    perform public.recalc_prize_pool_for_match(new.match_id::text);
  elsif (tg_op = 'UPDATE') then
    -- Recompute when status changes or when record moves matches (rare)
    if new.match_id is distinct from old.match_id then
      if old.match_id is not null then perform public.recalc_prize_pool_for_match(old.match_id::text); end if;
      if new.match_id is not null then perform public.recalc_prize_pool_for_match(new.match_id::text); end if;
    elsif new.status is distinct from old.status then
      perform public.recalc_prize_pool_for_match(new.match_id::text);
    end if;
  elsif (tg_op = 'DELETE') then
    if old.match_id is not null then perform public.recalc_prize_pool_for_match(old.match_id::text); end if;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_refresh_prize_pool on public.registrations;
create trigger trg_refresh_prize_pool
after insert or update or delete on public.registrations
for each row
execute function public.tg_refresh_prize_pool();
