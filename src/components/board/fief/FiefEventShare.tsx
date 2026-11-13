"use client";

import { useEffect, useMemo, useState } from "react";
import { Search, Send } from "lucide-react";
import { Toggle } from "@/components/board/Toggle";
import { getFiefEventShare, saveFiefEventShare, type FiefAudience, type FiefEventShareState } from "@/app/actions/fief-admin";

// « Visible sur FIEF » d'un événement (fiche événement → onglet FIEF, et onglet FIEF → Événements) :
// public visé (toutes, clubs, fonctions, sélection) qui voit l'événement dans son calendrier FIEF
// et reçoit la notification (FIEF, push, e-mail).

const AUDIENCES: { id: FiefAudience; label: string }[] = [
  { id: "all", label: "Toutes les membres FIEF" },
  { id: "clubs", label: "Un ou plusieurs clubs" },
  { id: "functions", label: "Une fonction (éducatrice, dirigeante, arbitre…)" },
  { id: "members", label: "Une sélection de personnes" },
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export function FiefEventShare({ eventId, onSaved }: { eventId: string; onSaved?: () => void }) {
  const [state, setState] = useState<FiefEventShareState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [audience, setAudience] = useState<FiefAudience>("all");
  const [clubs, setClubs] = useState<string[]>([]);
  const [functions, setFunctions] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [notify, setNotify] = useState(true);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    getFiefEventShare(eventId).then((r) => {
      if (!alive) return;
      if (!r.ok) return setLoadError(r.error);
      setState(r.data);
      const s = r.data.share;
      setEnabled(!!s);
      if (s) {
        setAudience(s.audience);
        setClubs(s.clubNumbers);
        setFunctions(s.functions);
        setMembers(s.memberIds);
        setNotify(!s.notifiedAt);
      }
    });
    return () => {
      alive = false;
    };
  }, [eventId]);

  const toggleIn = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const filteredClubs = useMemo(() => (state?.options.clubs ?? []).filter((c) => !q.trim() || fold(c.clubName).includes(fold(q.trim()))), [state, q]);
  const filteredMembers = useMemo(
    () => (state?.options.members ?? []).filter((m) => !q.trim() || fold(`${m.name} ${m.clubName ?? ""}`).includes(fold(q.trim()))),
    [state, q]
  );

  const save = async () => {
    setBusy(true);
    setMsg(null);
    const r = await saveFiefEventShare(eventId, { enabled, audience, clubNumbers: clubs, functions, memberIds: members, notify: enabled && notify });
    setBusy(false);
    if (!r.ok) return setMsg({ ok: false, text: r.error });
    const d = r.data;
    setMsg({
      ok: true,
      text: !d.shared
        ? "L'événement n'est plus visible sur FIEF."
        : notify
          ? d.notified
            ? `Visible sur FIEF — ${d.notified} membre${d.notified > 1 ? "s" : ""} notifiée${d.notified > 1 ? "s" : ""} (${d.pushed} par push, ${d.emailed} par e-mail).`
            : "Visible sur FIEF — personne ne correspond à ce public pour l'instant."
          : "Visible sur FIEF (sans notification).",
    });
    if (d.shared && notify) setNotify(false);
    onSaved?.();
  };

  if (loadError) return <p className="rounded-btn bg-bad-bg px-3 py-2 text-sm text-bad">{loadError}</p>;
  if (!state) return <p className="text-sm text-ink-3">Chargement…</p>;

  const memberCount = state.options.members.length;
  const picked = audience === "clubs" ? clubs : members;
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-card border border-line bg-panel px-4 py-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fief/crest.png" alt="" width={28} height={30} className="h-auto w-7" />
          <div>
            <p className="text-sm font-bold text-ink">Visible sur FIEF</p>
            <p className="text-xs text-ink-3">
              L&apos;événement apparaît dans le calendrier des membres visées ({memberCount} membre{memberCount > 1 ? "s" : ""} au total).
            </p>
          </div>
        </div>
        <Toggle on={enabled} onClick={() => setEnabled((v) => !v)} />
      </div>

      {enabled && (
        <div className="space-y-3">
          <p className="text-sm font-semibold text-ink">Qui voit l&apos;événement et reçoit la notification ?</p>
          <div className="space-y-1.5">
            {AUDIENCES.map((a) => (
              <label key={a.id} className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-2">
                <input
                  type="radio"
                  name={`fief-audience-${eventId}`}
                  checked={audience === a.id}
                  onChange={() => {
                    setAudience(a.id);
                    setQ("");
                  }}
                  className="accent-navy"
                />
                {a.label}
              </label>
            ))}
          </div>

          {audience === "functions" && (
            <div className="flex flex-wrap gap-1.5">
              {state.options.functions.map((f) => {
                const on = functions.includes(f.slug);
                return (
                  <button
                    key={f.slug}
                    type="button"
                    onClick={() => toggleIn(functions, setFunctions, f.slug)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold ${on ? "border-navy bg-navy text-white" : "border-line bg-card text-ink-2 hover:bg-hover"}`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>
          )}

          {(audience === "clubs" || audience === "members") && (
            <div className="rounded-card border border-line">
              <div className="relative border-b border-line">
                <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={audience === "clubs" ? "Chercher un club" : "Chercher une membre"}
                  className="w-full bg-transparent py-2 pl-8 pr-3 text-sm text-ink outline-none"
                />
              </div>
              <div className="max-h-56 overflow-y-auto p-1">
                {audience === "clubs" &&
                  (filteredClubs.length ? (
                    filteredClubs.map((c) => (
                      <label key={c.clubNumber} className="flex cursor-pointer items-center gap-2.5 rounded-btn px-2 py-1.5 text-sm hover:bg-hover">
                        <input type="checkbox" checked={clubs.includes(c.clubNumber)} onChange={() => toggleIn(clubs, setClubs, c.clubNumber)} className="accent-navy" />
                        <span className="flex-1 text-ink">{c.clubName}</span>
                        <span className="text-xs text-ink-4">
                          {c.count} membre{c.count > 1 ? "s" : ""}
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-xs text-ink-3">Aucun club parmi les membres.</p>
                  ))}
                {audience === "members" &&
                  (filteredMembers.length ? (
                    filteredMembers.map((m) => (
                      <label key={m.userId} className="flex cursor-pointer items-center gap-2.5 rounded-btn px-2 py-1.5 text-sm hover:bg-hover">
                        <input type="checkbox" checked={members.includes(m.userId)} onChange={() => toggleIn(members, setMembers, m.userId)} className="accent-navy" />
                        <span className="flex-1 text-ink">{m.name}</span>
                        <span className="truncate text-xs text-ink-4">{m.clubName}</span>
                      </label>
                    ))
                  ) : (
                    <p className="px-2 py-3 text-xs text-ink-3">Aucune membre.</p>
                  ))}
              </div>
              {picked.length > 0 && (
                <p className="border-t border-line px-3 py-1.5 text-xs text-ink-3">
                  {picked.length} sélectionné{picked.length > 1 ? "s" : ""}
                </p>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-2">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="accent-navy" />
            {state.share?.notifiedAt ? "Notifier à nouveau (notification FIEF, push et e-mail)" : "Notifier les membres visées (notification FIEF, push et e-mail)"}
          </label>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy || (!enabled && !state.share)}
          onClick={() => void save()}
          className="flex items-center gap-2 rounded-btn bg-navy px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          <Send size={14} />
          {busy ? "Enregistrement…" : enabled && notify ? "Enregistrer et notifier" : "Enregistrer"}
        </button>
        {msg && <span className={`text-xs font-semibold ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
