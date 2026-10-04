"use client";

/**
 * Présence du comité directeur sur un événement (calendrier) : « CD » plein quand un membre a
 * confirmé, en orange quand sa réponse est attendue, barré quand il a décliné sans remplaçant.
 */
export function DirectorGlyph({ status, size = 10 }: { status?: "approved" | "pending" | "denied" | null; size?: number }) {
  if (!status) return null;
  const style =
    status === "approved"
      ? { background: "#12305F", color: "#fff", borderColor: "#12305F" }
      : status === "pending"
        ? { background: "transparent", color: "#B26B00", borderColor: "#D98A0B" }
        : { background: "transparent", color: "#A50E15", borderColor: "#E1141B", textDecoration: "line-through" };
  const title =
    status === "approved"
      ? "Comité directeur : présence confirmée"
      : status === "pending"
        ? "Comité directeur : présence sollicitée, réponse attendue"
        : "Comité directeur : a décliné";
  return (
    <span
      title={title}
      aria-label={title}
      className="inline-flex shrink-0 items-center justify-center rounded-[3px] border font-extrabold leading-none"
      style={{ ...style, fontSize: size * 0.72, height: size + 2, padding: "0 2px" }}
    >
      CD
    </span>
  );
}
