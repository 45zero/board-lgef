import "server-only";
import type { createServiceClient } from "@/lib/supabase/serviceClient";
import type { ResendMessage } from "@/lib/email/resend";
import { parisToday } from "@/lib/board/dailyDigest";

// Anniversaires (profiles.birth_date) : bandeau d'accueil du jour et mail à tout le personnel,
// envoyé par le cron de 7 h (daily-digest). Seuls le jour et le mois servent, jamais l'année.

type Service = ReturnType<typeof createServiceClient>;

export type Birthday = { id: string; firstName: string; lastName: string };

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Né un 29 février : fêté le 28 les années non bissextiles. */
export function isBirthdayOn(birthDate: string, today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const md = birthDate.slice(5);
  return md === today.slice(5) || (md === "02-29" && !isLeap(y) && m === 2 && d === 28);
}

/** Personnes dont c'est l'anniversaire aujourd'hui (heure de Paris). */
export async function todaysBirthdays(service: Service): Promise<(Birthday & { email: string | null; announcedOn: string | null })[]> {
  const today = parisToday();
  const { data } = await service.from("profiles").select("id, first_name, last_name, email, birth_date, birthday_announced_on").not("birth_date", "is", null);
  return (data ?? [])
    .filter((p) => isBirthdayOn(p.birth_date!, today))
    .map((p) => ({ id: p.id, firstName: p.first_name ?? "", lastName: p.last_name ?? "", email: p.email, announcedOn: p.birthday_announced_on }));
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

const fullName = (b: Birthday) => `${b.firstName} ${b.lastName}`.trim();

/** Mail du jour : à la personne fêtée, ses vœux ; aux autres, « c'est l'anniversaire de … ». */
export function renderBirthdayMail(celebrants: Birthday[], recipient: { id: string; email: string }): ResendMessage {
  const board = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  const self = celebrants.find((c) => c.id === recipient.id);
  const others = celebrants.filter((c) => c.id !== recipient.id);
  const names = others.map(fullName);
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} et ${names.at(-1)}` : (names[0] ?? "");

  const subject = self ? `Joyeux anniversaire ${self.firstName} ! 🎉` : `🎂 C'est l'anniversaire de ${list} aujourd'hui`;
  const headline = self
    ? `Joyeux anniversaire <span style="color:#F2C14E">${escapeHtml(self.firstName)}</span> !`
    : `C'est l'anniversaire de ${escapeHtml(list)} !`;
  const body = self
    ? `Toute l'équipe de la Ligue Grand Est de Football te souhaite une excellente journée !${
        others.length ? `<br>Tu partages ce jour avec ${escapeHtml(list)}.` : ""
      }`
    : `Pensez à ${others.length > 1 ? "leur" : "lui"} souhaiter une excellente journée de la part de toute la Ligue Grand Est de Football.`;

  const html = `<div style="font-family:Arial,sans-serif;color:#0E2A55;max-width:620px">
<img src="${escapeHtml(board)}/banners/anniversaire.jpg" alt="" width="620" style="display:block;width:100%;max-width:620px;border-radius:12px 12px 0 0">
<div style="background:#12305F;color:#fff;padding:20px 24px;border-radius:0 0 12px 12px">
  <div style="font-size:24px;font-weight:800">${headline}</div>
  <div style="font-size:14px;opacity:.9;margin-top:6px;line-height:1.5">${body}</div>
</div>
<p style="margin-top:20px"><a href="${escapeHtml(board)}" style="background:#E1141B;color:#fff;padding:11px 18px;border-radius:6px;text-decoration:none;font-weight:700">Ouvrir le board</a></p>
<p style="font-size:12px;color:#6b7280">Mail envoyé à tout le personnel du board LGEF. Désactivez les notifications par e-mail dans vos paramètres du board pour ne plus le recevoir.</p>
</div>`;
  const text = `${subject}\n\n${self ? `Toute l'équipe de la Ligue Grand Est de Football te souhaite une excellente journée !` : `Pensez à souhaiter un joyeux anniversaire à ${list}.`}\n\n${board}`;
  return { to: [recipient.email], subject, html, text };
}

/**
 * Annonce du jour (une seule fois par anniversaire) : un mail à chaque compte qui accepte les mails
 * (profiles.notify_email), la personne fêtée comprise, puis anniversaire marqué « annoncé ».
 */
export async function announceBirthdays(service: Service, send: (messages: ResendMessage[]) => Promise<{ sent: number; errors: string[] }>) {
  const today = parisToday();
  const due = (await todaysBirthdays(service)).filter((b) => b.announcedOn !== today);
  if (!due.length) return { celebrants: 0, sent: 0, errors: [] as string[] };
  const { data: staff } = await service.from("profiles").select("id, email").eq("notify_email", true).not("email", "is", null);
  const messages = (staff ?? []).map((r) => renderBirthdayMail(due, { id: r.id, email: r.email! }));
  const result = await send(messages);
  // Marqué dès qu'un lot est parti : pas de doublon pour ceux déjà prévenus.
  if (result.sent > 0) await service.from("profiles").update({ birthday_announced_on: today }).in("id", due.map((b) => b.id));
  return { celebrants: due.length, ...result };
}
