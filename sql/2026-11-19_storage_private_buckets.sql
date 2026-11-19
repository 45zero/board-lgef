-- Stockage : fermer les buckets PRIVÉS aux visiteurs et aux comptes quelconques (audit du 19/11).
-- Aucun fichier n'est supprimé ni déplacé.
--
-- Constat (testé avec la clé publique, sans compte) : un visiteur liste et télécharge les fichiers de
-- invoices, event-files, attachments, support, coverage-files… à cause de deux règles génériques
-- (modèle du tableau de bord Supabase, suffixe 1mt4rzk_0) et d'une règle invoices_public_read :
--   - « public_read 1mt4rzk_0 »                 : lecture de TOUS les buckets sauf ir2f-*, pour tout le monde ;
--   - « allow_authenticated_uploads 1mt4rzk_0 » : envoi dans TOUS les buckets sauf ir2f-*, pour tout compte ;
--   - « invoices_public_read »                  : lecture de toutes les factures, pour tout le monde.
--
-- Le board n'en dépend pas : ses envois vers les buckets privés passent par des URL signées
-- (createSignedUploadUrl côté serveur) ou par la clé service, et ses lectures par la clé service ou par
-- les règles dédiées (event-files-select, invoices_read_owner_or_admin, coverage…), qui restent en place.
--
-- On garde le comportement des deux règles génériques pour les buckets PUBLICS (autres applis : quiz,
-- organisations, accréditations…), sauf expense_scans (justificatifs de frais) qu'on ne laisse plus lister.

begin;

drop policy if exists "invoices_public_read" on storage.objects;

drop policy if exists "public_read 1mt4rzk_0" on storage.objects;
create policy "public_read 1mt4rzk_0" on storage.objects for select to public
  using (
    bucket_id !~~ 'ir2f-%'
    and bucket_id <> 'expense_scans'
    and bucket_id in (select b.id from storage.buckets b where b.public)
  );

drop policy if exists "allow_authenticated_uploads 1mt4rzk_0" on storage.objects;
create policy "allow_authenticated_uploads 1mt4rzk_0" on storage.objects for insert to authenticated
  with check (
    bucket_id !~~ 'ir2f-%'
    and bucket_id <> 'expense_scans'
    and bucket_id in (select b.id from storage.buckets b where b.public)
  );

commit;
