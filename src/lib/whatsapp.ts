import "server-only";

/**
 * Envoi via l'API Meta WhatsApp Cloud — même WABA « Ligue du Grand Est de Football » et même
 * utilisateur système (Lgef Publisher) que lgef-quiz. Hors conversation ouverte par le destinataire,
 * Meta impose un modèle pré-approuvé : ici META_WHATSAPP_TEMPLATE_INVITATION.
 *
 * Modèle attendu (WhatsApp Manager, langue « fr ») :
 *   Corps : Bonjour {{1}} {{2}}, … vous invite à {{3}} … {{4}} …
 *   Bouton « Visiter le site web », URL dynamique : https://board-lgef.vercel.app/inscription/{{1}}
 */

type TemplateComponent =
  | { type: "body"; parameters: { type: "text"; text: string }[] }
  | { type: "button"; sub_type: "url"; index: string; parameters: { type: "text"; text: string }[] };

export function isWhatsAppConfigured() {
  return (
    !!process.env.META_WHATSAPP_TOKEN &&
    !!process.env.META_WHATSAPP_PHONE_NUMBER_ID &&
    !!process.env.META_WHATSAPP_TEMPLATE_INVITATION
  );
}

/** Meta refuse les paramètres vides, les retours à la ligne/tabulations et plus de 4 espaces consécutifs. */
function param(text: string | null | undefined, fallback: string) {
  const clean = (text ?? "").replace(/[\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  return { type: "text" as const, text: clean || fallback };
}

async function sendTemplate(to: string, templateName: string, components: TemplateComponent[]) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) return { ok: false as const, error: "WhatsApp non configuré (variables Meta manquantes)." };

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/^\+/, ""),
      type: "template",
      template: { name: templateName, language: { code: "fr" }, components },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    console.error("[whatsapp] envoi refusé", res.status, body);
    return { ok: false as const, error: body?.error?.error_data?.details ?? body?.error?.message ?? `Meta ${res.status}` };
  }
  return { ok: true as const };
}

/** Invitation à un événement — `linkSuffix` = « {eventId}/{token} », complété par l'URL de base déclarée dans le modèle. */
export async function sendWhatsAppEventInvite(p: {
  to: string;
  firstName: string | null;
  lastName: string | null;
  eventTitle: string;
  eventDateLabel: string;
  linkSuffix: string;
}) {
  const templateName = process.env.META_WHATSAPP_TEMPLATE_INVITATION;
  if (!templateName) return { ok: false as const, error: "Modèle WhatsApp non configuré (META_WHATSAPP_TEMPLATE_INVITATION)." };
  return sendTemplate(p.to, templateName, [
    {
      type: "body",
      parameters: [
        param(p.firstName, "Madame, Monsieur"),
        param(p.lastName, "-"),
        param(p.eventTitle, "notre événement"),
        param(p.eventDateLabel, "prochainement"),
      ],
    },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: p.linkSuffix }] },
  ]);
}
