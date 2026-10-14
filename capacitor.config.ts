import type { CapacitorConfig } from "@capacitor/cli";

// Appli mobile « Board LGEF » : coque native qui ouvre le board en ligne (mises à jour sans
// republier l'appli). Même identifiant que l'ancienne appli « Calendrier LGEF » : publiée comme
// une mise à jour de ses fiches Play Store / App Store, push via sa configuration Firebase.
const config: CapacitorConfig = {
  appId: "com.lgef.calendrier",
  appName: "Board LGEF",
  // Page de secours (hors connexion) ; le contenu vient de server.url.
  webDir: "capacitor/www",
  server: {
    url: "https://board-lgef.vercel.app",
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    // Android 15+ (bord à bord imposé) : le board s'arrête sous la barre d'état et au-dessus de la
    // barre de navigation, sur fond bleu marine (styles.xml), au lieu de passer dessous.
    adjustMarginsForEdgeToEdge: "auto",
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
  },
};

export default config;
