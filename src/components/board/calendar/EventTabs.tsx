"use client";

import { useEffect, useState } from "react";
import { Send, UserPlus, Navigation, Video } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useEventTeam } from "@/hooks/board/useEventTeam";
import { useEventComments } from "@/hooks/board/useEventComments";
import { useEventExpenses } from "@/hooks/board/useEventExpenses";
import type { useUserRole } from "@/hooks/board/useUserRole";
import type { useAvailableTechnicians } from "@/hooks/board/useAvailableTechnicians";
import type { useEventCoverage } from "@/hooks/board/useEventCoverage";

export function personName(
  p: { first_name: string | null; last_name: string | null; email: string | null } | null
) {
  if (!p) return "—";
  const name = [p.first_name, p.last_name].filter(Boolean).join(" ").trim();
  return name || p.email || "—";
}

export function DiscussionTab({ hook }: { hook: ReturnType<typeof useEventComments> }) {
  const [value, setValue] = useState("");
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {hook.comments.length === 0 && <p className="text-sm text-ink-4">Aucun message pour l&rsquo;instant.</p>}
        {hook.comments.map((c) => (
          <div key={c.id} className="rounded-btn bg-subtle px-3 py-2">
            <div className="text-xs font-semibold text-ink-2">{personName(c.author)}</div>
            <div className="text-sm text-ink">{c.body}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === "Enter" && value.trim()) {
              await hook.postComment(value);
              setValue("");
            }
          }}
          placeholder="Écrire un message…"
          className="flex-1 rounded-btn border border-line px-3 py-2 text-sm outline-none"
        />
        <button
          onClick={async () => {
            if (value.trim()) {
              await hook.postComment(value);
              setValue("");
            }
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-btn bg-navy text-white"
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}

interface ProfileOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

export function EquipeTab({ hook }: { hook: ReturnType<typeof useEventTeam> }) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<ProfileOption[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!pickerOpen) return;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("id, first_name, last_name, email")
      .order("first_name")
      .limit(200)
      .then(({ data }) => setOptions((data as ProfileOption[] | null) ?? []));
  }, [pickerOpen]);

  const filtered = options.filter((o) => personName(o).toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="space-y-3">
      {hook.team.map((m) => (
        <div key={m.id} className="flex items-center justify-between rounded-btn border border-line px-3 py-2">
          <div className="text-sm text-ink-2">
            {personName(m.profiles)}
            {m.role === "responsable" && <span className="ml-1 text-xs text-ink-4">(responsable)</span>}
          </div>
          {hook.canManageMembers && (
            <button onClick={() => hook.removeMember(m)} className="text-xs font-semibold text-red hover:underline">
              Retirer
            </button>
          )}
        </div>
      ))}

      {hook.canManageMembers && (
        <div className="relative">
          <button
            onClick={() => setPickerOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-btn border border-dashed border-line px-3 py-2 text-xs font-semibold text-ink-3 hover:bg-hover"
          >
            <UserPlus size={13} /> Ajouter
          </button>
          {pickerOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-72 rounded-btn border border-line bg-card p-2 shadow-card">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Rechercher…"
                className="mb-2 w-full rounded-btn border border-line px-2 py-1.5 text-sm outline-none"
              />
              <div className="max-h-56 overflow-y-auto">
                {filtered.map((p) => (
                  <button
                    key={p.id}
                    onClick={async () => {
                      await hook.addMember(p.id, "membre");
                      setPickerOpen(false);
                      setQuery("");
                    }}
                    className="block w-full rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover"
                  >
                    {personName(p)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FraisTab({ hook }: { hook: ReturnType<typeof useEventExpenses> }) {
  const [toll, setToll] = useState(0);
  const [meal, setMeal] = useState(0);
  const [other, setOther] = useState(0);
  const [otherDesc, setOtherDesc] = useState("");

  const total = hook.expenses.reduce((sum, e) => sum + (e.total_amount ?? 0), 0);

  return (
    <div className="space-y-4">
      <div className="text-lg font-extrabold text-ink">{total.toFixed(2)} €</div>

      {hook.expenses.map((e) => (
        <div key={e.id} className="flex items-center justify-between rounded-btn border border-line px-3 py-2 text-sm">
          <span>
            Péage {e.toll_fees ?? 0} € · Repas {e.meal_fees ?? 0} € · Autres {e.other_fees ?? 0} €
            {e.other_fees_description ? ` (${e.other_fees_description})` : ""}
          </span>
          <button onClick={() => hook.deleteExpense(e.id)} className="text-xs font-semibold text-red hover:underline">
            Supprimer
          </button>
        </div>
      ))}

      <div className="space-y-2 rounded-panel border border-line p-3">
        <div className="grid grid-cols-3 gap-2">
          <input type="number" min={0} step={0.01} value={toll || ""} onChange={(e) => setToll(parseFloat(e.target.value) || 0)} placeholder="Péage €" className="rounded-btn border border-line px-2 py-1.5 text-sm" />
          <input type="number" min={0} step={0.01} value={meal || ""} onChange={(e) => setMeal(parseFloat(e.target.value) || 0)} placeholder="Repas €" className="rounded-btn border border-line px-2 py-1.5 text-sm" />
          <input type="number" min={0} step={0.01} value={other || ""} onChange={(e) => setOther(parseFloat(e.target.value) || 0)} placeholder="Autres €" className="rounded-btn border border-line px-2 py-1.5 text-sm" />
        </div>
        {other > 0 && (
          <input value={otherDesc} onChange={(e) => setOtherDesc(e.target.value)} placeholder="Description des autres frais" className="w-full rounded-btn border border-line px-2 py-1.5 text-sm" />
        )}
        <button
          onClick={async () => {
            const ok = await hook.createExpense({ toll_fees: toll, meal_fees: meal, other_fees: other, other_fees_description: otherDesc || null });
            if (ok) {
              setToll(0);
              setMeal(0);
              setOther(0);
              setOtherDesc("");
            }
          }}
          disabled={toll === 0 && meal === 0 && other === 0}
          className="rounded-btn bg-navy px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
        >
          Ajouter la ligne de frais
        </button>
      </div>
    </div>
  );
}

export function GestionFraisPlaceholder() {
  return (
    <div className="rounded-panel border border-dashed border-line bg-card/60 p-6 text-sm text-ink-3">
      La validation des notes de frais par un administrateur n&rsquo;est pas encore construite dans Board
      LGEF — elle nécessite de porter <code>useAdminExpenseReports</code> et{" "}
      <code>useExpenseSubmissions</code> de calendrier-lgef. À venir dans une prochaine passe.
    </div>
  );
}

export function CarteTab({ location }: { location: string }) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`;
  return (
    <div className="space-y-3">
      <div className="flex h-[240px] items-center justify-center rounded-panel border border-dashed border-line bg-subtle text-sm text-ink-4">
        Emplacement réservé pour la vue cartographique (à fournir par le client — voir handoff §3)
      </div>
      <div className="text-sm text-ink-2">{location || "Aucune adresse renseignée."}</div>
      {location && (
        <a
          href={mapsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-btn border border-line px-3 py-2 text-xs font-semibold text-ink-2 hover:bg-hover"
        >
          <Navigation size={13} /> Itinéraire
        </a>
      )}
    </div>
  );
}

/** "Demander une couverture" / "Désigner directement" — pied du modal (§5.5 du handoff). */
export function CoverageActions({
  role,
  technicians,
  coverage,
}: {
  role: ReturnType<typeof useUserRole>;
  technicians: ReturnType<typeof useAvailableTechnicians>["technicians"];
  coverage: ReturnType<typeof useEventCoverage>;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const req = coverage.request;

  return (
    <div className="flex flex-wrap items-center gap-3 text-xs">
      {req ? (
        <span className="flex items-center gap-1.5 text-ink-3">
          <Video size={13} />
          {req.assigned_technician_name
            ? `Technicien assigné : ${req.assigned_technician_name}${req.technician_response === "pending" ? " (en attente de réponse)" : ""}`
            : "Couverture demandée — en attente d'assignation"}
        </span>
      ) : (
        role.isOrganizer && (
          <button
            onClick={() => coverage.requestCoverage()}
            className="flex items-center gap-1.5 font-semibold text-ink-2 hover:underline"
          >
            <Video size={13} /> Demander une couverture
          </button>
        )
      )}

      {role.isSuperUser && (
        <div className="relative">
          <button onClick={() => setPickerOpen((o) => !o)} className="font-semibold text-ink-2 hover:underline">
            Désigner directement
          </button>
          {pickerOpen && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-56 rounded-btn border border-line bg-card p-1 shadow-card">
              {technicians.length === 0 && (
                <div className="px-2 py-1.5 text-xs text-ink-4">Aucun technicien disponible</div>
              )}
              {technicians.map((t) => (
                <button
                  key={t.id}
                  onClick={async () => {
                    await coverage.assignTechnician(t);
                    setPickerOpen(false);
                  }}
                  className="block w-full rounded-btn px-2 py-1.5 text-left text-sm hover:bg-hover"
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
