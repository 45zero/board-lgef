-- Frais : factures en devise étrangère (ex. 60 $). La ligne est créée dans la devise de la facture
-- (lue par Claude), puis convertie en euros d'un clic (cours BCE du jour de la facture) : les
-- montants de la ligne passent en euros, la devise et le montant d'origine restent pour le valideur.
-- Une ligne pas encore convertie bloque la déclaration.
-- currency nul = euros (toutes les lignes existantes).
-- Appliquée à la main sur le projet Supabase partagé.

alter table public.event_expenses add column if not exists currency text;
alter table public.event_expenses add column if not exists original_amount numeric;
-- Cours appliqué (1 unité de la devise = exchange_rate €) ; nul tant que la ligne n'est pas convertie.
alter table public.event_expenses add column if not exists exchange_rate numeric;
alter table public.event_expenses add column if not exists exchange_rate_date date;
