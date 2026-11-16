import type { Metadata, Viewport } from "next";

// FIEF — Femmes Investies dans l'Encadrement du Football (fief.lgef.fr, voir src/proxy.ts).
// Habillage propre, sans rien du board : titre, icônes, appli installable (PWA), thème clair / sombre
// (couleurs .fief-theme dans globals.css ; choix enregistré sur l'appareil, sinon réglage du téléphone).

export const metadata: Metadata = {
  title: { default: "FIEF — L'espace des femmes du football du Grand Est", template: "%s · FIEF" },
  description: "FIEF, le réseau des femmes engagées dans le football du Grand Est, proposé par la Ligue du Grand Est de Football.",
  manifest: "/fief/manifest.webmanifest",
  icons: { icon: "/fief/icon-192.png", apple: "/fief/apple-icon.png" },
  appleWebApp: { capable: true, title: "FIEF", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0E2754" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0f17" },
  ],
};

// Thème posé avant le premier affichage (pas d'éclair blanc en mode sombre).
const THEME_SCRIPT = `try{var t=localStorage.getItem("fief-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.fiefTheme=t}catch(e){}`;

export default function FiefLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fief-theme min-h-dvh bg-f-bg font-[family-name:var(--font-manrope)] text-f-text antialiased">
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      {children}
    </div>
  );
}
