-- Hiérarchie N+1 (suite de 2026-11-19_hierarchie_n1.sql) : équipe d'un responsable et N+1 calculé.
--
-- * in_line_of(action, uid, personne) : uid est au-dessus de la personne (N+1, N+2…) ou délégataire
--   actif de quelqu'un au-dessus d'elle pour l'action — sans le passe-droit administrateur.
--   action NULL : hiérarchie seule (Effectif, fiches d'équipe), aucune délégation.
-- * can_approve = administrateur ou in_line_of (même résultat qu'avant, factorisé).
-- * team_of(action, uid) : les personnes concernées (« mes N-1 », directs et indirects).
-- * Vue profile_managers : N+1 calculé de chaque compte (individuel sinon responsable du service),
--   pour les listes et l'affichage. Lecture pour les comptes connectés uniquement.
-- * Type de notification « delegation » (délégation reçue).

alter type public.notification_type add value if not exists 'delegation';

begin;

create or replace function public.in_line_of(p_action text, p_uid uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and p_uid is distinct from p_user and (
    exists (select 1 from public.manager_chain(p_user) c where c.user_id = p_uid)
    or (p_action is not null and p_uid in (
      select public.active_delegates(
        array(select c.user_id from public.manager_chain(p_user) c),
        p_action,
        (select home_service from profiles where id = p_user))
    ))
  );
$$;

create or replace function public.can_approve(p_action text, p_uid uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and p_uid is distinct from p_user
     and (public.is_admin_or_super(p_uid) or public.in_line_of(p_action, p_uid, p_user));
$$;

create or replace function public.team_of(p_action text, p_uid uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select p.id from profiles p where public.in_line_of(p_action, p_uid, p.id);
$$;

create or replace view public.profile_managers as
  select p.id as user_id, public.manager_of(p.id) as manager_id, p.home_service, p.expense_validator_id as manager_override
    from public.profiles p;

revoke all on public.profile_managers from public, anon;
grant select on public.profile_managers to authenticated;
revoke all on function public.in_line_of(text, uuid, uuid), public.team_of(text, uuid) from public, anon;

commit;
