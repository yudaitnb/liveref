import { create } from "zustand";
import type { RunResult } from "../runner/runnerClient";

type RunState = {
  running: boolean;
  lastResult: RunResult | null;
  lastError: string | null;

  setRunning: (v: boolean) => void;
  setResult: (r: RunResult | null) => void;
  setError: (msg: string | null) => void;
  clear: () => void;
};

export const useRunStore = create<RunState>((set) => ({
  running: false,
  lastResult: null,
  lastError: null,

  setRunning: (v) => set({ running: v }),
  setResult: (r) => set({ lastResult: r }),
  setError: (msg) => set({ lastError: msg }),
  clear: () => set({ lastResult: null, lastError: null }),
}));
