-- Hydromatch — réparation après la migration sécurité du 17/11 (sql/2026-11-17_securite_rls.sql).
-- Rien n'est supprimé dans les données (les 72 inscriptions sont intactes).
--
-- 1. Admin à 0 demande : hydromatch.lgef.fr/admin.html se connecte avec le compte partagé
--    hydromatch@lgef.fr, qui n'était pas dans hydromatch_admins (seuls Anthony et Giovanni y étaient).
--    → on l'ajoute à la liste.
-- 2. Formulaire public en erreur : le 17/11, les visiteurs sans compte (anon) ont perdu la lecture de
--    public.profiles. Or trois règles du bucket event-files (le board) étaient ouvertes à « public »
--    (donc aussi aux visiteurs) et lisent profiles : toute opération de stockage d'un visiteur, y compris
--    l'envoi de la photo Hydromatch, échoue avec « permission denied for table profiles ».
--    → ces trois règles passent à « authenticated » : aucun changement pour le board (sans compte,
--      auth.uid() est vide, elles ne donnaient déjà rien aux visiteurs).

begin;

-- 1. Compte partagé de la page admin
insert into public.hydromatch_admins (user_id) values
  ('5911d76d-d2ef-4e7a-934b-d0ceb52a1d29') -- hydromatch@lgef.fr (compte de admin.html)
on conflict do nothing;

-- 2. Règles event-files réservées aux personnes connectées
alter policy "event-files-select" on storage.objects to authenticated;
alter policy "event-files-insert" on storage.objects to authenticated;
alter policy "event-files-delete" on storage.objects to authenticated;

commit;
