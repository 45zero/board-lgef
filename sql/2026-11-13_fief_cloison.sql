-- FIEF — cloison entre les comptes FIEF (fief.lgef.fr) et le board.
--
-- Les membres FIEF ont un compte Supabase dans le même projet que le board. Or beaucoup de règles
-- existantes ouvrent les données à « toute personne connectée » (41 tables avec une policy `true`,
-- une cinquantaine de fonctions SECURITY DEFINER sans contrôle de l'appelant, des vues propriétaire).
-- Sans cloison, une membre FIEF pourrait, avec la clé publique et son jeton, lire les profils, les
-- événements, modifier des cartes… Trois verrous, indépendants :
--
--   1. Marqueur : le compte FIEF porte app_metadata.realm = 'fief' (posé par le serveur à la création,
--      non modifiable par l'utilisatrice). Il est dans le JWT dès la première connexion.
--   2. Portier PostgREST (db_pre_request) : un jeton FIEF n'atteint que les tables, vues et fonctions
--      dont le nom commence par fief_. Couvre d'un coup les tables, les vues et les ~100 fonctions
--      SECURITY DEFINER existantes (et /graphql, servi par /rpc/resolve).
--   3. Policy RESTRICTIVE « fief_cloison » sur toutes les tables public hors fief_* et sur
--      storage.objects (hors buckets fief*) : couvre ce qui ne passe pas par PostgREST (Realtime,
--      Storage). Une policy restrictive s'ajoute en ET aux policies existantes : rien ne change pour
--      le board ni pour les pages publiques (anon), seuls les jetons FIEF sont refusés.
--   (+ côté application : src/proxy.ts refuse les sessions FIEF sur le board et les server actions.)
--
-- Les tables créées plus tard reçoivent la policy automatiquement (event trigger) ; à défaut,
-- relancer le bloc 3 (idempotent). Contrôle : select * from public.fief_cloison_manquante();

begin;

-- 1. Marqueur ------------------------------------------------------------------------------------

create or replace function public.is_fief_account()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'realm', '') = 'fief'
$$;

comment on function public.is_fief_account() is
  'Vrai si le jeton de la requête est celui d''un compte FIEF (app_metadata.realm = fief). Cloison FIEF / board.';

grant execute on function public.is_fief_account() to anon, authenticated, service_role;

-- 2. Portier PostgREST ---------------------------------------------------------------------------

create or replace function public.fief_request_gate()
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  p text := current_setting('request.path', true);
begin
  if public.is_fief_account() and coalesce(p, '') !~ '^/(rpc/)?fief_' then
    raise sqlstate 'PT403' using message = 'Accès réservé au board.', hint = 'fief_cloison';
  end if;
end
$$;

grant execute on function public.fief_request_gate() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request to 'public.fief_request_gate';
notify pgrst, 'reload config';

-- 3. Policy restrictive sur les tables existantes ---------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('r', 'p')
      and c.relname not like 'fief\_%'
  loop
    execute format('drop policy if exists fief_cloison on public.%I', r.relname);
    execute format(
      'create policy fief_cloison on public.%I as restrictive for all to authenticated '
      'using (not (select public.is_fief_account())) with check (not (select public.is_fief_account()))',
      r.relname
    );
  end loop;
end
$$;

drop policy if exists fief_cloison on storage.objects;
create policy fief_cloison on storage.objects
  as restrictive for all to authenticated
  using (not (select public.is_fief_account()) or bucket_id like 'fief%')
  with check (not (select public.is_fief_account()) or bucket_id like 'fief%');

-- Tables sans la cloison (doit rester vide).
create or replace function public.fief_cloison_manquante()
returns table (table_name text)
language sql
stable
set search_path = ''
as $$
  select c.relname::text
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind in ('r', 'p')
    and c.relname not like 'fief\_%'
    and not exists (
      select 1 from pg_policy p where p.polrelid = c.oid and p.polname = 'fief_cloison'
    )
  order by 1
$$;

revoke execute on function public.fief_cloison_manquante() from public, anon, authenticated;

-- 4. Tables futures : cloison posée à la création ----------------------------------------------------

create or replace function public.fief_cloison_on_create()
returns event_trigger
language plpgsql
set search_path = ''
as $$
declare
  obj record;
  tbl text;
begin
  for obj in select * from pg_event_trigger_ddl_commands() where object_type = 'table' and schema_name = 'public'
  loop
    tbl := (select c.relname from pg_class c where c.oid = obj.objid);
    if tbl is not null and tbl not like 'fief\_%' then
      execute format(
        'create policy fief_cloison on public.%I as restrictive for all to authenticated '
        'using (not (select public.is_fief_account())) with check (not (select public.is_fief_account()))',
        tbl
      );
    end if;
  end loop;
end
$$;

do $$
begin
  drop event trigger if exists fief_cloison_auto;
  create event trigger fief_cloison_auto on ddl_command_end
    when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
    execute function public.fief_cloison_on_create();
exception when insufficient_privilege then
  raise notice 'Event trigger refusé : relancer le bloc 3 après chaque nouvelle table (voir fief_cloison_manquante()).';
end
$$;

commit;
