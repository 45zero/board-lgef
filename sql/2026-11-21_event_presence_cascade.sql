-- Présences jour par jour : la cascade derrière les présences souhaitées.
--
-- 1. Origine d'un jour de présence : 'self' (déclaré par la personne) ou 'request' (recopié de la
--    présence souhaitée quand elle a accepté). Les jours 'self' ne sont jamais touchés par la suite.
-- 2. La demande change (Jérémie passe la vidéo du mardi au mercredi) : les personnes déjà engagées
--    dans ce rôle, dont les jours viennent de la demande, suivent automatiquement. L'appli les prévient.
-- 3. La personne quitte son rôle (technicien réassigné ou qui refuse, renfort qui décline ou est
--    retiré, membre CD qui décline, est retiré ou passe la main) : ses jours recopiés disparaissent,
--    sauf si elle reste engagée sur l'événement à un autre titre.

begin;

alter table public.event_presence_days add column if not exists source text not null default 'self';
alter table public.event_presence_days drop constraint if exists event_presence_days_source_check;
alter table public.event_presence_days add constraint event_presence_days_source_check check (source in ('self', 'request'));

-- Personnes engagées (ayant accepté) sur un événement, et les rôles de présence qui les concernent.
create or replace function public.presence_holders(p_event uuid)
returns table (user_id uuid, kinds text[])
language sql
stable
security definer
set search_path = public
as $$
  select h.user_id, array_agg(distinct h.k) as kinds
    from (
      select coalesce(c.assigned_technician_id, c.technician_id) as user_id, unnest(presence_kinds_of_role(c.technician_role)) as k
        from coverage_requests c
       where c.event_id = p_event and c.technician_response = 'accepted' and c.status is distinct from 'cancelled'
      union all
      select w.user_id, unnest(presence_kinds_of_role(w.role)) from coverage_crew w where w.event_id = p_event and w.status = 'accepted'
      union all
      select d.director_id, 'cd' from director_attendance d where d.event_id = p_event and d.status = 'approved'
    ) h
   where h.user_id is not null
   group by h.user_id
$$;

-- Recopie (ou remet à jour) les jours d'une personne d'après la demande de ses rôles. Ne fait rien
-- si elle a déclaré elle-même ses jours ; sans demande pour ses rôles, ses jours recopiés sont retirés
-- (elle redevient présente sur tout l'événement).
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
  if exists (select 1 from event_presence_days where event_id = p_event and user_id = p_user and source = 'self') then
    return;
  end if;
  delete from event_presence_days where event_id = p_event and user_id = p_user and source = 'request';
  insert into event_presence_days (event_id, user_id, day, start_time, end_time, source)
  select p_event, p_user, r.day,
         case when bool_or(r.start_time is null) then null else min(r.start_time) end,
         case when bool_or(r.end_time is null) then null else max(r.end_time) end,
         'request'
    from event_presence_requests r
   where r.event_id = p_event and r.kind = any (p_kinds)
   group by r.day
  on conflict (event_id, user_id, day) do nothing;
end;
$$;

-- Retire les jours recopiés d'une personne qui n'est plus engagée sur l'événement ; si elle l'est
-- encore, ses jours sont recalculés pour ses rôles (rôle changé, nouvelle acceptation…).
create or replace function public.presence_release(p_event uuid, p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kinds text[];
begin
  if p_user is null or p_event is null then
    return;
  end if;
  select h.kinds into v_kinds from presence_holders(p_event) h where h.user_id = p_user;
  if v_kinds is null then
    delete from event_presence_days where event_id = p_event and user_id = p_user and source = 'request';
  else
    perform presence_from_requests(p_event, p_user, v_kinds);
  end if;
end;
$$;

revoke all on function public.presence_holders(uuid) from public, anon, authenticated;
revoke all on function public.presence_release(uuid, uuid) from public, anon, authenticated;
revoke all on function public.presence_from_requests(uuid, uuid, text[]) from public, anon, authenticated;

-- Acceptation, changement de rôle ou départ : on recalcule la ou les personnes concernées.
create or replace function public.presence_on_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'coverage_requests' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform presence_release(old.event_id, coalesce(old.assigned_technician_id, old.technician_id));
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform presence_release(new.event_id, coalesce(new.assigned_technician_id, new.technician_id));
    end if;
  elsif tg_table_name = 'coverage_crew' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform presence_release(old.event_id, old.user_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform presence_release(new.event_id, new.user_id);
    end if;
  elsif tg_table_name = 'director_attendance' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform presence_release(old.event_id, old.director_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      perform presence_release(new.event_id, new.director_id);
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists presence_on_accept on public.coverage_requests;
create trigger presence_on_accept after insert or delete or update of technician_response, assigned_technician_id, technician_id, technician_role, status
  on public.coverage_requests for each row execute function public.presence_on_accept();

drop trigger if exists presence_on_accept on public.coverage_crew;
create trigger presence_on_accept after insert or delete or update of status, role, user_id
  on public.coverage_crew for each row execute function public.presence_on_accept();

drop trigger if exists presence_on_accept on public.director_attendance;
create trigger presence_on_accept after insert or delete or update of status, director_id
  on public.director_attendance for each row execute function public.presence_on_accept();

-- La demande change : les personnes engagées dont les jours viennent de la demande suivent.
create or replace function public.presence_on_request_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event uuid;
  h record;
begin
  v_event := case when tg_op = 'DELETE' then old.event_id else new.event_id end;
  for h in select * from presence_holders(v_event) loop
    perform presence_from_requests(v_event, h.user_id, h.kinds);
  end loop;
  return null;
end;
$$;

drop trigger if exists presence_on_request_change on public.event_presence_requests;
create trigger presence_on_request_change after insert or update or delete on public.event_presence_requests
  for each row execute function public.presence_on_request_change();

commit;
