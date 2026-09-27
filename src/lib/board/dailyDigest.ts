import "server-only";
import type { Dashboard } from "@/lib/board/dashboardCore";
import type { ResendMessage } from "@/lib/email/resend";

// Mail « Ta journée » envoyé à 7 h (heure de Paris) : les actions à faire et le programme du jour,
// exactement ce qu'affiche le tableau de bord du board.

const PARIS = "Europe/Paris";

export function parisToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: PARIS, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function parisHour(): number {
  return Number(new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS, hour: "2-digit", hour12: false }).format(new Date()));
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const time = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const TONE_COLOR = { red: "#E1141B", orange: "#D98A0B", navy: "#12305F" } as const;

/** Rien à signaler (aucune action, aucun événement) : pas de mail ce jour-là. */
export function hasContent(d: Dashboard) {
  return d.actions.length > 0 || d.programme.length > 0;
}

export function renderDailyDigest(d: Dashboard, email: string): ResendMessage {
  const board = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const dayLabel = new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS, weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const total = d.actions.reduce((n, a) => n + a.count, 0);

  const actionsHtml = d.actions.length
    ? d.actions
        .map(
          (a) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eef0f3">
  <span style="display:inline-block;min-width:26px;padding:2px 8px;border-radius:12px;background:${TONE_COLOR[a.tone]};color:#fff;font-weight:700;font-size:13px;text-align:center">${a.count}</span>
  <strong style="margin-left:8px">${escapeHtml(a.title)}</strong>
  <div style="margin-left:42px;color:#6b7280;font-size:12px">${escapeHtml(a.detail)}</div>
</td></tr>`
        )
        .join("")
    : `<tr><td style="padding:8px 0;color:#1F7A4D">✓ Rien à faire pour l'instant, tout est à jour.</td></tr>`;

  const programmeHtml = d.programme.length
    ? d.programme
        .map(
          (p) => `<tr><td style="padding:8px 0;border-bottom:1px solid #eef0f3;vertical-align:top;width:56px;font-family:monospace;font-weight:700">${time(p.start)}</td>
<td style="padding:8px 0;border-bottom:1px solid #eef0f3">
  <strong>${escapeHtml(p.title)}</strong>
  <div style="color:#6b7280;font-size:12px">${escapeHtml(p.roles.join(", "))}${p.location ? ` · ${escapeHtml(p.location)}` : ""}</div>
</td></tr>`
        )
        .join("")
    : `<tr><td style="padding:8px 0;color:#6b7280">Aucun événement où vous êtes sollicité aujourd'hui.</td></tr>`;

  const subject = `Votre journée — ${total > 0 ? `${total} action${total > 1 ? "s" : ""}` : "rien à faire"} · ${d.programme.length} événement${d.programme.length > 1 ? "s" : ""}`;

  const html = `<div style="font-family:Arial,sans-serif;color:#0E2A55;max-width:620px">
<div style="background:linear-gradient(160deg,#12305F,#2F52B0);color:#fff;padding:22px 24px;border-radius:12px">
  <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.75">${escapeHtml(dayLabel)}</div>
  <div style="font-size:22px;font-weight:800;margin-top:6px">Bonjour${d.firstName ? ` ${escapeHtml(d.firstName)}` : ""}.</div>
  <div style="font-size:14px;opacity:.85;margin-top:4px">Voici votre journée sur le board LGEF.</div>
</div>
<h3 style="margin:22px 0 4px;font-size:15px">Mes actions</h3>
<table style="width:100%;border-collapse:collapse;font-size:14px">${actionsHtml}</table>
<h3 style="margin:22px 0 4px;font-size:15px">Mon programme aujourd'hui</h3>
<table style="width:100%;border-collapse:collapse;font-size:14px">${programmeHtml}</table>
<p style="margin-top:22px"><a href="${escapeHtml(board)}" style="background:#E1141B;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:700">Ouvrir le board</a></p>
<p style="font-size:12px;color:#6b7280">Vous recevez ce mail car le « programme de la journée » est activé dans vos paramètres du board (Notifications). Désactivez-le à tout moment au même endroit.</p>
</div>`;

  const text = `${subject}\n\nMes actions :\n${
    d.actions.map((a) => `- ${a.count} × ${a.title}`).join("\n") || "- Rien à faire."
  }\n\nMon programme aujourd'hui :\n${
    d.programme.map((p) => `- ${time(p.start)} ${p.title} (${p.roles.join(", ")})${p.location ? ` — ${p.location}` : ""}`).join("\n") || "- Aucun événement."
  }\n\n${board}`;

  return { to: [email], subject, html, text };
}
