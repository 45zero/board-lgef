-- Envoi automatique des publications programmées du centre de publication : toutes les 5 minutes,
-- pg_cron appelle la route du board /api/cron/publications avec le secret partagé CRON_SECRET
-- (même valeur que la variable d'environnement Vercel du board). Même mécanique que le job
-- process-event-reminders déjà en place.
--
-- À exécuter en remplaçant <CRON_SECRET> :
select cron.schedule(
  'publish-scheduled-publications',
  '*/5 * * * *',
  $$
    select net.http_get(
      url     := 'https://board-lgef.vercel.app/api/cron/publications',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
      timeout_milliseconds := 60000
    );
  $$
);
