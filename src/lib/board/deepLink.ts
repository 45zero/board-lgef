// Liens directs vers un module du board (e-mails de notification) : /?app=frais, /?app=weekend…
// Lu une fois à l'ouverture, puis retiré de l'adresse. L'événement s'ouvre avec ?openEvent=<id>
// (voir EventOpener).

export function readAppParam(): string | null {
  if (typeof window === "undefined") return null;
  return new URL(window.location.href).searchParams.get("app");
}

export function clearAppParam() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("app")) return;
  url.searchParams.delete("app");
  window.history.replaceState(null, "", url.pathname + url.search + url.hash);
}
