-- LGEF Transfer — statistiques : ouvertures des liens (page …/t/<code>) et personnes distinctes.
--
-- transfer_views : une ligne par ouverture de la page d'un transfert. « visitor » est une empreinte
-- (SHA-256 tronqué de l'adresse IP + navigateur, salé avec un secret serveur) : elle permet de compter
-- les personnes distinctes sans conserver d'adresse IP. Les robots (aperçus de liens, antivirus des
-- messageries) sont écartés côté serveur.
-- transfer_downloads.visitor : même empreinte, pour compter les personnes distinctes par document.
-- Lecture : comme les téléchargements (ses transferts, tout pour les admins). Écriture : serveur.
-- À appliquer à la main sur le projet Supabase partagé.

begin;

create table if not exists public.transfer_views (
  id bigint generated always as identity primary key,
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  visitor text not null default '',
  at timestamptz not null default now()
);
create index if not exists transfer_views_transfer_idx on public.transfer_views (transfer_id, at desc);
create index if not exists transfer_views_at_idx on public.transfer_views (at);
create index if not exists transfer_downloads_at_idx on public.transfer_downloads (at);

alter table public.transfers add column if not exists view_count int not null default 0;
alter table public.transfer_downloads add column if not exists visitor text not null default '';

alter table public.transfer_views enable row level security;
drop policy if exists transfer_views_select on public.transfer_views;
create policy transfer_views_select on public.transfer_views for select to authenticated
  using (exists (select 1 from transfers t where t.id = transfer_id and (t.sender_user_id = auth.uid() or is_admin_or_super(auth.uid()))));
grant select on public.transfer_views to authenticated;

create or replace function public.transfer_count_view(p_transfer uuid, p_visitor text)
returns void language sql security definer set search_path = public as $$
  insert into transfer_views (transfer_id, visitor) values (p_transfer, coalesce(p_visitor, ''));
  update transfers set view_count = view_count + 1 where id = p_transfer;
$$;

-- Téléchargement : même compteur qu'avant, avec l'empreinte du visiteur.
drop function if exists public.transfer_count_download(uuid, uuid);
create or replace function public.transfer_count_download(p_transfer uuid, p_file uuid, p_visitor text)
returns void language sql security definer set search_path = public as $$
  insert into transfer_downloads (transfer_id, file_id, visitor) values (p_transfer, p_file, coalesce(p_visitor, ''));
  update transfer_files set download_count = download_count + 1 where id = p_file and transfer_id = p_transfer;
  update transfers set download_count = download_count + 1, last_download_at = now() where id = p_transfer;
$$;

revoke all on function public.transfer_count_view(uuid, text) from public, anon, authenticated;
revoke all on function public.transfer_count_download(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.transfer_count_view(uuid, text) to service_role;
grant execute on function public.transfer_count_download(uuid, uuid, text) to service_role;

commit;
