-- Accès aux modules du board : qui voit quel module (rail, dock, mobile). Une règle par module :
-- tout le monde, ou restreint à des rôles / spécialités (pôles, Couverture match, salariés), plus
-- des personnes ajoutées et des personnes retirées. Sans règle : visible par tout le monde.
-- Administrateurs et super users voient toujours tout (personne ne peut s'enfermer dehors).
-- Le centre de publication (module « audiovisuel ») remplace board_settings.publisher_ids : voir
-- le module = pouvoir publier = recevoir « Média à publier ».
-- Appliquée à la main sur le projet Supabase partagé.

create table if not exists public.module_access (
  module_id text primary key,
  everyone boolean not null default true,
  roles text[] not null default '{}',
  specialty_slugs text[] not null default '{}',
  include_user_ids uuid[] not null default '{}',
  exclude_user_ids uuid[] not null default '{}',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.module_access enable row level security;

drop policy if exists module_access_select on public.module_access;
create policy module_access_select on public.module_access
  for select to authenticated using (true);
drop policy if exists module_access_manage on public.module_access;
create policy module_access_manage on public.module_access
  for all to authenticated
  using (public.is_admin_or_super(auth.uid()))
  with check (public.is_admin_or_super(auth.uid()));

-- La règle du module désigne-t-elle cette personne ? (sans le passe-droit des administrateurs :
-- sert aussi à choisir qui notifier).
create or replace function public.module_rule_matches(uid uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.module_id is null then true
    when uid = any(m.exclude_user_ids) then false
    when uid = any(m.include_user_ids) then true
    when m.everyone then true
    else exists (select 1 from public.profiles p where p.id = uid and p.role::text = any(m.roles))
      or exists (
        select 1
        from public.profile_specialties ps
        join public.specialties s on s.id = ps.specialty_id
        where ps.user_id = uid and s.slug = any(m.specialty_slugs)
      )
  end
  from (select 1) as one
  left join public.module_access m on m.module_id = p_module;
$$;

create or replace function public.can_see_module(uid uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_or_super(uid) or public.module_rule_matches(uid, p_module);
$$;

-- Modules visibles parmi ceux donnés (rail, dock, fiche utilisateur).
create or replace function public.modules_visible_to(uid uuid, p_modules text[])
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(m order by m), '{}') from unnest(p_modules) as m where public.can_see_module(uid, m);
$$;

grant execute on function public.module_rule_matches(uuid, text) to authenticated;
grant execute on function public.can_see_module(uuid, text) to authenticated;
grant execute on function public.modules_visible_to(uuid, text[]) to authenticated;

-- Centre de publication : les personnes habilitées deviennent les « personnes ajoutées ».
insert into public.module_access (module_id, everyone, include_user_ids)
select 'audiovisuel', false, coalesce(publisher_ids, '{}') from public.board_settings where id = true
on conflict (module_id) do nothing;

-- « Média à publier » : les personnes que désigne la règle du centre de publication.
create or replace function public.notify_publishers_to_publish() returns trigger
language plpgsql
security definer
set search_path = public
as $$
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
         label || ' — de nouveaux médias attendent dans le centre de publication.',
         new.event_id,
         jsonb_build_object('publication_id', new.id, 'event_id', new.event_id)
  from profiles p
  where exists (select 1 from module_access m where m.module_id = 'audiovisuel')
    and public.module_rule_matches(p.id, 'audiovisuel')
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
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'module_access') then
    alter publication supabase_realtime add table public.module_access;
  end if;
end $$;
