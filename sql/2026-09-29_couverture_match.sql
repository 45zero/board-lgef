-- Couverture match : le réseau photo accueille aussi les vidéastes (spécialité tech-video), pour
-- avoir au même endroit tous les intervenants des matchs. La vidéo reste attribuée par
-- coverage_requests ; tech-video fait apparaître la personne dans la liste des vidéastes.
-- Appliquée à la main sur le projet Supabase partagé.

insert into public.specialties (label, slug, domain)
select 'Vidéaste', 'tech-video', 'technician'
where not exists (select 1 from public.specialties where slug = 'tech-video');

-- Correctif : le pôle « Technicien — Tirages de coupes » a pour slug tech-tirages_coupes, mais la
-- règle de création d'événements (ev_insert_technician_by_specialty) le cherchait sous
-- tech-tirages-coupes : ce pôle ne permettait pas de créer d'événement de tirage.
insert into public.specialty_event_types (specialty_slug, event_type)
values ('tech-tirages_coupes', 'tirages_coupes')
on conflict do nothing;
