-- Habillage des vidéos (FFmpeg sur Vercel) : dépôt temporaire de la vidéo d'origine et du calque,
-- puis du résultat, le temps que le téléphone le récupère. Bucket privé (URL signées uniquement) ;
-- les fichiers d'entrée sont supprimés dès l'encodage, le résultat dès qu'il est récupéré.
insert into storage.buckets (id, name, public, file_size_limit)
values ('video-work', 'video-work', false, 524288000)
on conflict (id) do nothing;
