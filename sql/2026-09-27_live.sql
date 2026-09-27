-- Board en direct : les tables dont les changements doivent mettre à jour l'écran immédiatement
-- (pastilles, cloche, tableau de bord, calendrier, inscriptions, frais) sont publiées dans
-- supabase_realtime. Chaque utilisateur ne reçoit que les lignes que la RLS l'autorise à lire.
do $$
declare
  t text;
begin
  foreach t in array array[
    'events', 'coverage_requests', 'director_attendance', 'event_assignments', 'event_team_members',
    'media_publications', 'comment_moderation', 'event_registration_campaigns', 'event_registration_recipients',
    'event_expenses', 'expense_submissions'
  ] loop
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Notification in-app à l'organisateur quand quelqu'un répond à une invitation.
alter type public.notification_type add value if not exists 'registration_response';
