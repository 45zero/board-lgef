"use client";

const PALETTE = [
  "#7C5CBF",
  "#D9822B",
  "#2E86AB",
  "#C0392B",
  "#1F7A4D",
  "#8E44AD",
  "#B8860B",
  "#16697A",
  "#A23E48",
  "#4B6584",
];

function hashString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** "Sophie Lambert <s.lambert@lgef.fff.fr>" → "Sophie Lambert" ; sans nom, retombe sur l'email. */
export function parseSenderName(from: string) {
  const match = from.match(/^"?([^"<]*?)"?\s*<[^>]+>$/);
  const name = (match?.[1] ?? from).trim();
  return name || from.trim();
}

function initialsFor(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Avatar rond façon Outlook — pas de photo réelle (nécessiterait l'API People), juste des initiales colorées déterministes. */
export function SenderAvatar({ name, size = 36 }: { name: string; size?: number }) {
  const displayName = parseSenderName(name);
  const color = PALETTE[hashString(displayName) % PALETTE.length];
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: color, fontSize: size * 0.38 }}
    >
      {initialsFor(displayName)}
    </div>
  );
}
