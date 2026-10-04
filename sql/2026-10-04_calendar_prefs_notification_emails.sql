-- 1) Affichage par défaut du calendrier (clic droit : vue, « où je suis sollicité », matchs vidéo /
--    photo), enregistré sur le compte pour être repris sur le mobile (useCalendarDefaults).
-- 2) Notifications par e-mail depuis le board : chaque notification part une fois, selon
--    profiles.notify_email (/api/cron/notification-emails, appelé chaque minute).
-- Appliquée à la main sur le projet Supabase partagé.

alter table public.profiles
  add column if not exists calendar_prefs jsonb not null default '{}'::jsonb;

alter table public.notifications
  add column if not exists email_status text,
  add column if not exists email_sent_at timestamptz;

-- Notifications en attente d'e-mail (la route ne regarde que les 30 dernières minutes).
create index if not exists notifications_email_pending_idx
  on public.notifications (created_at)
  where email_status is null;

-- Pas d'envoi rétroactif : les notifications déjà présentes au déploiement ne partent pas.
update public.notifications
set email_status = 'skipped'
where email_status is null
  and created_at > now() - interval '1 hour';

-- Tâche chaque minute. Même appel (et même secret CRON_SECRET) que la tâche « daily-digest » :
-- la commande est recopiée en changeant seulement la route, pour ne pas écrire le secret ici.
select cron.unschedule('notification-emails')
where exists (select 1 from cron.job where jobname = 'notification-emails');

select cron.schedule(
  'notification-emails',
  '* * * * *',
  replace((select command from cron.job where jobname = 'daily-digest'), '/api/cron/daily-digest', '/api/cron/notification-emails')
);
