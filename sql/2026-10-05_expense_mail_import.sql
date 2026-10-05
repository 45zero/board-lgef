-- Frais : import automatique des factures reçues par e-mail (Frais → Paramètres).
-- Chacun règle ses propres règles sur SA boîte Gmail connectée (expéditeur, mots du sujet) ; les
-- pièces jointes (PDF, photos) des mails correspondants sont lues par Claude puis ajoutées à SES
-- frais comme un justificatif déposé à la main : ligne hors événement du mois de la facture (ou
-- l'événement si le rapprochement est net et que la règle le demande), copie dans le Drive.
-- Un cron (toutes les 15 min) passe sur les règles actives ; « Vérifier maintenant » fait de même.
-- Appliquée à la main sur le projet Supabase partagé.

create table if not exists public.expense_mail_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Compte Google connecté (connected_accounts, Prisma) dont la boîte est lue.
  account_id uuid not null,
  label text not null default '',
  -- Adresse ou domaine de l'expéditeur (ex. factures@sncf.fr, free.fr) ; au moins un des deux filtres.
  from_filter text not null default '',
  -- Mots du sujet (ex. « facture »).
  subject_filter text not null default '',
  -- Rattacher à un événement quand le rapprochement est net (sinon : hors événement du mois).
  match_events boolean not null default false,
  enabled boolean not null default true,
  -- Seuls les mails reçus après la création de la règle sont importés (pas d'historique).
  created_at timestamptz not null default now(),
  last_checked_at timestamptz,
  last_error text,
  check (length(trim(from_filter)) > 0 or length(trim(subject_filter)) > 0)
);

create index if not exists expense_mail_rules_enabled_idx on public.expense_mail_rules (enabled, last_checked_at);

-- Journal : une ligne par pièce jointe traitée (évite les doublons, affiché dans Paramètres).
create table if not exists public.expense_mail_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  rule_id uuid references public.expense_mail_rules (id) on delete set null,
  gmail_message_id text not null,
  attachment_name text not null,
  mail_from text,
  mail_subject text,
  mail_date timestamptz,
  status text not null check (status in ('imported', 'ignored', 'error')),
  detail text,
  expense_ids uuid[] not null default '{}',
  total numeric,
  created_at timestamptz not null default now(),
  unique (user_id, gmail_message_id, attachment_name)
);

create index if not exists expense_mail_imports_user_idx on public.expense_mail_imports (user_id, created_at desc);

alter table public.expense_mail_rules enable row level security;
alter table public.expense_mail_imports enable row level security;

-- Lecture de ses propres lignes ; écritures par les server actions et le cron (service role).
drop policy if exists expense_mail_rules_select on public.expense_mail_rules;
create policy expense_mail_rules_select on public.expense_mail_rules for select using (user_id = auth.uid());
drop policy if exists expense_mail_imports_select on public.expense_mail_imports;
create policy expense_mail_imports_select on public.expense_mail_imports for select using (user_id = auth.uid());

-- Tâche toutes les 15 minutes : appelle /api/cron/expense-mail.
-- À exécuter en remplaçant <CRON_SECRET> :
select cron.schedule(
  'expense-mail',
  '*/15 * * * *',
  $$
    select net.http_get(
      url     := 'https://board-lgef.vercel.app/api/cron/expense-mail',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
      timeout_milliseconds := 300000
    );
  $$
);
