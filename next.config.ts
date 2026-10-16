import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // FFmpeg (habillage des vidéos) : binaire natif, chargé tel quel par Node et embarqué dans la
  // fonction de la route (le paquet de la plateforme n'est pas « requis », il faut l'inclure).
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/media/video-habillage": ["./node_modules/@ffmpeg-installer/linux-x64/**/*"],
    "/api/media/habillage-animation": ["./node_modules/@ffmpeg-installer/linux-x64/**/*"],
  },
  // Liens de l'ancienne appli calendrier-lgef (push et e-mails de ses messages, encore envoyés tant
  // qu'elle est utilisée) : ils ouvrent la discussion de l'événement dans la bulle au lieu d'une 404.
  async redirects() {
    const uuid = "(?<ev>[0-9a-fA-F-]{36})";
    const toChat = "/?openChat=event%3A:ev";
    return [
      { source: "/messages", has: [{ type: "query", key: "event", value: uuid }], destination: toChat, permanent: false },
      { source: "/messages", has: [{ type: "query", key: "event_id", value: uuid }], destination: toChat, permanent: false },
      { source: "/messages/:ev([0-9a-fA-F-]{36})", destination: toChat, permanent: false },
      { source: "/dashboard", has: [{ type: "query", key: "event", value: uuid }], destination: toChat, permanent: false },
      { source: "/messages", destination: "/", permanent: false },
      { source: "/dashboard", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
