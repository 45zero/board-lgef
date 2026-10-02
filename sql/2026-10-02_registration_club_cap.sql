-- Inscriptions : plafond optionnel de personnes par club (ex. AG : 2 max par club).
-- NULL = pas de limite (comportement par défaut de toutes les campagnes).
-- Appliquée à la main sur le projet Supabase partagé.
alter table public.event_registration_campaigns
  add column if not exists max_attendees_per_club smallint
  check (max_attendees_per_club is null or max_attendees_per_club between 1 and 99);

notify pgrst, 'reload schema';
