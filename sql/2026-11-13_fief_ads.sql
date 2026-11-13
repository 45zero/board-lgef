-- FIEF — publicités « Sponsorisé » (colonne de droite de fief.lgef.fr, comme sur Facebook), alimentées par
-- l'équipe FIEF dans le board (onglet FIEF → Publicités). Image dans le Drive du board (FIEF / Publicités),
-- servie par /api/fief/ads/[id]. Écritures : route /api/fief/ads (équipe FIEF, clé service).

begin;

create table if not exists public.fief_ads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 120),
  body text check (length(body) <= 500),
  link_url text check (link_url ~* '^https?://'),
  link_label text check (length(link_label) <= 40),
  advertiser text check (length(advertiser) <= 80),     -- affiché sous le titre (ex. « credit-agricole.fr »)
  image_storage_id text,
  image_mime text,
  active boolean not null default true,
  starts_on date,
  ends_on date,
  position smallint not null default 0,
  clicks int not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

drop trigger if exists fief_ads_updated_at on public.fief_ads;
create trigger fief_ads_updated_at before update on public.fief_ads
  for each row execute function public.set_updated_at();

alter table public.fief_ads enable row level security;
drop policy if exists fief_ads_manager on public.fief_ads;
create policy fief_ads_manager on public.fief_ads for select to authenticated
  using ((select public.fief_is_manager()));

-- Publicités en cours de diffusion (membres et équipe), sans les champs internes.
create or replace function public.fief_active_ads()
returns table (id uuid, title text, body text, link_url text, link_label text, advertiser text, has_image boolean)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.title, a.body, a.link_url, a.link_label, a.advertiser, a.image_storage_id is not null
  from public.fief_ads a
  where a.active
    and (a.starts_on is null or a.starts_on <= (now() at time zone 'Europe/Paris')::date)
    and (a.ends_on is null or a.ends_on >= (now() at time zone 'Europe/Paris')::date)
    and (public.fief_is_member() or public.fief_is_manager())
  order by a.position, a.created_at desc
  limit 6
$$;

revoke execute on function public.fief_active_ads() from public, anon;
grant execute on function public.fief_active_ads() to authenticated;

commit;
