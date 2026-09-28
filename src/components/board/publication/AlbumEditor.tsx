"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronsLeft, Check, Image as ImageIcon, Plus, Upload, Video, X } from "lucide-react";
import { getEventFileViewUrl, listEventFiles, uploadEventFiles, type EventFile } from "@/lib/board/eventFiles";
import { getDriveStreamUrl } from "@/app/actions/media-stream";

const isMedia = (f: EventFile) => /^(image|video)\//.test(f.content_type ?? "");
const isVideo = (f: EventFile) => (f.content_type ?? "").startsWith("video");

// Les URL (signées, ~30 min à 1 h) ne sont demandées qu'une fois par fichier pendant la session.
const urlCache = new Map<string, Promise<string | null>>();
function thumbUrl(f: EventFile): Promise<string | null> {
  if (isVideo(f)) return Promise.resolve(null);
  let url = urlCache.get(f.id);
  if (!url) {
    url =
      f.storage_provider === "drive" && f.drive_file_id
        ? getDriveStreamUrl(f.event_id, f.drive_file_id)
        : getEventFileViewUrl(f);
    urlCache.set(f.id, url);
  }
  return url;
}

function Thumb({ file }: { file: EventFile }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    thumbUrl(file).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [file]);

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- URL signée temporaire, pas un asset statique optimisable
    return <img src={url} alt={file.filename} loading="lazy" draggable={false} className="h-full w-full object-cover" />;
  }
  const Icon = isVideo(file) ? Video : ImageIcon;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-1 text-ink-4">
      <Icon size={18} />
      <span className="w-full truncate text-center text-[9px]">{file.filename}</span>
    </div>
  );
}

/**
 * Album d'une publication rattachée à un événement : ordre des médias (glisser-déposer, ou flèches
 * sur la sélection — utilisables au doigt), retrait de médias sélectionnés (ils restent dans les
 * fichiers de l'événement), ajout depuis l'ordinateur ou depuis les autres médias de l'événement.
 * `onChange` reçoit le nouvel album complet ; `added` liste les fichiers qui viennent d'y entrer.
 */
