-- FIEF — lot 1 : réglages, demandes d'adhésion, membres, recherche de club.
-- À appliquer APRÈS sql/2026-11-13_fief_cloison.sql.
--
-- Parcours :
--   fief.lgef.fr → formulaire de demande (serveur, clé service) → fief_applications 'pending'
--     (ou 'awaiting_parent' si mineure sous le seuil d'accord parental : e-mail au parent, lien à jeton)
--   Claire (onglet FIEF du board) valide → compte auth créé avec app_metadata.realm = 'fief',
--     ligne fief_members 'active', e-mail « choisissez votre mot de passe » ; ou refuse (motif).
--
-- Accès board : module 'fief' (module_access), réservé à Claire au départ ; les administrateurs le voient aussi.

begin;

-- Helpers ------------------------------------------------------------------------------------------

-- Gestionnaire FIEF côté board (jamais un compte FIEF).
create or replace function public.fief_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and not public.is_fief_account()
     and public.can_see_module(auth.uid(), 'fief')
$$;

-- Repli minuscule sans accents, pour la recherche (unaccent n'est pas installé).
create or replace function public.fief_fold(t text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(lower(coalesce(t, '')),
    'àâäáãåçéèêëíìîïñóòôöõúùûüýÿœæ-''’',
    'aaaaaaceeeeiiiinooooouuuuyyoa   ')
$$;

-- Accès board : module FIEF, Claire seulement (les administrateurs passent par can_see_module).
insert into public.module_access (module_id, everyone, roles, specialty_slugs, include_user_ids, exclude_user_ids, hidden)
values ('fief', false, '{}', '{}', array['2a2bbb02-2346-4eb8-9d02-a1a4aede39b7'::uuid], '{}', false)
on conflict (module_id) do nothing;

-- Réglages (une seule ligne) -----------------------------------------------------------------------

create table if not exists public.fief_settings (
  id boolean primary key default true check (id),
  -- Mineures : refusées si false (18 ans minimum). Si true : âge minimum min_age, et accord
  -- parental exigé sous parental_consent_under (15 ans minimum légal en France pour un réseau social).
  minors_allowed boolean not null default false,
  min_age smallint not null default 13 check (min_age between 10 and 18),
  parental_consent_under smallint not null default 18 check (parental_consent_under between 15 and 18),
  -- Charte affichée et acceptée à l'inscription.
  charter_text text,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.fief_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists fief_settings_updated_at on public.fief_settings;
create trigger fief_settings_updated_at before update on public.fief_settings
  for each row execute function public.set_updated_at();

-- Fonctions (rôles dans le football), modifiables par Claire ------------------------------------------

create table if not exists public.fief_member_functions (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  label text not null,
  position smallint not null default 0,
  active boolean not null default true
);

insert into public.fief_member_functions (slug, label, position) values
  ('joueuse', 'Joueuse', 10),
  ('dirigeante', 'Dirigeante', 20),
  ('educatrice', 'Éducatrice / entraîneuse', 30),
  ('arbitre', 'Arbitre', 40),
  ('benevole', 'Bénévole', 50),
  ('salariee', 'Salariée (club, district, ligue)', 60),
  ('medical', 'Médical / paramédical', 70),
  ('autre', 'Autre', 99)
on conflict (slug) do nothing;

-- Demandes d'adhésion ------------------------------------------------------------------------------

create table if not exists public.fief_applications (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email)),
  first_name text not null check (length(first_name) between 1 and 80),
  last_name text not null check (length(last_name) between 1 and 80),
  birth_date date not null,
  phone text check (length(phone) <= 30),
  club_number text,                       -- numéro d'affiliation (liste des clubs du board)
  club_name text check (length(club_name) <= 160),
  club_not_listed boolean not null default false,
  functions text[] not null default '{}',
  message text check (length(message) <= 2000),
  status text not null default 'pending'
    check (status in ('awaiting_parent', 'pending', 'approved', 'refused', 'withdrawn')),
  -- Accord parental (mineure sous le seuil) : le lien envoyé au parent porte un jeton dont on garde l'empreinte.
  parent_name text check (length(parent_name) <= 160),
  parent_email text check (parent_email = lower(parent_email)),
  parent_token_hash text,
  parent_consent_at timestamptz,
  charter_accepted_at timestamptz not null,
  refusal_reason text check (length(refusal_reason) <= 2000),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  user_id uuid references auth.users (id) on delete set null,   -- compte créé à la validation
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'awaiting_parent' or (parent_email is not null and parent_token_hash is not null))
);

create unique index if not exists fief_applications_one_open
  on public.fief_applications (email) where status in ('awaiting_parent', 'pending');
create index if not exists fief_applications_status_idx
  on public.fief_applications (status, created_at desc);
create unique index if not exists fief_applications_parent_token_idx
  on public.fief_applications (parent_token_hash) where parent_token_hash is not null;

drop trigger if exists fief_applications_updated_at on public.fief_applications;
create trigger fief_applications_updated_at before update on public.fief_applications
  for each row execute function public.set_updated_at();

-- Membres ------------------------------------------------------------------------------------------

create table if not exists public.fief_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  application_id uuid references public.fief_applications (id) on delete set null,
  email text not null,
  first_name text not null,
  last_name text not null,
  birth_date date,
  phone text,
  club_number text,
  club_name text,
  functions text[] not null default '{}',
  bio text check (length(bio) <= 500),
  avatar_path text,
  show_phone boolean not null default false,
  status text not null default 'active' check (status in ('active', 'suspended', 'left')),
  status_reason text,
  approved_by uuid references auth.users (id) on delete set null,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists fief_members_club_idx on public.fief_members (club_number) where status = 'active';
create index if not exists fief_members_status_idx on public.fief_members (status);

-- Membre FIEF active (compte FIEF ou personne du board inscrite au réseau).
create or replace function public.fief_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.fief_members m where m.user_id = auth.uid() and m.status = 'active')
$$;

