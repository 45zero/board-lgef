-- Espace Team : mentions @ (commentaires, checklist, description) et notifications plus claires.
--
-- 1. Assignation : le titre de la notification dit qui, quoi et quelle carte, comme les autres
--    notifications de carte (« Prénom Nom vous a assigné la carte « … » »), le message donne l'échéance.
-- 2. Personne mentionnée qui n'est pas encore membre de la carte : elle est ajoutée pour pouvoir
--    l'ouvrir, sans recevoir en plus « vous a assigné » — elle reçoit seulement « vous a identifié
--    dans … ». team_add_members_quietly pose un réglage local à la transaction que le déclencheur lit.
--    security invoker : les règles d'insertion de team_card_members s'appliquent comme d'habitude
--    (seul qui peut modifier la carte ajoute des membres, assigned_by = soi).

begin;

create or replace function public.team_on_member_added()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_card team_cards%rowtype;
  v_actor text;
begin
  select * into v_card from team_cards where id = new.card_id;
  perform team_add_event_participants(v_card.event_id, array[new.user_id]);
  if new.assigned_by is distinct from new.user_id
     and coalesce(current_setting('lgef.team_quiet', true), '') <> 'on' then
    select coalesce(nullif(btrim(concat_ws(' ', first_name, last_name)), ''), email) into v_actor
      from profiles where id = new.assigned_by;
    perform create_notification(
      new.user_id, 'card_assigned',
      format('%s vous a assigné la carte « %s »', coalesce(v_actor, 'Quelqu''un'), v_card.title),
      case
        when v_card.due_at is not null
          then format('Échéance : %s', to_char(v_card.due_at at time zone 'Europe/Paris', 'DD/MM/YYYY à HH24:MI'))
        else 'Ouvrez la carte pour voir la description et la checklist.'
      end,
      jsonb_build_object('team_card_id', v_card.id),
      v_actor
    );
  end if;
  return new;
end;
$$;

create or replace function public.team_add_members_quietly(p_card uuid, p_users uuid[])
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform set_config('lgef.team_quiet', 'on', true);
  insert into team_card_members (card_id, user_id, assigned_by)
  select p_card, u, auth.uid() from unnest(p_users) u
  where not exists (select 1 from team_card_members m where m.card_id = p_card and m.user_id = u);
  perform set_config('lgef.team_quiet', 'off', true);
end;
$$;

revoke all on function public.team_add_members_quietly(uuid, uuid[]) from public, anon;
grant execute on function public.team_add_members_quietly(uuid, uuid[]) to authenticated;

commit;
