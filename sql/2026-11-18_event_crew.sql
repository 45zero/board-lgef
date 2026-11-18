-- Fiche événement : plusieurs membres du comité directeur, plusieurs photographes / vidéastes, tous
-- affichés dans la barre du bas (pastilles vertes = confirmé, orange = en attente, km · min dessous).
--
-- 0. Correctif : la notification « … vous a retiré de la carte » (Espace Team, 18/11) utilisait le type
--    card_unassigned, absent de l'énumération notification_type — elle échouait sans bruit.
-- 1. Comité directeur : director_attendance acceptait déjà plusieurs lignes par événement, mais le board
--    n'en lisait qu'une ; 4 événements ont jusqu'à 19 lignes identiques (même membre, même seconde —
--    créées en rafale le 09/11, 13/11 et 16/11) et n'affichaient plus rien. On garde la plus ancienne
--    ligne par (événement, membre) puis une contrainte d'unicité empêche le retour des doublons.
--    Le circuit de couverture prévient désormais tous les membres CD présents (et non le premier).
-- 2. Couverture : coverage_requests reste la demande unique de l'événement et son technicien principal
--    (circuit inchangé : proposition, acceptation, refus qui remet dans le pot, notifications) ; il gagne
--    son rôle (photo, vidéo ou les deux). Les renforts vont dans coverage_crew, une ligne par personne,
--    avec rôle et réponse ; la personne est prévenue et répond (accepter / décliner).

-- ALTER TYPE … ADD VALUE ne peut pas être utilisé dans la transaction qui l'ajoute : à part.
alter type public.notification_type add value if not exists 'card_unassigned';

begin;

/* ---------- 1. Comité directeur : plusieurs membres ---------- */

delete from public.director_attendance d
using public.director_attendance k
where d.event_id = k.event_id
  and d.director_id = k.director_id
  and (k.created_at, k.id) < (d.created_at, d.id);

create unique index if not exists director_attendance_event_director_key
  on public.director_attendance (event_id, director_id) where director_id is not null;

/* ---------- 2. Couverture : rôle du technicien principal ---------- */

alter table public.coverage_requests add column if not exists technician_role text;
alter table public.coverage_requests drop constraint if exists coverage_requests_technician_role_check;
alter table public.coverage_requests
  add constraint coverage_requests_technician_role_check check (technician_role is null or technician_role in ('photo', 'video', 'both'));

-- Qui attribue les captations (comme useUserRole.canAssignCoverage) : admin, super utilisateur, technicien salarié.
create or replace function public.can_assign_coverage(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin_or_super(uid) or exists (
    select 1 from profile_specialties ps join specialties s on s.id = ps.specialty_id
    where ps.user_id = uid and s.slug = 'tech-salarie'
  );
$$;

create or replace function public.coverage_role_label(p_role text)
returns text language sql immutable as $$
  select case p_role when 'photo' then 'photographe' when 'video' then 'vidéaste' else 'photographe et vidéaste' end;
$$;

/* ---------- 2. Couverture : renforts ---------- */

create table if not exists public.coverage_crew (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('photo', 'video', 'both')),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  notes text,
  assigned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (event_id, user_id)
);
create index if not exists coverage_crew_user_idx on public.coverage_crew (user_id, event_id);

alter table public.coverage_crew enable row level security;

drop policy if exists coverage_crew_select on public.coverage_crew;
create policy coverage_crew_select on public.coverage_crew for select to authenticated using (true);
drop policy if exists coverage_crew_insert on public.coverage_crew;
create policy coverage_crew_insert on public.coverage_crew for insert to authenticated
  with check (public.can_assign_coverage(auth.uid()) and assigned_by = auth.uid());
drop policy if exists coverage_crew_update on public.coverage_crew;
create policy coverage_crew_update on public.coverage_crew for update to authenticated
  using (public.can_assign_coverage(auth.uid()) or user_id = auth.uid())
  with check (public.can_assign_coverage(auth.uid()) or user_id = auth.uid());
drop policy if exists coverage_crew_delete on public.coverage_crew;
create policy coverage_crew_delete on public.coverage_crew for delete to authenticated
  using (public.can_assign_coverage(auth.uid()));

-- La personne désignée ne change que sa réponse (statut, mot) ; l'heure de réponse est posée ici.
create or replace function public.coverage_crew_before_update()
returns trigger language plpgsql set search_path = public as $$
begin
  if not public.can_assign_coverage(auth.uid()) then
    new.event_id := old.event_id;
    new.user_id := old.user_id;
    new.role := old.role;
    new.assigned_by := old.assigned_by;
  end if;
  if new.status is distinct from old.status then
    new.responded_at := case when new.status = 'pending' then null else now() end;
  end if;
  return new;
end;
$$;
drop trigger if exists coverage_crew_before_update on public.coverage_crew;
create trigger coverage_crew_before_update before update on public.coverage_crew
  for each row execute function public.coverage_crew_before_update();

-- Notifications : proposition à la personne ; sa réponse à qui l'a proposée, à son N+1 et aux
-- responsables de l'événement.
create or replace function public.notify_coverage_crew()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  label text := public.event_label(new.event_id);
  what text := public.coverage_role_label(new.role);
  manager uuid;
  note text := nullif(trim(coalesce(new.notes, '')), '');
