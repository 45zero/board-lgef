import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Board LGEF",
  description: "Espace de travail centralisé de l'écosystème LGEF.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
