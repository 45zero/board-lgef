-- Tournois — déclaration en ligne des tournois et rassemblements (règlements généraux FFF).
--
-- Parcours :
--   page publique (sans compte) → le club cherche son nom (tournament_clubs) → remplit la déclaration
--     (serveur, clé service) → tournament_declarations 'received' + n° de dossier T2027-0001
--     → accusé PDF au déclarant + copie à l'adresse officielle du club + copie au district + ligue.
--   Board, onglet Tournois (module 'tournois', même système d'accès que les autres onglets) :
--     « Déclarations » (instruction, statuts, avis) et « Tournois à venir » (suite : pièces, rappels, bilan).
--   Échanges : messages envoyés depuis l'adresse du board, signés par la personne qui envoie
--     (copie à elle-même au choix) ; chaque destinataire est gardé (tournament_message_recipients).
--
-- Lectures board : RLS select pour les personnes qui voient le module.
-- Écritures : uniquement par le serveur (clé service) après contrôle du module — aucune politique
-- insert / update / delete, comme pour FIEF.
-- Liste des clubs : importée depuis liste_club_form_hydromatchok.xlsx (script à part) ; la page
-- publique ne voit que nom, n°, ville et district (tournament_club_search), jamais les contacts.
-- Réponses : chaque destinataire d'un message reçoit un bouton « Répondre » personnel (jeton) qui ouvre
-- une page où il écrit sa réponse ; elle revient dans le dossier et notifie la personne qui a écrit.

-- Notification « réponse reçue sur un dossier tournoi » (hors transaction : ALTER TYPE … ADD VALUE).
alter type public.notification_type add value if not exists 'tournament_message';

begin;

-- Cloison FIEF (sql/2026-11-13_fief_cloison.sql) : l'event trigger posait sa policy à chaque commande
-- sur une table (ALTER TABLE compris) et échouait si elle existait déjà. Désormais idempotent.
create or replace function public.fief_cloison_on_create()
returns event_trigger
language plpgsql
set search_path = ''
as $$
declare
  obj record;
  tbl text;
begin
  for obj in select * from pg_event_trigger_ddl_commands() where object_type = 'table' and schema_name = 'public'
  loop
    tbl := (select c.relname from pg_class c where c.oid = obj.objid);
    if tbl is not null and tbl not like 'fief\_%'
       and not exists (select 1 from pg_policy p where p.polrelid = obj.objid and p.polname = 'fief_cloison') then
      execute format(
        'create policy fief_cloison on public.%I as restrictive for all to authenticated '
        'using (not (select public.is_fief_account())) with check (not (select public.is_fief_account()))',
        tbl
      );
    end if;
  end loop;
end
$$;

-- Accès board ----------------------------------------------------------------------------------------

insert into public.module_access (module_id, everyone, roles, specialty_slugs, include_user_ids, exclude_user_ids, hidden)
values ('tournois', false, '{}', '{}', '{}', '{}', false)
on conflict (module_id) do nothing;

create or replace function public.tournois_is_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and not public.is_fief_account()
     and public.can_see_module(auth.uid(), 'tournois')
$$;

-- Personnes du board qui voient l'onglet (prévenues des nouvelles déclarations) — serveur seulement.
create or replace function public.tournois_manager_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.id
  from public.profiles p
  join auth.users u on u.id = p.id
  where coalesce(u.raw_app_meta_data ->> 'realm', '') <> 'fief'
    and public.can_see_module(p.id, 'tournois')
$$;

revoke execute on function public.tournois_manager_ids() from public, anon, authenticated;

-- Districts (centres de gestion) + ligue : destinataires des copies ----------------------------------

create table if not exists public.tournament_districts (
  code text primary key,                          -- « Gestionnaire » du fichier clubs (5612…)
  name text not null,
  short_name text not null,
  is_ligue boolean not null default false,
  -- Coordonnées (onglet Tournois → Réglages)
  contact_name text,                              -- service ou personne (ex. « Commission foot d'animation »)
  emails text[] not null default '{}',            -- destinataires des copies
  phone text,
  address text,
  auto_send boolean not null default false,       -- coché : chaque déclaration lui part automatiquement au dépôt
  position smallint not null default 0,
  active boolean not null default true
);

insert into public.tournament_districts (code, name, short_name, is_ligue, position) values
  ('5600', 'Ligue du Grand Est de Football', 'Ligue', true, 0),
  ('5611', 'District des Ardennes', 'Ardennes', false, 10),
  ('5612', 'District Aube', 'Aube', false, 20),
  ('5613', 'District Marne', 'Marne', false, 30),
  ('5614', 'District Haute-Marne', 'Haute-Marne', false, 40),
  ('5607', 'District Meurthe-et-Moselle', 'Meurthe-et-Moselle', false, 50),
  ('5601', 'District Meuse', 'Meuse', false, 60),
  ('5602', 'District Mosellan', 'Moselle', false, 70),
  ('5606', 'District Vosges', 'Vosges', false, 80),
  ('5621', 'District d''Alsace', 'Alsace', false, 90)
on conflict (code) do nothing;

update public.tournament_districts set emails = array['footanimation@district-aube.fff.fr']
where code = '5612' and emails = '{}';

-- Clubs (import du fichier de la ligue) --------------------------------------------------------------

create table if not exists public.tournament_clubs (
  club_number text primary key,
  name text not null,
  district_code text references public.tournament_districts (code) on update cascade,
  address_line text,                              -- Voie-rue
  address_extra text,                             -- Complément / lieu-dit
  postal_code text,
  city text,
  contact_civility text,
  contact_first_name text,
  contact_last_name text,
  contact_mobile text,
  contact_email text,
  official_email text,
  active boolean not null default true,
  imported_at timestamptz not null default now()
);

create index if not exists tournament_clubs_district_idx on public.tournament_clubs (district_code);

-- Recherche publique : pas de contacts, seulement de quoi reconnaître son club.
create or replace function public.tournament_club_search(q text, max_rows int default 12)
returns table (club_number text, club_name text, city text, district_code text, district_name text)
language sql
stable
security definer
set search_path = public
as $$
  select c.club_number, c.name, c.city, d.code, d.short_name
  from public.tournament_clubs c
  left join public.tournament_districts d on d.code = c.district_code
  where c.active
    and length(trim(coalesce(q, ''))) >= 2
    and (public.fief_fold(c.name) like '%' || public.fief_fold(trim(q)) || '%'
         or public.fief_fold(c.city) like public.fief_fold(trim(q)) || '%'
         or c.club_number = trim(q))
  order by (public.fief_fold(c.name) like public.fief_fold(trim(q)) || '%') desc, c.name
  limit least(greatest(coalesce(max_rows, 12), 1), 30)
$$;

revoke execute on function public.tournament_club_search(text, int) from public;
grant execute on function public.tournament_club_search(text, int) to anon, authenticated;

-- Réglages (une ligne) et catégories -----------------------------------------------------------------

create table if not exists public.tournament_settings (
  id boolean primary key default true check (id),
  min_notice_days smallint not null default 60,   -- « au moins 2 mois avant » : en deçà, dossier « hors délai »
  intro_text text,                                -- texte d'accueil du formulaire public
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.tournament_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists tournament_settings_updated_at on public.tournament_settings;
create trigger tournament_settings_updated_at before update on public.tournament_settings
  for each row execute function public.set_updated_at();

create table if not exists public.tournament_categories (
  slug text primary key check (slug ~ '^[a-z0-9-]+$'),
  label text not null,
  kind text not null check (kind in ('rassemblement', 'tournoi')),
  position smallint not null default 0,
  active boolean not null default true            -- Seniors (ou autre) : désactivable dans Réglages
);

insert into public.tournament_categories (slug, label, kind, position) values
  ('u6-u7', 'U6-U7', 'rassemblement', 10),
  ('u8-u9', 'U8-U9', 'rassemblement', 20),
  ('u10-u11', 'U10-U11', 'rassemblement', 30),
  ('u12-u13', 'U12-U13', 'tournoi', 40),
  ('u14-u15', 'U14-U15', 'tournoi', 50),
  ('u16-u17', 'U16-U17', 'tournoi', 60),
  ('u18-u19', 'U18-U19', 'tournoi', 70),
  ('seniors', 'Seniors', 'tournoi', 80)
on conflict (slug) do nothing;

-- Déclarations ---------------------------------------------------------------------------------------

create table if not exists public.tournament_ref_counters (
  year int primary key,
  last_value int not null default 0
);

create table if not exists public.tournament_declarations (
  id uuid primary key default gen_random_uuid(),
  ref text unique,                                -- T2027-0042, posé par trigger
  status text not null default 'received'
    check (status in ('received', 'reviewing', 'info_requested', 'validated', 'refused', 'cancelled')),

  -- Club (copié au dépôt : le dossier reste lisible si la liste des clubs change)
  club_number text,
  club_name text not null,
  club_official_email text,
  district_code text references public.tournament_districts (code) on update cascade,

  -- Manifestation
  title text not null,
  start_date date not null,
  end_date date not null check (end_date >= start_date),
  start_time time,
  end_time time,
  address text not null,
  lat double precision,
  lng double precision,

  -- Responsable
  contact_first_name text not null,
  contact_last_name text not null,
  contact_phone text not null,
  contact_landline text,
  contact_email text not null,

  -- Participants et esprit de la manifestation
  clubs_expected int check (clubs_expected is null or clubs_expected >= 0),
  other_districts boolean,
  other_countries boolean,
  participant_charter boolean,
  educational_messages text,                      -- thèmes du PEF ou autres
  match_sheets_at_start boolean,
  discipline_commission boolean,

  -- Logistique
  refreshments boolean,                           -- buvette
  catering text check (catering is null or catering in ('internal', 'external', 'none')),
  hot_points boolean,                             -- friteuse, barbecue…
  parking text,
  first_aid text,
  spectators_expected int check (spectators_expected is null or spectators_expected >= 0),
  animations text,
  other_info text,

  -- Dépôt
  submitted_at timestamptz not null default now(),
  late boolean not null default false,            -- déposée moins de min_notice_days avant start_date
  finalized_at timestamptz,                       -- pièces envoyées, accusé et copies partis (null = dépôt en cours)

  -- Instruction (board)
  assigned_to uuid references auth.users (id) on delete set null,
  district_opinion text check (district_opinion is null or district_opinion in ('yes', 'no')),
  district_opinion_note text,
  decision_note text,                             -- motif / message joint à la décision
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  calendar_event_id uuid,                         -- événement créé dans le Calendrier une fois validé

  -- Après le tournoi
  report jsonb,                                   -- bilan : équipes présentes, incidents, discipline…
  report_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tournament_declarations_status_idx on public.tournament_declarations (status, start_date);
create index if not exists tournament_declarations_district_idx on public.tournament_declarations (district_code, start_date);
create index if not exists tournament_declarations_club_idx on public.tournament_declarations (club_number);

create or replace function public.tournament_declarations_set_ref()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  y int := extract(year from new.submitted_at)::int;
  n int;
begin
  if new.ref is null then
    insert into public.tournament_ref_counters as c (year, last_value) values (y, 1)
    on conflict (year) do update set last_value = c.last_value + 1
    returning last_value into n;
    new.ref := 'T' || y || '-' || lpad(n::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists tournament_declarations_ref on public.tournament_declarations;
create trigger tournament_declarations_ref before insert on public.tournament_declarations
  for each row execute function public.tournament_declarations_set_ref();

drop trigger if exists tournament_declarations_updated_at on public.tournament_declarations;
create trigger tournament_declarations_updated_at before update on public.tournament_declarations
  for each row execute function public.set_updated_at();

-- Une ligne par catégorie engagée (le tableau du PDF + temps de jeu et format)
create table if not exists public.tournament_declaration_categories (
  declaration_id uuid not null references public.tournament_declarations (id) on delete cascade,
  category_slug text not null references public.tournament_categories (slug) on update cascade,
  teams int check (teams is null or teams >= 0),
  play_date date,                                 -- si la catégorie ne joue qu'un des jours
  players_per_team smallint,
  substitutes smallint,
  surface text,                                   -- herbe, synthétique, futsal, foot indoor, beach soccer…
  format text check (format is null or format in ('poules', 'elimination', 'poules_elimination', 'plateau')),
  match_minutes smallint,                         -- temps de jeu d'une rencontre
  min_play_minutes smallint,                      -- temps de jeu minimum par équipe
  max_play_minutes smallint,                      -- temps de jeu maximum par équipe
  primary key (declaration_id, category_slug)
);

-- Échanges et suivi des envois -----------------------------------------------------------------------

-- kind : 'mail' (envoyé depuis le board), 'forward' (dossier transféré), 'auto' (accusé, copies au dépôt),
--        'note' (note interne, rien n'est envoyé), 'reply' (réponse du club ajoutée au dossier).
create table if not exists public.tournament_messages (
  id uuid primary key default gen_random_uuid(),
  declaration_id uuid not null references public.tournament_declarations (id) on delete cascade,
  kind text not null check (kind in ('mail', 'forward', 'auto', 'note', 'reply')),
  subject text,
  body text,                                      -- corps tel qu'envoyé (signature de l'expéditeur comprise)
  sent_by uuid references auth.users (id) on delete set null,
  copy_to_sender boolean not null default false,
  include_pdf boolean not null default false,     -- récapitulatif PDF du dossier proposé au téléchargement
  -- Réponse ('reply') : qui a répondu, à quel message
  parent_message_id uuid references public.tournament_messages (id) on delete set null,
  from_name text,
  from_email text,
  read_at timestamptz,                            -- réponse vue dans le board
  created_at timestamptz not null default now()
);

create index if not exists tournament_messages_declaration_idx on public.tournament_messages (declaration_id, created_at);

-- Pièces : affiche, règlement, autres, pièces jointes d'une réponse (Drive du board, jamais publiques)
create table if not exists public.tournament_files (
  id uuid primary key default gen_random_uuid(),
  declaration_id uuid not null references public.tournament_declarations (id) on delete cascade,
  message_id uuid references public.tournament_messages (id) on delete cascade,   -- pièce jointe d'une réponse
  kind text not null default 'other' check (kind in ('poster', 'rules', 'other', 'reply')),
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  upload_url text,                                -- session d'envoi par morceaux (côté serveur seulement)
  storage_key text,                               -- identifiant côté stockage (derrière une interface)
  source text not null default 'form' check (source in ('form', 'board', 'reply')),
  uploaded_by uuid references auth.users (id) on delete set null,   -- null = déposé par le club
  created_at timestamptz not null default now()
);

create index if not exists tournament_files_declaration_idx on public.tournament_files (declaration_id);

-- À qui c'est parti, et si l'envoi a réussi
create table if not exists public.tournament_message_recipients (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.tournament_messages (id) on delete cascade,
  email text not null,
  name text,
  role text not null default 'other'
    check (role in ('contact', 'club', 'district', 'ligue', 'sender', 'other')),
  field text not null default 'to' check (field in ('to', 'cc', 'bcc')),
  delivery text not null default 'pending' check (delivery in ('pending', 'sent', 'failed')),
  error text,
  -- Bouton « Répondre » personnel : sha256 du jeton (le jeton lui-même n'est que dans le mail)
  reply_token_hash text unique,
  opened_at timestamptz,                          -- page de réponse ouverte
  replied_at timestamptz
);

create index if not exists tournament_message_recipients_message_idx on public.tournament_message_recipients (message_id);

-- Pièces jointes d'un message (affiche, règlement… déjà au dossier)
create table if not exists public.tournament_message_files (
  message_id uuid not null references public.tournament_messages (id) on delete cascade,
  file_id uuid not null references public.tournament_files (id) on delete cascade,
  primary key (message_id, file_id)
);

-- Historique (dépôt, changements de statut, avis, affectation…)
create table if not exists public.tournament_activity (
  id bigint generated always as identity primary key,
  declaration_id uuid not null references public.tournament_declarations (id) on delete cascade,
  actor uuid references auth.users (id) on delete set null,   -- null = le club / le système
  action text not null,                                       -- 'submitted', 'status', 'opinion', 'assigned', 'edited'…
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists tournament_activity_declaration_idx on public.tournament_activity (declaration_id, created_at);

-- RLS : lecture pour les personnes qui voient l'onglet ; écritures par le serveur seulement ---------

do $$
declare t text;
begin
  foreach t in array array[
    'tournament_districts', 'tournament_clubs', 'tournament_settings', 'tournament_categories',
    'tournament_ref_counters', 'tournament_declarations', 'tournament_declaration_categories',
    'tournament_files', 'tournament_messages', 'tournament_message_recipients',
    'tournament_message_files', 'tournament_activity'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_manager', t);
    if t <> 'tournament_ref_counters' then
      execute format(
        'create policy %I on public.%I for select to authenticated using ((select public.tournois_is_manager()))',
        t || '_manager', t);
    end if;
  end loop;
end $$;

commit;
