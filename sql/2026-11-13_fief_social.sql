-- FIEF — lot 3 : fil d'actualités (publications, photos, commentaires, j'aime, signalements) et
-- messagerie privée entre membres. À appliquer après les migrations FIEF précédentes.
--
-- Écritures : routes /api/fief/* (clé service, après contrôle de la session) — seules routes ouvertes
-- aux comptes FIEF (src/proxy.ts) ; elles envoient aussi notifications et push. Lectures : fonctions
-- fief_* ci-dessous (SECURITY DEFINER, filtrées sur la personne connectée). Les tables n'ont donc que
-- des policies de lecture. Photos : Drive du board (src/lib/fief/storage.ts), jamais dans Supabase.

begin;

-- Fil d'actualités ---------------------------------------------------------------------------------

create table if not exists public.fief_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id) on delete cascade,
  as_team boolean not null default false,             -- publié par l'équipe FIEF (affiché « Équipe FIEF »)
  body text not null default '' check (length(body) <= 5000),
  pinned boolean not null default false,
  hidden_at timestamptz,                              -- masqué par l'équipe FIEF (modération)
  hidden_by uuid references auth.users (id) on delete set null,
  hidden_reason text,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists fief_posts_feed_idx on public.fief_posts (created_at desc) where hidden_at is null;
create index if not exists fief_posts_author_idx on public.fief_posts (author_id);

-- Fichiers (photos) : envoyés avant la publication (post_id nul), rattachés à la publication.
create table if not exists public.fief_media (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid references public.fief_posts (id) on delete cascade,
  storage_id text not null,                           -- identifiant du fichier dans le Drive du board
  mime_type text not null,
  size_bytes bigint not null default 0,
  width int,
  height int,
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists fief_media_post_idx on public.fief_media (post_id, position);
create index if not exists fief_media_orphans_idx on public.fief_media (created_at) where post_id is null;

create table if not exists public.fief_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.fief_posts (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  as_team boolean not null default false,
  body text not null check (length(body) between 1 and 2000),
  hidden_at timestamptz,
  hidden_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists fief_comments_post_idx on public.fief_comments (post_id, created_at);

create table if not exists public.fief_reactions (
  post_id uuid not null references public.fief_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- Messagerie privée (conversations à deux) ----------------------------------------------------------

create table if not exists public.fief_conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create table if not exists public.fief_conversation_members (
  conversation_id uuid not null references public.fief_conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists fief_conversation_members_user_idx on public.fief_conversation_members (user_id);

create table if not exists public.fief_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.fief_conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists fief_messages_conv_idx on public.fief_messages (conversation_id, created_at desc);

-- Signalements (publication, commentaire ou message) → onglet FIEF du board.
create table if not exists public.fief_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  post_id uuid references public.fief_posts (id) on delete cascade,
  comment_id uuid references public.fief_comments (id) on delete cascade,
  message_id uuid references public.fief_messages (id) on delete cascade,
  reason text check (length(reason) <= 1000),
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  check (num_nonnulls(post_id, comment_id, message_id) = 1)
);

create index if not exists fief_reports_open_idx on public.fief_reports (created_at desc) where status = 'open';

-- Notifications : nouveaux types (commentaire, message, publication de l'équipe).
alter table public.fief_notifications drop constraint if exists fief_notifications_kind_check;
alter table public.fief_notifications
  add constraint fief_notifications_kind_check check (kind in ('event', 'membership', 'info', 'comment', 'message', 'post'));

-- RLS : lecture seulement (écritures par les routes /api/fief/*, clé service) ---------------------------

alter table public.fief_posts enable row level security;
alter table public.fief_media enable row level security;
alter table public.fief_comments enable row level security;
alter table public.fief_reactions enable row level security;
alter table public.fief_reports enable row level security;
alter table public.fief_conversations enable row level security;
alter table public.fief_conversation_members enable row level security;
alter table public.fief_messages enable row level security;

drop policy if exists fief_posts_read on public.fief_posts;
create policy fief_posts_read on public.fief_posts for select to authenticated
  using ((select public.fief_is_manager()) or ((select public.fief_is_member()) and (hidden_at is null or author_id = (select auth.uid()))));

drop policy if exists fief_media_read on public.fief_media;
create policy fief_media_read on public.fief_media for select to authenticated
  using ((select public.fief_is_manager()) or ((select public.fief_is_member()) and (post_id is not null or uploader_id = (select auth.uid()))));

drop policy if exists fief_comments_read on public.fief_comments;
create policy fief_comments_read on public.fief_comments for select to authenticated
  using ((select public.fief_is_manager()) or ((select public.fief_is_member()) and (hidden_at is null or author_id = (select auth.uid()))));

drop policy if exists fief_reactions_read on public.fief_reactions;
create policy fief_reactions_read on public.fief_reactions for select to authenticated
  using ((select public.fief_is_manager()) or (select public.fief_is_member()));

drop policy if exists fief_reports_manager on public.fief_reports;
create policy fief_reports_manager on public.fief_reports for select to authenticated
  using ((select public.fief_is_manager()));

-- Conversations : uniquement les deux participantes (l'équipe FIEF ne lit pas les messages privés,
-- sauf un message signalé, montré dans le signalement).
create or replace function public.fief_in_conversation(p_conversation uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.fief_conversation_members c where c.conversation_id = p_conversation and c.user_id = auth.uid())
$$;

drop policy if exists fief_conversations_read on public.fief_conversations;
create policy fief_conversations_read on public.fief_conversations for select to authenticated
  using (public.fief_in_conversation(id));
drop policy if exists fief_conversation_members_read on public.fief_conversation_members;
create policy fief_conversation_members_read on public.fief_conversation_members for select to authenticated
  using (public.fief_in_conversation(conversation_id));
drop policy if exists fief_messages_read on public.fief_messages;
create policy fief_messages_read on public.fief_messages for select to authenticated
  using (public.fief_in_conversation(conversation_id));

-- Lectures --------------------------------------------------------------------------------------------

-- Nom affiché d'une autrice : membre FIEF, sinon « Équipe FIEF » (personne du board).
create or replace function public.fief_author(p_user uuid, p_as_team boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_as_team or m.user_id is null then jsonb_build_object('id', p_user, 'name', 'Équipe FIEF', 'club', null, 'team', true)
    else jsonb_build_object('id', m.user_id, 'name', m.first_name || ' ' || m.last_name, 'club', m.club_name, 'team', false)
  end
  from (select 1) one
  left join public.fief_members m on m.user_id = p_user
$$;

revoke execute on function public.fief_author(uuid, boolean) from public, anon, authenticated;

-- Fil : publications visibles, les épinglées d'abord (première page), puis par date.
create or replace function public.fief_feed(p_before timestamptz default null, p_limit int default 20)
returns table (
  id uuid,
  author jsonb,
  body text,
  pinned boolean,
  hidden boolean,
  created_at timestamptz,
  edited_at timestamptz,
  media jsonb,
  like_count int,
  liked boolean,
  comment_count int,
  mine boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, public.fief_author(p.author_id, p.as_team), p.body, p.pinned, p.hidden_at is not null, p.created_at, p.edited_at,
         coalesce((select jsonb_agg(jsonb_build_object('id', md.id, 'mime', md.mime_type, 'w', md.width, 'h', md.height) order by md.position)
                   from public.fief_media md where md.post_id = p.id), '[]'::jsonb),
         (select count(*)::int from public.fief_reactions r where r.post_id = p.id),
         exists (select 1 from public.fief_reactions r where r.post_id = p.id and r.user_id = auth.uid()),
         (select count(*)::int from public.fief_comments c where c.post_id = p.id and c.hidden_at is null),
         p.author_id = auth.uid()
  from public.fief_posts p
  where (public.fief_is_member() or public.fief_is_manager())
    and (p.hidden_at is null or public.fief_is_manager() or p.author_id = auth.uid())
    and (p_before is null or p.created_at < p_before)
  order by (p_before is null and p.pinned) desc, p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

revoke execute on function public.fief_feed(timestamptz, int) from public, anon;
grant execute on function public.fief_feed(timestamptz, int) to authenticated;

create or replace function public.fief_post_comments(p_post uuid)
returns table (id uuid, author jsonb, body text, hidden boolean, created_at timestamptz, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, public.fief_author(c.author_id, c.as_team), c.body, c.hidden_at is not null, c.created_at, c.author_id = auth.uid()
  from public.fief_comments c
  join public.fief_posts p on p.id = c.post_id
  where c.post_id = p_post
    and (public.fief_is_member() or public.fief_is_manager())
    and (p.hidden_at is null or public.fief_is_manager() or p.author_id = auth.uid())
    and (c.hidden_at is null or public.fief_is_manager() or c.author_id = auth.uid())
  order by c.created_at
  limit 500
$$;

revoke execute on function public.fief_post_comments(uuid) from public, anon;
grant execute on function public.fief_post_comments(uuid) to authenticated;

-- Conversations de la membre connectée : l'autre personne, dernier message, non lus.
create or replace function public.fief_my_conversations()
returns table (id uuid, other jsonb, last_body text, last_at timestamptz, last_mine boolean, unread int)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         public.fief_author(o.user_id, false),
         lm.body, c.last_message_at, lm.sender_id = auth.uid(),
         (select count(*)::int from public.fief_messages x where x.conversation_id = c.id and x.sender_id <> auth.uid() and x.created_at > me.last_read_at)
  from public.fief_conversation_members me
  join public.fief_conversations c on c.id = me.conversation_id
  join public.fief_conversation_members o on o.conversation_id = c.id and o.user_id <> me.user_id
  left join lateral (select m.body, m.sender_id from public.fief_messages m where m.conversation_id = c.id order by m.created_at desc limit 1) lm on true
  where me.user_id = auth.uid()
  order by c.last_message_at desc
  limit 200
$$;

revoke execute on function public.fief_my_conversations() from public, anon;
grant execute on function public.fief_my_conversations() to authenticated;

-- Messages d'une conversation (participantes seulement), du plus récent au plus ancien.
create or replace function public.fief_conversation_messages(p_conversation uuid, p_before timestamptz default null)
returns table (id uuid, sender_id uuid, body text, created_at timestamptz, mine boolean)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.sender_id, m.body, m.created_at, m.sender_id = auth.uid()
  from public.fief_messages m
  where m.conversation_id = p_conversation
    and public.fief_in_conversation(p_conversation)
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit 100
$$;

revoke execute on function public.fief_conversation_messages(uuid, timestamptz) from public, anon;
grant execute on function public.fief_conversation_messages(uuid, timestamptz) to authenticated;

-- Conversation à deux (existante ou nouvelle) — appelée par la route /api/fief/messages (clé service).
create or replace function public.fief_open_conversation(p_me uuid, p_other uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  conv uuid;
begin
  if p_me = p_other then
    raise exception 'Conversation avec soi-même impossible.';
  end if;
  select a.conversation_id into conv
  from public.fief_conversation_members a
  join public.fief_conversation_members b on b.conversation_id = a.conversation_id and b.user_id = p_other
  where a.user_id = p_me
    and (select count(*) from public.fief_conversation_members c where c.conversation_id = a.conversation_id) = 2
  limit 1;
  if conv is null then
    insert into public.fief_conversations default values returning id into conv;
    insert into public.fief_conversation_members (conversation_id, user_id) values (conv, p_me), (conv, p_other);
  end if;
  return conv;
end
$$;

revoke execute on function public.fief_open_conversation(uuid, uuid) from public, anon, authenticated;

-- Messages en direct (Realtime) : la RLS ci-dessus filtre ce que chaque abonnée reçoit.
do $$
begin
  alter publication supabase_realtime add table public.fief_messages;
exception when duplicate_object then null;
end
$$;

commit;