export function AlbumEditor({
  eventId,
  files,
  onChange,
}: {
  eventId: string;
  files: EventFile[];
  onChange: (files: EventFile[], added: EventFile[]) => void;
}) {
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [eventMedia, setEventMedia] = useState<EventFile[] | null>(null);
  const [toAdd, setToAdd] = useState<Set<string>>(new Set());
  const [upload, setUpload] = useState<{ label: string; error?: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const inAlbum = new Set(files.map((f) => f.id));
  const others = (eventMedia ?? []).filter((f) => !inAlbum.has(f.id));
  const allSelected = files.length > 0 && selected.size === files.length;

  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const moveTo = (id: string, targetId: string) => {
    if (id === targetId) return;
    const from = files.findIndex((f) => f.id === id);
    const to = files.findIndex((f) => f.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...files];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next, []);
  };

  /** Décale d'un cran chaque média sélectionné (sans sauter par-dessus un autre média sélectionné). */
  const shift = (dir: -1 | 1) => {
    const next = [...files];
    const order = dir === -1 ? next.map((_, i) => i) : next.map((_, i) => next.length - 1 - i);
    for (const i of order) {
      const j = i + dir;
      if (!selected.has(next[i].id) || j < 0 || j >= next.length || selected.has(next[j].id)) continue;
      [next[i], next[j]] = [next[j], next[i]];
    }
    onChange(next, []);
  };

  const toFront = () => onChange([...files.filter((f) => selected.has(f.id)), ...files.filter((f) => !selected.has(f.id))], []);

  const removeSelected = () => {
    const rest = files.filter((f) => !selected.has(f.id));
    if (rest.length === 0) return alert("Un album doit garder au moins un média. Pour tout retirer, supprimez la publication.");
    onChange(rest, []);
    stopSelecting();
  };

  const openPicker = async () => {
    setPicking(true);
    setToAdd(new Set());
    const all = await listEventFiles(eventId);
    setEventMedia(all.filter(isMedia).sort((a, b) => a.created_at.localeCompare(b.created_at)));
  };

  const addPicked = () => {
    const added = others.filter((f) => toAdd.has(f.id));
    if (added.length) onChange([...files, ...added], added);
    setPicking(false);
  };

  const uploadFromDevice = async (list: FileList | null) => {
    const picked = Array.from(list ?? []).filter((f) => /^(image|video)\//.test(f.type) || /\.(heic|heif|mov|mp4)$/i.test(f.name));
    if (inputRef.current) inputRef.current.value = "";
    if (picked.length === 0) return;
    setUpload({ label: `Envoi de ${picked.length} fichier${picked.length > 1 ? "s" : ""}…` });
    try {
      const results = await uploadEventFiles(eventId, picked, (sent, total, current) =>
        setUpload({ label: `${current} — ${Math.round((sent / (total || 1)) * 100)} %` })
      );
      const ids = results.filter((r) => r.ok && r.id).map((r) => r.id as string);
      const all = await listEventFiles(eventId);
      setEventMedia(all.filter(isMedia).sort((a, b) => a.created_at.localeCompare(b.created_at)));
      const added = ids.map((id) => all.find((f) => f.id === id)).filter((f): f is EventFile => !!f && !inAlbum.has(f.id));
      if (added.length) onChange([...files, ...added], added);
      const failed = results.filter((r) => !r.ok);
      setUpload(failed.length ? { label: "", error: `Échec pour : ${failed.map((f) => f.name).join(", ")}` } : null);
    } catch (e) {
      setUpload({ label: "", error: e instanceof Error ? e.message : "Échec de l'envoi." });
    }
  };

  const btn = "flex items-center gap-1 rounded-btn border border-line px-2 py-1 text-[11px] font-semibold text-ink-2 hover:bg-subtle disabled:opacity-40";

  return (
    <div className="space-y-2 rounded-btn border border-line p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-auto text-[10px] font-mono uppercase tracking-[0.1em] text-ink-4">
          Album · {files.length} média{files.length > 1 ? "s" : ""}
        </span>
        {selecting ? (
          <>
            <button className={btn} onClick={() => setSelected(allSelected ? new Set() : new Set(files.map((f) => f.id)))}>
              {allSelected ? "Aucun" : "Tout"}
            </button>
            <button className={`${btn} text-bad`} disabled={selected.size === 0} onClick={removeSelected}>
              <X size={12} /> Retirer{selected.size ? ` (${selected.size})` : ""}
            </button>
            <button className={btn} onClick={stopSelecting}>
              Terminé
            </button>
          </>
        ) : (
          <>
            {files.length > 1 && (
              <button className={btn} onClick={() => setSelecting(true)}>
                <Check size={12} /> Sélectionner
              </button>
            )}
            <button className={btn} onClick={openPicker}>
              <Plus size={12} /> De l&rsquo;événement
            </button>
            <button className={btn} disabled={!!upload && !upload.error} onClick={() => inputRef.current?.click()}>
              <Upload size={12} /> Importer
            </button>
            <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => uploadFromDevice(e.target.files)} />
          </>
        )}
      </div>

      {selecting && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-3">Déplacer la sélection :</span>
          <button className={btn} onClick={toFront} title="En premier">
            <ChevronsLeft size={12} /> En premier
          </button>
          <button className={btn} onClick={() => shift(-1)} title="Avant">
            <ArrowLeft size={12} />
          </button>
          <button className={btn} onClick={() => shift(1)} title="Après">
            <ArrowRight size={12} />
          </button>
        </div>
      )}

      <div className="grid max-h-72 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-5">
        {files.map((f, i) => {
          const isSel = selected.has(f.id);
          return (
            <div
              key={f.id}
              draggable={!selecting}
              onDragStart={(e) => {
                setDragId(f.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
                setOverId(f.id);
              }}
              onDragLeave={() => setOverId((cur) => (cur === f.id ? null : cur))}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) moveTo(dragId, f.id);
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
              onClick={() => selecting && toggle(f.id)}
              title={f.filename}
              className={`relative aspect-square overflow-hidden rounded-btn bg-subtle ${
                selecting ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"
              } ${dragId === f.id ? "opacity-40" : ""} ${overId === f.id && dragId !== f.id ? "ring-2 ring-link" : ""} ${
                isSel ? "ring-2 ring-link" : ""
              }`}
            >
              <Thumb file={f} />
              <span className="absolute left-1 top-1 rounded-full bg-navy/80 px-1.5 text-[9px] font-bold text-white">{i + 1}</span>
              {i >= 10 && <span className="absolute bottom-1 left-1 rounded-full bg-black/60 px-1.5 text-[8px] text-white">hors Instagram</span>}
              {selecting && (
                <span
                  className={`absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full border ${
                    isSel ? "border-link bg-link text-white" : "border-white bg-black/30"
                  }`}
                >
                  {isSel && <Check size={10} />}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {!selecting && files.length > 1 && (
        <p className="text-[10px] text-ink-4">Glissez les vignettes pour changer l&rsquo;ordre — la n°1 est la couverture.</p>
      )}
      {upload && <p className={`text-[11px] ${upload.error ? "text-bad" : "text-ink-3"}`}>{upload.error ?? upload.label}</p>}

      {picking && (
        <div className="space-y-2 rounded-btn border border-dashed border-line p-2">
          <div className="flex items-center justify-between text-[11px] font-semibold text-ink-2">
            Autres médias de l&rsquo;événement
            <button onClick={() => setPicking(false)} className="text-ink-4 hover:text-ink">
              <X size={14} />
            </button>
          </div>
          {!eventMedia ? (
            <p className="text-[11px] text-ink-4">Chargement…</p>
          ) : others.length === 0 ? (
            <p className="text-[11px] text-ink-4">Tous les médias de l&rsquo;événement sont déjà dans l&rsquo;album.</p>
          ) : (
            <>
              <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-5">
                {others.map((f) => {
                  const on = toAdd.has(f.id);
                  return (
                    <button
                      key={f.id}
                      onClick={() =>
                        setToAdd((prev) => {
                          const next = new Set(prev);
                          if (on) next.delete(f.id);
                          else next.add(f.id);
                          return next;
                        })
                      }
                      title={f.filename}
                      className={`relative aspect-square overflow-hidden rounded-btn bg-subtle ${on ? "ring-2 ring-link" : ""}`}
                    >
                      <Thumb file={f} />
                      {on && (
                        <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-link text-white">
                          <Check size={10} />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <button onClick={addPicked} disabled={toAdd.size === 0} className={btn}>
                <Plus size={12} /> Ajouter à l&rsquo;album{toAdd.size ? ` (${toAdd.size})` : ""}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
