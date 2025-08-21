-- Registrations enrichment: auto-fill player game data and assign random slot based on match type capacity.
-- Paste in Supabase SQL editor and run once.

-- Ensure columns exist
alter table if exists public.registrations
  add column if not exists slot_number int,
  add column if not exists player_game_id text,
  add column if not exists player_game_name text;

-- Helper: compute slots by match type
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

grant execute on function public.compute_slots_by_type(text) to anon, authenticated, service_role;

-- Assign a random available slot (1..capacity) per match, avoiding duplicates among CONFIRMED registrations
create or replace function public.assign_random_slot(p_match_id text)
returns int
language plpgsql
security definer
as $$
declare
  v_type text;
  v_capacity int;
  v_taken int[];
  v_candidate int;
  v_attempts int := 0;
begin
  -- read match type from matches (id stored as text or uuid cast to text)
  select match_type into v_type from public.matches m where m.id::text = p_match_id limit 1;
  v_capacity := public.compute_slots_by_type(v_type);

  -- collect taken slot numbers for this match (confirmed only)
  select coalesce(array_agg(slot_number), '{}') into v_taken
  from public.registrations r
  where r.match_id::text = p_match_id and r.status = 'CONFIRMED' and r.slot_number is not null;

  if v_capacity is null or v_capacity <= 0 then
    v_capacity := 12;
  end if;

  -- Try a few random picks, then fallback to first free
  while v_attempts < 10 loop
    v_candidate := 1 + floor(random() * v_capacity)::int;
    if not (v_candidate = any(v_taken)) then
      return v_candidate;
    end if;
    v_attempts := v_attempts + 1;
  end loop;

  -- Fallback: find first free slot
  for v_candidate in 1..v_capacity loop
    if not (v_candidate = any(v_taken)) then
      return v_candidate;
    end if;
  end loop;

  -- If all taken, return null
  return null;
end;
$$;

revoke all on function public.assign_random_slot(text) from public;
grant execute on function public.assign_random_slot(text) to anon, authenticated, service_role;

-- Trigger: on INSERT, fill player game data from profiles and assign slot if empty
create or replace function public.tg_registrations_fill_defaults()
returns trigger
language plpgsql
security definer
as $$
declare
  v_name text;
  v_game_id text;
  v_slot int;
begin
  -- copy game info from profiles (keep existing if user provided)
  if new.player_game_id is null or new.player_game_id = '' then
    select p.game_id into v_game_id from public.profiles p where p.id::text = new.user_id::text limit 1;
    if v_game_id is not null then new.player_game_id := v_game_id; end if;
  end if;
  if new.player_name is null or new.player_name = '' then
    select coalesce(p.user_name, p.name) into v_name from public.profiles p where p.id::text = new.user_id::text limit 1;
    if v_name is not null then new.player_name := v_name; end if;
  end if;

  -- assign slot on confirmed registrations
  if new.status = 'CONFIRMED' and (new.slot_number is null or new.slot_number <= 0) then
    v_slot := public.assign_random_slot(new.match_id::text);
    if v_slot is not null then
      new.slot_number := v_slot;
    end if;
  end if;

  return new;
end;
$$;

-- Create trigger
drop trigger if exists trg_registrations_fill_defaults on public.registrations;
create trigger trg_registrations_fill_defaults
before insert on public.registrations
for each row
execute function public.tg_registrations_fill_defaults();

-- Optional: also assign slot when a registration transitions to CONFIRMED without a slot
create or replace function public.tg_registrations_assign_on_update()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.status = 'CONFIRMED' and (new.slot_number is null or new.slot_number <= 0) then
    new.slot_number := public.assign_random_slot(new.match_id::text);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_registrations_assign_on_update on public.registrations;
create trigger trg_registrations_assign_on_update
before update of status on public.registrations
for each row
when (new.status = 'CONFIRMED' and (new.slot_number is null or new.slot_number <= 0))
execute function public.tg_registrations_assign_on_update();
