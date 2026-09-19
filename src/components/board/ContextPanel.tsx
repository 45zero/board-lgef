"use client";

import { ChevronRight } from "lucide-react";

const TODAY_ITEMS = [
  {
    time: "14:00",
    title: "Session Quiz en direct — Sécurité",
    meta: "App Quiz · 148 participants",
    tag: "Vidéo",
    tone: "bad" as const,
  },
  {
    time: "16:30",
    title: "Comité de direction",
    meta: "Siège · Grande salle",
    tag: "Photo",
    tone: "navy" as const,
  },
];

const ACTIVITY = [
  {
    initials: "AB",
    color: "#A50E15",
    name: "Ahmed Benali",
    text: "a lancé la session « Sécurité des rencontres ».",
    tag: "Quiz",
    time: "il y a 12 min",
  },
  {
    initials: "SL",
    color: "#12305F",
    name: "Sophie Lambert",
    text: "a déplacé 2 cartes dans « En cours ».",
    tag: "Trello",
    time: "il y a 40 min",
  },
  {
    initials: "CD",
    color: "#D98A0B",
    name: "Claire Dumont",
    text: "a relancé 34 collaborateurs sur le RGPD.",
    tag: "Communication",
    time: "il y a 3 h",
  },
  {
    initials: "TW",
    color: "#1F7A4D",
    name: "Thomas Weber",
    text: "a validé le module 4 du parcours U13.",
    tag: "Formations",
    time: "hier",
  },
];

export function ContextPanel() {
  return (
    <aside className="hidden w-[280px] shrink-0 flex-col gap-4 overflow-y-auto rounded-panel border border-line bg-card/70 p-4 shadow-bar backdrop-blur xl:flex">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[10px] tracking-[0.12em] text-ink-4 uppercase">
          Récapitulatif
        </h3>
        <ChevronRight size={14} className="text-ink-4" />
      </div>

      <div>
        <div className="mb-2 font-mono text-[9px] tracking-[0.1em] text-ink-4 uppercase">
          Aujourd&rsquo;hui
        </div>
        <div className="flex flex-col gap-2">
          {TODAY_ITEMS.map((item) => (
            <div
              key={item.title}
              className="rounded-btn border-l-4 p-3"
              style={{
                borderLeftColor: item.tone === "bad" ? "var(--bad)" : "var(--navy)",
                background: item.tone === "bad" ? "var(--bad-bg)" : "var(--sel-bg)",
              }}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold text-ink">{item.time}</span>
                <span className="rounded-full bg-card px-2 py-0.5 text-[10px] font-semibold text-ink-2">
                  {item.tag}
                </span>
              </div>
              <div className="mt-1 text-sm font-bold text-ink">{item.title}</div>
              <div className="text-xs text-ink-3">{item.meta}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 font-mono text-[9px] tracking-[0.1em] text-ink-4 uppercase">
          Activité du board
        </div>
        <div className="flex flex-col gap-3">
          {ACTIVITY.map((item, i) => (
            <div key={i} className="flex gap-2">
              <div
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                style={{ background: item.color }}
              >
                {item.initials}
              </div>
              <div className="text-xs text-ink-2">
                <span className="font-bold text-ink">{item.name}</span> {item.text}
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-[10px] font-semibold text-ink-3">
                    {item.tag}
                  </span>
                  <span className="text-[10px] text-ink-4">{item.time}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}
