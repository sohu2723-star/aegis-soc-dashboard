import { useEffect, useState } from "react";

const STORAGE_KEY = "aegis-sound-alerts";

function beep(freq: number, duration: number, vol = 0.35) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.type = "sine";
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
    setTimeout(() => ctx.close(), (duration + 0.2) * 1000);
  } catch { /* AudioContext not available */ }
}

// Critical: triple urgent ascending beeps
function playCritical() {
  beep(523, 0.12, 0.45);
  setTimeout(() => beep(659, 0.12, 0.45), 160);
  setTimeout(() => beep(880, 0.25, 0.45), 320);
}

// High: double beep
function playHigh() {
  beep(660, 0.15, 0.30);
  setTimeout(() => beep(660, 0.15, 0.30), 220);
}

export function useSoundAlert() {
  const [enabled, setEnabled] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEY) !== "false";
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(enabled));
  }, [enabled]);

  useEffect(() => {
    const handler = (e: Event) => {
      if (!enabled) return;
      const severity = (e as CustomEvent<{ severity: string }>).detail?.severity;
      if (severity === "critical") playCritical();
      else if (severity === "high") playHigh();
    };
    window.addEventListener("aegis:alert", handler);
    return () => window.removeEventListener("aegis:alert", handler);
  }, [enabled]);

  const toggle = () => setEnabled(v => !v);

  return { enabled, toggle };
}
