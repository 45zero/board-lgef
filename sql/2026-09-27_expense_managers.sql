-- Qui peut régler les responsables N+1 des frais : les administrateurs, plus les personnes listées ici
-- (paramétrable par un administrateur dans Frais → Responsables N+1).
alter table public.board_settings add column if not exists expense_manager_ids uuid[] not null default '{}';
