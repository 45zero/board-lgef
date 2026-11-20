-- Événements sur plusieurs jours : présences SOUHAITÉES (vidéo, photo, comité directeur) jour par jour.
--
-- Le responsable de l'événement indique, à côté des dates, les jours (et le moment fort, heures
-- facultatives) où il veut un vidéaste, un photographe ou un membre du comité directeur. Le planning
-- affiche la demande sur ces jours-là seulement ; la personne désignée la voit avec les heures.
--
-- Quand elle accepte (technicien principal : coverage_requests.technician_response = 'accepted' ;
-- renfort : coverage_crew.status = 'accepted' ; comité directeur : director_attendance.status =
-- 'approved'), ses jours de présence (event_presence_days) sont remplis d'après la demande de son
-- rôle — seulement si elle n'a encore rien précisé. Elle peut ensuite les ajuster.
-- Sans demande précise : rien ne change (présent sur tout l'événement, comme aujourd'hui).

begin;

create table if not exists public.event_presence_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  kind text not null check (kind in ('video', 'photo', 'cd')),
  day date not null,
  start_time time,
  end_time time,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (event_id, kind, day),
  check (start_time is null or end_time is null or end_time > start_time)
);

create index if not exists event_presence_requests_event_idx on public.event_presence_requests (event_id);

-- Même contrôle de date que les présences : le jour doit tomber pendant l'événement.
create or replace function public.event_presence_request_check()
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
  return new;
end;
$$;

drop trigger if exists event_presence_request_check on public.event_presence_requests;
create trigger event_presence_request_check
  before insert or update on public.event_presence_requests
  for each row execute function public.event_presence_request_check();

alter table public.event_presence_requests enable row level security;

-- Comme les événements (modifiables par tout compte du board) ; jamais les comptes FIEF.
drop policy if exists event_presence_requests_select on public.event_presence_requests;
create policy event_presence_requests_select on public.event_presence_requests for select to authenticated
  using (not public.is_fief_account());
drop policy if exists event_presence_requests_write on public.event_presence_requests;
create policy event_presence_requests_write on public.event_presence_requests for all to authenticated
  using (not public.is_fief_account())
  with check (not public.is_fief_account());

grant select, insert, update, delete on public.event_presence_requests to authenticated;

/* ---------- Acceptation : jours de présence remplis d'après la demande ---------- */

-- Copie les créneaux demandés pour ces rôles dans les jours de présence de la personne, si elle n'en
-- a aucun sur l'événement. Plusieurs rôles (photo + vidéo) le même jour : du plus tôt au plus tard.
create or replace function public.presence_from_requests(p_event uuid, p_user uuid, p_kinds text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_user is null or p_event is null then
    return;
  end if;
  if exists (select 1 from event_presence_days where event_id = p_event and user_id = p_user) then
    return;
  end if;
  insert into event_presence_days (event_id, user_id, day, start_time, end_time)
  select p_event, p_user, r.day,
         case when bool_or(r.start_time is null) then null else min(r.start_time) end,
         case when bool_or(r.end_time is null) then null else max(r.end_time) end
    from event_presence_requests r
   where r.event_id = p_event and r.kind = any (p_kinds)
   group by r.day
  on conflict (event_id, user_id, day) do nothing;
end;
$$;

revoke all on function public.presence_from_requests(uuid, uuid, text[]) from public, anon, authenticated;

create or replace function public.presence_kinds_of_role(p_role text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_role when 'photo' then array['photo'] when 'video' then array['video'] else array['video', 'photo'] end
$$;

create or replace function public.presence_on_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'coverage_requests' then
    if new.technician_response = 'accepted' and old.technician_response is distinct from 'accepted' then
      perform presence_from_requests(new.event_id, coalesce(new.assigned_technician_id, new.technician_id), presence_kinds_of_role(new.technician_role));
    end if;
  elsif tg_table_name = 'coverage_crew' then
    if new.status = 'accepted' and (tg_op = 'INSERT' or old.status is distinct from 'accepted') then
      perform presence_from_requests(new.event_id, new.user_id, presence_kinds_of_role(new.role));
    end if;
  elsif tg_table_name = 'director_attendance' then
    if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
      perform presence_from_requests(new.event_id, new.director_id, array['cd']);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists presence_on_accept on public.coverage_requests;
create trigger presence_on_accept after update of technician_response on public.coverage_requests
  for each row execute function public.presence_on_accept();

drop trigger if exists presence_on_accept on public.coverage_crew;
create trigger presence_on_accept after insert or update of status on public.coverage_crew
  for each row execute function public.presence_on_accept();

drop trigger if exists presence_on_accept on public.director_attendance;
create trigger presence_on_accept after insert or update of status on public.director_attendance
  for each row execute function public.presence_on_accept();

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'event_presence_requests') then
    alter publication supabase_realtime add table public.event_presence_requests;
  end if;
end $$;

commit;
