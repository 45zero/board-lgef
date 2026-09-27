-- Modération des commentaires (Claude) : toutes les 5 minutes, pg_cron appelle /api/cron/comments du board
-- avec le secret partagé CRON_SECRET (même valeur que la variable Vercel). Tant que
-- ANTHROPIC_API_KEY n'est pas configurée, la route répond « skipped » sans rien faire.
--
-- À exécuter en remplaçant <CRON_SECRET> :
select cron.schedule(
  'moderate-comments',
  '*/5 * * * *',
  $$
    select net.http_get(
      url     := 'https://board-lgef.vercel.app/api/cron/comments',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
      timeout_milliseconds := 60000
    );
  $$
);
