"use client";

import { useState } from "react";
import {
  Clock,
  ChevronRight,
  Mail,
  Kanban,
  CalendarRange,
  Calendar,
  Gamepad2,
  FolderArchive,
  Search,
  SlidersHorizontal,
  Plus,
} from "lucide-react";
import type { ComponentType } from "react";

const TABS = [
  { id: "vue", label: "Vue d'ensemble", count: null },
  { id: "activite", label: "Mon activité", count: 8 },
  { id: "epingles", label: "Épinglés", count: 5 },
  { id: "mentions", label: "Mentions", count: 3 },
  { id: "annonces", label: "Annonces", count: null },
] as const;

const TODAY = new Date().toLocaleDateString("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

interface AppCard {
  id: string;
  label: string;
  detail: string;
  icon: ComponentType<{ size?: number }>;
}

const APP_CARDS: AppCard[] = [
  { id: "mails", label: "Mails", detail: "12 non lus · 3 à traiter", icon: Mail },
  { id: "trello", label: "Trello", detail: "5 cartes qui vous sont assignées", icon: Kanban },
  { id: "planning", label: "Planning", detail: "Semaine 38 · 4 pôles", icon: CalendarRange },
  { id: "calendrier", label: "Calendrier", detail: "7 événements cette semaine", icon: Calendar },
  { id: "quiz", label: "Quiz", detail: "1 session en direct", icon: Gamepad2 },
  { id: "pointage", label: "Pointage", detail: "Entrée à 08:41 · crédit +12 h 30", icon: Clock },
  { id: "ged", label: "GED", detail: "18 dépôts récents", icon: FolderArchive },
];

export function AccueilScreen({
  punchedIn,
  onTogglePunch,
}: {
  punchedIn: boolean;
  onTogglePunch: () => void;
}) {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["id"]>("vue");

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto rounded-panel p-1">
      <section>
        <div className="font-mono text-[10px] tracking-[0.1em] text-ink-4 uppercase">
          Accueil · Espace de travail
        </div>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-extrabold tracking-[-0.45px] text-ink">Vue d&rsquo;ensemble</h1>
            <p className="mt-1 text-sm text-ink-3">
              Tout ce qui vous attend aujourd&rsquo;hui, à travers les quatorze applications.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-btn border border-line bg-card px-3 py-2 text-ink-3">
              <Search size={14} />
              <input
                placeholder="Rechercher..."
                className="w-36 bg-transparent text-sm outline-none placeholder:text-ink-4"
              />
            </div>
            <button
              type="button"
              className="flex h-9 w-9 items-center justify-center rounded-btn border border-line text-ink-2 hover:bg-hover"
              aria-label="Filtrer"
            >
              <SlidersHorizontal size={15} />
            </button>
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-btn bg-navy px-3.5 py-2 text-sm font-bold text-white hover:bg-navy-600"
            >
              <Plus size={15} />
              Créer
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === tab.id
                  ? "border-navy bg-navy text-white"
                  : "border-line bg-card text-ink-2 hover:bg-hover"
              }`}
            >
              {tab.label}
              {tab.count !== null && (
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    activeTab === tab.id ? "bg-white/20" : "bg-subtle text-ink-3"
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section
        className="rounded-panel p-7 text-white"
        style={{
          background: "linear-gradient(160deg, var(--navy) 0%, var(--navy-500) 100%)",
        }}
      >
        <div className="font-mono text-[10px] tracking-[0.12em] text-white/70 uppercase">
          {TODAY}
        </div>
        <h1 className="mt-2 text-2xl font-extrabold">Bonjour Giovanni.</h1>
        <p className="mt-1 text-sm text-white/80">
          Trois réunions aujourd&rsquo;hui, douze mails à traiter et une session Quiz en direct à 14 h 00.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onTogglePunch}
            className="flex items-center gap-2 rounded-btn bg-red px-4 py-3 text-sm font-bold shadow-btn-red transition hover:bg-red-700"
          >
            <Clock size={16} />
            {punchedIn ? "Pointer la sortie" : "Pointer l'entrée"}
          </button>

          <button
            type="button"
            className="flex items-center gap-2 rounded-btn border border-white/25 bg-white/10 px-4 py-3 text-sm font-semibold"
          >
            Tableau de bord de pointage
            <ChevronRight size={15} />
          </button>

          <div className="flex items-center gap-2 font-mono text-xs text-white/80">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: punchedIn ? "#4ADE80" : "#FF8A8F" }}
            />
            {punchedIn ? "Entrée enregistrée à 08:41" : "Sortie enregistrée"}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">Vos applications</h2>
          <span className="text-xs text-ink-4">{APP_CARDS.length} actives sur 14</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {APP_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              className="flex items-center gap-3 rounded-card border border-line bg-card p-4 text-left shadow-card transition hover:border-line-strong"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-btn bg-subtle text-ink-2">
                <card.icon size={18} />
              </div>
              <div>
                <div className="text-sm font-bold text-ink">{card.label}</div>
                <div className="text-xs text-ink-3">{card.detail}</div>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
