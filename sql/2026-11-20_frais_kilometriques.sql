-- Indemnités kilométriques (décision de Giovanni du 20/11/2026) : 0,45 €/km pour les salariés, le
-- comité directeur et la TeamMedias « Réseau » sans véhicule de fonction ; rien pour les bénévoles et
-- les prestataires. Nouvelle catégorie de ligne de frais « Indemnités kilométriques » : une colonne
-- montant de plus, comme les autres (transport_fees, fuel_fees…). Le montant est toujours recalculé
-- côté serveur (kilomètres × 0,45) ; distance_km garde les kilomètres aller-retour.
-- Ajout seulement : colonne vide par défaut, aucune donnée existante modifiée. Droits : ceux de la
-- table (accordés à la table entière, la colonne en hérite).
-- Retour arrière : alter table public.event_expenses drop column mileage_fees;

alter table public.event_expenses add column if not exists mileage_fees numeric;
comment on column public.event_expenses.mileage_fees is
  'Indemnités kilométriques (€) = distance_km × 0,45 — voir sql/2026-11-20_frais_kilometriques.sql';
