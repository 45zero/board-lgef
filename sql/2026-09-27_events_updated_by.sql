-- Qui a modifié un événement en dernier : renseigné automatiquement à chaque UPDATE par
-- l'utilisateur connecté (auth.uid()), quelle que soit l'appli (board ou calendrier). Les mises
-- à jour système (cron, service role : auth.uid() nul) gardent la valeur précédente.
-- updated_at est déjà tenu à jour par le trigger existant update_events_updated_at.

create or replace function public.set_event_updated_by()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_event_updated_by_trigger on public.events;
create trigger set_event_updated_by_trigger
  before update on public.events
  for each row execute function public.set_event_updated_by();
