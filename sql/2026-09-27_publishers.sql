-- Centre de publication : personnes habilitées à publier (en plus des administrateurs). Elles seules
-- voient le centre et sont notifiées quand un média est « à publier ».
alter table public.board_settings add column if not exists publisher_ids uuid[] not null default '{}';

alter type public.notification_type add value if not exists 'publication_to_publish';

-- Notification in-app aux personnes habilitées quand une publication passe « à publier », quel que
-- soit le chemin (board, ancienne appli, dépôt de fichiers). Un dépôt de 50 photos crée 50
-- publications : au plus une notification non lue par personne et par événement.
create or replace function public.notify_publishers_to_publish() returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ids uuid[];
  label text;
begin
  if new.status is distinct from 'to_publish' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'to_publish' then return new; end if;

  select publisher_ids into ids from board_settings where id = true;
  if ids is null or cardinality(ids) = 0 then return new; end if;

  select title into label from events where id = new.event_id;
  label := coalesce(label, new.title, 'Publication directe');

  insert into notifications (user_id, type, title, message, event_id, data)
  select uid,
         'publication_to_publish',
         'Média à publier',
         label || ' — de nouveaux médias attendent dans le centre de publication.',
         new.event_id,
         jsonb_build_object('publication_id', new.id, 'event_id', new.event_id)
  from unnest(ids) as uid
  where uid is distinct from new.created_by
    and not exists (
      select 1 from notifications n
      where n.user_id = uid
        and n.type = 'publication_to_publish'
        and n.read is not true
        and n.event_id is not distinct from new.event_id
    );
  return new;
end;
$$;

drop trigger if exists trg_notify_publishers_to_publish on public.media_publications;
create trigger trg_notify_publishers_to_publish
  after insert or update of status on public.media_publications
  for each row execute function public.notify_publishers_to_publish();
