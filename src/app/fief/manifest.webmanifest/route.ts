// Manifeste de l'appli FIEF installable (écran d'accueil du téléphone). Sur fief.lgef.fr l'appli
// démarre à la racine ; ailleurs (board, aperçus) sous /fief.

export function GET(request: Request) {
  const onFiefHost = (request.headers.get("host") ?? "").startsWith("fief.");
  const base = onFiefHost ? "/" : "/fief";
  return Response.json(
    {
      name: "FIEF — Femmes Investies dans l'Encadrement du Football",
      short_name: "FIEF",
      description: "L'espace des femmes du football du Grand Est",
      start_url: base,
      scope: base,
      display: "standalone",
      background_color: "#0E2754",
      theme_color: "#0E2754",
      lang: "fr",
      icons: [
        { src: "/fief/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any maskable" },
        { src: "/fief/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ],
    },
    { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } }
  );
}
