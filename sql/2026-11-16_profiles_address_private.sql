-- Adresse personnelle privée (ticket b264d046) : quand la case est cochée dans « Mon profil », le domicile
-- (adresse et épingle sur la carte des techniciens) n'est montré qu'à la personne et à son N+1
-- (expense_validator_id). Les temps de trajet restent calculés côté serveur, sans montrer l'adresse.
-- Ajout seulement.

alter table public.profiles
  add column if not exists address_private boolean not null default false;
