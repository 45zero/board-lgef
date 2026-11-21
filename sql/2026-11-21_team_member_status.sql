-- Espace Team : statut de chaque personne sur une carte (au lieu d'un statut unique par carte).
--
-- Exemple : Giovanni crée une carte et y assigne Ianis. Ianis la voit arriver « en rouge » dans
-- « Mes cartes » ; il passe à l'orange quand il s'y met, au vert quand sa part est faite. Giovanni
-- voit la pastille IV avec un point orange : il sait que c'est en cours.
--
--   red    : à faire (valeur de départ de toute assignation, y compris les assignations existantes)
--   orange : en cours
--   green  : fait
--
-- Droits : déjà en place — chacun ne peut modifier que sa propre ligne d'assignation
-- (policy team_card_members_update : user_id = auth.uid()).
--
-- Le statut par carte ajouté plus tôt aujourd'hui (team_cards.status, 2026-11-21_team_card_status.sql)
-- est retiré : il n'a jamais été rempli et le statut par personne le remplace.

begin;

alter table public.team_card_members add column if not exists status text not null default 'red';
alter table public.team_card_members drop constraint if exists team_card_members_status_check;
alter table public.team_card_members add constraint team_card_members_status_check check (status in ('red', 'orange', 'green'));

alter table public.team_cards drop constraint if exists team_cards_status_check;
alter table public.team_cards drop column if exists status;

commit;
