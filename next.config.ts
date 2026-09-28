import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // FFmpeg (habillage des vidéos) : binaire natif, chargé tel quel par Node et embarqué dans la
  // fonction de la route (le paquet de la plateforme n'est pas « requis », il faut l'inclure).
  serverExternalPackages: ["@ffmpeg-installer/ffmpeg"],
  outputFileTracingIncludes: {
    "/api/media/video-habillage": ["./node_modules/@ffmpeg-installer/linux-x64/**/*"],
    "/api/media/habillage-animation": ["./node_modules/@ffmpeg-installer/linux-x64/**/*"],
  },
};

export default nextConfig;
