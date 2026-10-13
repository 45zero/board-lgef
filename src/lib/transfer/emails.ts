import "server-only";
import { sendTransactionalBatch, type EmailMessage } from "@/lib/email/transactional";
import { formatBytes } from "@/lib/transfer/shared";

// E-mails de LGEF Transfer. Le lien pointe toujours vers la page LGEF (…/t/<code>), jamais vers le
// fichier : le destinataire passe par la page (aperçu, pub) pour télécharger.

const base = () => (process.env.NEXT_PUBLIC_TRANSFER_URL || process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/+$/, "");

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long", year: "numeric" });

function layout(body: string) {
  return `<!doctype html><html><body style="margin:0;background:#eef1f7;font-family:Arial,Helvetica,sans-serif;color:#13203d">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f7;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td style="background:#0b1f5c;padding:20px;text-align:center"><img src="${base()}/lgeftransfer.png" alt="LGEF Transfer" height="72" style="height:72px"></td></tr>
<tr><td style="padding:28px 28px 8px">${body}</td></tr>
<tr><td style="padding:16px 28px 24px;font-size:11px;color:#7a8499">LGEF Transfer — Ligue du Grand Est de Football</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, label: string) =>
  `<p style="margin:24px 0"><a href="${href}" style="display:inline-block;background:#d6001c;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:10px">${label}</a></p>`;

async function send(messages: EmailMessage[]) {
  if (!messages.length) return;
  const { sent, errors } = await sendTransactionalBatch(messages, async () => {});
  if (!sent && errors.length) throw new Error(errors.join(" · "));
}

export async function sendCodeEmail(email: string, code: string) {
  await send([
    {
      to: [email],
      subject: `${code} — votre code LGEF Transfer`,
      text: `Votre code de vérification LGEF Transfer : ${code}\nIl est valable 15 minutes.`,
      html: layout(
        `<p style="font-size:15px">Votre code de vérification :</p>
<p style="font-size:34px;font-weight:bold;letter-spacing:8px;margin:12px 0">${code}</p>
<p style="font-size:13px;color:#56607a">Il est valable 15 minutes. Si vous n'avez rien demandé, ignorez cet e-mail.</p>`
      ),
    },
  ]);
}

type TransferForMail = {
  sender_email: string;
  sender_name: string;
  title: string;
  message: string;
  recipients: string[];
  total_bytes: number;
  expires_at: string | null;
};

function filesBlock(files: { name: string; size_bytes: number }[]) {
  const shown = files.slice(0, 8);
  const more = files.length - shown.length;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e3e7ef;border-radius:10px;font-size:13px">
${shown.map((f) => `<tr><td style="padding:8px 12px;border-bottom:1px solid #eef1f7">${esc(f.name)}</td><td style="padding:8px 12px;border-bottom:1px solid #eef1f7;text-align:right;color:#7a8499;white-space:nowrap">${formatBytes(f.size_bytes)}</td></tr>`).join("")}
${more > 0 ? `<tr><td colspan="2" style="padding:8px 12px;color:#7a8499">+ ${more} autre${more > 1 ? "s" : ""} fichier${more > 1 ? "s" : ""}</td></tr>` : ""}
</table>`;
}

export async function sendTransferEmails(t: TransferForMail, files: { name: string; size_bytes: number }[], link: string, opts: { recipientsOnly?: boolean } = {}) {
  const who = t.sender_name || t.sender_email;
  const count = `${files.length} fichier${files.length > 1 ? "s" : ""} (${formatBytes(t.total_bytes)})`;
  const expiry = t.expires_at ? `Disponible jusqu'au ${longDate(t.expires_at)}.` : "Disponible sans limite de durée.";
  const messages: EmailMessage[] = t.recipients.map((to) => ({
    to: [to],
    replyTo: t.sender_email,
    subject: `${who} vous a envoyé ${t.title ? `« ${t.title} »` : count} via LGEF Transfer`,
    text: `${who} vous a envoyé ${count}.\n${t.message ? `\n${t.message}\n` : ""}\nVoir et télécharger : ${link}\n${expiry}`,
    html: layout(
      `<p style="font-size:17px;font-weight:bold;margin:0 0 6px">${esc(who)} vous a envoyé ${esc(count)}</p>
${t.title ? `<p style="font-size:14px;margin:0 0 12px;color:#56607a">${esc(t.title)}</p>` : ""}
${t.message ? `<p style="font-size:14px;white-space:pre-line;background:#f5f7fb;border-radius:10px;padding:12px 14px">${esc(t.message)}</p>` : ""}
${filesBlock(files)}
${button(link, "Voir et télécharger")}
<p style="font-size:12px;color:#7a8499">${expiry}</p>`
    ),
  }));
  if (!opts.recipientsOnly) {
    messages.push({
      to: [t.sender_email],
      subject: `Votre transfert est prêt — ${t.title || count}`,
      text: `Votre transfert est en ligne : ${link}\n${t.recipients.length ? `Envoyé à : ${t.recipients.join(", ")}` : "Partagez ce lien avec vos destinataires."}\n${expiry}`,
      html: layout(
        `<p style="font-size:17px;font-weight:bold;margin:0 0 6px">Votre transfert est en ligne</p>
<p style="font-size:14px;color:#56607a;margin:0 0 12px">${t.recipients.length ? `Envoyé à ${esc(t.recipients.join(", "))}.` : "Partagez ce lien avec vos destinataires."} Vous serez prévenu au premier téléchargement.</p>
${filesBlock(files)}
${button(link, "Revoir le transfert")}
<p style="font-size:12px;color:#7a8499;word-break:break-all">${esc(link)}<br>${expiry}</p>`
      ),
    });
  }
  await send(messages);
}

export async function sendDownloadNoticeEmail(t: { sender_email: string; title: string }, fileName: string, link: string) {
  await send([
    {
      to: [t.sender_email],
      subject: `Vos fichiers ont été téléchargés${t.title ? ` — ${t.title}` : ""}`,
      text: `Premier téléchargement de votre transfert (${fileName}).\n${link}`,
      html: layout(
        `<p style="font-size:17px;font-weight:bold;margin:0 0 6px">Vos fichiers ont été téléchargés</p>
<p style="font-size:14px;color:#56607a">Premier téléchargement : <b>${esc(fileName)}</b>.</p>
${button(link, "Voir le transfert")}`
      ),
    },
  ]);
}
