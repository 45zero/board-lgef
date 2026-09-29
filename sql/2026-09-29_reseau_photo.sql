-- Réseau photo : les matchs du week-end (événements « match_du_week_end ») portent leur affiche
-- (compétition, équipes, niveaux, pages régionales) et un poste photo proposé au réseau des
-- photographes. Le premier photographe qui clique « Je prends » l'obtient.
-- La vidéo reste gérée par coverage_requests (une captation par événement, partagée avec
-- calendrier-lgef) : cette migration n'y touche pas.
-- Appliquée à la main sur le projet Supabase partagé.

-- Métier « photographe » (le mode de paiement reste porté par tech-reseau / tech-prestataire / tech-benevole).
insert into public.specialties (label, slug, domain)
select 'Photographe', 'tech-photo', 'technician'
where not exists (select 1 from public.specialties where slug = 'tech-photo');

-- Coordinateurs du réseau photo : administrateurs, super users, réseau salarié.
create or replace function public.is_photo_coordinator(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin_or_super(uid) or public.has_specialty_slugs(uid, array['tech-salarie']);
$$;

-- Affiche d'un match.
create table if not exists public.match_details (
  event_id uuid primary key references public.events(id) on delete cascade,
  competition text not null,
  home_team text not null,
  home_level text,
  away_team text not null,
  away_level text,
  -- Pages Facebook régionales où publier (clés de src/lib/social/targets.ts).
  regions text[] not null default '{}'
    check (regions <@ array['alsace', 'lorraine', 'champagne_ardenne']::text[]),
  created_at timestamptz not null default now()
);

-- Poste photo d'un match : brouillon (pas encore envoyé au réseau) → proposé → pris.
create table if not exists public.photo_missions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references public.events(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'open', 'taken')),
  photographer_id uuid references public.profiles(id) on delete set null,
  -- Relais de publication (« Publi Olivier ») ; nul : le photographe ou le centre de publication.
  publisher_id uuid references public.profiles(id) on delete set null,
  taken_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists photo_missions_photographer_idx on public.photo_missions (photographer_id);

alter table public.match_details enable row level security;
alter table public.photo_missions enable row level security;

drop policy if exists match_details_select on public.match_details;
create policy match_details_select on public.match_details
  for select to authenticated using (true);
drop policy if exists match_details_manage on public.match_details;
create policy match_details_manage on public.match_details
  for all to authenticated
  using (public.is_photo_coordinator(auth.uid()))
  with check (public.is_photo_coordinator(auth.uid()));

-- Les brouillons ne sont visibles que des coordinateurs.
drop policy if exists photo_missions_select on public.photo_missions;
create policy photo_missions_select on public.photo_missions
  for select to authenticated
  using (status <> 'draft' or public.is_photo_coordinator(auth.uid()));
drop policy if exists photo_missions_manage on public.photo_missions;
create policy photo_missions_manage on public.photo_missions
  for all to authenticated
  using (public.is_photo_coordinator(auth.uid()))
  with check (public.is_photo_coordinator(auth.uid()));

-- « Je prends » : premier arrivé, premier servi. La mise à jour conditionnelle verrouille la ligne :
-- un second clic simultané relit status = 'taken' et échoue.
create or replace function public.claim_photo_mission(p_mission uuid)
returns public.photo_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.photo_missions;
begin
  if auth.uid() is null then
    raise exception 'Non authentifié' using errcode = '42501';
  end if;
  if not (public.has_specialty_slugs(auth.uid(), array['tech-photo']) or public.is_photo_coordinator(auth.uid())) then
    raise exception 'Réservé au réseau photo.' using errcode = '42501';
  end if;
  update public.photo_missions
  set status = 'taken', photographer_id = auth.uid(), taken_at = now(), updated_at = now()
  where id = p_mission and status = 'open'
  returning * into m;
  if m.id is null then
    raise exception 'Ce match vient d''être pris par quelqu''un d''autre.' using errcode = 'P0001';
  end if;
  return m;
end;
$$;

-- Le photographe se désiste (avant le match) : le poste repart au réseau.
create or replace function public.release_photo_mission(p_mission uuid)
returns public.photo_missions
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.photo_missions;
begin
  update public.photo_missions pm
  set status = 'open', photographer_id = null, taken_at = null, updated_at = now()
  where pm.id = p_mission
    and pm.status = 'taken'
    and pm.photographer_id = auth.uid()
    and exists (select 1 from public.events e where e.id = pm.event_id and e.start_date > now())
  returning * into m;
  if m.id is null then
    raise exception 'Impossible de libérer ce match (déjà commencé, ou il ne vous est pas attribué).' using errcode = 'P0001';
  end if;
  return m;
end;
$$;

grant execute on function public.claim_photo_mission(uuid) to authenticated;
grant execute on function public.release_photo_mission(uuid) to authenticated;

-- Album d'un match dans le centre de publication : texte (affiche + crédit photo) et pages
-- régionales pré-remplis. Déclencheur séparé : la mise en album (queue_event_media_for_publication)
-- reste inchangée.
create or replace function public.prefill_match_publication()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.match_details;
  who text;
begin
  if new.event_id is null or new.caption is not null or coalesce(new.kind, '') not in ('photo', 'gallery') then
    return new;
  end if;
  select * into d from public.match_details where event_id = new.event_id;
  if d.event_id is null then
    return new;
  end if;
  select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') into who
  from public.photo_missions m
  join public.profiles p on p.id = m.photographer_id
  where m.event_id = new.event_id;

  new.caption := d.competition || ' : '
    || d.home_team || coalesce(' (' || nullif(d.home_level, '') || ')', '')
    || ' – '
    || d.away_team || coalesce(' (' || nullif(d.away_level, '') || ')', '')
    || coalesce(E'\n📸 ' || who, '');
  if coalesce(new.targets, '{}'::jsonb) = '{}'::jsonb and cardinality(d.regions) > 0 then
    new.targets := jsonb_build_object('facebook', (select jsonb_object_agg(r, true) from unnest(d.regions) as r));
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prefill_match_publication on public.media_publications;
create trigger trg_prefill_match_publication
  before insert on public.media_publications
  for each row execute function public.prefill_match_publication();

-- Board en direct (voir sql/2026-09-27_live.sql).
do $$
declare
  t text;
begin
  foreach t in array array['match_details', 'photo_missions'] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
