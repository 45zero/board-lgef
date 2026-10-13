-- LGEF Transfer : envoi de fichiers type WeTransfer / SwissTransfer (transfer.lgef.fr + onglet du board).
--
-- Les fichiers ne sont JAMAIS stockés dans Supabase : ils partent du navigateur vers le Drive du board
-- (dossier « LGEF Transfer/<mois>/<transfert> »), ici on ne garde que les métadonnées.
-- Le destinataire reçoit toujours un lien vers la page LGEF (…/t/<code>), jamais vers le fichier :
-- il passe par la page (logo, aperçu, pub) pour télécharger, et chaque téléchargement est compté.
--
-- Limites : par « formule » (transfer_plans) — taille max et durée max, null = illimité.
-- Formule d'une adresse : attribution nominative (transfer_plan_assignments, ex. formule payée
-- jusqu'à telle date) > formule « membres du board » si l'adresse est celle d'un compte > formule par défaut.
--
-- Accès : la page publique passe par le serveur (service role). Dans le board : chacun voit ses
-- transferts, administrateurs et super users voient tout et gèrent formules et pubs.
-- À appliquer à la main sur le projet Supabase partagé.

begin;

/* ---------- Formules (limites) ---------- */

create table if not exists public.transfer_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  -- null = illimité
  max_size_bytes bigint check (max_size_bytes is null or max_size_bytes > 0),
  max_days int check (max_days is null or max_days > 0),
  -- Formule appliquée aux expéditeurs sans compte ni attribution (une seule).
  is_default boolean not null default false,
  -- Formule appliquée à tous les comptes du board sans attribution (une seule).
  is_members_default boolean not null default false,
  -- Peut cocher « Archiver » (garder les fichiers dans le Drive après expiration).
  can_archive boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists transfer_plans_one_default on public.transfer_plans (is_default) where is_default;
create unique index if not exists transfer_plans_one_members on public.transfer_plans (is_members_default) where is_members_default;

create table if not exists public.transfer_plan_assignments (
  email text primary key check (email = lower(email)),
  plan_id uuid not null references public.transfer_plans(id) on delete cascade,
  -- Fin de validité (formule payée jusqu'au…) ; null = sans fin.
  valid_until date,
  note text not null default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

insert into public.transfer_plans (name, description, max_size_bytes, max_days, is_default, is_members_default, can_archive, position)
select * from (values
  ('Gratuit', 'Expéditeurs sans compte', 5::bigint * 1024 * 1024 * 1024, 7, true, false, false, 0),
  ('Membres', 'Comptes du board', null::bigint, null::int, false, true, true, 1)
) v
where not exists (select 1 from public.transfer_plans);

/* ---------- Transferts ---------- */

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  -- Code court du lien public (…/t/<code>).
  code text not null unique,
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'expired', 'revoked')),
  source text not null default 'public' check (source in ('public', 'board')),
  sender_email text not null check (sender_email = lower(sender_email)),
  sender_name text not null default '',
  sender_user_id uuid references public.profiles(id) on delete set null,
  plan_id uuid references public.transfer_plans(id) on delete set null,
  title text not null default '',
  message text not null default '' check (length(message) <= 5000),
  -- Vide = « lien seulement » (l'expéditeur partage le lien lui-même).
  recipients text[] not null default '{}' check (cardinality(recipients) <= 50),
  notify_on_download boolean not null default true,
  -- Garder les fichiers dans le Drive après expiration.
  archived boolean not null default false,
  total_bytes bigint not null default 0,
  file_count int not null default 0,
  drive_folder_id text,
  download_count int not null default 0,
  last_download_at timestamptz,
  -- null = sans expiration
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  ready_at timestamptz
);
create index if not exists transfers_created_idx on public.transfers (created_at desc);
create index if not exists transfers_sender_user_idx on public.transfers (sender_user_id);
create index if not exists transfers_expiring_idx on public.transfers (expires_at) where status = 'ready';

create table if not exists public.transfer_files (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  name text not null,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  drive_file_id text,
  -- Fichier déjà présent dans le Drive du board (envoyé depuis le board) : jamais mis à la corbeille.
  from_board_drive boolean not null default false,
  uploaded boolean not null default false,
  download_count int not null default 0,
  position int not null default 0
);
create index if not exists transfer_files_transfer_idx on public.transfer_files (transfer_id);

create table if not exists public.transfer_downloads (
  id bigint generated always as identity primary key,
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  file_id uuid references public.transfer_files(id) on delete cascade,
  at timestamptz not null default now()
);
create index if not exists transfer_downloads_transfer_idx on public.transfer_downloads (transfer_id, at desc);

-- Codes de vérification de l'adresse de l'expéditeur (page publique). Haché, 15 min, 5 essais.
create table if not exists public.transfer_email_codes (
  email text primary key check (email = lower(email)),
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  sent_at timestamptz not null default now()
);

