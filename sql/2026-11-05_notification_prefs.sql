-- Préférences de notification du module Frais, réglées par chacun dans Paramètres → Notifications.
-- Une colonne jsonb sur profiles, vide par défaut (= comportement actuel) :
--   {
--     "frais_decision": "instant" | "board",   -- mes frais / factures validés ou payés
--     "frais_refus":    "instant" | "board",   -- mes frais / factures refusés
--     "frais_a_valider": "instant" | "half_day" | "board",  -- ce que je dois valider (N+1, GED)
--     "frais_a_valider_last_push": "2026-11-05T09:00:00Z"   -- dernier rappel « à valider » envoyé
--   }
-- « instant » : board + push + e-mail (selon les interrupteurs généraux) ; « board » : notification
-- dans le board seulement ; « half_day » : au plus un push / e-mail toutes les 12 h.
-- Rien n'est supprimé ni réécrit : ajout d'une colonne avec valeur par défaut.

alter table public.profiles
  add column if not exists notification_prefs jsonb not null default '{}'::jsonb;

comment on column public.profiles.notification_prefs is
  'Préférences de notification par catégorie (module Frais) — voir sql/2026-11-05_notification_prefs.sql';
