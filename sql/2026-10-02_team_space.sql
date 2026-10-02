-- Espace Team (module « trello » du board) : tableaux personnels, cartes assignables.
--
-- Tables neuves, indépendantes de l'ancien Kanban de calendrier.lgef.fr (boards / lists / cards),
-- toujours utilisé et dont les déclencheurs ne conviennent pas (un membre ajouté à un tableau est
-- assigné à toutes ses cartes, une échéance crée un événement « kanban »).
--
-- Principes :
--  * chaque personne a ses tableaux (team_boards.owner_id) — rien n'y est partagé par défaut ;
--  * une carte assignée (team_card_members) reste sur le tableau de son créateur et apparaît dans
--    « Mes cartes » de chaque assigné, qui peut la lire, la commenter, cocher la checklist et la
--    changer de colonne ;
--  * une carte liée à un événement fait de chaque assigné un participant de l'événement
--    (event_team_members, rôle « membre ») ;
--  * le N+1 (profiles.expense_validator_id) voit les cartes assignées à ses équipiers, les
--    administrateurs et super users voient tout.
-- Appliquée à la main sur le projet Supabase partagé.

begin;

create table if not exists public.team_boards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 80),
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists team_boards_owner_idx on public.team_boards (owner_id);

create table if not exists public.team_lists (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.team_boards(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 60),
  -- Colonne « terminé » : une carte qui s'y trouve est considérée comme faite.
  is_done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (id, board_id)
);
create index if not exists team_lists_board_idx on public.team_lists (board_id);

create table if not exists public.team_cards (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.team_boards(id) on delete cascade,
  list_id uuid not null,
  title text not null check (length(btrim(title)) between 1 and 200),
  description text not null default '',
  color text,
  labels jsonb not null default '[]'::jsonb,
  due_at timestamptz,
  event_id uuid references public.events(id) on delete set null,
  position double precision not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  -- La colonne appartient forcément au tableau de la carte.
  foreign key (list_id, board_id) references public.team_lists (id, board_id) on delete cascade
);
create index if not exists team_cards_board_idx on public.team_cards (board_id);
create index if not exists team_cards_list_idx on public.team_cards (list_id);
create index if not exists team_cards_event_idx on public.team_cards (event_id);

create table if not exists public.team_card_members (
  card_id uuid not null references public.team_cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  assigned_by uuid references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),
  -- Première ouverture par l'assigné (pastille « nouvelle carte » tant que null).
  seen_at timestamptz,
  primary key (card_id, user_id)
);
create index if not exists team_card_members_user_idx on public.team_card_members (user_id);

