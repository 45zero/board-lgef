-- GED (module Frais pour les administrateurs et la compta) : paiement, factures hors intervention
-- et fiche société des prestataires. Ajouts seulement : aucune colonne ni donnée existante modifiée.
--
--  * event_invoices : déjà payment_status ('unpaid' | 'paid') et paid_at (appli calendrier) ; on
--    ajoute qui a marqué payé, le n° et la date de la facture, un objet (facture sans événement :
--    séminaire, matériel…), le montant HT et la provenance (board, lien sans compte, e-mail) ;
--  * expense_submissions : « remboursé le » (paid_at, paid_by) pour les notes de frais validées ;
--  * prestataire_profiles : société du prestataire (raison sociale, SIRET, TVA, IBAN, adresse) et
--    domaines e-mail d'où arrivent ses factures (traiteurmarie.com), pour l'import par e-mail (lot 3).
-- Lecture et écriture par le board avec le client de service, après vérification des droits
-- (src/app/actions/staff.ts) ; RLS : la personne lit et complète sa propre fiche société.
-- À appliquer à la main sur le projet Supabase partagé, après accord.

begin;

-- Factures : paiement et champs de contrôle.
alter table public.event_invoices
  add column if not exists paid_by uuid references public.profiles(id) on delete set null,
  add column if not exists invoice_number text,
  add column if not exists invoice_date date,
  add column if not exists label text,
  add column if not exists amount_ht numeric(10, 2) check (amount_ht is null or amount_ht >= 0),
  add column if not exists source text not null default 'board' check (source in ('board', 'link', 'mail'));

-- Paiement : toutes les factures existantes ont déjà payment_status ; valeur par défaut pour les nouvelles.
alter table public.event_invoices alter column payment_status set default 'unpaid';

-- Factures sans événement : rangées au mois de la facture (invoice_date), sinon du dépôt.
create index if not exists event_invoices_user_idx on public.event_invoices (user_id);
create index if not exists event_invoices_unpaid_idx on public.event_invoices (status, payment_status);
-- Doublons (même prestataire, même n°) : signalés par le board avant l'enregistrement.
create index if not exists event_invoices_number_idx on public.event_invoices (user_id, invoice_number) where invoice_number is not null;

-- Notes de frais : remboursement.
alter table public.expense_submissions
  add column if not exists paid_at timestamptz,
  add column if not exists paid_by uuid references public.profiles(id) on delete set null;

-- Fiche société du prestataire.
create table if not exists public.prestataire_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  company_name text,
  siret text check (siret is null or siret ~ '^[0-9]{14}$'),
  vat_number text,
  iban text,
  billing_address text,
  mail_domains text[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
create index if not exists prestataire_profiles_domains_idx on public.prestataire_profiles using gin (mail_domains);

alter table public.prestataire_profiles enable row level security;

drop policy if exists prestataire_profiles_select on public.prestataire_profiles;
create policy prestataire_profiles_select on public.prestataire_profiles for select
  using (user_id = auth.uid() or can_manage_staff_cost(user_id, auth.uid()));
drop policy if exists prestataire_profiles_write on public.prestataire_profiles;
create policy prestataire_profiles_write on public.prestataire_profiles for all
  using (user_id = auth.uid() or can_manage_staff_cost(user_id, auth.uid()))
  with check (user_id = auth.uid() or can_manage_staff_cost(user_id, auth.uid()));

commit;

notify pgrst, 'reload schema';
