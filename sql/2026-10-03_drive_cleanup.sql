-- Nettoyage du Drive du board : les photos et vidéos publiées sur les réseaux sont retirées du Drive
-- 7 jours après leur publication (elles restent en ligne sur Facebook / Instagram / YouTube).
-- Les documents (PDF, Word…), justificatifs et factures ne sont jamais concernés.
-- *_purged_at : date de retrait du Drive — le board n'affiche plus de lien vers ces fichiers.

alter table public.event_files add column if not exists drive_purged_at timestamptz;
-- Médias d'une publication autonome (créée depuis le centre, sans événement : colonne media).
alter table public.media_publications add column if not exists media_purged_at timestamptz;

-- Tâche quotidienne (4 h 20, heure de Paris en été) : appelle /api/cron/drive-cleanup.
-- À exécuter en remplaçant <CRON_SECRET> :
select cron.schedule(
  'drive-cleanup',
  '20 2 * * *',
  $$
    select net.http_get(
      url     := 'https://board-lgef.vercel.app/api/cron/drive-cleanup',
      headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>'),
      timeout_milliseconds := 60000
    );
  $$
);
