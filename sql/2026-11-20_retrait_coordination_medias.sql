-- Retrait du statut « Salarié » (tech-salarie, qui donne la coordination médias) à 4 personnes qui
-- l'avaient par accident, décidé par Giovanni le 20/11/2026 : Emma Audinot-Cunin, Frédéric Barrat,
-- Julien Lottin, Yann Leroy. Ils n'utilisaient aucune fonction réservée (campagnes d'inscription,
-- annuaires, matchs du week-end, contacts WhatsApp) ; l'ajout de fichiers reste ouvert à tous.
-- Retour arrière : insert into profile_specialties (user_id, specialty_id)
--   select u, (select id from specialties where slug = 'tech-salarie') from unnest(array['c3f65e99-eaa2-4a91-9d33-c6e8cdcc6bab','894092ac-9bc6-4af4-9c88-9e53df44c0fd','9adc5a30-612e-491b-8966-3d9ad122d83d','8954478e-3841-401e-b4b4-409a32ec6bc4']::uuid[]) u;

begin;
delete from public.profile_specialties
 where user_id in ('c3f65e99-eaa2-4a91-9d33-c6e8cdcc6bab','894092ac-9bc6-4af4-9c88-9e53df44c0fd','9adc5a30-612e-491b-8966-3d9ad122d83d','8954478e-3841-401e-b4b4-409a32ec6bc4')
   and specialty_id = (select id from public.specialties where slug = 'tech-salarie');
commit;
