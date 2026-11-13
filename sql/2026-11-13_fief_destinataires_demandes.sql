-- FIEF — qui reçoit les alertes « nouvelle demande d'adhésion » (onglet FIEF → Réglages).
-- Jusqu'ici : les personnes ajoutées à la main au module « fief » (Claire). Désormais une liste réglable,
-- choisie parmi les personnes qui voient l'onglet FIEF. Valeur de départ : la règle actuelle (Claire).

begin;

alter table public.fief_settings
  add column if not exists request_recipient_ids uuid[] not null default '{}';

update public.fief_settings s
set request_recipient_ids = coalesce((select m.include_user_ids from public.module_access m where m.module_id = 'fief'), '{}')
where s.id and cardinality(s.request_recipient_ids) = 0;

-- Personnes qui voient l'onglet FIEF (choix possibles des destinataires) — serveur uniquement.
create or replace function public.fief_manager_candidates()
returns table (user_id uuid, first_name text, last_name text, role text)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.first_name, p.last_name, p.role::text
  from public.profiles p
  where public.can_see_module(p.id, 'fief')
  order by p.last_name, p.first_name
$$;

revoke execute on function public.fief_manager_candidates() from public, anon, authenticated;

commit;
