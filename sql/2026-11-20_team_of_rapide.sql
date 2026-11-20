-- Audit de vitesse du 20/11/2026, point 5 : team_of (« mon équipe » : mes N-1 directs et indirects, plus
-- les équipes des personnes qui m'ont délégué l'action) recalculait la chaîne hiérarchique de CHAQUE
-- compte (in_line_of pour 90 profils) : 59 ms par appel, des milliers d'appels par jour (tableau de bord,
-- pastilles, Frais). Nouvelle version : on descend directement depuis la personne (et depuis ses
-- délégants), 10 niveaux au plus, arrêt sur boucle — 2 ms.
--
-- Mêmes règles, mêmes résultats : comparé avant application sur les 90 comptes × 5 actions (frais,
-- comptes, pointages, factures, hiérarchie seule) — 450 cas sur 450 identiques.
-- Remplacement sur place (create or replace) : même signature, mêmes droits, rien n'est supprimé ;
-- in_line_of, can_approve et manager_chain restent inchangées.
-- Retour arrière : create or replace function public.team_of(p_action text, p_uid uuid) returns setof uuid
--   language sql stable security definer set search_path = public as $$
--   select p.id from profiles p where public.in_line_of(p_action, p_uid, p.id); $$;

create or replace function public.team_of(p_action text, p_uid uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with recursive edges as (
    -- Une ligne par personne : son N+1 calculé (individuel, sinon responsable du service).
    select p.id, public.manager_of(p.id) as mgr, p.home_service from profiles p
  ),
  roots as (
    -- Départ : moi, et chaque personne qui m'a délégué l'action (active aujourd'hui, heure de Paris).
    select p_uid as root, null::text as svc_filter
    union all
    select d.delegator_id, d.service_key from approval_delegations d
     where p_action is not null and d.delegate_id = p_uid and d.action = p_action
       and (d.starts_on is null or d.starts_on <= (now() at time zone 'Europe/Paris')::date)
       and (d.ends_on is null or d.ends_on >= (now() at time zone 'Europe/Paris')::date)
  ),
  down(root, svc_filter, id, depth, path) as (
    -- Descente N-1, N-2… depuis chaque départ : 10 niveaux au plus, arrêt sur boucle (comme manager_chain).
    select r.root, r.svc_filter, e.id, 1, array[r.root, e.id]
      from roots r join edges e on e.mgr = r.root
     where e.id <> r.root
    union all
    select d.root, d.svc_filter, e.id, d.depth + 1, d.path || e.id
      from down d join edges e on e.mgr = d.id
     where d.depth < 10 and not e.id = any(d.path)
  )
  select distinct dn.id
    from down dn join edges e on e.id = dn.id
   where dn.id <> p_uid
     -- Délégation limitée à un service : seulement les personnes de ce service.
     and (dn.svc_filter is null or dn.svc_filter is not distinct from e.home_service);
$$;
