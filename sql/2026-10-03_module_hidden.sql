-- Modules « masqués — en préparation » : un administrateur ou un super user peut masquer un module
-- à tout le monde sans perdre sa règle d'accès (rôles, pôles, personnes). Un module masqué n'est
-- visible que des administrateurs et super users (can_see_module), et sa règle ne désigne plus
-- personne (pas de notification « Média à publier »…). Pour présenter les modules petit à petit.

alter table public.module_access add column if not exists hidden boolean not null default false;

create or replace function public.module_rule_matches(uid uuid, p_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when m.module_id is null then true
    when m.hidden then false
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

-- Modules pas encore construits (écran « à venir ») : masqués d'office, à démasquer quand ils sont prêts.
insert into public.module_access (module_id, hidden)
values ('planning', true), ('quiz', true), ('pointage', true), ('formations', true), ('arbitrage', true),
       ('compta', true), ('communication', true), ('administration', true)
on conflict (module_id) do update set hidden = true;
