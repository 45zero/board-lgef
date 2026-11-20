-- Suppression de 3 comptes demandée par Giovanni le 20/11/2026 :
--   Fred Acker (direction@upskillz.fr, compte de test ; le vrai compte Frédéric ACKER facker@lgef.fff.fr est gardé),
--   Animateur District (ton@email.com, admin générique), gio verna (verna.gio57@gmail.com, second compte admin).
-- Avant suppression : les événements et demandes de captation de Fred Acker passent sur le compte principal
-- de Giovanni (gverna@lgef.fff.fr), qui les avait créés en test, pour ne rien retirer du calendrier.
-- Le reste (commentaires de test, note de test de 144,45 €, notifications, événement « ccc » de gio verna,
-- assignations) part en cascade avec les comptes.

begin;

do $$
declare
  me constant uuid := '533d3fce-4278-4e52-a373-4d790839b7d3';
  gone constant uuid[] := array['efe7f13f-5bd2-4636-b19c-00a72e2511ed', 'e996b7d8-24da-40aa-9842-29e688466d64', '7c3ad420-dcab-4141-a48f-9281f6b43dae']::uuid[];
  fred constant uuid := 'efe7f13f-5bd2-4636-b19c-00a72e2511ed';
begin
  update events set created_by = me where created_by = fred;
  update events set organizer_id = me where organizer_id = fred;
  update events set updated_by = me where updated_by = any(gone);
  update coverage_requests set requester_id = me where requester_id = fred;
  delete from auth.users where id = any(gone);
  if exists (select 1 from profiles where id = any(gone)) then
    delete from profiles where id = any(gone);
  end if;
end $$;

commit;
