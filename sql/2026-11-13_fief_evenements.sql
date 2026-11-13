-- FIEF — lot 2 : événements « Visible sur FIEF », calendrier des membres, notifications.
-- À appliquer après sql/2026-11-13_fief_cloison.sql et sql/2026-11-13_fief_membres.sql.
--
-- Dans le board, l'équipe FIEF active « Visible sur FIEF » sur un événement et choisit le public :
-- toutes les membres, un ou plusieurs clubs, une ou plusieurs fonctions, ou une sélection de personnes.
-- Ce public voit l'événement dans son calendrier FIEF et reçoit la notification (FIEF, push, e-mail).
-- Les membres n'ont jamais accès à la table events (cloison) : elles passent par fief_my_events().

begin;

-- Partage d'un événement sur FIEF ------------------------------------------------------------------

create table if not exists public.fief_event_shares (
  event_id uuid primary key references public.events (id) on delete cascade,
  audience text not null default 'all' check (audience in ('all', 'clubs', 'functions', 'members')),
  club_numbers text[] not null default '{}',
  functions text[] not null default '{}',
  member_ids uuid[] not null default '{}',
  shared_by uuid references auth.users (id) on delete set null,
  shared_at timestamptz not null default now(),
  notified_at timestamptz,
  updated_at timestamptz not null default now(),
  check (audience <> 'clubs' or cardinality(club_numbers) > 0),
  check (audience <> 'functions' or cardinality(functions) > 0),
  check (audience <> 'members' or cardinality(member_ids) > 0)
);

drop trigger if exists fief_event_shares_updated_at on public.fief_event_shares;
create trigger fief_event_shares_updated_at before update on public.fief_event_shares
  for each row execute function public.set_updated_at();

alter table public.fief_event_shares enable row level security;
drop policy if exists fief_event_shares_manager on public.fief_event_shares;
create policy fief_event_shares_manager on public.fief_event_shares for all to authenticated
  using ((select public.fief_is_manager())) with check ((select public.fief_is_manager()));

-- Une membre fait-elle partie du public d'un partage ?
create or replace function public.fief_in_audience(s public.fief_event_shares, m public.fief_members)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select m.status = 'active' and case s.audience
    when 'all' then true
    when 'clubs' then coalesce(m.club_number = any (s.club_numbers), false)
    when 'functions' then m.functions && s.functions
    when 'members' then m.user_id = any (s.member_ids)
    else false
  end
$$;

-- Public d'un événement (envoi des notifications, côté serveur seulement).
create or replace function public.fief_event_audience(p_event_id uuid)
returns table (user_id uuid, email text, first_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id, m.email, m.first_name
  from public.fief_event_shares s
  join public.fief_members m on public.fief_in_audience(s, m)
  where s.event_id = p_event_id
$$;

revoke execute on function public.fief_event_audience(uuid) from public, anon, authenticated;

-- Calendrier de la membre connectée (ou de l'équipe FIEF : tous les événements partagés).
create or replace function public.fief_my_events(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  title text,
  description text,
  start_date timestamptz,
  end_date timestamptz,
  location text,
  online_meeting boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, e.title, e.description, e.start_date, e.end_date, coalesce(e.event_address, e.location), coalesce(e.online_meeting, false)
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

-- Notifications FIEF (cloche de fief.lgef.fr) -------------------------------------------------------

create table if not exists public.fief_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('event', 'membership', 'info')),
  title text not null,
  body text,
  route text,
  event_id uuid references public.events (id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists fief_notifications_user_idx on public.fief_notifications (user_id, created_at desc);

alter table public.fief_notifications enable row level security;
drop policy if exists fief_notifications_own_select on public.fief_notifications;
create policy fief_notifications_own_select on public.fief_notifications for select to authenticated
  using (user_id = (select auth.uid()));
drop policy if exists fief_notifications_own_update on public.fief_notifications;
create policy fief_notifications_own_update on public.fief_notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Écriture : serveur (clé service) uniquement.

-- Une membre ne change que read_at sur ses notifications.
create or replace function public.fief_notifications_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if auth.uid() is not null
     and (new.user_id is distinct from old.user_id or new.kind is distinct from old.kind or new.title is distinct from old.title
          or new.body is distinct from old.body or new.route is distinct from old.route or new.event_id is distinct from old.event_id
          or new.created_at is distinct from old.created_at) then
    raise exception 'Seul l''état « lu » peut être modifié.' using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists fief_notifications_guard on public.fief_notifications;
create trigger fief_notifications_guard before update on public.fief_notifications
  for each row execute function public.fief_notifications_guard();

-- Abonnements push des membres (navigateur / appli installée) -----------------------------------------

create table if not exists public.fief_push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index if not exists fief_push_subscriptions_user_idx on public.fief_push_subscriptions (user_id);

alter table public.fief_push_subscriptions enable row level security;
drop policy if exists fief_push_own on public.fief_push_subscriptions;
create policy fief_push_own on public.fief_push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

commit;
