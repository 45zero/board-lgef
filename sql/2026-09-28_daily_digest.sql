-- Programme de la journée par e-mail (7 h, heure de Paris), activé par chacun dans ses paramètres.
-- daily_digest_sent_on : date (Paris) du dernier envoi, pour ne jamais envoyer deux fois le même jour.
alter table public.profiles add column if not exists daily_digest_email boolean not null default false;
alter table public.profiles add column if not exists daily_digest_sent_on date;
