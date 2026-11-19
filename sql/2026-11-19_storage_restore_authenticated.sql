-- Correction de sql/2026-11-19_storage_private_buckets.sql : il bloquait des envois réels des comptes connectés
-- (techniciens : pièces jointes de frais dans attachments/expense_attachments, justificatifs dans
-- expense_scans, factures prestataire dans invoices/prestataire_invoices — appli calendrier), qui passaient
-- par les deux règles génériques.
--
-- On rétablit À L'IDENTIQUE l'accès des personnes CONNECTÉES (lecture et envoi dans tous les buckets sauf
-- ir2f-*, comme avant le 19/11). Seule différence conservée : les visiteurs SANS COMPTE ne lisent plus que
-- les buckets publics (ils n'avaient aucun usage légitime des buckets privés : Hydromatch et LGEF Transfer
-- ont leurs propres règles). Aucun fichier n'est touché.

begin;

-- Envoi : identique à la règle d'origine (connectés, tous buckets sauf ir2f-*).
drop policy if exists "allow_authenticated_uploads 1mt4rzk_0" on storage.objects;
create policy "allow_authenticated_uploads 1mt4rzk_0" on storage.objects for insert to public
  with check ((auth.role() = 'authenticated'::text) and (bucket_id !~~ 'ir2f-%'::text));

-- Lecture : connectés = identique à l'origine (tous buckets sauf ir2f-*) ;
-- visiteurs = buckets publics seulement, hors expense_scans.
drop policy if exists "public_read 1mt4rzk_0" on storage.objects;
create policy "public_read 1mt4rzk_0" on storage.objects for select to authenticated
  using (bucket_id !~~ 'ir2f-%'::text);
drop policy if exists "public_read_anon_public_buckets" on storage.objects;
create policy "public_read_anon_public_buckets" on storage.objects for select to anon
  using (
    bucket_id !~~ 'ir2f-%'
    and bucket_id <> 'expense_scans'
    and bucket_id in (select b.id from storage.buckets b where b.public)
  );

-- Factures : invoices_public_read (supprimée) donnait la lecture à tous ; les connectés la retrouvent
-- par « public_read 1mt4rzk_0 » ci-dessus, les visiteurs non.

commit;
