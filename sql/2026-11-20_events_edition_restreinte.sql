-- Événements : fin de la modification ouverte à tous (audit des rôles du 20/11/2026).
--
-- Constat : la règle ev_update_all_authenticated (UPDATE … using true) laissait tout compte connecté —
-- prestataires et bénévoles compris — modifier n'importe quel événement hors Perso, et la fiche s'ouvre
-- en mode modifiable pour tout le monde. N'importe qui pouvait aussi créer un « match du week-end ».
--
-- 1. can_edit_event(événement, personne) : peut modifier un événement
--      - un administrateur / super user,
--      - son créateur ou son organisateur désigné,
--      - une personne qui a le pôle de l'événement (mêmes types que pour la création),
--      - la coordination médias (statut Salarié, tech-salarie).
--    Pas les membres d'équipe : event_team_members est encore ouverte en écriture à tous (n'importe qui
--    pourrait s'y ajouter pour obtenir le droit) — à fermer dans un second temps.
--    Perso : inchangé, toujours réservé à son auteur (ev_perso_owner_only, restrictive).
-- 2. ev_update_all_authenticated remplacée par ev_update_editors (can_edit_event).
-- 3. « Captation demandée » : la demande de captation coche elle-même requires_coverage sur
--    l'événement (déclencheur security definer). Un organisateur qui demande une captation pour un
--    événement d'un autre pôle n'a plus besoin de pouvoir le modifier ; la mise à jour faite par
--    l'écran ne touche simplement aucune ligne pour lui, sans erreur.
-- 5. Demande de captation : plus le comité directeur seul (décision de Giovanni du 20/11/2026).
--    Restent : administrateurs, organisateurs, coordination médias (statut Salarié) — donc un membre
--    du comité à qui l'on donne la coordination médias (le président, par exemple) peut toujours
--    demander. L'organisateur désigné de l'événement aussi (covreq_insert_admin_any, inchangée).
--    request_coverage (fonction security definer jamais appelée par le board, qui contournait ces
--    règles) n'est plus exécutable par les comptes connectés.
-- 4. Création d'un « match du week-end » : administrateurs et coordination médias seulement
--    (comme dans l'écran Week-end ; toutes les créations de l'an passé viennent d'un administrateur).
--
-- Vérifié sur les 6 derniers mois : les modifications faites par quelqu'un d'autre que le créateur
-- venaient d'administrateurs, de personnes du pôle ou de la coordination, sauf une dizaine faites par
-- des vidéastes / photographes assignés ou des membres d'équipe en enregistrant la fiche (rappels
-- personnels). Côté écran (useEventActions.updateEvent), leurs rappels et présences restent enregistrés ;
-- un message dit seulement que les autres changements n'ont pas été pris en compte.
--
-- Retour arrière :
--   drop policy ev_update_editors on public.events;
--   create policy ev_update_all_authenticated on public.events for update to authenticated using (true);
--   drop policy ev_insert_match_weekend on public.events;
--   create policy ev_insert_match_weekend on public.events for insert to authenticated with check (event_type = 'match_du_week_end');
--   drop trigger trg_coverage_request_marks_event on public.coverage_requests;
--   recréer covreq_insert_allowed_roles avec « or has_role(auth.uid(), 'comite_directeur') » ;
--   grant execute on function public.request_coverage to authenticated;

begin;

create or replace function public.can_edit_event(p_event uuid, p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and exists (
    select 1 from events e
     where e.id = p_event
       and (
         public.is_admin_or_super(p_uid)
         or e.created_by = p_uid
         or e.organizer_id = p_uid
         or exists (select 1 from allowed_event_types_for_user a where a.user_id = p_uid and a.event_type = e.event_type)
         or public.has_specialty_slugs(p_uid, array['tech-salarie'])
       )
  );
$$;

revoke all on function public.can_edit_event(uuid, uuid) from public, anon;
grant execute on function public.can_edit_event(uuid, uuid) to authenticated;

drop policy if exists ev_update_all_authenticated on public.events;
drop policy if exists ev_update_editors on public.events;
create policy ev_update_editors on public.events for update to authenticated
  using (public.can_edit_event(id, (select auth.uid())))
  with check (public.can_edit_event(id, (select auth.uid())));

create or replace function public.coverage_request_marks_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update events set requires_coverage = true
   where id = new.event_id and requires_coverage is distinct from true;
  return new;
end;
$$;

drop trigger if exists trg_coverage_request_marks_event on public.coverage_requests;
create trigger trg_coverage_request_marks_event
  after insert on public.coverage_requests
  for each row execute function public.coverage_request_marks_event();

drop policy if exists ev_insert_match_weekend on public.events;
create policy ev_insert_match_weekend on public.events for insert to authenticated
  with check (
    event_type = 'match_du_week_end'
    and (public.is_admin_or_super((select auth.uid())) or public.has_specialty_slugs((select auth.uid()), array['tech-salarie']))
  );

drop policy if exists covreq_insert_allowed_roles on public.coverage_requests;
create policy covreq_insert_allowed_roles on public.coverage_requests for insert to authenticated
  with check (
    requester_id = (select auth.uid())
    and (
      public.is_admin_or_super((select auth.uid()))
      or public.has_role((select auth.uid()), 'organizer'::text)
      or public.has_specialty_slugs((select auth.uid()), array['tech-salarie'])
    )
  );

do $$
declare f regprocedure;
begin
  for f in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'request_coverage' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

commit;
