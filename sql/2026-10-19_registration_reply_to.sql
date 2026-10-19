-- Inscriptions : adresse de réponse des mails envoyés aux clubs (invitations, relances, confirmations).
--
-- - board_settings.registration_reply_to : quand un club clique « Répondre », son mail arrive à cette
--   adresse (ex. communication@lgef.fff.fr). Vide = l'adresse de la personne qui envoie, comme avant.
--   Lue et modifiée par le serveur (client service) après contrôle du rôle : pas de nouvelle politique RLS.

begin;

alter table public.board_settings add column if not exists registration_reply_to text;

commit;
