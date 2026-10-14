-- Rappel « au moment du départ » (début − temps de route depuis le domicile − marge) et envoi des
-- rappels d'événement par le board (/api/cron/event-reminders) au lieu de la fonction
-- process_event_reminders de l'ancien calendrier (libellés faux pour 0min / 20min / 2h, ignorait « depart »).
-- Appliquée à la main sur le projet Supabase partagé.

-- 1) Nouvelle valeur de rappel « depart ».
alter table public.event_reminders drop constraint if exists event_reminders_reminder_offset_check;
alter table public.event_reminders
  add constraint event_reminders_reminder_offset_check
  check (reminder_offset = any (array['0min', '10min', '20min', '30min', '1h', '2h', '1d', 'depart']));

-- 2) Rappels dus (la route ne regarde que les 15 dernières minutes).
create index if not exists event_reminders_due_idx
  on public.event_reminders (remind_at)
  where sent_at is null;

-- 3) Le board envoie les rappels ; l'ancienne tâche s'arrête (sinon chaque rappel partirait deux fois).
select cron.unschedule('process-event-reminders')
where exists (select 1 from cron.job where jobname = 'process-event-reminders');

-- Même appel (et même secret CRON_SECRET) que la tâche « daily-digest », route changée.
select cron.unschedule('event-reminders')
where exists (select 1 from cron.job where jobname = 'event-reminders');

select cron.schedule(
  'event-reminders',
  '* * * * *',
  replace((select command from cron.job where jobname = 'daily-digest'), '/api/cron/daily-digest', '/api/cron/event-reminders')
);
