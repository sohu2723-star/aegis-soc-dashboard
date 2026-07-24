import { useEffect, useState } from "react";

const STORAGE_KEY = "aegis-sound-alerts";

let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  audioContext ??= new AudioContext();
  return audioContext;
}

function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx?.state === "suspended") void ctx.resume();
  } catch { /* AudioContext not available */ }
}

function beep(freq: number, duration: number, vol = 0.35, delay = 0) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const schedule = () => {
      if (ctx.state === "suspended") return; // still suspended — give up
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      const start = ctx.currentTime + delay;
      gain.gain.setValueAtTime(vol, start);
      gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
      osc.start(start);
      osc.stop(start + duration);
    };

    if (ctx.state === "suspended") {
      // Resume first, then schedule the beep
      ctx.resume().then(schedule).catch(() => {});
    } else {
      schedule();
    }
  } catch { /* AudioContext not available */ }
}

// Critical: triple urgent ascending beeps
function playCritical() {
  beep(523, 0.12, 0.45, 0);
  beep(659, 0.12, 0.45, 0.16);
  beep(880, 0.25, 0.45, 0.32);
}

// High: double beep
function playHigh() {
  beep(660, 0.15, 0.30, 0);
  beep(660, 0.15, 0.30, 0.22);
}

export function useSoundAlert() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== "false"; } catch { return true; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, String(enabled)); } catch { /* ignore */ }
  }, [enabled]);

  // Unlock AudioContext on first user gesture (required by browsers).
  // We also eagerly create the context here so resume() can be called later.
  useEffect(() => {
    const unlock = () => {
      unlockAudio();
      // Once unlocked, remove the listeners — the context stays "running"
    };
    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown",    unlock, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown",    unlock);
    };
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      if (!enabled) return;
      const severity = (e as CustomEvent<{ severity: string }>).detail?.severity;
      if (severity === "critical") playCritical();
      else if (severity === "high")     playHigh();
    };
    window.addEventListener("aegis:alert", handler);
    return () => window.removeEventListener("aegis:alert", handler);
  }, [enabled]);

  const toggle = () => setEnabled(v => !v);

  return { enabled, toggle };
}
