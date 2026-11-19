-- Hiérarchie N+1 / N+2, responsables de service et délégations.
--
-- 1. Services (org_services) : un par pôle (mêmes clés que buildPoles : arbitrage, technique…), chacun
--    avec un responsable paramétrable (Paramètres → Organisation). Technique : Patrice Grethen.
-- 2. Service de rattachement d'une personne (profiles.home_service), un seul, distinct des pôles
--    auxquels elle a accès.
-- 3. N+1 d'une personne (manager_of) = son N+1 choisi individuellement (profiles.expense_validator_id,
--    inchangé) sinon le responsable de son service. N+2 = N+1 du N+1, jamais saisi (manager_chain,
--    protégé contre les boucles). Les fonctions qui lisaient expense_validator_id passent par
--    manager_of : tant qu'aucun service n'est renseigné, le résultat est strictement le même.
-- 4. Actions validables (approval_actions : comptes, frais, pointages, factures — liste extensible) et
--    délégations (approval_delegations) : un N+1 confie une action à quelqu'un, pour tout son
--    périmètre ou un seul service, en permanence ou sur une période. Il garde lui-même le droit.
-- 5. Qui peut valider (can_approve) : toute la chaîne au-dessus de la personne (N+1, N+2, …), les
--    délégataires actifs de cette chaîne pour l'action, et les administrateurs. Jamais soi-même.
--    Qui prévenir en premier (first_approvers) : le N+1 et ses délégataires ; sinon les admins.
-- 6. Demandes de compte : service concerné (facultatif) et date de relance au N+2.
--
-- Ajouts seulement, aucune donnée existante modifiée (sauf le responsable Technique).

begin;

