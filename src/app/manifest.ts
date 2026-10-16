import type { MetadataRoute } from "next";

// Manifeste de l'appli web : nom, icône et fenêtre sans barre d'adresse quand le board est ajouté
// au Dock du Mac (Safari > Fichier > Ajouter au Dock) ou à l'écran d'accueil d'un téléphone.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Board LGEF",
    short_name: "Board LGEF",
    description: "Espace de travail centralisé de l'écosystème LGEF.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#12305f",
    theme_color: "#0b1d3c",
    lang: "fr",
    icons: [
      { src: "/icon.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
