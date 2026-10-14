import type { State } from "./types";

const KEY = "sip-state-cache";

/** Never throws — returns null on any failure (private mode, corrupt JSON, SSR). */
export function readCachedState(): State | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as State) : null;
  } catch {
    return null;
  }
}

/** Never throws — silently drops the write on any failure (private mode, quota). */
export function writeCachedState(state: State) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}
