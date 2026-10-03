-- Profils : un utilisateur ne peut plus modifier lui-même son rôle ni ses droits.
--
-- La politique RLS « Users can update their own profile » (USING auth.uid() = id, sans restriction de
-- colonnes) laisse chacun réécrire SA ligne entière depuis le navigateur, rôle compris : n'importe quel
-- compte peut se donner le rôle admin, choisir son N+1 (qui valide ses frais) ou s'ouvrir la GED.
-- Ce trigger refuse ces changements sauf pour un administrateur / super user. Les server actions du
-- board (client service, auth.uid() nul) et les mises à jour faites par un admin restent possibles.
-- Le reste de la fiche (nom, secteur, adresse, véhicule, photo, préférences) reste modifiable par soi.

create or replace function public.profiles_protect_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.is_admin_or_super(auth.uid()) then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.expense_validator_id is distinct from old.expense_validator_id
     or new.has_ged_access is distinct from old.has_ged_access
     or new.employment_type is distinct from old.employment_type
     or new.organisation_id is distinct from old.organisation_id
     or new.email is distinct from old.email then
    raise exception 'Seul un administrateur peut modifier le rôle, le N+1, les accès ou l''e-mail d''un compte.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_protect_columns on public.profiles;
create trigger trg_profiles_protect_columns
  before update on public.profiles
  for each row execute function public.profiles_protect_columns();