create table if not exists public.team_checklist_items (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.team_cards(id) on delete cascade,
  content text not null check (length(btrim(content)) between 1 and 300),
  done boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists team_checklist_items_card_idx on public.team_checklist_items (card_id);

create table if not exists public.team_card_comments (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.team_cards(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  content text not null check (length(btrim(content)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists team_card_comments_card_idx on public.team_card_comments (card_id);

/* ---------- Droits ---------- */

-- Peut modifier la carte : propriétaire du tableau, créateur, assigné, administrateur.
create or replace function public.team_can_edit_card(p_card uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_cards c join team_boards b on b.id = c.board_id
    where c.id = p_card
      and (b.owner_id = p_uid or c.created_by = p_uid or is_admin_or_super(p_uid)
           or exists (select 1 from team_card_members m where m.card_id = c.id and m.user_id = p_uid))
  );
$$;

-- Peut voir la carte : ceux qui la modifient, plus le N+1 d'un assigné.
create or replace function public.team_can_see_card(p_card uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select team_can_edit_card(p_card, p_uid) or exists (
    select 1 from team_card_members m join profiles p on p.id = m.user_id
    where m.card_id = p_card and p.expense_validator_id = p_uid
  );
$$;

-- Voit le tableau (titre, colonnes) : son propriétaire, ou quiconque voit une de ses cartes.
create or replace function public.team_can_see_board(p_board uuid, p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from team_boards b where b.id = p_board and (b.owner_id = p_uid or is_admin_or_super(p_uid)))
      or exists (select 1 from team_cards c where c.board_id = p_board and team_can_see_card(c.id, p_uid));
$$;

alter table public.team_boards enable row level security;
alter table public.team_lists enable row level security;
alter table public.team_cards enable row level security;
alter table public.team_card_members enable row level security;
alter table public.team_checklist_items enable row level security;
alter table public.team_card_comments enable row level security;

drop policy if exists team_boards_select on public.team_boards;
create policy team_boards_select on public.team_boards for select using (team_can_see_board(id, auth.uid()));
drop policy if exists team_boards_write on public.team_boards;
create policy team_boards_write on public.team_boards for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists team_lists_select on public.team_lists;
create policy team_lists_select on public.team_lists for select using (team_can_see_board(board_id, auth.uid()));
drop policy if exists team_lists_write on public.team_lists;
create policy team_lists_write on public.team_lists for all
  using (exists (select 1 from team_boards b where b.id = board_id and b.owner_id = auth.uid()))
  with check (exists (select 1 from team_boards b where b.id = board_id and b.owner_id = auth.uid()));

drop policy if exists team_cards_select on public.team_cards;
create policy team_cards_select on public.team_cards for select using (team_can_see_card(id, auth.uid()));
drop policy if exists team_cards_insert on public.team_cards;
create policy team_cards_insert on public.team_cards for insert
  with check (created_by = auth.uid() and exists (select 1 from team_boards b where b.id = board_id and b.owner_id = auth.uid()));
drop policy if exists team_cards_update on public.team_cards;
create policy team_cards_update on public.team_cards for update
  using (team_can_edit_card(id, auth.uid())) with check (team_can_edit_card(id, auth.uid()));
drop policy if exists team_cards_delete on public.team_cards;
create policy team_cards_delete on public.team_cards for delete using (
  created_by = auth.uid() or is_admin_or_super(auth.uid())
  or exists (select 1 from team_boards b where b.id = board_id and b.owner_id = auth.uid())
);

drop policy if exists team_card_members_select on public.team_card_members;
create policy team_card_members_select on public.team_card_members for select using (team_can_see_card(card_id, auth.uid()));
drop policy if exists team_card_members_insert on public.team_card_members;
create policy team_card_members_insert on public.team_card_members for insert
  with check (team_can_edit_card(card_id, auth.uid()) and assigned_by = auth.uid());
drop policy if exists team_card_members_update on public.team_card_members;
-- Seul l'assigné marque la carte comme vue.
create policy team_card_members_update on public.team_card_members for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists team_card_members_delete on public.team_card_members;
create policy team_card_members_delete on public.team_card_members for delete using (team_can_edit_card(card_id, auth.uid()));

drop policy if exists team_checklist_select on public.team_checklist_items;
create policy team_checklist_select on public.team_checklist_items for select using (team_can_see_card(card_id, auth.uid()));
drop policy if exists team_checklist_write on public.team_checklist_items;
create policy team_checklist_write on public.team_checklist_items for all
  using (team_can_edit_card(card_id, auth.uid())) with check (team_can_edit_card(card_id, auth.uid()));

drop policy if exists team_comments_select on public.team_card_comments;
create policy team_comments_select on public.team_card_comments for select using (team_can_see_card(card_id, auth.uid()));
drop policy if exists team_comments_insert on public.team_card_comments;
create policy team_comments_insert on public.team_card_comments for insert
  with check (user_id = auth.uid() and team_can_see_card(card_id, auth.uid()));
drop policy if exists team_comments_delete on public.team_card_comments;
create policy team_comments_delete on public.team_card_comments for delete using (user_id = auth.uid());

/* ---------- Automatismes ---------- */

drop trigger if exists team_cards_touch on public.team_cards;
create trigger team_cards_touch before update on public.team_cards
  for each row execute function public.update_updated_at_column();

-- Ajoute des personnes comme participants (« membre ») d'un événement, sans doublon.
create or replace function public.team_add_event_participants(p_event uuid, p_users uuid[])
returns void language sql security definer set search_path = public as $$
  insert into event_team_members (event_id, user_id, role)
  select p_event, u, 'membre' from unnest(p_users) u
  where p_event is not null
    and not exists (select 1 from event_team_members t where t.event_id = p_event and t.user_id = u);
$$;

-- Assignation : participant de l'événement de la carte + notification (sauf si on s'assigne soi-même).
create or replace function public.team_on_member_added()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_card team_cards%rowtype;
  v_actor text;
begin
  select * into v_card from team_cards where id = new.card_id;
  perform team_add_event_participants(v_card.event_id, array[new.user_id]);
  if new.assigned_by is distinct from new.user_id then
    select coalesce(nullif(btrim(concat_ws(' ', first_name, last_name)), ''), email) into v_actor
      from profiles where id = new.assigned_by;
    perform create_notification(
      new.user_id, 'card_assigned', 'Nouvelle carte',
      format('%s vous a assigné « %s ».', coalesce(v_actor, 'Quelqu''un'), v_card.title),
      jsonb_build_object('team_card_id', v_card.id),
      v_actor
    );
  end if;
  return new;
end;
$$;
drop trigger if exists team_card_members_added on public.team_card_members;
create trigger team_card_members_added after insert on public.team_card_members
  for each row execute function public.team_on_member_added();

-- Événement lié (ou changé) après coup : tous les assignés en deviennent participants.
create or replace function public.team_on_card_event_set()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.event_id is not null and new.event_id is distinct from old.event_id then
    perform team_add_event_participants(
      new.event_id, array(select user_id from team_card_members where card_id = new.id)
    );
  end if;
  return new;
end;
$$;
drop trigger if exists team_cards_event_set on public.team_cards;
create trigger team_cards_event_set after update of event_id on public.team_cards
  for each row execute function public.team_on_card_event_set();

commit;

-- En direct : les changements de cartes mettent à jour l'écran de chaque personne concernée.
do $$
declare
  t text;
begin
  foreach t in array array['team_boards', 'team_lists', 'team_cards', 'team_card_members', 'team_checklist_items', 'team_card_comments'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
