-- Discussions entre utilisateurs (bulle « Discussions »), hors événement : conversation à deux ou
-- en groupe, mêmes possibilités que les discussions d'événements (réponses, ❤️, photos et
-- fichiers dans le bucket event-files dossier chats/, vocaux), lu / non lu et archivage par membre.
-- Lecture et écriture uniquement par les actions serveur (service role), après contrôle que
-- l'utilisateur est membre : RLS activée sans politique pour anon / authenticated.

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz
);
alter table public.chat_conversations enable row level security;

create table if not exists public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  archived_at timestamptz,
  primary key (conversation_id, user_id)
);
create index if not exists chat_conversation_members_user_idx on public.chat_conversation_members (user_id);
alter table public.chat_conversation_members enable row level security;

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  parent_id uuid references public.chat_messages(id) on delete set null,
  mentions uuid[],
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_conversation_idx on public.chat_messages (conversation_id, created_at);
alter table public.chat_messages enable row level security;

create table if not exists public.chat_message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  path text not null,
  filename text not null,
  content_type text,
  size_bytes bigint,
  kind text not null default 'file' check (kind in ('file', 'image', 'audio')),
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists chat_message_attachments_message_idx on public.chat_message_attachments (message_id);
alter table public.chat_message_attachments enable row level security;

create table if not exists public.chat_message_reactions (
  message_id uuid not null references public.chat_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'like' check (type = 'like'),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, type)
);
alter table public.chat_message_reactions enable row level security;

-- Notification d'un message direct : push et bulle (pas la cloche, pas d'e-mail).
alter type public.notification_type add value if not exists 'direct_message';
