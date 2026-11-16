-- Tournois (ticket e7cce75c) : nombre de matchs par équipe dans chaque catégorie (la durée d'un match
-- existe déjà : match_minutes) et case « le club utilisera le logiciel de gestion de tournoi offert par
-- la ligue » (rend obligatoires les informations complémentaires). Ajouts seulement, rien de supprimé.

alter table public.tournament_declaration_categories
  add column if not exists matches_per_team smallint check (matches_per_team is null or matches_per_team >= 0);

alter table public.tournament_declarations
  add column if not exists uses_league_software boolean not null default false;
