-- Règle du N-1 partout, administrateurs compris : on ne valide jamais (et on n'est jamais prévenu
-- pour) une personne qui est au-dessus de soi (son N+1, son N+2…).
--
-- Constat du 20/11 : Giovanni Verna (super_user) voyait et pouvait valider les frais de Sébastien
-- Moreira, son N+1, parce que can_approve laissait passer tout administrateur, et Sébastien n'ayant
-- pas de N+1, first_approvers prévenait tous les administrateurs, Giovanni compris.
--
-- 1. can_approve : faux si p_user est dans la chaîne au-dessus de p_uid (comptes, frais, pointages,
--    factures — toutes les actions). Le reste est inchangé.
-- 2. first_approvers : sans N+1, les administrateurs prévenus sont ceux qui ne sont pas sous la personne.
--    (Si tous les administrateurs sont sous elle, personne n'est prévenu : à régler en lui donnant un N+1.)
--
-- Côté application (déjà en place, sans attendre ce fichier) : les listes « Tout le monde » du module
-- Frais, le compteur GED, les justificatifs et reviewSubmission excluent déjà la chaîne au-dessus de soi.
--
-- Remplacement de deux fonctions, aucune donnée modifiée.

begin;

create or replace function public.can_approve(p_action text, p_uid uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and p_uid is distinct from p_user
     and not exists (select 1 from public.manager_chain(p_uid) c where c.user_id = p_user)
     and (public.is_admin_or_super(p_uid) or public.in_line_of(p_action, p_uid, p_user));
$$;

create or replace function public.first_approvers(p_action text, p_user uuid)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare
  m uuid := public.manager_of(p_user);
begin
  if m is null then
    return query
      select p.id from profiles p
       where p.role in ('admin', 'super_user') and p.id <> p_user
         and not exists (select 1 from public.manager_chain(p.id) c where c.user_id = p_user);
    return;
  end if;
  return query
    select m
    union
    select public.active_delegates(array[m], p_action, (select home_service from profiles where id = p_user));
end;
$$;

commit;