-- 1. Services ---------------------------------------------------------------------------------------
create table if not exists public.org_services (
  key text primary key,
  label text not null,
  manager_id uuid references public.profiles(id) on delete set null,
  sort int not null default 0,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.org_services (key, label, sort) values
  ('arbitrage', 'Arbitrage', 10),
  ('technique', 'Technique', 20),
  ('formation', 'Formation', 30),
  ('competitions', 'Compétitions', 40),
  ('communication', 'Communication', 50),
  ('institutionnel', 'Institutionnel', 60),
  ('pem', 'Pôle Espoirs Mixte', 70),
  ('tirages-coupes', 'Tirages de coupes', 80)
on conflict (key) do nothing;

update public.org_services
   set manager_id = (select id from public.profiles where first_name ilike 'patrice' and last_name ilike 'grethen' limit 1)
 where key = 'technique' and manager_id is null;

alter table public.org_services enable row level security;
drop policy if exists org_services_read on public.org_services;
create policy org_services_read on public.org_services for select to authenticated using (true);
-- Écriture : server actions (client service) réservées aux administrateurs.

-- 2. Service de rattachement ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists home_service text references public.org_services(key) on update cascade on delete set null;
create index if not exists profiles_home_service_idx on public.profiles (home_service);
grant select (home_service) on public.profiles to authenticated;

create or replace function public.profiles_protect_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin_or_super(auth.uid()) then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.expense_validator_id is distinct from old.expense_validator_id
     or new.home_service is distinct from old.home_service
     or new.has_ged_access is distinct from old.has_ged_access
     or new.employment_type is distinct from old.employment_type
     or new.organisation_id is distinct from old.organisation_id
     or new.email is distinct from old.email then
    raise exception 'Seul un administrateur peut modifier le rôle, le N+1, le service, les accès ou l''e-mail d''un compte.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- 3. N+1, chaîne N+1 / N+2 / … ------------------------------------------------------------------------
create or replace function public.manager_of(p_user uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    nullif(p.expense_validator_id, p.id),
    (select s.manager_id from org_services s where s.key = p.home_service and s.manager_id <> p.id)
  )
  from profiles p where p.id = p_user;
$$;

-- Chaîne au-dessus d'une personne : niveau 1 = N+1, 2 = N+2… Arrêt sur boucle et à 10 niveaux.
create or replace function public.manager_chain(p_user uuid)
returns table (level int, user_id uuid) language sql stable security definer set search_path = public as $$
  with recursive chain(level, user_id, seen) as (
    select 1, x.m, array[p_user, x.m] from (select public.manager_of(p_user) as m) x where x.m is not null
    union all
    select c.level + 1, n.m, c.seen || n.m
      from chain c cross join lateral (select public.manager_of(c.user_id) as m) n
     where n.m is not null and not n.m = any(c.seen) and c.level < 10
  )
  select chain.level, chain.user_id from chain;
$$;

-- Même chaîne en partant du responsable d'un service (demande de compte pas encore rattachée à un compte).
create or replace function public.service_chain(p_service text)
returns table (level int, user_id uuid) language sql stable security definer set search_path = public as $$
  select 1, s.manager_id from org_services s where s.key = p_service and s.manager_id is not null
  union all
  select c.level + 1, c.user_id
    from org_services s cross join lateral public.manager_chain(s.manager_id) c
   where s.key = p_service and s.manager_id is not null and c.user_id <> s.manager_id;
$$;

-- 4. Actions validables et délégations ---------------------------------------------------------------
create table if not exists public.approval_actions (
  key text primary key,
  label text not null,
  description text,
  sort int not null default 0
);

insert into public.approval_actions (key, label, description, sort) values
  ('comptes', 'Demandes de compte', 'Accepter ou refuser les demandes d''accès au board et affecter la personne.', 10),
  ('frais', 'Notes de frais', 'Valider ou refuser les notes de frais.', 20),
  ('pointages', 'Pointages', 'Valider les heures et pointages.', 30),
  ('factures', 'Factures', 'Valider les factures des prestataires.', 40)
on conflict (key) do nothing;

alter table public.approval_actions enable row level security;
drop policy if exists approval_actions_read on public.approval_actions;
create policy approval_actions_read on public.approval_actions for select to authenticated using (true);

create table if not exists public.approval_delegations (
  id uuid primary key default gen_random_uuid(),
  delegator_id uuid not null references public.profiles(id) on delete cascade,
  delegate_id uuid not null references public.profiles(id) on delete cascade,
  action text not null references public.approval_actions(key) on update cascade on delete cascade,
  service_key text references public.org_services(key) on update cascade on delete cascade,
  starts_on date,
  ends_on date,
  note text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint approval_delegations_not_self check (delegator_id <> delegate_id),
  constraint approval_delegations_dates check (ends_on is null or starts_on is null or ends_on >= starts_on)
);
create index if not exists approval_delegations_delegator_idx on public.approval_delegations (delegator_id, action);
create index if not exists approval_delegations_delegate_idx on public.approval_delegations (delegate_id, action);

alter table public.approval_delegations enable row level security;
drop policy if exists approval_delegations_read on public.approval_delegations;
create policy approval_delegations_read on public.approval_delegations for select to authenticated
  using (delegator_id = (select auth.uid()) or delegate_id = (select auth.uid()) or (select public.is_admin_or_super(auth.uid())));
-- Écriture : server actions (client service).

-- Délégataires actifs aujourd'hui (heure de Paris) d'un ensemble de personnes, pour une action et un service.
create or replace function public.active_delegates(p_delegators uuid[], p_action text, p_service text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct d.delegate_id
    from approval_delegations d
   where d.delegator_id = any(p_delegators)
     and d.action = p_action
     and (d.service_key is null or d.service_key is not distinct from p_service)
     and (d.starts_on is null or d.starts_on <= (now() at time zone 'Europe/Paris')::date)
     and (d.ends_on is null or d.ends_on >= (now() at time zone 'Europe/Paris')::date);
$$;

-- 5. Qui peut valider, qui prévenir -------------------------------------------------------------------
create or replace function public.can_approve(p_action text, p_uid uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and p_uid is distinct from p_user and (
    public.is_admin_or_super(p_uid)
    or exists (select 1 from public.manager_chain(p_user) c where c.user_id = p_uid)
    or p_uid in (
      select public.active_delegates(
        array(select c.user_id from public.manager_chain(p_user) c),
        p_action,
        (select home_service from profiles where id = p_user))
    )
  );
$$;

create or replace function public.can_approve_for_service(p_action text, p_uid uuid, p_service text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    public.is_admin_or_super(p_uid)
    or exists (select 1 from public.service_chain(p_service) c where c.user_id = p_uid)
    or p_uid in (select public.active_delegates(array(select c.user_id from public.service_chain(p_service) c), p_action, p_service))
  );
$$;

-- Premiers destinataires : le N+1 et ses délégataires actifs pour l'action ; personne → administrateurs.
create or replace function public.first_approvers(p_action text, p_user uuid)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare
  m uuid := public.manager_of(p_user);
begin
  if m is null then
    return query select id from profiles where role in ('admin', 'super_user') and id <> p_user;
    return;
  end if;
  return query
    select m
    union
    select public.active_delegates(array[m], p_action, (select home_service from profiles where id = p_user));
end;
$$;

create or replace function public.first_approvers_for_service(p_action text, p_service text)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare
  m uuid := (select manager_id from org_services where key = p_service);
begin
  if m is null then
    return query select id from profiles where role in ('admin', 'super_user');
    return;
  end if;
  return query select m union select public.active_delegates(array[m], p_action, p_service);
end;
$$;

-- Personnes pour lesquelles p_uid peut valider l'action (son équipe directe et indirecte, délégations
-- comprises ; tout le monde pour un administrateur).
create or replace function public.approvable_users(p_action text, p_uid uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from profiles p where public.can_approve(p_action, p_uid, p.id);
$$;

revoke all on function public.manager_of(uuid), public.manager_chain(uuid), public.service_chain(text),
  public.active_delegates(uuid[], text, text), public.can_approve(text, uuid, uuid),
  public.can_approve_for_service(text, uuid, text), public.first_approvers(text, uuid),
  public.first_approvers_for_service(text, text), public.approvable_users(text, uuid) from public, anon;
grant execute on function public.manager_of(uuid), public.manager_chain(uuid), public.can_approve(text, uuid, uuid)
  to authenticated;

-- 6. Demandes de compte ------------------------------------------------------------------------------
alter table public.account_requests
  add column if not exists service_key text references public.org_services(key) on update cascade on delete set null,
  add column if not exists escalated_at timestamptz;

-- 7. Fonctions existantes : le N+1 passe par manager_of -------------------------------------------------
create or replace function public.can_manage_staff_cost(p_user uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select is_admin_or_super(p_uid) or public.manager_of(p_user) = p_uid;
$function$;

create or replace function public.team_can_see_card(p_card uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select team_can_edit_card(p_card, p_uid) or exists (
    select 1 from team_card_members m
    where m.card_id = p_card and public.manager_of(m.user_id) = p_uid
  );
$function$;

-- notify_coverage_circuit et notify_director_attendance : définitions actuelles reprises telles
-- quelles, seule la lecture du N+1 change.
CREATE OR REPLACE FUNCTION public.notify_coverage_circuit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    manager := public.manager_of(tech);
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
$function$;

CREATE OR REPLACE FUNCTION public.notify_director_attendance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      manager := public.manager_of(old.director_id);
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
    manager := public.manager_of(new.director_id);
    perform public.notify_many(array[manager] || public.event_owner_ids(new.event_id),
      case when new.status = 'approved' then 'director_accepted'::notification_type else 'director_declined'::notification_type end,
      public.person_name(new.director_id) || case when new.status = 'approved' then ' a confirmé sa présence (comité directeur)' else ' ne pourra pas être présent (comité directeur)' end,
      label || coalesce(' · « ' || note || ' »', ''), new.event_id);
  end if;
  return new;
end;
$function$;

commit;
