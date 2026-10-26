import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { AuthProvider } from "@/contexts/AuthContext";
import "./globals.css";

// Polices hébergées dans le projet (versions variables officielles de Google Fonts) : le build ne
// dépend plus du téléchargement de Google Fonts, qui faisait échouer Turbopack sur Vercel.
const manrope = localFont({
  src: "./fonts/Manrope-Variable.ttf",
  weight: "200 800",
  display: "swap",
  variable: "--font-manrope",
});

const jetbrainsMono = localFont({
  src: "./fonts/JetBrainsMono-Variable.ttf",
  weight: "100 800",
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  title: "Board LGEF",
  description: "Espace de travail centralisé de l'écosystème LGEF.",
};

// Navigateur mobile (Chrome Android…) : le clavier réduit la page au lieu de la recouvrir, la zone
// de saisie en bas d'écran (discussions, commentaires…) reste au-dessus du clavier.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className={`${manrope.variable} ${jetbrainsMono.variable}`}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
