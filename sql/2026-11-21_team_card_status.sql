-- Espace Team : statut d'une carte, réglé d'un clic depuis l'accueil (« Mes cartes ») par une
-- pastille verte, orange ou rouge, visible de tous les membres de la carte.
--
--   green  : en bonne voie
--   orange : en attente / à surveiller
--   red    : bloqué
--   null   : pas de statut (valeur par défaut, aucune carte existante n'est modifiée)
--
-- Aucun nouveau droit : la colonne suit la règle de modification des cartes déjà en place
-- (policy team_cards_update → team_can_edit_card, qui couvre aussi les assignés).

begin;

alter table public.team_cards add column if not exists status text;
alter table public.team_cards drop constraint if exists team_cards_status_check;
alter table public.team_cards add constraint team_cards_status_check check (status is null or status in ('green', 'orange', 'red'));

commit;
