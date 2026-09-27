-- Habillages des publications (photo prise sur mobile → gabarit LGEF + texte), réglables par un
-- administrateur : tailles du logo et du texte, signature, gabarits intégrés actifs, et gabarits
-- personnalisés (calques PNG transparents 1080 × 1350 / 1080 × 1080 déposés dans board-assets).
alter table public.board_settings add column if not exists habillage jsonb not null default '{}'::jsonb;

-- Visuels du board lisibles publiquement (le canvas du navigateur doit pouvoir les charger en CORS).
insert into storage.buckets (id, name, public)
values ('board-assets', 'board-assets', true)
on conflict (id) do nothing;
