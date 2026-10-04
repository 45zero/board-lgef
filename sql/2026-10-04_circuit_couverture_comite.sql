-- Circuit des demandes de couverture et du comité directeur, centralisé en base : les mêmes
-- notifications partent quelle que soit l'origine (board, réponse par e-mail, ancien calendrier).
-- Elles partent ensuite par e-mail selon les préférences (/api/cron/notification-emails).
--
-- Couverture :
--  - nouvelle demande sans personne désignée → les réceptionnaires (board_settings.coverage_receiver_ids,
--    réglables dans Paramètres → Circuits de notification) ;
--  - mission proposée / désignation directe → la personne concernée ;
--  - réponse → toujours son N+1 (profiles.expense_validator_id) ;
--    refus → la demande repart en attente (« à réattribuer ») et les réceptionnaires (+ demandeur) sont prévenus ;
--    acceptation → créateur, responsables, membre du comité directeur sollicité, réceptionnaires.
-- Comité directeur :
--  - présence sollicitée → le membre (plus d'envoi à tous les admins / techniciens) ;
--  - réponse → créateur + responsables + N+1 du membre ; refus avec transfert → le nouveau membre.
-- Appliquée à la main sur le projet Supabase partagé.

alter table public.board_settings
  add column if not exists coverage_receiver_ids uuid[] not null default '{}';

-- Premier réceptionnaire : Giovanni Verna (super user).
update public.board_settings
set coverage_receiver_ids = array['533d3fce-4278-4e52-a373-4d790839b7d3']::uuid[]
where id = true and cardinality(coverage_receiver_ids) = 0;

/* ---------- Outils ---------- */

create or replace function public.person_name(uid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(nullif(trim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), ''), email, 'Quelqu''un')
  from public.profiles where id = uid;
$$;

create or replace function public.event_label(eid uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select e.title || ' — ' || to_char(e.start_date at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24"h"MI')
  from public.events e where e.id = eid;
$$;

-- Créateur et responsables de l'équipe d'un événement.
create or replace function public.event_owner_ids(eid uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct x) filter (where x is not null), '{}')
  from (
    select created_by as x from public.events where id = eid
    union all
    select user_id from public.event_team_members where event_id = eid and role = 'responsable'
  ) s;
$$;

-- Une notification par destinataire (sans doublon, sans l'auteur de l'action).
create or replace function public.notify_many(
  recipients uuid[],
  p_type notification_type,
  p_title text,
  p_message text,
  p_event uuid,
  p_data jsonb default '{}'::jsonb
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (user_id, type, title, message, event_id, data, actor_name)
  select distinct r, p_type, p_title, p_message, p_event,
         jsonb_build_object('event_id', p_event) || coalesce(p_data, '{}'::jsonb),
         public.person_name(auth.uid())
  from unnest(recipients) as r
  where r is not null and r is distinct from auth.uid();
$$;

/* ---------- Couverture : refus = retour en attente ---------- */

create or replace function public.coverage_refusal_back_to_pool()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.technician_response = 'rejected' and old.technician_response is distinct from 'rejected' then
    new.status := 'pending';
    new.refused_by_name := public.person_name(coalesce(new.assigned_technician_id, new.technician_id));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_coverage_refusal_back_to_pool on public.coverage_requests;
create trigger trg_coverage_refusal_back_to_pool
  before update of technician_response on public.coverage_requests
  for each row execute function public.coverage_refusal_back_to_pool();

/* ---------- Couverture : nouvelle demande, proposition, réponse ---------- */

create or replace function public.notify_coverage_circuit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  receivers uuid[];
  tech uuid := coalesce(new.assigned_technician_id, new.technician_id);
  label text := public.event_label(new.event_id);
  manager uuid;
  director uuid;
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
      select d.director_id into director from public.director_attendance d
      where d.event_id = new.event_id and d.status is distinct from 'denied' limit 1;
      perform public.notify_many(
        array[manager, director] || public.event_owner_ids(new.event_id) || receivers,
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
$$;

-- Remplace les anciens triggers (refus envoyé à tous les admins, proposition en double avec le board).
drop trigger if exists trg_notify_coverage_assignment on public.coverage_requests;
drop trigger if exists trg_notify_coverage_denied on public.coverage_requests;
drop trigger if exists trg_notify_coverage_circuit on public.coverage_requests;
create trigger trg_notify_coverage_circuit
  after insert or update of assigned_technician_id, technician_id, technician_response, status on public.coverage_requests
  for each row execute function public.notify_coverage_circuit();

/* ---------- Comité directeur ---------- */

create or replace function public.notify_director_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  label text := public.event_label(new.event_id);
  manager uuid;
  note text := nullif(trim(coalesce(new.comments, '')), '');
begin
  if new.director_id is null then
    return new;
  end if;

  -- Présence sollicitée (nouvelle demande, autre membre désigné, ou transfert après refus).
  if tg_op = 'INSERT' or new.director_id is distinct from old.director_id then
    if tg_op = 'UPDATE' and old.director_id is not null and old.director_id = auth.uid() then
      -- Le membre sollicité ne peut pas venir et propose quelqu'un d'autre.
      perform public.notify_many(array[new.director_id], 'director_invitation',
        public.person_name(old.director_id) || ' ne pourra pas être présent et vous propose de le remplacer',
        label || coalesce(' · « ' || note || ' »', ''), new.event_id);
      select expense_validator_id into manager from public.profiles where id = old.director_id;
      perform public.notify_many(array[manager] || public.event_owner_ids(new.event_id), 'director_declined',
        public.person_name(old.director_id) || ' ne pourra pas être présent (comité directeur)',
        label || ' · ' || public.person_name(new.director_id) || ' est sollicité à sa place.', new.event_id);
    else
      perform public.notify_many(array[new.director_id], 'director_invitation',
        'Présence du comité directeur sollicitée', label, new.event_id);
    end if;
    return new;
  end if;

  -- Réponse du membre sollicité.
  if new.status is distinct from old.status and new.status in ('approved', 'denied') then
    select expense_validator_id into manager from public.profiles where id = new.director_id;
    perform public.notify_many(array[manager] || public.event_owner_ids(new.event_id),
      case when new.status = 'approved' then 'director_accepted'::notification_type else 'director_declined'::notification_type end,
      public.person_name(new.director_id) || case when new.status = 'approved' then ' a confirmé sa présence (comité directeur)' else ' ne pourra pas être présent (comité directeur)' end,
      label || coalesce(' · « ' || note || ' »', ''), new.event_id);
  end if;
  return new;
end;
$$;
