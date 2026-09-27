-- Programme de la journée par e-mail : pg_cron appelle /api/cron/daily-digest toutes les heures ;
-- la route n'envoie qu'à 7 h heure de Paris (gère l'heure d'été/d'hiver) et une fois par jour.
-- À exécuter en remplaçant <CRON_SECRET> :
select cron.schedule(
  'daily-digest',
  '5 * * * *',
  $$
    select net.http_get(
      url     := 'https://board-lgef.vercel.app/api/cron/daily-digest',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
      timeout_milliseconds := 60000
    );
  $$
);