/* ---------- Publicités ---------- */

create table if not exists public.transfer_ads (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  advertiser text not null default '',
  media_type text not null check (media_type in ('image', 'video')),
  -- Fichier de la pub dans le Drive du board (servi par /api/transfer/ads/<id>/media).
  media_drive_file_id text not null,
  link_url text check (link_url is null or link_url ~* '^https?://'),
  format text not null default 'wallpaper' check (format in ('wallpaper', 'banner')),
  placements text[] not null default '{upload,download}' check (placements <@ array['upload', 'download']),
  starts_at date,
  ends_at date,
  active boolean not null default true,
  -- Poids de tirage quand plusieurs pubs sont en ligne en même temps.
  weight int not null default 1 check (weight between 1 and 100),
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

/* ---------- Compteurs (appelés par le serveur, service role) ---------- */

create or replace function public.transfer_count_download(p_transfer uuid, p_file uuid)
returns void language sql security definer set search_path = public as $$
  insert into transfer_downloads (transfer_id, file_id) values (p_transfer, p_file);
  update transfer_files set download_count = download_count + 1 where id = p_file and transfer_id = p_transfer;
  update transfers set download_count = download_count + 1, last_download_at = now() where id = p_transfer;
$$;

create or replace function public.transfer_ad_hit(p_ad uuid, p_click boolean)
returns void language sql security definer set search_path = public as $$
  update transfer_ads
     set impressions = impressions + case when p_click then 0 else 1 end,
         clicks = clicks + case when p_click then 1 else 0 end
   where id = p_ad;
$$;

revoke all on function public.transfer_count_download(uuid, uuid) from public, anon, authenticated;
revoke all on function public.transfer_ad_hit(uuid, boolean) from public, anon, authenticated;
grant execute on function public.transfer_count_download(uuid, uuid) to service_role;
grant execute on function public.transfer_ad_hit(uuid, boolean) to service_role;

/* ---------- Droits ---------- */

alter table public.transfer_plans enable row level security;
alter table public.transfer_plan_assignments enable row level security;
alter table public.transfers enable row level security;
alter table public.transfer_files enable row level security;
alter table public.transfer_downloads enable row level security;
alter table public.transfer_email_codes enable row level security;
alter table public.transfer_ads enable row level security;

-- Formules : lisibles par les comptes (affichage de sa limite), gérées par les admins.
drop policy if exists transfer_plans_select on public.transfer_plans;
create policy transfer_plans_select on public.transfer_plans for select to authenticated using (true);
drop policy if exists transfer_plans_admin on public.transfer_plans;
create policy transfer_plans_admin on public.transfer_plans for all to authenticated
  using (is_admin_or_super(auth.uid())) with check (is_admin_or_super(auth.uid()));

drop policy if exists transfer_plan_assignments_admin on public.transfer_plan_assignments;
create policy transfer_plan_assignments_admin on public.transfer_plan_assignments for all to authenticated
  using (is_admin_or_super(auth.uid())) with check (is_admin_or_super(auth.uid()));

-- Transferts : les siens, ou tout pour les admins. Écritures par le serveur (service role).
drop policy if exists transfers_select on public.transfers;
create policy transfers_select on public.transfers for select to authenticated
  using (sender_user_id = auth.uid() or is_admin_or_super(auth.uid()));

drop policy if exists transfer_files_select on public.transfer_files;
create policy transfer_files_select on public.transfer_files for select to authenticated
  using (exists (select 1 from transfers t where t.id = transfer_id and (t.sender_user_id = auth.uid() or is_admin_or_super(auth.uid()))));

drop policy if exists transfer_downloads_select on public.transfer_downloads;
create policy transfer_downloads_select on public.transfer_downloads for select to authenticated
  using (exists (select 1 from transfers t where t.id = transfer_id and (t.sender_user_id = auth.uid() or is_admin_or_super(auth.uid()))));

-- Codes : aucune politique → serveur uniquement.

drop policy if exists transfer_ads_admin on public.transfer_ads;
create policy transfer_ads_admin on public.transfer_ads for all to authenticated
  using (is_admin_or_super(auth.uid())) with check (is_admin_or_super(auth.uid()));

grant select on public.transfer_plans, public.transfers, public.transfer_files, public.transfer_downloads to authenticated;
grant select, insert, update, delete on public.transfer_plans, public.transfer_plan_assignments, public.transfer_ads to authenticated;

commit;

-- Tâche quotidienne (3 h 40, heure de Paris en été) : liens expirés coupés, fichiers à la corbeille.
-- À exécuter séparément en remplaçant <CRON_SECRET> :
-- select cron.schedule(
--   'transfers-expire',
--   '40 1 * * *',
--   $$
--     select net.http_get(
--       url     := 'https://board-lgef.vercel.app/api/cron/transfers-expire',
--       headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
--       timeout_milliseconds := 300000
--     );
--   $$
-- );
