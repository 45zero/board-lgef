-- Frais hors événement : les lignes (event_expenses.event_id déjà nullable) sont déclarées au N+1
-- par mois, via une déclaration sans événement identifiée par period_month ('YYYY-MM').
alter table public.expense_submissions alter column event_id drop not null;
alter table public.expense_submissions add column if not exists period_month text;
create unique index if not exists unique_month_user_expense
  on public.expense_submissions (user_id, period_month) where event_id is null;
alter table public.expense_submissions drop constraint if exists expense_submissions_target_check;
alter table public.expense_submissions add constraint expense_submissions_target_check
  check (event_id is not null or period_month ~ '^\d{4}-\d{2}$');
