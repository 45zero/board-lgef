-- Attribution d'une publication (vidéo, album…) à une personne chargée de la publier.
--   • media_publications.assigned_to : la personne attribuée (null = personne en particulier).
--   • Par défaut, une publication d'un événement créé par l'une des personnes de
--     board_settings.publication_self_assign_creators lui est attribuée (Anthony Drouhin) ; on peut
--     ensuite la réattribuer (événement ou centre de publication).
--   • Notification « Média à publier » : si la publication est attribuée, seule la personne
--     attribuée est prévenue (au lieu de tous les publicateurs).
-- Ajouts uniquement ; aucune donnée existante modifiée.

begin;

alter table public.media_publications
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null;
create index if not exists media_publications_assigned_to_idx on public.media_publications (assigned_to) where assigned_to is not null;

alter table public.board_settings
  add column if not exists publication_self_assign_creators uuid[] not null default '{}';

-- Anthony Drouhin : ses événements lui sont attribués par défaut.
update public.board_settings
set publication_self_assign_creators = array(select distinct unnest(publication_self_assign_creators || '070fe01c-43ac-4740-91f2-d6f9e00c4aac'::uuid));

-- Attribution par défaut à la création.
create or replace function public.publication_default_assignee()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  creator uuid;
begin
  if new.assigned_to is not null or new.event_id is null then return new; end if;
  select e.created_by into creator from events e where e.id = new.event_id;
  if creator is not null and exists (
    select 1 from board_settings s where creator = any(s.publication_self_assign_creators)
  ) then
    new.assigned_to := creator;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_publication_default_assignee on public.media_publications;
create trigger trg_publication_default_assignee
  before insert on public.media_publications
  for each row execute function public.publication_default_assignee();

-- Notification « Média à publier » : la personne attribuée seulement, sinon tous les publicateurs.
create or replace function public.notify_publishers_to_publish()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  label text;
begin
  if new.status is distinct from 'to_publish' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'to_publish' then return new; end if;

  select title into label from events where id = new.event_id;
  label := coalesce(label, new.title, 'Publication directe');

  insert into notifications (user_id, type, title, message, event_id, data)
  select p.id,
         'publication_to_publish',
         'Média à publier',
         label || case when new.assigned_to is not null
                       then ' — un média vous est attribué dans le centre de publication.'
                       else ' — de nouveaux médias attendent dans le centre de publication.' end,
         new.event_id,
         jsonb_build_object('publication_id', new.id, 'event_id', new.event_id)
  from profiles p
  where (
      (new.assigned_to is not null and p.id = new.assigned_to)
      or (new.assigned_to is null
          and exists (select 1 from module_access m where m.module_id = 'audiovisuel')
          and public.module_rule_matches(p.id, 'audiovisuel'))
    )
    and p.id is distinct from new.created_by
    and not exists (
      select 1 from notifications n
      where n.user_id = p.id
        and n.type = 'publication_to_publish'
        and n.read is not true
        and n.event_id is not distinct from new.event_id
    );
  return new;
end;
$function$;

-- Personnes à qui l'on peut attribuer une publication : celles qui voient le centre de publication.
create or replace function public.publication_assignee_candidates()
returns table (id uuid, first_name text, last_name text, email text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.id, p.first_name, p.last_name, p.email
  from profiles p
  where public.can_see_module(p.id, 'audiovisuel')
  order by p.first_name, p.last_name;
$$;
revoke all on function public.publication_assignee_candidates() from public, anon;
grant execute on function public.publication_assignee_candidates() to authenticated, service_role;

commit;
