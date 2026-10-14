-- Push des nouveaux mails (onglet « Principal » de Gmail) sur un canal Android « mail » distinct :
-- /api/cron/mail-push, appelé chaque minute. Retient, par compte Google connecté, la date du dernier
-- mail signalé (internalDate Gmail, en ms) pour ne prévenir qu'une fois de chaque mail.
-- Appliquée à la main sur le projet Supabase partagé.

create table if not exists public.mail_push_state (
  account_id text primary key,          -- board."ConnectedAccount".id
  user_id uuid not null references auth.users(id) on delete cascade,
  last_internal_date bigint not null,
  updated_at timestamptz not null default now()
);

-- Lue et écrite seulement par le serveur (aucun accès depuis le navigateur).
alter table public.mail_push_state enable row level security;

-- Tâche chaque minute. Même appel (et même secret CRON_SECRET) que la tâche « daily-digest »,
-- route changée.
select cron.unschedule('mail-push')
where exists (select 1 from cron.job where jobname = 'mail-push');

select cron.schedule(
  'mail-push',
  '* * * * *',
  replace((select command from cron.job where jobname = 'daily-digest'), '/api/cron/daily-digest', '/api/cron/mail-push')
);
