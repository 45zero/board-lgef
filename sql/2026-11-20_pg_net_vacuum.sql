-- Audit de vitesse du 20/11/2026 : 64 % du temps de calcul de la base (depuis le 27/09) partait dans le
-- nettoyage de net._http_response (journal des réponses aux appels web des tâches planifiées, pg_net).
-- La table ne gardait que ~1 250 réponses (6 h) mais pesait 132 Mo : les lignes supprimées n'étaient
-- jamais compactées, et chaque nettoyage (plusieurs fois par seconde) relisait ces 132 Mo.
--
-- Fait le 20/11 : truncate net._http_response (132 Mo → 32 Ko ; personne ne lit ce journal).
-- Ci-dessous : compactage toutes les heures pour qu'elle ne regonfle plus (VACUUM simple, sans verrou
-- bloquant, quelques millisecondes sur une table de quelques centaines de lignes).
-- Retour arrière : select cron.unschedule('pg-net-vacuum');

select cron.schedule('pg-net-vacuum', '17 * * * *', 'vacuum net._http_response');
