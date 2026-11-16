-- FIEF — évolutions du 16/11 (tickets du centre d'aide). Ajouts et fonctions recréées, aucune donnée supprimée.
--
--  1. Public « Certaines personnes » élargi : personnes ET fonctions (éducatrices, dirigeantes, joueuses…)
--     ET clubs, pour les publications (ebe629a0) et les documents partagés (9e3415d0).
--     Une seule règle : fief_audience_match().
--  2. Page d'une membre : fief_feed(p_author) donne ses publications visibles par la personne connectée (9ab309dc).
--  3. Événements : « Pour information » ou « Invitation » (1557ef9a) ; réponse à l'invitation depuis le
--     calendrier FIEF : je participe / peut-être / je ne participe pas (eb3e4787).
--  4. Documents : seule l'équipe FIEF partage (route /api/fief/documents) ; public par document.
--  5. Administratrices FIEF nommées par l'équipe (ddeb4fe3) : liste des comptes du board (hors comptes FIEF)
--     parmi lesquels choisir ; l'accès passe par la règle du module « fief » (module_access).

begin;

-- 1. Règle de public ---------------------------------------------------------------------------------

-- La personne connectée fait-elle partie du public ? 'all' : toutes ; 'custom' : une des personnes,
-- une des fonctions ou un des clubs.
create or replace function public.fief_audience_match(p_audience text, p_ids uuid[], p_functions text[], p_clubs text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_audience = 'all'
      or (
        p_audience = 'custom'
        and exists (
          select 1 from public.fief_members m
          where m.user_id = auth.uid()
            and m.status = 'active'
            and (m.user_id = any (p_ids) or m.functions && p_functions or coalesce(m.club_number = any (p_clubs), false))
        )
      )
$$;

revoke execute on function public.fief_audience_match(text, uuid[], text[], text[]) from public, anon;
grant execute on function public.fief_audience_match(text, uuid[], text[], text[]) to authenticated;

-- Publications
alter table public.fief_posts
  add column if not exists audience_functions text[] not null default '{}',
  add column if not exists audience_clubs text[] not null default '{}';

alter table public.fief_posts drop constraint if exists fief_posts_audience_check;
alter table public.fief_posts
  add constraint fief_posts_audience_check check (
    audience in ('all', 'custom', 'private')
    and (audience <> 'custom' or cardinality(audience_ids) + cardinality(audience_functions) + cardinality(audience_clubs) > 0)
  );

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
        and public.fief_audience_match(p.audience, p.audience_ids, p.audience_functions, p.audience_clubs)
      )
$$;

-- 2. Fil : filtre par autrice (page d'une membre) --------------------------------------------------

drop function if exists public.fief_feed(timestamptz, int);
create function public.fief_feed(p_before timestamptz default null, p_limit int default 20, p_author uuid default null)
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
         cardinality(p.audience_ids) + cardinality(p.audience_functions) + cardinality(p.audience_clubs),
         public.fief_mentions(p.mention_ids)
  from public.fief_posts p
  where public.fief_can_see_post(p)
    and (p_before is null or p.created_at < p_before)
    and (p_author is null or (p.author_id = p_author and not p.as_team))
  order by (p_before is null and p_author is null and p.pinned) desc, p.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

revoke execute on function public.fief_feed(timestamptz, int, uuid) from public, anon;
grant execute on function public.fief_feed(timestamptz, int, uuid) to authenticated;

-- 3. Événements : information / invitation, réponses ------------------------------------------------

alter table public.fief_event_shares
  add column if not exists mode text not null default 'invitation';
alter table public.fief_event_shares drop constraint if exists fief_event_shares_mode_check;
alter table public.fief_event_shares add constraint fief_event_shares_mode_check check (mode in ('info', 'invitation'));

create table if not exists public.fief_event_responses (
  event_id uuid not null references public.events (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  response text not null check (response in ('yes', 'maybe', 'no')),
  responded_at timestamptz not null default now(),
  primary key (event_id, user_id)
);

alter table public.fief_event_responses enable row level security;
drop policy if exists fief_event_responses_own on public.fief_event_responses;
create policy fief_event_responses_own on public.fief_event_responses for select to authenticated
  using (user_id = (select auth.uid()) or (select public.fief_is_manager()));
-- Écriture : route /api/fief/events (clé service), après contrôle du public.

drop function if exists public.fief_my_events(timestamptz, timestamptz);
create function public.fief_my_events(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  title text,
  description text,
  start_date timestamptz,
  end_date timestamptz,
  location text,
  online_meeting boolean,
  mode text,
  my_response text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.title, e.description, e.start_date, e.end_date, coalesce(e.event_address, e.location), coalesce(e.online_meeting, false),
         s.mode,
         (select r.response from public.fief_event_responses r where r.event_id = e.id and r.user_id = auth.uid())
  from public.fief_event_shares s
  join public.events e on e.id = s.event_id
  where e.start_date < p_to
    and coalesce(e.end_date, e.start_date) >= p_from
    and (
      public.fief_is_manager()
      or exists (select 1 from public.fief_members m where m.user_id = auth.uid() and public.fief_in_audience(s, m))
    )
  order by e.start_date
  limit 500
$$;

revoke execute on function public.fief_my_events(timestamptz, timestamptz) from public, anon;
grant execute on function public.fief_my_events(timestamptz, timestamptz) to authenticated;

-- 4. Documents : public par document -----------------------------------------------------------------

alter table public.fief_documents
  add column if not exists audience text not null default 'all',
  add column if not exists audience_ids uuid[] not null default '{}',
  add column if not exists audience_functions text[] not null default '{}',
  add column if not exists audience_clubs text[] not null default '{}';
alter table public.fief_documents drop constraint if exists fief_documents_audience_check;
alter table public.fief_documents
  add constraint fief_documents_audience_check check (
    audience in ('all', 'custom')
    and (audience <> 'custom' or cardinality(audience_ids) + cardinality(audience_functions) + cardinality(audience_clubs) > 0)
  );

create or replace function public.fief_doc_folders_list()
returns table (id uuid, name text, sort_order smallint, shared_count int)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, f.position,
         (select count(*)::int from public.fief_documents d
          where d.folder_id = f.id and d.visibility = 'shared' and d.status = 'ready'
            and (public.fief_is_manager() or d.owner_id = auth.uid()
                 or public.fief_audience_match(d.audience, d.audience_ids, d.audience_functions, d.audience_clubs)))
  from public.fief_doc_folders f
  where public.fief_is_member() or public.fief_is_manager()
  order by f.position, f.name
$$;

drop function if exists public.fief_documents_list(text, uuid);
create function public.fief_documents_list(p_scope text, p_folder uuid default null)
returns table (
  id uuid,
  name text,
  description text,
  mime_type text,
  size_bytes bigint,
  visibility text,
  folder_id uuid,
  folder_name text,
  author jsonb,
  mine boolean,
  created_at timestamptz,
  audience text,
  audience_ids uuid[],
  audience_functions text[],
  audience_clubs text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.name, d.description, d.mime_type, d.size_bytes, d.visibility, d.folder_id, f.name,
         public.fief_author(d.owner_id, d.as_team), d.owner_id = auth.uid(), d.created_at,
         d.audience,
         case when public.fief_is_manager() then d.audience_ids else '{}' end,
         case when public.fief_is_manager() then d.audience_functions else '{}' end,
         case when public.fief_is_manager() then d.audience_clubs else '{}' end
  from public.fief_documents d
  left join public.fief_doc_folders f on f.id = d.folder_id
  where d.status = 'ready'
    and (public.fief_is_member() or public.fief_is_manager())
    and case
      when p_scope = 'mine' then d.owner_id = auth.uid()
      else d.visibility = 'shared'
        and (p_folder is null or d.folder_id = p_folder)
        and (public.fief_is_manager() or d.owner_id = auth.uid()
             or public.fief_audience_match(d.audience, d.audience_ids, d.audience_functions, d.audience_clubs))
    end
  order by d.created_at desc
  limit 500
$$;

revoke execute on function public.fief_documents_list(text, uuid) from public, anon;
grant execute on function public.fief_documents_list(text, uuid) to authenticated;

-- 5. Comptes du board parmi lesquels nommer des administratrices FIEF (serveur uniquement) -----------

create or replace function public.fief_board_people()
returns table (user_id uuid, first_name text, last_name text, email text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.first_name, p.last_name, p.email, p.role::text
  from public.profiles p
  join auth.users u on u.id = p.id
  where coalesce(u.raw_app_meta_data ->> 'realm', '') <> 'fief'
  order by p.last_name, p.first_name
$$;

revoke execute on function public.fief_board_people() from public, anon, authenticated;

commit;
