// Service worker FIEF : affiche les notifications push envoyées par src/lib/fief/push.ts et ouvre la
// page concernée au clic. Sur fief.lgef.fr il est servi à /sw.js (portée « / ») ; sur le domaine du
// board à /fief/sw.js (portée « /fief/ »), d'où le préfixe calculé ci-dessous.

const PREFIX = new URL(self.registration.scope).pathname.startsWith("/fief") ? "/fief" : "";

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "FIEF", {
      body: payload.body || "",
      icon: "/fief/icon-192.png",
      badge: "/fief/icon-192.png",
      tag: payload.tag || undefined,
      data: { route: payload.route || "/" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = event.notification.data?.route || "/";
  const url = new URL(PREFIX + (route === "/" && PREFIX ? "" : route), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    })
  );
});