begin
  if tg_op = 'INSERT' then
    if new.user_id is distinct from auth.uid() then
      perform public.notify_many(array[new.user_id], 'coverage_assignment',
        coalesce(public.person_name(auth.uid()), 'La Ligue') || ' vous propose d''être ' || what || ' sur un événement',
        label || ' — merci de répondre.', new.event_id, jsonb_build_object('coverage_crew_id', new.id, 'role', new.role));
    end if;
    return new;
  end if;
  if new.status is distinct from old.status and new.status in ('accepted', 'declined') then
    select expense_validator_id into manager from public.profiles where id = new.user_id;
    perform public.notify_many(
      array[new.assigned_by, manager] || public.event_owner_ids(new.event_id),
      case when new.status = 'accepted' then 'coverage_accepted'::notification_type else 'coverage_rejected'::notification_type end,
      public.person_name(new.user_id) || case when new.status = 'accepted' then ' sera ' || what || ' sur l''événement' else ' ne pourra pas être ' || what || ' sur l''événement' end,
      label || coalesce(' · « ' || note || ' »', ''), new.event_id,
      jsonb_build_object('coverage_crew_id', new.id, 'response', new.status));
  end if;
  return new;
end;
$$;
drop trigger if exists notify_coverage_crew on public.coverage_crew;
create trigger notify_coverage_crew after insert or update of status on public.coverage_crew
  for each row execute function public.notify_coverage_crew();

/* ---------- Circuit de couverture : tous les membres CD présents ---------- */

create or replace function public.notify_coverage_circuit()
returns trigger language plpgsql security definer set search_path = public as $function$
declare
  receivers uuid[];
  tech uuid := coalesce(new.assigned_technician_id, new.technician_id);
  label text := public.event_label(new.event_id);
  manager uuid;
  directors uuid[];
  note text := nullif(trim(coalesce(new.technician_response_notes, '')), '');
begin
  select coverage_receiver_ids into receivers from public.board_settings where id = true;
  receivers := coalesce(receivers, '{}');

  -- Nouvelle demande à traiter (personne n'est encore désigné).
  if tg_op = 'INSERT' and tech is null then
    perform public.notify_many(receivers, 'coverage_request', 'Nouvelle demande de couverture',
      label || ' · demandée par ' || coalesce(public.person_name(new.requester_id), 'un organisateur'), new.event_id,
      jsonb_build_object('coverage_request_id', new.id));
    return new;
  end if;

  -- Mission proposée ou désignation directe.
  if tech is not null and (tg_op = 'INSERT' or tech is distinct from coalesce(old.assigned_technician_id, old.technician_id)) then
    if new.technician_response = 'accepted' then
      perform public.notify_many(array[tech], 'assignment_created', public.person_name(auth.uid()) || ' vous a désigné pour couvrir un événement',
        label, new.event_id, jsonb_build_object('coverage_request_id', new.id, 'role', 'couverture'));
    else
      perform public.notify_many(array[tech], 'coverage_assignment', public.person_name(auth.uid()) || ' vous propose une mission de couverture',
        label || ' — merci de répondre.', new.event_id, jsonb_build_object('coverage_request_id', new.id));
    end if;
    return new;
  end if;

  if tg_op <> 'UPDATE' then
    return new;
  end if;

  -- Réponse de la personne désignée (même personne qu'avant : ce n'est pas une désignation).
  if new.technician_response is distinct from old.technician_response and new.technician_response in ('accepted', 'rejected') and tech is not null then
    select expense_validator_id into manager from public.profiles where id = tech;
    if new.technician_response = 'accepted' then
      select coalesce(array_agg(d.director_id), '{}') into directors from public.director_attendance d
      where d.event_id = new.event_id and d.director_id is not null and d.status is distinct from 'denied';
      perform public.notify_many(
        array[manager] || directors || public.event_owner_ids(new.event_id) || receivers,
        'coverage_accepted', public.person_name(tech) || ' a accepté la mission de couverture',
        label || coalesce(' · « ' || note || ' »', ''), new.event_id,
        jsonb_build_object('coverage_request_id', new.id, 'response', 'accepted'));
    else
      perform public.notify_many(
        array[manager, new.requester_id] || receivers,
        'coverage_rejected', public.person_name(tech) || ' a refusé la mission de couverture — à réattribuer',
        label || coalesce(' · « ' || note || ' »', ''), new.event_id,
        jsonb_build_object('coverage_request_id', new.id, 'response', 'rejected'));
    end if;
    return new;
  end if;

  -- Demande refusée par la Ligue (pas par la personne désignée) : le demandeur est prévenu.
  if new.status = 'rejected' and old.status is distinct from 'rejected' and new.technician_response is not distinct from old.technician_response then
    perform public.notify_many(array[new.requester_id] || public.event_owner_ids(new.event_id), 'coverage_denied',
      'Demande de couverture non retenue', label || coalesce(' · « ' || nullif(trim(coalesce(new.comment, '')), '') || ' »', ''), new.event_id,
      jsonb_build_object('coverage_request_id', new.id));
  end if;
  return new;
end;
$function$;

-- En direct : la barre de la fiche se met à jour quand quelqu'un répond.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'coverage_crew') then
    alter publication supabase_realtime add table public.coverage_crew;
  end if;
end $$;

commit;
