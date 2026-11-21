-- Remise des photos et vidéos d'événement par les TeamMedias.
--
-- 1. Réglages (Paramètres → Publication, administrateurs) : délai par défaut pour la photo, pour la
--    vidéo, et délai maximum, en jours après la fin de l'événement. La remise est due à 23 h 59
--    (heure de Paris) le jour obtenu.
-- 2. media_deliveries : une ligne par personne qui a ACCEPTÉ de couvrir un événement (technicien
--    principal de coverage_requests et renforts de coverage_crew). Créée par déclencheur à
--    l'acceptation (ou à la désignation directe), avec la date par défaut ; la personne choisit sa date
--    au moment d'accepter dans le board (server action, plafonnée au délai maximum), sinon elle la
--    confirme depuis l'encart de l'accueil. Retirée si la personne se désiste ou est retirée (tant que
--    rien n'est remis).
-- 3. Remis : automatiquement dès que la personne dépose une photo ou une vidéo sur l'événement
--    (event_files), ou par le bouton « C'est remis » (server action).
-- 4. Relance du N+1 (cloche orange puis rouge, comme sur les cartes Espace Team) : reminder_level,
--    reminded_at, reminded_by — écrits côté serveur après contrôle des droits.
-- 5. Nouveau type de notification « media_delivery » (relances, contact du N+1).
--
-- Droits : lecture par la personne, sa chaîne hiérarchique (N+1, N+2…) et les administrateurs.
-- Aucune écriture directe : déclencheurs et server actions (client service) seulement.
-- Reprise : uniquement les événements à venir (aucune alerte rétroactive sur les anciens événements).
-- Ajouts seulement ; aucune donnée existante modifiée.

-- ALTER TYPE … ADD VALUE ne peut pas être utilisé dans la transaction qui l'ajoute : à part.
alter type public.notification_type add value if not exists 'media_delivery';

begin;

/* ---------- 1. Réglages ---------- */

alter table public.board_settings add column if not exists media_delivery_photo_days int not null default 2;
alter table public.board_settings add column if not exists media_delivery_video_days int not null default 7;
alter table public.board_settings add column if not exists media_delivery_max_days int not null default 15;

/* ---------- 2. Remises ---------- */

create table if not exists public.media_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'both' check (role in ('photo', 'video', 'both')),
  source text not null check (source in ('lead', 'crew')),
  due_at timestamptz not null,
  -- true : date choisie par la personne (ou fixée par son N+1) ; false : date par défaut à confirmer.
  due_confirmed boolean not null default false,
  delivered_at timestamptz,
  delivered_via text check (delivered_via in ('upload', 'manual')),
  reminder_level smallint not null default 0 check (reminder_level between 0 and 2),
  reminded_at timestamptz,
  reminded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);
create index if not exists media_deliveries_pending_idx on public.media_deliveries (due_at) where delivered_at is null;
create index if not exists media_deliveries_user_idx on public.media_deliveries (user_id);

alter table public.media_deliveries enable row level security;

drop policy if exists media_deliveries_select on public.media_deliveries;
create policy media_deliveries_select on public.media_deliveries for select to authenticated using (
  user_id = auth.uid()
  or public.is_admin_or_super(auth.uid())
  or exists (select 1 from public.manager_chain(media_deliveries.user_id) c where c.user_id = auth.uid())
);

-- Date de remise par défaut : fin de l'événement (jour, heure de Paris) + délai du rôle, à 23 h 59.
create or replace function public.media_delivery_default_due(p_event uuid, p_role text)
returns timestamptz language sql stable security definer set search_path = public as $$
  select ((((coalesce(e.end_date, e.start_date) at time zone 'Europe/Paris')::date
            + case when p_role = 'photo' then coalesce(s.media_delivery_photo_days, 2)
                   else coalesce(s.media_delivery_video_days, 7) end)
          + time '23:59') at time zone 'Europe/Paris')
  from public.events e
  left join public.board_settings s on s.id = true
  where e.id = p_event;
$$;

-- Crée (ou met à jour le rôle de) la remise d'une personne qui vient d'accepter.
create or replace function public.media_delivery_upsert(p_event uuid, p_user uuid, p_role text, p_source text)
returns void language plpgsql security definer set search_path = public as $$
declare
  ev_start timestamptz := (select start_date from events where id = p_event);
