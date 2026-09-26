-- Gestion des frais du board : chaque utilisateur a un responsable N+1 qui valide ses déclarations.
-- Les déclarations restent celles de l'appli calendrier (expense_submissions : non_declare → pending
-- → approved / rejected) ; leurs écritures passent par des actions serveur du board qui vérifient
-- elles-mêmes les droits (la personne, son N+1, un admin), sans toucher aux règles RLS partagées.

begin;

alter table public.profiles
  add column if not exists expense_validator_id uuid references public.profiles(id) on delete set null;

create index if not exists profiles_expense_validator_idx on public.profiles (expense_validator_id);

commit;

alter type public.notification_type add value if not exists 'expense_to_validate';

-- Statuts supplémentaires : 'no_expense' (« pas de frais » déclaré depuis le board, sort l'événement
-- de la liste à déclarer) et 'non_declare' (utilisé par l'appli calendrier, refusé jusqu'ici par la contrainte).
alter table public.expense_submissions drop constraint if exists expense_submissions_status_check;
alter table public.expense_submissions add constraint expense_submissions_status_check
  check (status = any (array['pending', 'approved', 'rejected', 'revision_requested', 'no_expense', 'non_declare']));