drop trigger if exists fief_members_updated_at on public.fief_members;
create trigger fief_members_updated_at before update on public.fief_members
  for each row execute function public.set_updated_at();

-- Une membre ne modifie que son profil public ; statut, identité et club restent à l'équipe FIEF.
create or replace function public.fief_members_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is null or public.fief_is_manager() then
    return new;
  end if;
  if new.user_id is distinct from old.user_id
     or new.application_id is distinct from old.application_id
     or new.email is distinct from old.email
     or new.first_name is distinct from old.first_name
     or new.last_name is distinct from old.last_name
     or new.birth_date is distinct from old.birth_date
     or new.club_number is distinct from old.club_number
     or new.club_name is distinct from old.club_name
     or new.status is distinct from old.status
     or new.status_reason is distinct from old.status_reason
     or new.approved_by is distinct from old.approved_by
     or new.joined_at is distinct from old.joined_at then
    raise exception 'Seule l''équipe FIEF peut modifier ces informations.' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists fief_members_guard on public.fief_members;
create trigger fief_members_guard before update on public.fief_members
  for each row execute function public.fief_members_guard();

-- RLS ----------------------------------------------------------------------------------------------

alter table public.fief_settings enable row level security;
alter table public.fief_member_functions enable row level security;
alter table public.fief_applications enable row level security;
alter table public.fief_members enable row level security;

drop policy if exists fief_settings_select on public.fief_settings;
create policy fief_settings_select on public.fief_settings for select to authenticated
  using ((select public.fief_is_manager()) or (select public.fief_is_member()));
drop policy if exists fief_settings_update on public.fief_settings;
create policy fief_settings_update on public.fief_settings for update to authenticated
  using ((select public.fief_is_manager())) with check ((select public.fief_is_manager()));

drop policy if exists fief_functions_select on public.fief_member_functions;
create policy fief_functions_select on public.fief_member_functions for select to anon, authenticated
  using (true);
drop policy if exists fief_functions_write on public.fief_member_functions;
create policy fief_functions_write on public.fief_member_functions for all to authenticated
  using ((select public.fief_is_manager())) with check ((select public.fief_is_manager()));

-- Demandes : uniquement l'équipe FIEF (le formulaire public écrit côté serveur, clé service).
drop policy if exists fief_applications_manager on public.fief_applications;
create policy fief_applications_manager on public.fief_applications for all to authenticated
  using ((select public.fief_is_manager())) with check ((select public.fief_is_manager()));

-- Membres : l'équipe FIEF voit et gère tout ; une membre lit et modifie sa propre fiche
-- (les autres membres passent par fief_directory(), sans date de naissance ni e-mail).
drop policy if exists fief_members_manager on public.fief_members;
create policy fief_members_manager on public.fief_members for all to authenticated
  using ((select public.fief_is_manager())) with check ((select public.fief_is_manager()));
drop policy if exists fief_members_self_select on public.fief_members;
create policy fief_members_self_select on public.fief_members for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists fief_members_self_update on public.fief_members;
create policy fief_members_self_update on public.fief_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Annuaire des membres (pour les membres et l'équipe) ----------------------------------------------

create or replace function public.fief_directory()
returns table (
  user_id uuid,
  first_name text,
  last_name text,
  club_number text,
  club_name text,
  functions text[],
  bio text,
  avatar_path text,
  phone text,
  joined_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.first_name, m.last_name, m.club_number, m.club_name, m.functions, m.bio,
         m.avatar_path, case when m.show_phone then m.phone end, m.joined_at
  from public.fief_members m
  where m.status = 'active'
    and (public.fief_is_member() or public.fief_is_manager())
  order by m.last_name, m.first_name
$$;

revoke execute on function public.fief_directory() from public, anon;
grant execute on function public.fief_directory() to authenticated;

-- Recherche de club (formulaire public) : nom, numéro, ville seulement — jamais les contacts ----------

create or replace function public.fief_club_search(q text, max_rows int default 20)
returns table (club_number text, club_name text, city text)
language sql
stable
security definer
set search_path = public
as $$
  with clubs as (
    select distinct on (m.club_number)
           m.club_number, m.club, m.city
    from public.registration_contact_list_members m
    where m.club_number is not null and m.club is not null
    order by m.club_number, m.created_at desc
  )
  select c.club_number, c.club, c.city
  from clubs c
  where length(trim(coalesce(q, ''))) >= 2
    and (public.fief_fold(c.club) like '%' || public.fief_fold(trim(q)) || '%'
         or public.fief_fold(c.city) like public.fief_fold(trim(q)) || '%'
         or c.club_number = trim(q))
  order by (public.fief_fold(c.club) like public.fief_fold(trim(q)) || '%') desc, c.club
  limit least(greatest(coalesce(max_rows, 20), 1), 50)
$$;

revoke execute on function public.fief_club_search(text, int) from public;
grant execute on function public.fief_club_search(text, int) to anon, authenticated;

commit;
