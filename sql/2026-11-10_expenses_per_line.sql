-- Frais hors événement : une déclaration PAR DÉPENSE au lieu d'une par mois.
--
-- Avant (sql/2026-09-27_expenses_without_event.sql) : toutes les dépenses hors événement d'un mois
-- formaient une seule déclaration (user_id, period_month). Le N+1 validait ou refusait le mois
-- entier, et une fois le mois validé plus rien ne pouvait y être ajouté.
-- Après : chaque dépense hors événement a sa propre déclaration (expense_id) : validée, refusée et
-- payée une par une ; une nouvelle facture n'est jamais bloquée par celles déjà validées.
-- period_month est gardé (mois de la dépense) pour l'affichage et le classement.
--
-- Données existantes : chaque déclaration mensuelle est éclatée en une déclaration par dépense
-- qu'elle contenait, avec le MÊME statut, les mêmes dates de validation, commentaire et paiement.
-- Les dépenses saisies après coup (hors de expense_ids) redeviennent « à déclarer ».

begin;

alter table public.expense_submissions
  add column if not exists expense_id uuid references public.event_expenses(id) on delete cascade;

-- 0. L'ancienne règle « une déclaration par mois » saute AVANT l'éclatement (sinon doublon).
drop index if exists public.unique_month_user_expense;

-- 1. Une déclaration par dépense, copiée de la déclaration mensuelle.
insert into public.expense_submissions (
  user_id, event_id, period_month, expense_id, expense_ids, total_amount, status, comments,
  submitted_at, reviewed_at, reviewed_by, reviewer_comments, reviewer_comment,
  notified_at, notified_month, paid_at, paid_by, created_at, updated_at
)
select distinct on (e.id)
  s.user_id, null, to_char(coalesce(e.expense_date, e.created_at::date), 'YYYY-MM'), e.id, array[e.id],
  coalesce(e.total_amount, 0), s.status, s.comments,
  s.submitted_at, s.reviewed_at, s.reviewed_by, s.reviewer_comments, s.reviewer_comment,
  s.notified_at, s.notified_month, s.paid_at, s.paid_by, s.created_at, now()
from public.expense_submissions s
cross join lateral unnest(s.expense_ids) as x(id)
join public.event_expenses e on e.id = x.id::uuid and e.user_id = s.user_id and e.event_id is null
where s.event_id is null and s.expense_id is null
order by e.id, s.submitted_at desc;

-- 2. Les déclarations mensuelles disparaissent.
delete from public.expense_submissions where event_id is null and expense_id is null;

-- 3. Contraintes : une déclaration par dépense ; hors événement ⇒ une dépense.
create unique index if not exists unique_line_expense_submission
  on public.expense_submissions (expense_id) where expense_id is not null;
alter table public.expense_submissions drop constraint if exists expense_submissions_target_check;
alter table public.expense_submissions add constraint expense_submissions_target_check
  check (event_id is not null or expense_id is not null);

comment on column public.expense_submissions.expense_id is
  'Dépense hors événement déclarée seule (event_id nul) — voir sql/2026-11-10_expenses_per_line.sql';

commit;
