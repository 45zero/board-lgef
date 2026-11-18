-- Dossiers dans les pièces jointes d'un événement : on peut déposer un dossier entier (ex. 20 photos)
-- depuis la fiche événement ou une carte de l'Espace Team liée. La fiche affiche alors un seul
-- dossier, qu'on ouvre pour voir / télécharger chaque fichier. Les photos et vidéos restent une ligne
-- event_files chacune : le déclencheur queue_event_media_for_publication les met toujours une par une
-- dans « À publier » du centre de publication — rien ne change de ce côté.
--
-- `folder` : chemin du dossier tel que déposé (« Match U15 » ou « Match U15 / Mi-temps »), null =
-- fichier hors dossier. Purement du rangement d'affichage : aucune règle d'accès n'en dépend.

alter table public.event_files add column if not exists folder text;

alter table public.event_files drop constraint if exists event_files_folder_check;
alter table public.event_files
  add constraint event_files_folder_check check (folder is null or (length(folder) between 1 and 200));
