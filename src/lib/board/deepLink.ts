// Liens directs vers un module du board (e-mails de notification) : /?app=frais, /?app=weekend…
// Lu une fois à l'ouverture, puis retiré de l'adresse. L'événement s'ouvre avec ?openEvent=<id>
// (voir EventOpener).

export function readAppParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("app");
}

/** Transfert à ouvrir dans LGEF Transfer (/?app=transfer&openTransfer=<id>, notification « transfert partagé »). */
export function readOpenTransferParam(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URL(window.location.href).searchParams.get("openTransfer");
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

export function clearOpenTransferParam() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("openTransfer")) return;
  url.searchParams.delete("openTransfer");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/** Dossier à ouvrir dans l'onglet Tournois (/?app=tournois&openTournoi=<id>, notifications « tournoi »). */
export function readOpenTournoiParam(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URL(window.location.href).searchParams.get("openTournoi");
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

export function clearOpenTournoiParam() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("openTournoi")) return;
  url.searchParams.delete("openTournoi");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

export function clearAppParam() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("app")) return;
  url.searchParams.delete("app");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}

/** Boîte à ouvrir dans Mails (/?app=mails&mailAccount=<id>, notification d'un nouveau mail). */
export function readOpenMailAccountParam(): string | null {
  if (typeof window === "undefined") return null;
  const id = new URL(window.location.href).searchParams.get("mailAccount");
  return id && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}

export function clearOpenMailAccountParam() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("mailAccount")) return;
  url.searchParams.delete("mailAccount");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