begin
  -- Pas de remise pour un événement déjà loin dans le passé (régularisation après coup).
  if p_user is null or ev_start is null or ev_start < now() - interval '1 day' then return; end if;
  insert into media_deliveries (event_id, user_id, role, source, due_at)
  values (p_event, p_user, coalesce(p_role, 'both'), p_source, public.media_delivery_default_due(p_event, coalesce(p_role, 'both')))
  on conflict (event_id, user_id) do update
    set role = excluded.role,
        updated_at = now();
end;
$$;

-- Retire la remise d'une personne qui n'est plus sur l'événement (rien de remis seulement).
create or replace function public.media_delivery_drop(p_event uuid, p_user uuid, p_source text)
returns void language sql security definer set search_path = public as $$
  delete from media_deliveries
  where event_id = p_event and user_id = p_user and source = p_source and delivered_at is null;
$$;

-- Technicien principal (coverage_requests).
create or replace function public.media_delivery_from_coverage()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.assigned_technician_id is not null
     and (tg_op = 'DELETE'
          or new.assigned_technician_id is distinct from old.assigned_technician_id
          or new.technician_response is distinct from 'accepted'
          or new.status = 'cancelled') then
    perform public.media_delivery_drop(old.event_id, old.assigned_technician_id, 'lead');
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.assigned_technician_id is not null
     and new.technician_response = 'accepted' and new.status is distinct from 'cancelled' then
    perform public.media_delivery_upsert(new.event_id, new.assigned_technician_id, new.technician_role, 'lead');
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists media_delivery_from_coverage on public.coverage_requests;
create trigger media_delivery_from_coverage
  after insert or update of assigned_technician_id, technician_response, technician_role, status or delete
  on public.coverage_requests
  for each row execute function public.media_delivery_from_coverage();

-- Renforts (coverage_crew).
create or replace function public.media_delivery_from_crew()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.status is distinct from 'accepted') then
    perform public.media_delivery_drop(old.event_id, old.user_id, 'crew');
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'accepted' then
    perform public.media_delivery_upsert(new.event_id, new.user_id, new.role, 'crew');
  end if;
  return coalesce(new, old);
end;
$$;
drop trigger if exists media_delivery_from_crew on public.coverage_crew;
create trigger media_delivery_from_crew
  after insert or update of status, role or delete on public.coverage_crew
  for each row execute function public.media_delivery_from_crew();

/* ---------- 3. Remis à la dépose d'une photo ou d'une vidéo ---------- */

create or replace function public.media_delivery_on_upload()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.content_type, '') like 'image/%' or coalesce(new.content_type, '') like 'video/%' then
    update media_deliveries
       set delivered_at = now(), delivered_via = 'upload', reminder_level = 0, updated_at = now()
     where event_id = new.event_id and user_id = new.uploaded_by and delivered_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists media_delivery_on_upload on public.event_files;
create trigger media_delivery_on_upload after insert on public.event_files
  for each row execute function public.media_delivery_on_upload();

-- Événement déplacé : les remises pas encore faites suivent la nouvelle date de fin.
create or replace function public.media_delivery_on_event_move()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.end_date, new.start_date) is distinct from coalesce(old.end_date, old.start_date) then
    update media_deliveries
       set due_at = due_at + (coalesce(new.end_date, new.start_date) - coalesce(old.end_date, old.start_date)), updated_at = now()
     where event_id = new.id and delivered_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists media_delivery_on_event_move on public.events;
create trigger media_delivery_on_event_move after update of start_date, end_date on public.events
  for each row execute function public.media_delivery_on_event_move();

/* ---------- Reprise : événements à venir déjà acceptés ---------- */

insert into public.media_deliveries (event_id, user_id, role, source, due_at)
select c.event_id, c.assigned_technician_id, coalesce(c.technician_role, 'both'), 'lead',
       public.media_delivery_default_due(c.event_id, coalesce(c.technician_role, 'both'))
from public.coverage_requests c
join public.events e on e.id = c.event_id
where c.assigned_technician_id is not null and c.technician_response = 'accepted'
  and c.status is distinct from 'cancelled' and e.start_date >= now()
on conflict (event_id, user_id) do nothing;

insert into public.media_deliveries (event_id, user_id, role, source, due_at)
select k.event_id, k.user_id, k.role, 'crew', public.media_delivery_default_due(k.event_id, k.role)
from public.coverage_crew k
join public.events e on e.id = k.event_id
where k.status = 'accepted' and e.start_date >= now()
on conflict (event_id, user_id) do nothing;

/* ---------- Temps réel ---------- */

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'media_deliveries') then
    alter publication supabase_realtime add table public.media_deliveries;
  end if;
end;
$$;

commit;
