-- Déclarations de frais « en attente » sans aucune ligne ni montant, envoyées par l'ancienne appli
-- calendrier quand on validait une fiche vide (ex. 8 chez Kevin Fernandez le 19/10/2026).
-- Le board les traite déjà comme « pas de frais » (isEmptyDeclaration) ; ceci range la base pareil.
-- Seulement celles sans aucune ligne de frais saisie depuis sur l'événement.

update public.expense_submissions s
set status = 'no_expense', updated_at = now()
where s.status in ('pending', 'revision_requested')
  and coalesce(s.total_amount, 0) = 0
  and coalesce(cardinality(s.expense_ids), 0) = 0
  and not exists (
    select 1 from public.event_expenses e
    where e.user_id = s.user_id
      and (e.event_id = s.event_id or (s.event_id is null and e.event_id is null))
  );
