-- Événements sur plusieurs jours : présence jour par jour (et créneau horaire facultatif).
--
-- Un membre du comité directeur, un photographe / vidéaste, un membre de l'équipe — ou toute
-- personne du board qui décide de venir (« je viens le 3e jour ») — indique les jours où il sera
-- là, avec une heure d'arrivée et de départ s'il le souhaite.
--
-- Règle de lecture : aucune ligne pour (événement, personne) = présent sur tout l'événement (comme
-- aujourd'hui, rien ne change pour l'existant). Des lignes = présent seulement ces jours-là.
--
-- Le planning s'en sert pour mettre en avant, dans le bandeau de l'événement, les jours où la
-- personne connectée est présente (et ses heures), sans créer d'autre événement.

begin;

create table if not exists public.event_presence_days (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  -- null : toute la journée de l'événement
  start_time time,
  end_time time,
  note text check (note is null or char_length(note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id, day),
  check (start_time is null or end_time is null or end_time > start_time)
);

create index if not exists event_presence_days_user_day_idx on public.event_presence_days (user_id, day);
create index if not exists event_presence_days_event_idx on public.event_presence_days (event_id);

-- Le jour doit tomber pendant l'événement (dates de Paris).
create or replace function public.event_presence_day_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start date;
  v_end date;
begin
  select (start_date at time zone 'Europe/Paris')::date,
         ((end_date - interval '1 second') at time zone 'Europe/Paris')::date
    into v_start, v_end
    from events where id = new.event_id;
  if v_start is null then
    raise exception 'Événement introuvable';
  end if;
  if new.day < v_start or new.day > greatest(v_start, v_end) then
    raise exception 'Ce jour n''est pas dans l''événement (du % au %)', v_start, greatest(v_start, v_end);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists event_presence_day_check on public.event_presence_days;
create trigger event_presence_day_check
  before insert or update on public.event_presence_days
  for each row execute function public.event_presence_day_check();

alter table public.event_presence_days enable row level security;

-- Lecture : comptes du board (pas les comptes FIEF), pour voir qui vient quel jour.
drop policy if exists event_presence_days_select on public.event_presence_days;
create policy event_presence_days_select on public.event_presence_days for select to authenticated
  using (not public.is_fief_account());

-- Écriture : chacun ses propres jours ; administrateurs et super users pour tout le monde.
drop policy if exists event_presence_days_insert on public.event_presence_days;
create policy event_presence_days_insert on public.event_presence_days for insert to authenticated
  with check (not public.is_fief_account() and (user_id = auth.uid() or public.is_admin_or_super(auth.uid())));

drop policy if exists event_presence_days_update on public.event_presence_days;
create policy event_presence_days_update on public.event_presence_days for update to authenticated
  using (user_id = auth.uid() or public.is_admin_or_super(auth.uid()))
  with check (user_id = auth.uid() or public.is_admin_or_super(auth.uid()));

drop policy if exists event_presence_days_delete on public.event_presence_days;
create policy event_presence_days_delete on public.event_presence_days for delete to authenticated
  using (user_id = auth.uid() or public.is_admin_or_super(auth.uid()));

grant select, insert, update, delete on public.event_presence_days to authenticated;

-- En direct : la fiche et le planning se mettent à jour quand quelqu'un change ses jours.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'event_presence_days') then
    alter publication supabase_realtime add table public.event_presence_days;
  end if;
end $$;

commit;
