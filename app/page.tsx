"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { History, Settings, State } from "@/lib/types";
import { readCachedState, writeCachedState } from "@/lib/stateCache";
import { reminderStatusText } from "@/lib/schedule";
import { HistoryChart } from "./history-chart";

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
const ml = (n: number) =>
  n >= 1000 ? `${n % 1000 === 0 ? n / 1000 : (n / 1000).toFixed(2).replace(/0$/, "")} L` : `${n} ml`;

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

const BUTTERFLIES = [
  { left: "30%", delay: "0ms", drift: "-16px" },
  { left: "48%", delay: "120ms", drift: "20px" },
  { left: "62%", delay: "60ms", drift: "-10px" },
  { left: "40%", delay: "200ms", drift: "14px" },
  { left: "55%", delay: "260ms", drift: "-18px" },
];

export default function Home() {
  const [deviceId, setDeviceId] = useState("");
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState("");
  const [push, setPush] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [pushError, setPushError] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<History | null>(null);
  const [fromReminder, setFromReminder] = useState(false);
  const [customMl, setCustomMl] = useState("");
  const [newSuppName, setNewSuppName] = useState("");
  const [newSuppTime, setNewSuppTime] = useState("09:00");
  const [celebrate, setCelebrate] = useState(false);
  const [showAddSupplement, setShowAddSupplement] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const wasDoneRef = useRef(false);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2600);
  };

  const commit = (s: State) => {
    setState(s);
    writeCachedState(s);
  };

  // Load state, register the service worker, and work out where push setup stands.
  const loadState = useCallback(async () => {
    setLoadError("");
    setPushError("");
    const id = getDeviceId();
    setDeviceId(id);
    setFromReminder(new URLSearchParams(location.search).get("from") === "reminder");

    const cached = readCachedState();
    if (cached) setState(cached);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LOAD_TIMEOUT_MS);
    try {
      let s: State = await api(`/api/state?deviceId=${id}`, "GET", undefined, controller.signal);
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (tz && tz !== s.settings.timezone) s = await api("/api/settings", "PUT", { deviceId: id, timezone: tz });
      commit(s);
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
      const message = err.name === "AbortError" ? "Taking too long to load. Check your connection and try again." : err.message;
      if (cached) flash(message);
      else setLoadError(message);
    } finally {
      clearTimeout(timer);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  const turnOnReminders = async () => {
    setBusy(true);
    setPushError("");
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
      commit(await api("/api/subscribe", "POST", { deviceId, subscription: sub.toJSON() }));
      setPush("on");
      flash("Reminders are on 💧");
    } catch (e) {
      const message = (e as Error).message;
      flash(message);
      setPushError(`Couldn't turn on reminders: ${message}`);
    } finally {
      setBusy(false);
    }
  };

  const drink = useCallback(
    async (amountMl?: number) => {
      if (!deviceId || !state) return;
      if ("vibrate" in navigator) navigator.vibrate?.(10);
      const amount = amountMl ?? state.settings.glassMl;
      const previous = state;
      const optimisticLog = { id: `pending-${Date.now()}`, amountMl: amount, at: new Date().toISOString() };
      setState({ ...state, todayMl: state.todayMl + amount, logs: [optimisticLog, ...state.logs] });
      setFromReminder(false);
      try {
        commit(await api("/api/log", "POST", { deviceId, amountMl }));
      } catch (e) {
        setState(previous);
        flash((e as Error).message);
      }
    },
    [deviceId, state]
  );

  const addCustom = () => {
    const amount = Math.round(Number(customMl));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 3000) {
      flash("Enter an amount between 1 and 3000 ml.");
      return;
    }
    drink(amount);
    setCustomMl("");
  };

  const undo = async () => {
    try {
      commit(await api("/api/log", "DELETE", { deviceId }));
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const save = async (patch: Partial<Settings>) => {
    if (!state) return;
    setState({ ...state, settings: { ...state.settings, ...patch } });
    try {
      commit(await api("/api/settings", "PUT", { deviceId, ...patch }));
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const toggleHistory = async () => {
    setShowHistory((v) => !v);
    if (!history && deviceId) {
      try {
        setHistory(await api(`/api/history?deviceId=${deviceId}`));
      } catch (e) {
        flash((e as Error).message);
      }
    }
  };

  const toggleSupplement = useCallback(
    async (supplementId: string, takenToday: boolean) => {
      if (!deviceId || !state) return;
      const previous = state;
      setState({
        ...state,
        supplements: state.supplements.map((v) => (v.id === supplementId ? { ...v, takenToday: !takenToday } : v)),
      });
      try {
        commit(
          takenToday
            ? await api("/api/supplements/log", "DELETE", { deviceId, supplementId })
            : await api("/api/supplements/log", "POST", { deviceId, supplementId })
        );
      } catch (e) {
        setState(previous);
        flash((e as Error).message);
      }
    },
    [deviceId, state]
  );

  const addSupplement = async () => {
    if (!newSuppName.trim()) return;
    try {
      commit(await api("/api/supplements", "POST", { deviceId, name: newSuppName.trim(), timeOfDay: newSuppTime }));
      setNewSuppName("");
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const updateSupplement = async (id: string, patch: { name?: string; timeOfDay?: string; enabled?: boolean }) => {
    try {
      commit(await api("/api/supplements", "PUT", { deviceId, id, ...patch }));
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const deleteSupplement = async (id: string) => {
    try {
      commit(await api("/api/supplements", "DELETE", { deviceId, id }));
    } catch (e) {
      flash((e as Error).message);
    }
  };

  const test = async () => {
    setPushError("");
    try {
      await api("/api/test", "POST", { deviceId });
      flash("Test sent. Check your notifications.");
    } catch (e) {
      const message = (e as Error).message;
      flash(message);
      setPushError(`Test push failed: ${message}`);
      setPush("ask");
    }
  };

  const pct = useMemo(
    () => (state ? Math.min(state.todayMl / state.settings.goalMl, 1) : 0),
    [state]
  );

  useEffect(() => {
    if (!state) return;
    const nowDone = state.todayMl >= state.settings.goalMl;
    if (nowDone && !wasDoneRef.current) setCelebrate(true);
    wasDoneRef.current = nowDone;
  }, [state]);

  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => setCelebrate(false), 2000);
    return () => clearTimeout(t);
  }, [celebrate]);

  // Re-evaluate the reminder-status text every 30s against a live clock, so it
  // never gets stuck showing a time that has already passed.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  // Refresh from the server whenever the app comes back to the foreground —
  // a lot can change while it was backgrounded (including a cron run).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") loadState();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadState]);

  const reminderStatus = useMemo(() => {
    if (!state) return null;
    return reminderStatusText({
      now,
      enabled: state.settings.enabled,
      timezone: state.settings.timezone,
      startHour: state.settings.startHour,
      endHour: state.settings.endHour,
      todayMl: state.todayMl,
      goalMl: state.settings.goalMl,
      nextReminderAt: state.nextReminderAt ? new Date(state.nextReminderAt) : null,
      lastCronAt: state.lastCronAt ? new Date(state.lastCronAt) : null,
    });
  }, [state, now]);

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
    <main className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-10">
      {celebrate && (
        <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
          {BUTTERFLIES.map((b, i) => (
            <span
              key={i}
              className="flutter absolute bottom-24 text-4xl"
              style={{ left: b.left, animationDelay: b.delay, "--drift": b.drift } as React.CSSProperties}
            >
              🦋
            </span>
          ))}
        </div>
      )}

      <header
        className="sticky top-0 z-10 -mx-5 flex items-center justify-between bg-ink/95 px-5 pb-4 backdrop-blur"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 1rem)" }}
      >
        <h1 className="text-2xl font-bold tracking-tight">Sip 🦋</h1>
        <div className="flex gap-2">
          <button
            onClick={toggleHistory}
            className="rounded-full bg-deep px-4 py-2 text-sm font-medium text-foam/80 active:scale-95"
          >
            {showHistory ? "Done" : "History"}
          </button>
          <button
            onClick={() => setShowSettings((v) => !v)}
            className="rounded-full bg-deep px-4 py-2 text-sm font-medium text-foam/80 active:scale-95"
          >
            {showSettings ? "Done" : "Settings"}
          </button>
        </div>
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
        <div className="mt-3 flex gap-2">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={3000}
            placeholder="Custom ml"
            value={customMl}
            onChange={(e) => setCustomMl(e.target.value)}
            className="sel flex-1"
          />
          <button onClick={addCustom} className="rounded-2xl bg-deep px-5 py-3 font-medium active:scale-95">
            Add
          </button>
        </div>
      </section>

      {/* Reminders */}
      <section className="mt-8 rounded-3xl bg-deep p-5">
        <h2 className="font-semibold">Reminders</h2>
        {pushError && (
          <p className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{pushError}</p>
        )}
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
            {s.enabled && !done && (
              <p className="text-foam/80">
                {`Every ${s.intervalMin >= 60 ? `${s.intervalMin / 60} h` : `${s.intervalMin} min`}, ${hourLabel(s.startHour)}–${hourLabel(s.endHour)}. Logging a drink resets the timer, and reminders stop once you hit your goal.`}
              </p>
            )}
            {reminderStatus && (
              <p className={reminderStatus.warning ? "rounded-xl bg-red-500/10 px-3 py-2 text-red-300" : "text-foam/60"}>
                {reminderStatus.text}
              </p>
            )}
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
          <div className="space-y-2 border-t border-foam/10 pt-4">
            <p className="text-foam/80">Vitamins</p>
            {state.supplements.map((v) => (
              <div key={v.id} className="flex items-center gap-2">
                <input
                  defaultValue={v.name}
                  onBlur={(e) => e.target.value.trim() && e.target.value !== v.name && updateSupplement(v.id, { name: e.target.value.trim() })}
                  className="sel min-w-0 flex-1"
                />
                <input
                  type="time"
                  defaultValue={v.timeOfDay}
                  onBlur={(e) => e.target.value !== v.timeOfDay && updateSupplement(v.id, { timeOfDay: e.target.value })}
                  className="sel"
                />
                <button onClick={() => deleteSupplement(v.id)} className="text-water active:opacity-60">
                  Delete
                </button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                placeholder="Vitamin name"
                value={newSuppName}
                onChange={(e) => setNewSuppName(e.target.value)}
                className="sel min-w-0 flex-1"
              />
              <input type="time" value={newSuppTime} onChange={(e) => setNewSuppTime(e.target.value)} className="sel" />
              <button onClick={addSupplement} className="rounded-xl bg-ink px-3 py-2 font-medium active:scale-95">
                Add
              </button>
            </div>
          </div>
          <p className="text-foam/50">Time zone: {s.timezone}</p>
        </section>
      )}

      {/* Vitamins */}
      <section className="mt-6 rounded-3xl bg-deep p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Vitamins today</h2>
          {state.supplements.length > 0 && (
            <span className="text-sm text-foam/60">
              {state.supplements.filter((v) => v.takenToday).length} of {state.supplements.length} taken
            </span>
          )}
        </div>
        {state.supplements.length === 0 && (
          <p className="mt-2 text-sm text-foam/50">🦋 No vitamins yet.</p>
        )}
        <ul className="mt-3 space-y-2">
          {state.supplements.map((v) => (
            <li key={v.id}>
              <button
                onClick={() => toggleSupplement(v.id, v.takenToday)}
                className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-sm active:scale-[0.98] ${
                  v.takenToday ? "bg-water/15 text-foam" : "bg-ink text-foam/80"
                }`}
              >
                <span>{v.takenToday ? "✅" : "🦋"} {v.name}</span>
                <span className="text-foam/50">{v.timeOfDay}</span>
              </button>
            </li>
          ))}
        </ul>
        {showAddSupplement ? (
          <div className="mt-3 flex items-center gap-2">
            <input
              placeholder="Vitamin name"
              value={newSuppName}
              onChange={(e) => setNewSuppName(e.target.value)}
              className="sel min-w-0 flex-1"
            />
            <input type="time" value={newSuppTime} onChange={(e) => setNewSuppTime(e.target.value)} className="sel" />
            <button
              onClick={() => {
                addSupplement();
                setShowAddSupplement(false);
              }}
              className="rounded-xl bg-ink px-3 py-2 font-medium active:scale-95"
            >
              Add
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowAddSupplement(true)}
            className="mt-3 text-sm text-water active:opacity-60"
          >
            + Add vitamin
          </button>
        )}
      </section>

      {/* History */}
      {showHistory && (
        <section className="mt-4 rounded-3xl bg-deep p-5">
          <h2 className="font-semibold">Last 7 days</h2>
          {history ? (
            <div className="mt-3">
              <HistoryChart history={history} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-foam/60">Loading…</p>
          )}
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
          <p className="mt-2 text-sm text-foam/50">🦋 Nothing logged yet.</p>
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
