"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Settings = {
  timezone: string;
  intervalMin: number;
  startHour: number;
  endHour: number;
  goalMl: number;
  glassMl: number;
  enabled: boolean;
};
type State = {
  settings: Settings;
  todayMl: number;
  logs: { id: string; amountMl: number; at: string }[];
  subscribed: boolean;
};
type PushStatus = "loading" | "unsupported" | "install" | "ask" | "denied" | "on";

const VAPID = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

function getDeviceId() {
  try {
    let id = localStorage.getItem("sip-device");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("sip-device", id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function b64ToUint8(base64: string) {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

const hourLabel = (h: number) =>
  h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
const timeLabel = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const ml = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 ? 2 : 1).replace(/0$/, "")} L` : `${n} ml`);

async function api(path: string, method = "GET", body?: unknown, signal?: AbortSignal) {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

const LOAD_TIMEOUT_MS = 10_000;

export default function Home() {
  const [deviceId, setDeviceId] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState("");
  const [push, setPush] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [fromReminder, setFromReminder] = useState(false);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  };

  // Load state, register the service worker, and work out where push setup stands.
  const loadState = useCallback(async () => {
    setLoadError("");
    const id = getDeviceId();
    setDeviceId(id);
    setFromReminder(new URLSearchParams(location.search).get("from") === "reminder");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    try {
      let s: State = await api(`/api/state?deviceId=${id}`, "GET", undefined, controller.signal);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && tz !== s.settings.timezone) s = await api("/api/settings", "PUT", { deviceId: id, timezone: tz });
      setState(s);
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        setPush(isIOS() && !isStandalone() ? "install" : "unsupported");
        return;
      }
      await navigator.serviceWorker.register("/sw.js");
      if (Notification.permission === "denied") setPush("denied");
      else if (Notification.permission === "granted" && s.subscribed) setPush("on");
      else setPush("ask");
    } catch (e) {
      const err = e as Error;
      setLoadError(err.name === "AbortError" ? "Taking too long to load. Check your connection and try again." : err.message);
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const turnOnReminders = async () => {
    setBusy(true);
    try {
      if (!VAPID) throw new Error("NEXT_PUBLIC_VAPID_PUBLIC_KEY is not set");
      const perm = await Notification.requestPermission(); // must run from a tap on iOS
      if (perm !== "granted") {
        setPush(perm === "denied" ? "denied" : "ask");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(VAPID) }));
      setState(await api("/api/subscribe", "POST", { deviceId, subscription: sub.toJSON() }));
      setPush("on");
      flash("Reminders are on 💧");
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const drink = useCallback(
    async (amountMl?: number) => {
      if (!deviceId) return;
      if ("vibrate" in navigator) navigator.vibrate?.(10);
      try {
        setState(await api("/api/log", "POST", { deviceId, amountMl }));
        setFromReminder(false);
      } catch (e) {
        flash((e as Error).message);
      }
    },
    [deviceId]
  );

  const undo = async () => {
    try {
      setState(await api("/api/log", "DELETE", { deviceId }));
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const save = async (patch: Partial<Settings>) => {
    if (!state) return;
    setState({ ...state, settings: { ...state.settings, ...patch } });
    try {
      setState(await api("/api/settings", "PUT", { deviceId, ...patch }));
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const test = async () => {
    try {
      await api("/api/test", "POST", { deviceId });
      flash("Test sent. Check your notifications.");
    } catch (e) {
      flash((e as Error).message);
      setPush("ask");
    }
  };

  const pct = useMemo(
    () => (state ? Math.min(state.todayMl / state.settings.goalMl, 1) : 0),
    [state]
  );

  if (loadError && !state) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center">
        <div>
          <p className="text-lg font-semibold text-foam">Couldn’t load Sip</p>
          <p className="mt-2 text-sm text-foam/60">{loadError}</p>
          <button
            onClick={loadState}
            className="mt-5 rounded-full bg-water px-6 py-2.5 font-semibold text-ink active:scale-95"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (!state) {
    return (
      <main className="grid min-h-dvh place-items-center text-foam/60">
        <p>Pouring…</p>
      </main>
    );
  }

  const s = state.settings;
  const glasses = Math.round(state.todayMl / s.glassMl);
  const goalGlasses = Math.ceil(s.goalMl / s.glassMl);
  const done = state.todayMl >= s.goalMl;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10 pt-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Sip</h1>
        <button
          onClick={() => setShowSettings((v) => !v)}
          className="rounded-full bg-deep px-4 py-2 text-sm font-medium text-foam/80 active:scale-95"
        >
          {showSettings ? "Done" : "Settings"}
        </button>
      </header>

      {fromReminder && !done && (
        <p className="mt-4 rounded-2xl bg-water/15 px-4 py-3 text-sm text-foam">
          Reminder time. Drink a glass, then tap the button below.
        </p>
      )}

      {/* Glass */}
      <section className="mt-6 flex flex-col items-center">
        <div className="relative h-72 w-48 overflow-hidden rounded-b-[3rem] rounded-t-xl border-4 border-foam/25 bg-deep/60">
          <div
            className="absolute inset-x-0 bottom-0 bg-water/80 transition-[height] duration-700 ease-out"
            style={{ height: `${pct * 100}%` }}
          >
            {pct > 0 && pct < 1 && (
              <svg className="wave absolute -top-3 left-0 h-4 w-[200%]" viewBox="0 0 200 10" preserveAspectRatio="none">
                <path
                  d="M0 5 Q 12.5 0 25 5 T 50 5 T 75 5 T 100 5 T 125 5 T 150 5 T 175 5 T 200 5 V10 H0 Z"
                  fill="rgb(56 189 248 / 0.8)"
                />
              </svg>
            )}
          </div>
          <div className="absolute inset-0 grid place-items-center text-center">
            <div>
              <p className="text-4xl font-bold tabular-nums drop-shadow">{ml(state.todayMl)}</p>
              <p className="mt-1 text-sm text-foam/80">of {ml(s.goalMl)}</p>
            </div>
          </div>
        </div>
        <p className="mt-4 text-foam/70">
          {done ? "Goal reached. Nice work 🎉" : `${glasses} of ${goalGlasses} glasses`}
        </p>
      </section>

      {/* Log buttons */}
      <section className="mt-6">
        <button
          onClick={() => drink()}
          className="w-full rounded-3xl bg-water py-5 text-xl font-bold text-ink shadow-lg shadow-water/20 active:scale-[0.98]"
        >
          + 1 glass ({s.glassMl} ml)
        </button>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {[100, 500, 750].map((a) => (
            <button key={a} onClick={() => drink(a)} className="rounded-2xl bg-deep py-3 font-medium active:scale-95">
              +{a} ml
            </button>
          ))}
        </div>
      </section>

      {/* Reminders */}
      <section className="mt-8 rounded-3xl bg-deep p-5">
        <h2 className="font-semibold">Reminders</h2>
        {push === "loading" && <p className="mt-2 text-sm text-foam/60">Checking…</p>}
        {push === "install" && (
          <div className="mt-2 space-y-2 text-sm text-foam/80">
            <p>On iPhone, notifications only work after you add Sip to your Home Screen:</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>Tap the Share button in Safari.</li>
              <li>Choose “Add to Home Screen”, then “Add”.</li>
              <li>Open Sip from your Home Screen and come back here.</li>
            </ol>
          </div>
        )}
        {push === "unsupported" && (
          <p className="mt-2 text-sm text-foam/80">
            This browser can’t receive push notifications. On iPhone you need iOS 16.4 or newer.
          </p>
        )}
        {push === "denied" && (
          <p className="mt-2 text-sm text-foam/80">
            Notifications are blocked. Turn them on in Settings › Notifications › Sip, then reopen the app.
          </p>
        )}
        {push === "ask" && (
          <button
            disabled={busy}
            onClick={turnOnReminders}
            className="mt-3 w-full rounded-2xl bg-foam py-3 font-semibold text-ink disabled:opacity-50 active:scale-[0.98]"
          >
            {busy ? "Turning on…" : "Turn on reminders"}
          </button>
        )}
        {push === "on" && (
          <div className="mt-2 space-y-3 text-sm">
            <p className="text-foam/80">
              {s.enabled
                ? `Every ${s.intervalMin >= 60 ? `${s.intervalMin / 60} h` : `${s.intervalMin} min`}, ${hourLabel(s.startHour)}–${hourLabel(s.endHour)}. Logging a drink resets the timer, and reminders stop once you hit your goal.`
                : "Paused."}
            </p>
            <div className="flex gap-3">
              <button onClick={() => save({ enabled: !s.enabled })} className="flex-1 rounded-2xl bg-ink py-2.5 font-medium">
                {s.enabled ? "Pause" : "Resume"}
              </button>
              <button onClick={test} className="flex-1 rounded-2xl bg-ink py-2.5 font-medium">
                Send a test
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Settings */}
      {showSettings && (
        <section className="mt-4 space-y-4 rounded-3xl bg-deep p-5 text-sm">
          <Field label="Remind me every">
            <select value={s.intervalMin} onChange={(e) => save({ intervalMin: +e.target.value })} className="sel">
              {[15, 30, 45, 60, 90, 120, 180].map((m) => (
                <option key={m} value={m}>
                  {m < 60 ? `${m} min` : `${m / 60} h`}
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <select value={s.startHour} onChange={(e) => save({ startHour: +e.target.value })} className="sel">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </Field>
          <Field label="Until">
            <select value={s.endHour} onChange={(e) => save({ endHour: +e.target.value })} className="sel">
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>{hourLabel(h)}</option>
              ))}
            </select>
          </Field>
          <Field label="Daily goal">
            <select value={s.goalMl} onChange={(e) => save({ goalMl: +e.target.value })} className="sel">
              {[1500, 2000, 2500, 3000, 3500, 4000].map((g) => (
                <option key={g} value={g}>{ml(g)}</option>
              ))}
            </select>
          </Field>
          <Field label="Glass size">
            <select value={s.glassMl} onChange={(e) => save({ glassMl: +e.target.value })} className="sel">
              {[150, 200, 250, 300, 330, 400, 500].map((g) => (
                <option key={g} value={g}>{g} ml</option>
              ))}
            </select>
          </Field>
          <p className="text-foam/50">Time zone: {s.timezone}</p>
        </section>
      )}

      {/* Today */}
      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Today</h2>
          {state.logs.length > 0 && (
            <button onClick={undo} className="text-sm text-water active:opacity-60">
              Undo last
            </button>
          )}
        </div>
        {state.logs.length === 0 ? (
          <p className="mt-2 text-sm text-foam/50">Nothing logged yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-foam/10">
            {state.logs.map((l) => (
              <li key={l.id} className="flex justify-between py-2.5 text-sm">
                <span className="text-foam/70">{timeLabel(l.at)}</span>
                <span className="font-medium tabular-nums">{l.amountMl} ml</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {toast && (
        <div className="fixed inset-x-5 bottom-[calc(env(safe-area-inset-bottom)+1.25rem)] mx-auto max-w-md rounded-2xl bg-foam px-4 py-3 text-center text-sm font-medium text-ink shadow-xl">
          {toast}
        </div>
      )}
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-4">
      <span className="text-foam/80">{label}</span>
      {children}
    </label>
  );
}
