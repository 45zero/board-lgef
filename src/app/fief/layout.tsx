import type { Metadata, Viewport } from "next";

// FIEF — Femmes Investies dans l'Environnement du Football (fief.lgef.fr, voir src/proxy.ts).
// Habillage propre, sans rien du board : titre, icônes et appli installable (PWA) FIEF.

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
  themeColor: "#0E2754",
  viewportFit: "cover",
};

export default function FiefLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-[#F3F6FB] font-[family-name:var(--font-manrope)] antialiased">{children}</div>;
}
