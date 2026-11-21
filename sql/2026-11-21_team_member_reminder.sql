-- Espace Team : relance persistante d'un membre sur une carte.
--
-- Clic sur la pastille d'un membre (accueil) : il reçoit une notification et sa pastille garde une
-- cloche ORANGE (1re relance). Tant qu'il n'a pas réagi, un nouveau clic la passe au ROUGE (2e relance).
-- La cloche disparaît quand la personne clique dessus (« vu ») ou change son statut sur la carte.
--
--   reminder_level : 0 aucune relance, 1 orange, 2 rouge
--   reminded_at    : date de la dernière relance
--   reminded_by    : qui a relancé en dernier
--
-- Droits : la relance est écrite côté serveur (client service) après vérification que l'auteur est
-- membre ou créateur de la carte ; l'effacement par la personne passe par sa propre ligne
-- (policy team_card_members_update existante : user_id = auth.uid()). Aucune policy ajoutée.
-- Aucun déclencheur sur la mise à jour de team_card_members (seulement à l'insertion) : sans effet de bord.

begin;

alter table public.team_card_members add column if not exists reminder_level smallint not null default 0;
alter table public.team_card_members add column if not exists reminded_at timestamptz;
alter table public.team_card_members add column if not exists reminded_by uuid references public.profiles(id) on delete set null;
alter table public.team_card_members drop constraint if exists team_card_members_reminder_level_check;
alter table public.team_card_members add constraint team_card_members_reminder_level_check check (reminder_level between 0 and 2);

commit;
