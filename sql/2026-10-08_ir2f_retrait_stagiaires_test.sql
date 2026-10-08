-- Ticket 8af7f39d — conventions de stage BMF Strasbourg (application IR2F, schéma ir2f) :
-- retrait des 4 stagiaires saisis pour des tests (Imbert, Bernier, Simon, Chanonier), pour qu'ils
-- n'apparaissent plus dans le document envoyé à la comptabilité et à l'administration.
-- À lancer dans l'éditeur SQL de Supabase, en deux temps.

-- 1) APERÇU — vérifier qu'il y a exactement les 4 lignes de test, et pas un vrai stagiaire homonyme.
select cs.id, cs.nom, cs.prenom, cs.email, cs.club, cs."formationId", cs."sessionId", cs."createdAt",
       (select count(*) from ir2f."ConventionSignataire" s where s."conventionStagiaireId" = cs.id) as signataires
from ir2f."ConventionStagiaire" cs
where lower(cs.nom) in ('imbert', 'bernier', 'simon', 'chanonier')
order by cs.nom;

-- 2) SUPPRESSION — si l'aperçu montre d'autres lignes, remplacer le filtre par la liste des id retenus :
--    where cs.id in ('…', '…', '…', '…')
begin;

delete from ir2f."ConventionSignataire" s
using ir2f."ConventionStagiaire" cs
where s."conventionStagiaireId" = cs.id
  and lower(cs.nom) in ('imbert', 'bernier', 'simon', 'chanonier');

delete from ir2f."ConventionStagiaire" cs
where lower(cs.nom) in ('imbert', 'bernier', 'simon', 'chanonier');
-- Le nombre de lignes supprimées doit être 4. Sinon : rollback;

commit;
