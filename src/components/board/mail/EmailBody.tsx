"use client";

/**
 * Corps de message Gmail — beaucoup de mails n'ont qu'une partie HTML (pas de
 * texte brut). Avant, on affichait bodyHtml tel quel dans du texte brut : les
 * balises apparaissaient littéralement à l'écran. On le rend maintenant dans
 * une iframe sandboxée (pas de scripts, pas d'accès à la page hôte) pour un
 * rendu correct sans risque XSS.
 */
export function EmailBody({
  bodyText,
  bodyHtml,
  className = "h-[420px]",
}: {
  bodyText: string;
  bodyHtml: string;
  className?: string;
}) {
  if (bodyHtml) {
    return (
      <iframe
        srcDoc={bodyHtml}
        sandbox="allow-popups allow-popups-to-escape-sandbox"
        title="Contenu du message"
        className={`w-full rounded-btn border border-line bg-white ${className}`}
      />
    );
  }
  if (bodyText) {
    return <div className="whitespace-pre-wrap text-sm text-ink-2">{bodyText}</div>;
  }
  return <div className="text-sm text-ink-4">(message vide)</div>;
}
