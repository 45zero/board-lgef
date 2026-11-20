-- Fermeture des tables encore modifiables par tout compte connecté (suite de l'audit des rôles du
-- 20/11/2026 et de sql/2026-11-20_events_edition_restreinte.sql). Lecture inchangée partout.
--
-- Deux droits communs :
--   can_manage_event_team(événement, personne) : peut gérer l'équipe = peut modifier l'événement
--     (can_edit_event : admin, créateur, organisateur, pôle, coordination médias) ou responsable de
--     son équipe (18 responsables actuels sont organisateurs d'un autre pôle : ils gardent la main).
--   can_contribute_event(événement, personne) : participe à l'événement = peut le modifier, membre de
--     l'équipe, assigné, vidéaste de la captation (non refusée), photographe de la mission, ou
--     publicateur (module Audiovisuel). Vérifié sur 4 mois : tous les dépôts de fichiers (189) viennent
--     de ces personnes.
--
-- 1. event_team_members (ouverte en lecture ET écriture à tous) : ajout / changement / retrait par
--    can_manage_event_team ; chacun peut se retirer lui-même. Les membres de cartes Team restent
--    ajoutés par team_add_event_participants (security definer, non concernée).
--    Écran (useEventTeam) : la passation de responsable nomme le nouveau AVANT de retirer l'ancien.
-- 2. event_assignments : n'importe qui pouvait s'assigner (et donc voir l'événement dans ses frais à
--    déclarer, l'Effectif, les indemnités kilométriques). Création / modification / suppression :
--    can_edit_event, en plus des règles admins et coordination médias existantes. Le board n'en crée
--    plus lui-même (héritage du calendrier).
-- 3. event_discussion_participants : chacun n'ajoute et ne modifie que sa propre ligne.
-- 4. event_files : dépôt réservé aux participants (can_contribute_event) ; modification (publish_info,
--    dossier) par admins, publicateurs, l'auteur du dépôt ou qui peut modifier l'événement.
--    Suppression : règle existante inchangée.
-- 5. media_publications : création par admins, publicateurs ou participants de l'événement (création
--    automatique au dépôt d'une photo / vidéo) ; modification et suppression par admins, publicateurs
--    ou l'auteur. Sur 4 mois, toutes les publications viennent d'admins, de publicateurs ou du serveur.
-- 6. comment_moderation : décisions de modération par admins et publicateurs (écran : requirePublisher ;
--    le robot passe par le serveur).
-- 7. Anciennes cartes Trello (card_checklists, card_checklist_items, card_labels) : plus utilisées par
--    le board (dernière écriture 04/2026) — lecture pour tous, écriture administrateurs seulement.
-- Non touché : quiz_participants (appli Quiz, scores des joueurs).
--
-- Retour arrière : recréer les règles supprimées (définitions en commentaire au-dessus de chaque
-- « drop policy »), puis supprimer les nouvelles (préfixes etm_, ea_, edp_, ef_, mp_, cm_, legacy_).

begin;

create or replace function public.can_manage_event_team(p_event uuid, p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and (
    public.can_edit_event(p_event, p_uid)
    or exists (select 1 from event_team_members t where t.event_id = p_event and t.user_id = p_uid and t.role = 'responsable')
  );
$$;

create or replace function public.can_contribute_event(p_event uuid, p_uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select p_uid is not null and p_event is not null and (
    public.can_edit_event(p_event, p_uid)
    or exists (select 1 from event_team_members t where t.event_id = p_event and t.user_id = p_uid)
    or exists (select 1 from event_assignments a where a.event_id = p_event and a.user_id = p_uid)
    or exists (select 1 from coverage_requests c
                where c.event_id = p_event and coalesce(c.assigned_technician_id, c.technician_id) = p_uid
                  and c.technician_response is distinct from 'rejected')
    or exists (select 1 from photo_missions m where m.event_id = p_event and m.photographer_id = p_uid)
    or public.can_see_module(p_uid, 'audiovisuel')
  );
$$;

revoke all on function public.can_manage_event_team(uuid, uuid), public.can_contribute_event(uuid, uuid) from public, anon;
grant execute on function public.can_manage_event_team(uuid, uuid), public.can_contribute_event(uuid, uuid) to authenticated;

-- 1. Équipes ------------------------------------------------------------------------------------------
-- était : "Authenticated users can manage event team members" for all to authenticated using (true) with check (true)
drop policy if exists "Authenticated users can manage event team members" on public.event_team_members;
drop policy if exists etm_select on public.event_team_members;
drop policy if exists etm_insert on public.event_team_members;
drop policy if exists etm_update on public.event_team_members;
drop policy if exists etm_delete on public.event_team_members;
create policy etm_select on public.event_team_members for select to authenticated using (true);
create policy etm_insert on public.event_team_members for insert to authenticated
  with check (public.can_manage_event_team(event_id, (select auth.uid())));
create policy etm_update on public.event_team_members for update to authenticated
  using (public.can_manage_event_team(event_id, (select auth.uid())))
  with check (public.can_manage_event_team(event_id, (select auth.uid())));
create policy etm_delete on public.event_team_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.can_manage_event_team(event_id, (select auth.uid())));

-- 2. Assignations -------------------------------------------------------------------------------------
-- étaient : "allow insert event assignments" for insert to authenticated with check (true) ;
--           "allow update event assignments" for update to authenticated using (true) with check (true)
drop policy if exists "allow insert event assignments" on public.event_assignments;
drop policy if exists "allow update event assignments" on public.event_assignments;
drop policy if exists ea_write_editors on public.event_assignments;
create policy ea_write_editors on public.event_assignments for all to authenticated
  using (public.can_edit_event(event_id, (select auth.uid())))
  with check (public.can_edit_event(event_id, (select auth.uid())));

-- 3. Participants aux discussions ---------------------------------------------------------------------
-- étaient : "allow insert discussion participants for event" for insert to authenticated with check (auth.uid() is not null) ;
--           "allow update discussion participants" for update to authenticated using (auth.uid() is not null) with check (auth.uid() is not null)
drop policy if exists "allow insert discussion participants for event" on public.event_discussion_participants;
drop policy if exists "allow update discussion participants" on public.event_discussion_participants;
drop policy if exists edp_update_own on public.event_discussion_participants;
create policy edp_update_own on public.event_discussion_participants for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- « anyone can upsert their presence » (insert de sa propre ligne) est gardée.

-- 4. Fichiers d'événement -----------------------------------------------------------------------------
-- étaient : "Allow authenticated users to insert event files" for insert to authenticated with check (auth.uid() is not null) ;
--           event_files_insert (admin, super user, tech-salarie) ;
--           "Users can update publish_info on event_files" for update using (auth.uid() is not null) with check (auth.uid() is not null)
drop policy if exists "Allow authenticated users to insert event files" on public.event_files;
drop policy if exists event_files_insert on public.event_files;
drop policy if exists "Users can update publish_info on event_files" on public.event_files;
drop policy if exists ef_insert_contributors on public.event_files;
drop policy if exists ef_update on public.event_files;
create policy ef_insert_contributors on public.event_files for insert to authenticated
  with check (public.is_admin_or_super((select auth.uid())) or public.can_contribute_event(event_id, (select auth.uid())));
create policy ef_update on public.event_files for update to authenticated
  using (
    public.is_admin_or_super((select auth.uid())) or public.can_see_module((select auth.uid()), 'audiovisuel')
    or uploaded_by = (select auth.uid()) or public.can_edit_event(event_id, (select auth.uid()))
  )
  with check (
    public.is_admin_or_super((select auth.uid())) or public.can_see_module((select auth.uid()), 'audiovisuel')
    or uploaded_by = (select auth.uid()) or public.can_edit_event(event_id, (select auth.uid()))
  );

-- 5. Publications médias ------------------------------------------------------------------------------
-- étaient : media_publications_insert / _update (auth.uid() is not null), media_publications_delete (auth.uid() is not null)
drop policy if exists media_publications_insert on public.media_publications;
drop policy if exists media_publications_update on public.media_publications;
drop policy if exists media_publications_delete on public.media_publications;
drop policy if exists mp_insert on public.media_publications;
drop policy if exists mp_update on public.media_publications;
drop policy if exists mp_delete on public.media_publications;
create policy mp_insert on public.media_publications for insert to authenticated
  with check (
    public.is_admin_or_super((select auth.uid())) or public.can_see_module((select auth.uid()), 'audiovisuel')
    or public.can_contribute_event(event_id, (select auth.uid()))
  );
create policy mp_update on public.media_publications for update to authenticated
  using (public.is_admin_or_super((select auth.uid())) or public.can_see_module((select auth.uid()), 'audiovisuel') or created_by = (select auth.uid()))
  with check (public.is_admin_or_super((select auth.uid())) or public.can_see_module((select auth.uid()), 'audiovisuel') or created_by = (select auth.uid()));
create policy mp_delete on public.media_publications for delete to authenticated
  using (public.is_admin_or_super((select auth.uid())) or public.can_see_module((select auth.uid()), 'audiovisuel') or created_by = (select auth.uid()));

-- 6. Modération des commentaires ----------------------------------------------------------------------
-- était : comment_moderation_update for update using (auth.uid() is not null) with check (auth.uid() is not null)
drop policy if exists comment_moderation_update on public.comment_moderation;
drop policy if exists cm_update_publishers on public.comment_moderation;
create policy cm_update_publishers on public.comment_moderation for update to authenticated
  using (public.is_admin_or_super((select auth.uid())) or public.can_see_module((select auth.uid()), 'audiovisuel'))
  with check (public.is_admin_or_super((select auth.uid())) or public.can_see_module((select auth.uid()), 'audiovisuel'));

-- 7. Anciennes cartes Trello --------------------------------------------------------------------------
-- étaient : card_checklists_all_auth / card_checklist_items_all_auth (all, auth.uid() is not null) ;
--           card_labels_write_auth (all, true)
drop policy if exists card_checklists_all_auth on public.card_checklists;
drop policy if exists card_checklist_items_all_auth on public.card_checklist_items;
drop policy if exists card_labels_write_auth on public.card_labels;
drop policy if exists legacy_read on public.card_checklists;
drop policy if exists legacy_read on public.card_checklist_items;
drop policy if exists legacy_admin on public.card_checklists;
drop policy if exists legacy_admin on public.card_checklist_items;
drop policy if exists legacy_admin on public.card_labels;
create policy legacy_read on public.card_checklists for select to authenticated using (true);
create policy legacy_read on public.card_checklist_items for select to authenticated using (true);
create policy legacy_admin on public.card_checklists for all to authenticated
  using (public.is_admin_or_super((select auth.uid()))) with check (public.is_admin_or_super((select auth.uid())));
create policy legacy_admin on public.card_checklist_items for all to authenticated
  using (public.is_admin_or_super((select auth.uid()))) with check (public.is_admin_or_super((select auth.uid())));
create policy legacy_admin on public.card_labels for all to authenticated
  using (public.is_admin_or_super((select auth.uid()))) with check (public.is_admin_or_super((select auth.uid())));
-- card_labels garde sa règle « Users can manage card labels for their cards » (cartes dont on est membre).

commit;
