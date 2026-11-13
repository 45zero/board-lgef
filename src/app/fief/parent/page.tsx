"use client";

import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Check } from "lucide-react";
import { confirmFiefParentConsent } from "@/app/actions/fief-public";
import { PublicFrame } from "@/components/fief/ui";

// Lien reçu par le parent d'une mineure : il donne son accord, la demande passe à l'équipe FIEF.
// L'accord demande un clic (rien n'est enregistré à la simple ouverture : les messageries testent les liens).

function Consent() {
  const token = useSearchParams().get("token") ?? "";
  const [state, setState] = useState<"ask" | "busy" | "done" | "already" | "error">("ask");
  const [firstName, setFirstName] = useState("");
  const [error, setError] = useState("");
  const sent = useRef(false);

  const confirm = async () => {
    if (sent.current) return;
    sent.current = true;
    setState("busy");
    const r = await confirmFiefParentConsent(token);
    if (!r.ok) {
      setError(r.error);
      setState("error");
      return;
    }
    setFirstName(r.data.firstName);
    setState(r.data.alreadyDone ? "already" : "done");
  };

  if (!token || state === "error")
    return (
      <>
        <h1 className="text-xl font-extrabold">Lien non valable</h1>
        <p className="mt-2 text-sm text-f-muted">{error || "Lien incomplet."}</p>
      </>
    );
  if (state === "done" || state === "already")
    return (
      <>
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-f-success-bg text-f-success">
          <Check size={30} strokeWidth={3} />
        </span>
        <h1 className="text-center text-xl font-extrabold">{state === "done" ? "Merci pour votre accord" : "Accord déjà enregistré"}</h1>
        <p className="mt-2 text-center text-sm text-f-muted">
          La demande de {firstName} est maintenant entre les mains de l&apos;équipe FIEF de la Ligue. Elle recevra un e-mail dès qu&apos;elle sera acceptée.
        </p>
      </>
    );
  return (
    <>
      <h1 className="text-xl font-extrabold">Accord parental</h1>
      <p className="mt-2 text-sm text-f-muted">
        Votre enfant a demandé à rejoindre FIEF, le réseau des femmes engagées dans le football du Grand Est proposé par la Ligue du Grand Est de Football. En confirmant, vous autorisez son
        inscription ; sa demande sera ensuite examinée par l&apos;équipe FIEF.
      </p>
      <button
        type="button"
        onClick={() => void confirm()}
        disabled={state === "busy"}
        className="mt-5 flex w-full items-center justify-center rounded-xl bg-f-accent px-4 py-3 text-[15px] font-bold text-white disabled:opacity-60"
      >
        {state === "busy" ? "Enregistrement…" : "Je donne mon accord"}
      </button>
      <p className="mt-3 text-center text-xs text-f-muted">Vous ne souhaitez pas donner votre accord ? Fermez simplement cette page.</p>
    </>
  );
}

export default function FiefParentPage() {
  return (
    <PublicFrame>
      <Suspense fallback={null}>
        <Consent />
      </Suspense>
    </PublicFrame>
  );
}
