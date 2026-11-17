-- Sécurité — corrections après test d'intrusion du 17/11 (lecture / écriture directe par l'API Supabase,
-- en contournant l'interface). Rien n'est supprimé dans les données.
--
-- 1. Hydromatch : les inscriptions (noms, e-mails, téléphones des référents et des maires) étaient lisibles
--    SANS COMPTE avec la clé publique du site. Lecture, modification et suppression réservées aux personnes
--    de hydromatch_admins ; le formulaire public garde le droit d'inscrire (INSERT).
-- 2. Profils : adresse, position, plaque, véhicule et date de naissance n'étaient protégés qu'à l'écran
--    (toute personne connectée pouvait les lire). Ces colonnes ne sont plus lisibles avec une session :
--    le board les lit côté serveur (clé service), en appliquant la règle « adresse privée ».
-- 3. Rappels d'événement : la règle « Service role updates reminders » laissait modifier les rappels de
--    tout le monde (même sans compte). Remplacée par « chacun ses rappels » (la clé service n'en a pas besoin).

begin;

-- 1. Hydromatch ---------------------------------------------------------------------------------------
-- Accès à hydromatch.lgef.fr/admin.html : liste nominative (Anthony Drouhin, Giovanni Verna) ; toute
-- autre personne en fait la demande et est ajoutée dans hydromatch_admins.
create table if not exists public.hydromatch_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.hydromatch_admins enable row level security;
-- Aucune règle : table lue seulement par la fonction ci-dessous (et la clé service).

create or replace function public.hydromatch_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.hydromatch_admins a where a.user_id = auth.uid())
$$;
revoke execute on function public.hydromatch_is_admin() from public, anon;
grant execute on function public.hydromatch_is_admin() to authenticated;

insert into public.hydromatch_admins (user_id) values
  ('070fe01c-43ac-4740-91f2-d6f9e00c4aac'), -- Anthony Drouhin
  ('533d3fce-4278-4e52-a373-4d790839b7d3')  -- Giovanni Verna
on conflict do nothing;

drop policy if exists "Select public" on public.hydromatch_inscriptions;
drop policy if exists "Update authentifié seulement" on public.hydromatch_inscriptions;
drop policy if exists hydromatch_admin_select on public.hydromatch_inscriptions;
drop policy if exists hydromatch_admin_update on public.hydromatch_inscriptions;
drop policy if exists hydromatch_admin_delete on public.hydromatch_inscriptions;
create policy hydromatch_admin_select on public.hydromatch_inscriptions for select to authenticated
  using ((select public.hydromatch_is_admin()));
create policy hydromatch_admin_update on public.hydromatch_inscriptions for update to authenticated
  using ((select public.hydromatch_is_admin())) with check ((select public.hydromatch_is_admin()));
create policy hydromatch_admin_delete on public.hydromatch_inscriptions for delete to authenticated
  using ((select public.hydromatch_is_admin()));
revoke update, delete, truncate on public.hydromatch_inscriptions from anon;

-- 2. Profils : colonnes sensibles fermées aux sessions --------------------------------------------------
revoke select on public.profiles from anon, authenticated;
grant select (
  id, first_name, last_name, email, role, created_at, updated_at, sector, avatar_url, default_calendar_view, theme,
  employment_type, has_ged_access, organisation_id, notify_email, notify_push, hate_alert_email, hate_alert_push,
  expense_validator_id, daily_digest_email, daily_digest_sent_on, birthday_announced_on, calendar_prefs,
  notification_prefs, address_private
) on public.profiles to authenticated;
-- Non accordées : home_address, home_coordinates, license_plate, has_company_car, birth_date.

-- 3. Rappels -----------------------------------------------------------------------------------------
drop policy if exists "Service role updates reminders" on public.event_reminders;
drop policy if exists "User updates own reminders" on public.event_reminders;
create policy "User updates own reminders" on public.event_reminders for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

commit;
