import "server-only";
import type { ResendMessage } from "@/lib/email/resend";

// E-mails des notifications du board (voir /api/cron/notification-emails) : un e-mail par
// notification, en-tête LGEF, infos de l'événement et boutons d'action directs. Les demandes qui
// attendent une réponse (couverture, comité directeur) ont leurs boutons Accepter / Refuser ; les
// autres un bouton qui ouvre le bon endroit du board.

export type EmailNotification = {
  id: string;
  type: string;
  title: string | null;
  message: string | null;
  actor_name: string | null;
  data: Record<string, unknown> | null;
  eventId: string | null;
};

export type EmailEvent = { id: string; title: string; start_date: string; end_date: string | null; location: string | null };

/** Demandes avec réponse directe depuis l'e-mail (page /action/<jeton>). */
export const CHOICES: Record<string, { accept: string; refuse: string; question: string }> = {
  coverage_assignment: { accept: "Accepter la mission", refuse: "Refuser", question: "Acceptez-vous de couvrir cet événement ?" },
  director_invitation: { accept: "Je serai présent", refuse: "Je ne pourrai pas", question: "Serez-vous présent pour représenter le comité directeur ?" },
};

/** Types jamais envoyés par cet e-mail : déjà envoyés par ailleurs (rappels, alertes de modération). */
export const NOT_EMAILED = new Set(["event_reminder", "hateful_comment"]);

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "https://board-lgef.vercel.app").replace(/\/+$/, "");

