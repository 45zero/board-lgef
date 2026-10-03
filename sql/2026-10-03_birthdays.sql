-- Anniversaires : date de naissance dans le profil (Mon profil, Paramètres → Utilisateurs).
-- Le jour J, le bandeau d'accueil change pour la personne fêtée, les autres voient « C'est
-- l'anniversaire de … », et le mail de 7 h (cron daily-digest) prévient tout le personnel.
-- birthday_announced_on : dernier jour où l'anniversaire a été annoncé par mail (une seule fois par an).
-- Seuls le jour et le mois sont montrés aux autres ; l'année n'est jamais affichée.

alter table public.profiles
  add column if not exists birth_date date,
  add column if not exists birthday_announced_on date;
