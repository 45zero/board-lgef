-- FIEF — confidentialité des publications et mentions @. À appliquer après sql/2026-11-13_fief_social.sql.
--
-- Publication : 'all' (toutes les membres), 'custom' (personnes choisies, audience_ids), 'private' (moi
-- uniquement). L'autrice et l'équipe FIEF (modération) voient toujours tout. Une seule règle,
-- fief_can_see_post(), sert au fil, aux commentaires, aux photos (RLS) et aux routes /api/fief/*.
-- Mentions : mention_ids sur publications et commentaires ; notification « mention » aux personnes
-- mentionnées qui voient la publication (route /api/fief/feed).

begin;

alter table public.fief_posts
  add column if not exists audience text not null default 'all',
  add column if not exists audience_ids uuid[] not null default '{}',
  add column if not exists mention_ids uuid[] not null default '{}';

alter table public.fief_posts drop constraint if exists fief_posts_audience_check;
alter table public.fief_posts
  add constraint fief_posts_audience_check check (audience in ('all', 'custom', 'private') and (audience <> 'custom' or cardinality(audience_ids) > 0));

alter table public.fief_comments add column if not exists mention_ids uuid[] not null default '{}';

alter table public.fief_notifications drop constraint if exists fief_notifications_kind_check;
alter table public.fief_notifications
  add constraint fief_notifications_kind_check check (kind in ('event', 'membership', 'info', 'comment', 'message', 'post', 'mention'));

-- Qui voit une publication (personne connectée).
create or replace function public.fief_can_see_post(p public.fief_posts)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fief_is_manager()
      or p.author_id = auth.uid()
      or (
        public.fief_is_member()
        and p.hidden_at is null
        and (p.audience = 'all' or (p.audience = 'custom' and auth.uid() = any (p.audience_ids)))
      )
$$;

grant execute on function public.fief_can_see_post(public.fief_posts) to authenticated;

-- Lecture directe des tables : même règle.
drop policy if exists fief_posts_read on public.fief_posts;
create policy fief_posts_read on public.fief_posts for select to authenticated
  using (public.fief_can_see_post(fief_posts));

drop policy if exists fief_media_read on public.fief_media;
create policy fief_media_read on public.fief_media for select to authenticated
  using (
    uploader_id = (select auth.uid())
    or exists (select 1 from public.fief_posts p where p.id = fief_media.post_id and public.fief_can_see_post(p))
  );

drop policy if exists fief_comments_read on public.fief_comments;
create policy fief_comments_read on public.fief_comments for select to authenticated
  using (
    exists (select 1 from public.fief_posts p where p.id = fief_comments.post_id and public.fief_can_see_post(p))
    and (hidden_at is null or author_id = (select auth.uid()) or (select public.fief_is_manager()))
  );

-- Personnes mentionnées : [{ id, name }].
create or replace function public.fief_mentions(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', m.user_id, 'name', m.first_name || ' ' || m.last_name)), '[]'::jsonb)
  from public.fief_members m
  where m.user_id = any (coalesce(p_ids, '{}'))
$$;

revoke execute on function public.fief_mentions(uuid[]) from public, anon, authenticated;

-- Fil : colonnes de confidentialité et mentions en plus (le type de retour change : la fonction est recréée).
drop function if exists public.fief_feed(timestamptz, int);
create function public.fief_feed(p_before timestamptz default null, p_limit int default 20)
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
  mine boolean,
  audience text,
  audience_count int,
  mentions jsonb
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
         p.author_id = auth.uid(),
         p.audience,
         cardinality(p.audience_ids),
         public.fief_mentions(p.mention_ids)
  from public.fief_posts p
  where public.fief_can_see_post(p)
    and (p_before is null or p.created_at < p_before)
  order by (p_before is null and p.pinned) desc, p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

revoke execute on function public.fief_feed(timestamptz, int) from public, anon;
grant execute on function public.fief_feed(timestamptz, int) to authenticated;

drop function if exists public.fief_post_comments(uuid);
create function public.fief_post_comments(p_post uuid)
returns table (id uuid, author jsonb, body text, hidden boolean, created_at timestamptz, mine boolean, mentions jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, public.fief_author(c.author_id, c.as_team), c.body, c.hidden_at is not null, c.created_at, c.author_id = auth.uid(),
         public.fief_mentions(c.mention_ids)
  from public.fief_comments c
  join public.fief_posts p on p.id = c.post_id
  where c.post_id = p_post
    and public.fief_can_see_post(p)
    and (c.hidden_at is null or public.fief_is_manager() or c.author_id = auth.uid())
  order by c.created_at
  limit 500
$$;

revoke execute on function public.fief_post_comments(uuid) from public, anon;
grant execute on function public.fief_post_comments(uuid) to authenticated;

commit;