export function eventWhen(e: Pick<EmailEvent, "start_date">) {
  const opts: Intl.DateTimeFormatOptions = { timeZone: "Europe/Paris" };
  const start = new Date(e.start_date);
  const day = start.toLocaleDateString("fr-FR", { ...opts, weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const hour = start.toLocaleTimeString("fr-FR", { ...opts, hour: "2-digit", minute: "2-digit" });
  return `${day.charAt(0).toUpperCase()}${day.slice(1)} à ${hour}`;
}

/** Lien « ouvrir » : l'événement, ou le module concerné. */
function openLink(n: EmailNotification): { label: string; url: string } {
  const site = siteUrl();
  const app = typeof n.data?.app === "string" ? n.data.app : null;
  if (app === "weekend" && (n.type !== "coverage_assignment" || n.data?.trade === "photo")) return { label: "Voir les matchs du week-end", url: `${site}/?app=weekend` };
  switch (n.type) {
    case "expense_to_validate":
      return { label: "Valider les frais", url: `${site}/?app=frais` };
    case "expense_approved":
    case "expense_rejected":
      return { label: "Voir mes frais", url: `${site}/?app=frais` };
    case "publication_to_publish":
      return { label: "Ouvrir le centre de publication", url: `${site}/?app=audiovisuel` };
    case "support_ticket":
    case "support_resolved":
      return { label: "Ouvrir le centre d'aide", url: `${site}/?support=${typeof n.data?.support_ticket_id === "string" ? n.data.support_ticket_id : ""}` };
    case "registration_response":
      return { label: "Voir les inscriptions", url: `${site}/?app=inscription` };
    case "card_assigned":
    case "card_mentioned":
    case "card_commented":
    case "card_due_soon":
    case "board_shared":
      return { label: "Ouvrir l'Espace Team", url: `${site}/?app=trello` };
    case "coverage_request":
      if (n.eventId) return { label: "Attribuer la couverture", url: `${site}/?openEvent=${n.eventId}` };
  }
  if (n.eventId) return { label: "Voir l'événement", url: `${site}/?openEvent=${n.eventId}` };
  return { label: "Ouvrir le board", url: site };
}

const button = (label: string, url: string, tone: "red" | "green" | "navy" | "ghost") => {
  const styles = {
    red: "background:#E1141B;color:#fff",
    green: "background:#1F7A4D;color:#fff",
    navy: "background:#12305F;color:#fff",
    ghost: "background:#fff;color:#12305F;border:1px solid #c9d2e3",
  }[tone];
  return `<a href="${esc(url)}" style="${styles};display:inline-block;padding:11px 18px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin:0 8px 8px 0">${esc(label)}</a>`;
};

export function renderNotificationEmail(
  n: EmailNotification,
  recipient: { email: string; firstName: string | null },
  event: EmailEvent | null,
  actionToken: string | null
): ResendMessage {
  const site = siteUrl();
  const title = n.title?.trim() || "Notification du board";
  const message = n.message?.trim() || "";
  const choice = actionToken ? CHOICES[n.type] : undefined;
  const open = openLink(n);

  const subject = event && !title.includes(event.title) ? `${title} — ${event.title}` : title;

  const eventCard = event
    ? `<table style="width:100%;border-collapse:collapse;margin:18px 0;background:#F4F6FA;border-radius:10px">
  <tr><td style="padding:14px 16px">
    <div style="font-size:16px;font-weight:800;color:#0E2A55">${esc(event.title)}</div>
    <div style="font-size:14px;color:#334155;margin-top:6px">📅 ${esc(eventWhen(event))}</div>
    ${event.location ? `<div style="font-size:14px;color:#334155;margin-top:4px">📍 ${esc(event.location)}</div>` : ""}
  </td></tr></table>`
    : "";

  const buttons = choice
    ? `<p style="font-size:15px;font-weight:700;margin:18px 0 10px">${esc(choice.question)}</p>
${button(choice.accept, `${site}/action/${actionToken}?c=accept`, "green")}${button(choice.refuse, `${site}/action/${actionToken}?c=refuse`, "red")}${button(open.label, open.url, "ghost")}`
    : button(open.label, open.url, "navy");

  const html = `<div style="background:#EEF1F6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;color:#0E2A55">
  <div style="background:#12305F;padding:18px 24px">
    <table style="border-collapse:collapse"><tr>
      <td style="padding-right:12px"><img src="${esc(site)}/lgef-logo.png" alt="LGEF" width="40" style="display:block;width:40px;height:auto" /></td>
      <td style="color:#fff"><div style="font-size:15px;font-weight:800">Ligue Grand Est de Football</div><div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.75">Board LGEF</div></td>
    </tr></table>
  </div>
  <div style="padding:24px">
    <div style="font-size:14px;color:#64748b">Bonjour${recipient.firstName ? ` ${esc(recipient.firstName)}` : ""},</div>
    <h1 style="font-size:20px;line-height:1.3;margin:8px 0 6px">${esc(title)}</h1>
    ${message ? `<p style="font-size:15px;line-height:1.5;margin:0;color:#1e293b">${esc(message)}</p>` : ""}
    ${n.actor_name && !title.includes(n.actor_name) && !message.includes(n.actor_name) ? `<p style="font-size:13px;color:#64748b;margin:6px 0 0">De la part de ${esc(n.actor_name)}</p>` : ""}
    ${eventCard}
    <div style="margin-top:8px">${buttons}</div>
  </div>
  <div style="padding:14px 24px;background:#F8FAFC;font-size:12px;color:#64748b;line-height:1.5">
    Vous recevez cet e-mail car les notifications par e-mail sont activées dans vos paramètres du board
    (Paramètres → Notifications). <a href="${esc(site)}" style="color:#12305F">Ouvrir le board</a>
  </div>
</div></div>`;

  const text = [
    `Bonjour${recipient.firstName ? ` ${recipient.firstName}` : ""},`,
    title,
    message,
    event ? `${event.title}\n${eventWhen(event)}${event.location ? `\n${event.location}` : ""}` : "",
    choice ? `${choice.question}\n${choice.accept} : ${site}/action/${actionToken}?c=accept\n${choice.refuse} : ${site}/action/${actionToken}?c=refuse` : "",
    `${open.label} : ${open.url}`,
    "— Board LGEF (Paramètres → Notifications pour gérer ces e-mails)",
  ]
    .filter(Boolean)
    .join("\n\n");

  return { to: [recipient.email], subject, html, text };
}
