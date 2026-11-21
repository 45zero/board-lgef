"use client";

// « Wizz » des relances rouges (son + fenêtre qui tremble) — module partagé par les pop-ups de relance
// (remises de photos / vidéos ; même son que les cartes Espace Team, RedReminderPopup.tsx).
// Les navigateurs (Safari surtout) n'autorisent l'audio qu'après un geste dans la page : un élément
// <audio> (WAV généré en mémoire) est « amorcé » en silence au premier clic / touche sur le board, puis
// peut être rejoué plus tard sans nouveau geste. Secours : Web Audio débloqué au même moment.
// Page jamais touchée depuis son ouverture : pas de son possible (le pop-up et le tremblement restent).

/** WAV du wizz : trois bourdonnements de 130 ms (carré 180 Hz modulé), 16 bits mono 22 kHz. */
function wizzWavUrl(): string {
  const rate = 22050;
  const total = Math.round(rate * 0.48);
  const data = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / rate;
    const k = Math.floor(t / 0.16);
    const local = t - k * 0.16;
    if (k > 2 || local > 0.13) continue;
    const env = Math.min(1, local / 0.01) * Math.min(1, (0.13 - local) / 0.03);
    const f = 180 + 60 * Math.sin(2 * Math.PI * 38 * t);
    const phase = (t * f) % 1;
    data[i] = Math.round((phase < 0.5 ? 1 : -1) * env * 0.35 * 32767);
  }
  const buf = new ArrayBuffer(44 + data.length * 2);
  const v = new DataView(buf);
  const str = (o: number, x: string) => [...x].forEach((c, j) => v.setUint8(o + j, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + data.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, data.length * 2, true);
  new Int16Array(buf, 44).set(data);
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

let el: HTMLAudioElement | null = null;
let primed = false;
let audio: AudioContext | null = null;

export function unlockAudio() {
  try {
    if (!el) {
      el = new Audio(wizzWavUrl());
      el.preload = "auto";
    }
    if (!primed) {
      const a = el;
      a.muted = true;
      void a
        .play()
        .then(() => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
          primed = true;
        })
        .catch(() => {
          a.muted = false;
        });
    }
    if (!audio) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctx) audio = new Ctx();
    }
    if (audio && audio.state !== "running") void audio.resume();
  } catch {
    /* son indisponible */
  }
}

/** Secours Web Audio : même wizz synthétisé à la volée. */
function playWizzWebAudio() {
  const ctx = audio;
  if (!ctx) return;
  const go = () => {
    const t0 = ctx.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const start = t0 + i * 0.16;
      const osc = ctx.createOscillator();
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 180;
      lfo.frequency.value = 38;
      lfoGain.gain.value = 60;
      lfo.connect(lfoGain).connect(osc.frequency);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      lfo.start(start);
      osc.stop(start + 0.14);
      lfo.stop(start + 0.14);
    }
  };
  if (ctx.state === "running") go();
  else void ctx.resume().then(() => ctx.state === "running" && go()).catch(() => undefined);
}

/** Le wizz : élément audio amorcé, sinon Web Audio. Silencieux si le navigateur refuse. */
export function playWizz() {
  try {
    if (el) {
      el.muted = false;
      el.currentTime = 0;
      void el.play().catch(() => playWizzWebAudio());
      return;
    }
    playWizzWebAudio();
  } catch {
    /* son indisponible : le pop-up suffit */
  }
}


/** Débloque le son au premier geste sur le board (à appeler une fois par pop-up monté). */
export function listenForAudioUnlock() {
  const opts = { capture: true, passive: true } as const;
  window.addEventListener("pointerdown", unlockAudio, opts);
  window.addEventListener("keydown", unlockAudio, opts);
  return () => {
    window.removeEventListener("pointerdown", unlockAudio, opts);
    window.removeEventListener("keydown", unlockAudio, opts);
  };
}

/** Tremblement du pop-up (animation CSS « lgef-wizz »). */
export const WIZZ_KEYFRAMES = `@keyframes lgef-wizz{0%,100%{transform:translate(0,0)}10%{transform:translate(-9px,3px)}20%{transform:translate(8px,-4px)}30%{transform:translate(-7px,-3px)}40%{transform:translate(7px,4px)}50%{transform:translate(-5px,2px)}60%{transform:translate(5px,-2px)}70%{transform:translate(-3px,1px)}80%{transform:translate(2px,-1px)}}`;
