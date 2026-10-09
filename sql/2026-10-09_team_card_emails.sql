-- Espace Team : e-mails liés à une carte.
--
-- Un e-mail Gmail (boîte connectée d'une personne) est lié à une carte, depuis l'écran Mails ou
-- depuis la fiche carte. On garde une copie du message (objet, expéditeur, corps) : les autres
-- personnes qui voient la carte n'ont pas accès à la boîte Gmail de celui qui l'a liée.
-- Les pièces jointes de l'e-mail, si demandé, sont copiées comme pièces jointes de la carte (Drive
-- du board) : rien n'est stocké ici, seulement leurs noms.
--
-- Corps limités (texte 100 000, HTML 300 000 caractères) : l'instance Supabase est petite.
-- Droits : voir la carte → voir ses e-mails ; modifier la carte → lier ; délier : celui qui a lié
-- ou quiconque peut modifier la carte.
-- À appliquer à la main sur le projet Supabase partagé.

begin;

create table if not exists public.team_card_emails (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.team_cards(id) on delete cascade,
  linked_by uuid references public.profiles(id) on delete set null,
  linked_at timestamptz not null default now(),
  -- Boîte d'origine et identifiants Gmail (rouvrir le message pour celui qui l'a lié).
  account_email text not null,
  gmail_message_id text not null,
  gmail_thread_id text,
  subject text not null default '',
  from_header text not null default '',
  to_header text not null default '',
  cc_header text not null default '',
  sent_at timestamptz,
  snippet text not null default '',
  body_text text not null default '' check (length(body_text) <= 100000),
  body_html text not null default '' check (length(body_html) <= 300000),
  -- [{ "filename": "...", "mimeType": "...", "size": 123 }]
  attachments jsonb not null default '[]'::jsonb,
  unique (card_id, account_email, gmail_message_id)
);
create index if not exists team_card_emails_card_idx on public.team_card_emails (card_id);

alter table public.team_card_emails enable row level security;

drop policy if exists team_card_emails_select on public.team_card_emails;
create policy team_card_emails_select on public.team_card_emails for select using (team_can_see_card(card_id, auth.uid()));
drop policy if exists team_card_emails_insert on public.team_card_emails;
create policy team_card_emails_insert on public.team_card_emails for insert
  with check (linked_by = auth.uid() and team_can_edit_card(card_id, auth.uid()));
drop policy if exists team_card_emails_delete on public.team_card_emails;
create policy team_card_emails_delete on public.team_card_emails for delete
  using (linked_by = auth.uid() or team_can_edit_card(card_id, auth.uid()));

grant select, insert, delete on public.team_card_emails to authenticated;

commit;
