-- Évènements « Perso » (event_type 'kanban') visibles uniquement par leur créateur.
--
-- Les policies existantes sur events sont permissives (OR) : ev_select_all_safe (true) laisse
-- tout utilisateur connecté lire tous les évènements, ev_manage_admins donne tout aux admins.
-- Une policy RESTRICTIVE s'ajoute en ET à toutes les autres : un évènement Perso n'est lisible,
-- modifiable ou supprimable que par created_by — admins compris. Les cartes kanban de l'Espace
-- Team ont event_type NULL et ne sont pas concernées (NULL is distinct from 'kanban').
-- Le client service (server actions, crons) contourne la RLS : filtré côté code.

create policy ev_perso_owner_only on public.events
  as restrictive
  for all
  to public
  using (event_type is distinct from 'kanban'::event_type or created_by = auth.uid())
  with check (event_type is distinct from 'kanban'::event_type or created_by = auth.uid());

-- Vues sur events exposées à l'API (héritées de calendrier-lgef, non utilisées par le board) :
-- en mode propriétaire elles contournent la RLS. Passées en security_invoker pour qu'elles
-- appliquent les droits de la personne qui lit.
alter view public.events_calendar set (security_invoker = on);
alter view public.events_calendar_view set (security_invoker = on);
alter view public.events_calendar_for_user set (security_invoker = on);
alter view public.events_calendar_with_latest_coverage set (security_invoker = on);
alter view public.coverage_requests_with_event set (security_invoker = on);
