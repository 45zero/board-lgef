-- FIEF — lot 4 : documents (« Mes documents » et « Documents partagés »). À appliquer après les migrations FIEF précédentes.
--
-- Fichiers dans le Drive du board (src/lib/fief/storage.ts) : FIEF / Documents / <dossier> pour les
-- documents partagés, FIEF / Documents / Personnels / <nom> pour ceux gardés pour soi. Envoi par
-- morceaux relayé par /api/fief/documents (50 Mo max), téléchargement par /api/fief/documents/[id].
-- Écritures par ces routes (clé service) ; lectures par fief_documents_list / fief_doc_folders_list.

begin;

create table if not exists public.fief_doc_folders (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(name) between 1 and 80),
  position smallint not null default 0,
  created_at timestamptz not null default now()
);

insert into public.fief_doc_folders (name, position) values ('Formations', 10), ('Événements', 20), ('Ressources', 30)
on conflict (name) do nothing;

create table if not exists public.fief_documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  as_team boolean not null default false,                -- déposé par l'équipe FIEF
  folder_id uuid references public.fief_doc_folders (id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  description text check (length(description) <= 500),
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes between 0 and 52428800),
  visibility text not null default 'private' check (visibility in ('private', 'shared')),
  status text not null default 'uploading' check (status in ('uploading', 'ready')),
  storage_id text,                                       -- fichier dans le Drive du board (une fois envoyé)
  upload_url text,                                       -- session d'envoi Drive (serveur uniquement)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status <> 'ready' or storage_id is not null)
);

create index if not exists fief_documents_owner_idx on public.fief_documents (owner_id, created_at desc);
create index if not exists fief_documents_shared_idx on public.fief_documents (folder_id, created_at desc) where visibility = 'shared' and status = 'ready';

drop trigger if exists fief_documents_updated_at on public.fief_documents;
create trigger fief_documents_updated_at before update on public.fief_documents
  for each row execute function public.set_updated_at();

alter table public.fief_doc_folders enable row level security;
alter table public.fief_documents enable row level security;

drop policy if exists fief_doc_folders_read on public.fief_doc_folders;
create policy fief_doc_folders_read on public.fief_doc_folders for select to authenticated
  using ((select public.fief_is_manager()) or (select public.fief_is_member()));

-- Lecture directe : ses propres documents seulement (les partagés passent par fief_documents_list,
-- qui ne renvoie jamais upload_url ni storage_id).
drop policy if exists fief_documents_own on public.fief_documents;
create policy fief_documents_own on public.fief_documents for select to authenticated
  using (owner_id = (select auth.uid()));

-- Dossiers et nombre de documents partagés dans chacun.
create or replace function public.fief_doc_folders_list()
returns table (id uuid, name text, sort_order smallint, shared_count int)
language sql
stable
security definer
set search_path = public
as $$
  select f.id, f.name, f.position,
         (select count(*)::int from public.fief_documents d where d.folder_id = f.id and d.visibility = 'shared' and d.status = 'ready')
  from public.fief_doc_folders f
  where public.fief_is_member() or public.fief_is_manager()
  order by f.position, f.name
$$;

revoke execute on function public.fief_doc_folders_list() from public, anon;
grant execute on function public.fief_doc_folders_list() to authenticated;

-- Documents : p_scope 'mine' (les siens, partagés ou non) ou 'shared' (partagés, éventuellement d'un dossier).
create or replace function public.fief_documents_list(p_scope text, p_folder uuid default null)
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
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select d.id, d.name, d.description, d.mime_type, d.size_bytes, d.visibility, d.folder_id, f.name,
         public.fief_author(d.owner_id, d.as_team), d.owner_id = auth.uid(), d.created_at
  from public.fief_documents d
  left join public.fief_doc_folders f on f.id = d.folder_id
  where d.status = 'ready'
    and (public.fief_is_member() or public.fief_is_manager())
    and case
      when p_scope = 'mine' then d.owner_id = auth.uid()
      else d.visibility = 'shared' and (p_folder is null or d.folder_id = p_folder)
    end
  order by d.created_at desc
  limit 500
$$;

revoke execute on function public.fief_documents_list(text, uuid) from public, anon;
grant execute on function public.fief_documents_list(text, uuid) to authenticated;

commit;
