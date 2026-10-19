-- LGEF Transfer : faire suivre un transfert, et le joindre à une carte de l'Espace Team.
--
-- - transfer_forwards : « Faire suivre » depuis le board. Un membre qui voit un transfert (le sien,
--   ou un transfert reçu à son adresse) envoie le lien à d'autres adresses, avec un mot. Les
--   destinataires d'origine ne changent pas ; un membre du board à qui l'on fait suivre retrouve
--   le transfert dans « Partagés avec moi ». Écrit et lu par le serveur (service role) après contrôle.
-- - team_card_transfers : transfert joint à une carte. Les fichiers sont COPIÉS dans la carte
--   (Drive du board, comme les pièces jointes) : ils restent quand le lien expire. On garde un
--   instantané (titre, expéditeur, code) pour que la carte reste lisible après suppression du transfert.
--   Droits comme team_card_emails : voir la carte → voir ; modifier la carte → joindre ;
--   délier : celui qui a joint ou quiconque peut modifier la carte.
-- À appliquer à la main sur le projet Supabase partagé.

begin;

create table if not exists public.transfer_forwards (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.transfers(id) on delete cascade,
  forwarded_by uuid references public.profiles(id) on delete set null,
  recipients text[] not null check (cardinality(recipients) between 1 and 50),
  note text not null default '' check (length(note) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists transfer_forwards_transfer_idx on public.transfer_forwards (transfer_id, created_at desc);
create index if not exists transfer_forwards_recipients_idx on public.transfer_forwards using gin (recipients);
create index if not exists transfers_recipients_idx on public.transfers using gin (recipients);

alter table public.transfer_forwards enable row level security;
-- Aucune politique : serveur uniquement.

create table if not exists public.team_card_transfers (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.team_cards(id) on delete cascade,
  transfer_id uuid references public.transfers(id) on delete set null,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  code text not null,
  title text not null default '',
  sender_email text not null default '',
  sender_name text not null default '',
  file_count int not null default 0,
  total_bytes bigint not null default 0,
  -- Fichiers copiés dans la carte (0 si la copie n'a pas été demandée).
  files_copied int not null default 0,
  -- Copies dans le Drive du board : [{ "id", "name", "mimeType", "size" }] — aperçu et
  -- téléchargement depuis la carte, même après l'expiration du lien.
  files jsonb not null default '[]'::jsonb,
  unique (card_id, transfer_id)
);
create index if not exists team_card_transfers_card_idx on public.team_card_transfers (card_id);
create index if not exists team_card_transfers_transfer_idx on public.team_card_transfers (transfer_id);

alter table public.team_card_transfers enable row level security;

drop policy if exists team_card_transfers_select on public.team_card_transfers;
create policy team_card_transfers_select on public.team_card_transfers for select using (team_can_see_card(card_id, auth.uid()));
drop policy if exists team_card_transfers_insert on public.team_card_transfers;
create policy team_card_transfers_insert on public.team_card_transfers for insert
  with check (linked_by = auth.uid() and team_can_edit_card(card_id, auth.uid()));
drop policy if exists team_card_transfers_delete on public.team_card_transfers;
create policy team_card_transfers_delete on public.team_card_transfers for delete
  using (linked_by = auth.uid() or team_can_edit_card(card_id, auth.uid()));

grant select, insert, delete on public.team_card_transfers to authenticated;

commit;
