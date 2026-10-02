-- Effectif (module « effectif » du board) : tarif des prestataires et coût des interventions.
--
--  * staff_rates : forfait par intervention d'une personne (prestataire), en euros ;
--  * event_cost_adjustments : montant ajusté pour une personne sur un événement précis (journée
--    complète…), qui remplace le forfait sur cet événement.
-- Le coût n'est pas stocké : il se calcule (src/app/actions/staff.ts) à partir des sollicitations
-- (équipe de l'événement, assignation, captation, match photo pris — src/lib/board/solicitation.ts).
-- Lecture et écriture : la personne concernée lit son propre tarif ; son N+1
-- (profiles.expense_validator_id) et les administrateurs lisent et modifient.
-- À appliquer à la main sur le projet Supabase partagé, après accord.

begin;

create table if not exists public.staff_rates (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  amount_eur numeric(8, 2) not null check (amount_eur >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.event_cost_adjustments (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount_eur numeric(8, 2) not null check (amount_eur >= 0),
  note text,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index if not exists event_cost_adjustments_user_idx on public.event_cost_adjustments (user_id);

-- p_uid gère les coûts de p_user : son N+1, ou un administrateur.
create or replace function public.can_manage_staff_cost(p_user uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin_or_super(p_uid)
      or exists (select 1 from profiles p where p.id = p_user and p.expense_validator_id = p_uid);
$$;

alter table public.staff_rates enable row level security;
alter table public.event_cost_adjustments enable row level security;

drop policy if exists staff_rates_select on public.staff_rates;
create policy staff_rates_select on public.staff_rates for select
  using (user_id = auth.uid() or can_manage_staff_cost(user_id, auth.uid()));
drop policy if exists staff_rates_write on public.staff_rates;
create policy staff_rates_write on public.staff_rates for all
  using (can_manage_staff_cost(user_id, auth.uid())) with check (can_manage_staff_cost(user_id, auth.uid()));

drop policy if exists event_cost_adjustments_select on public.event_cost_adjustments;
create policy event_cost_adjustments_select on public.event_cost_adjustments for select
  using (user_id = auth.uid() or can_manage_staff_cost(user_id, auth.uid()));
drop policy if exists event_cost_adjustments_write on public.event_cost_adjustments;
create policy event_cost_adjustments_write on public.event_cost_adjustments for all
  using (can_manage_staff_cost(user_id, auth.uid())) with check (can_manage_staff_cost(user_id, auth.uid()));

commit;

notify pgrst, 'reload schema';
